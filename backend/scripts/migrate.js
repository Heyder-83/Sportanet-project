#!/usr/bin/env node
// backend/scripts/migrate.js
// Aplica migraciones SQL versionadas a la BD que indiquen las variables de entorno.
//
// Uso (desde backend/):
//   npm run migrate                 -> aplica pendientes a la BD de backend/.env (normalmente sportanet_v1)
//   npm run migrate:test            -> idem contra sportanet_test (usa .env.test)
//   npm run db:reset:test           -> recrea sportanet_test desde schema.sql y aplica todas las migraciones
//   node scripts/migrate.js --status    muestra aplicadas/pendientes y no cambia nada
//   node scripts/migrate.js --dry-run   lista lo que se aplicaría y no cambia nada
//   node scripts/migrate.js --yes       omite la confirmación interactiva (solo fuera de *_test)
//   node scripts/migrate.js --dir <carpeta> --schema <archivo>   rutas alternativas (pruebas)
//
// Convenciones:
// - Archivos en "Base de Datos/migrations/" con nombre NNN_descripcion.sql (p. ej. 002_users_avatar.sql).
//   NNN es la versión que se guarda en la tabla schema_migrations; se aplican en orden numérico.
// - El script registra la versión en schema_migrations al terminar con éxito; el .sql NO necesita
//   hacer su propio INSERT (si lo hace, no pasa nada: el registro duplicado se ignora).
// - MySQL NO revierte DDL (ALTER/CREATE/DROP confirman solos). Si una migración falla a mitad,
//   los cambios anteriores a esa sentencia ya están aplicados: por eso conviene UN cambio por archivo.
// - Fuera de una BD *_test pide confirmación escribiendo el nombre de la BD. Haz respaldo antes
//   (PROJECT_LOGIC §14): mysqldump ... --result-file=respaldo.sql
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline/promises');

// dotenv no pisa variables ya definidas, así que `node --env-file=.env.test` gana sobre backend/.env.
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), quiet: true });
const mysql = require('mysql2/promise');

const args = process.argv.slice(2);
const has = (name) => args.includes(name);
const opt = (name) => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
};

const DB_DIR = path.resolve(__dirname, '../../Base de Datos');
const MIGRATIONS_DIR = opt('--dir') ? path.resolve(opt('--dir')) : path.join(DB_DIR, 'migrations');
const SCHEMA_FILE = opt('--schema') ? path.resolve(opt('--schema')) : path.join(DB_DIR, 'schema.sql');

// Mismos valores por defecto que db/connection.js, para apuntar a la misma BD que la app.
const dbName = process.env.DB_NAME || 'sportanet_v1';
const isTestDb = /^[A-Za-z0-9_]+_test$/.test(dbName);
const baseConfig = {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT ? parseInt(process.env.DB_PORT, 10) : 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'root',
    multipleStatements: true
};

function fail(message) {
    console.error(`\nERROR: ${message}`);
    process.exitCode = 1;
}

// Lee y valida los archivos de migración.
function listMigrations() {
    if (!fs.existsSync(MIGRATIONS_DIR)) return [];
    const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => /^\d+_.+\.sql$/i.test(f));
    const migrations = files.map((file) => {
        const [, version, rest] = file.match(/^(\d+)_(.+)\.sql$/i);
        return { file, version, order: parseInt(version, 10), description: rest.replace(/_/g, ' ').slice(0, 255) };
    });
    migrations.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
    const seen = new Map();
    for (const m of migrations) {
        if (seen.has(m.version)) {
            throw new Error(`Versión duplicada ${m.version}: ${seen.get(m.version)} y ${m.file}`);
        }
        seen.set(m.version, m.file);
    }
    return migrations;
}

async function confirmTarget() {
    console.log(`\nATENCIÓN: "${dbName}" no es una BD de pruebas (*_test).`);
    console.log('Asegúrate de tener un respaldo reciente (mysqldump ... --result-file=respaldo.sql) y autorización.');
    if (!process.stdin.isTTY) {
        throw new Error('Sin terminal interactiva: usa --yes para confirmar explícitamente.');
    }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`Escribe el nombre de la BD (${dbName}) para continuar: `);
    rl.close();
    if (answer.trim() !== dbName) throw new Error('Confirmación incorrecta; no se aplicó nada.');
}

// Recrea la BD de pruebas desde schema.sql. Solo para *_test.
async function resetTestDb() {
    if (!isTestDb) {
        throw new Error(`--reset solo se permite en BD *_test (destino actual: "${dbName}").`);
    }
    if (!fs.existsSync(SCHEMA_FILE)) throw new Error(`No existe ${SCHEMA_FILE}`);
    const schemaSql = fs.readFileSync(SCHEMA_FILE, 'utf8');
    const conn = await mysql.createConnection(baseConfig); // sin database: puede no existir aún
    try {
        // dbName ya pasó la validación /^[A-Za-z0-9_]+_test$/, es seguro como identificador.
        await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4`);
        await conn.query(`USE \`${dbName}\``);
        await conn.query(schemaSql);
        console.log(`BD ${dbName} recreada desde ${path.basename(SCHEMA_FILE)}.`);
    } finally {
        await conn.end();
    }
}

async function main() {
    console.log(`Destino: ${baseConfig.user}@${baseConfig.host}:${baseConfig.port}/${dbName}`);
    console.log(`Migraciones: ${MIGRATIONS_DIR}`);

    const migrations = listMigrations();

    if (has('--reset')) await resetTestDb();

    let conn;
    try {
        conn = await mysql.createConnection({ ...baseConfig, database: dbName });
    } catch (err) {
        if (err.code === 'ER_BAD_DB_ERROR') {
            throw new Error(`La BD "${dbName}" no existe. En pruebas: npm run db:reset:test (la crea desde schema.sql).`);
        }
        throw err;
    }

    let locked = false;
    try {
        // Evita dos ejecuciones simultáneas sobre la misma BD.
        const [[lock]] = await conn.query("SELECT GET_LOCK('sportanet_migrate', 5) AS got");
        if (lock.got !== 1) throw new Error('Otra ejecución de migrate está en curso (no se obtuvo el bloqueo).');
        locked = true;

        let applied;
        try {
            [applied] = await conn.query('SELECT version, description, applied_at FROM schema_migrations');
        } catch (err) {
            if (err.code === 'ER_NO_SUCH_TABLE') {
                throw new Error('Falta la tabla schema_migrations: carga schema.sql primero (en pruebas: npm run db:reset:test).');
            }
            throw err;
        }

        const appliedSet = new Set(applied.map((r) => String(r.version)));
        const pending = migrations.filter((m) => !appliedSet.has(m.version));
        const orphans = applied.filter((r) => !migrations.some((m) => m.version === String(r.version)));

        console.log(`\nAplicadas en la BD: ${applied.length} | Archivos: ${migrations.length} | Pendientes: ${pending.length}`);
        for (const m of migrations) {
            console.log(`  [${appliedSet.has(m.version) ? 'aplicada' : 'PENDIENTE'}] ${m.file}`);
        }
        if (orphans.length) {
            console.log('  Registradas en la BD sin archivo en esta carpeta (informativo):',
                orphans.map((r) => r.version).join(', '));
            console.log('  Si una versión nueva coincide con una de estas, se tomaría como YA aplicada: revisa la numeración.');
        }

        if (has('--status') || has('--dry-run') || pending.length === 0) {
            if (pending.length === 0) console.log('\nNada que aplicar.');
            return;
        }

        if (!isTestDb && !has('--yes')) await confirmTarget();

        for (const m of pending) {
            const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, m.file), 'utf8');
            if (!sql.trim()) throw new Error(`${m.file} está vacío.`);
            process.stdout.write(`\nAplicando ${m.file} ... `);
            try {
                await conn.query(sql);
            } catch (err) {
                console.log('FALLÓ');
                throw new Error(
                    `${m.file}: ${err.code || ''} ${err.sqlMessage || err.message}\n` +
                    '  No se registró en schema_migrations. MySQL no revierte DDL: si el archivo tenía varias\n' +
                    '  sentencias, las anteriores a la que falló YA se aplicaron. Revisa la BD antes de reintentar.'
                );
            }
            // INSERT IGNORE: tolera migraciones que ya se registran a sí mismas.
            await conn.query('INSERT IGNORE INTO schema_migrations (version, description) VALUES (?, ?)', [m.version, m.description]);
            console.log('OK');
        }
        console.log(`\n${pending.length} migración(es) aplicada(s) en ${dbName}.`);
    } finally {
        if (locked) await conn.query("SELECT RELEASE_LOCK('sportanet_migrate')").catch(() => {});
        await conn.end();
    }
}

main().catch((err) => fail(err.message));
