// backend/test/dbSsl.test.js
// Pruebas de la configuración TLS hacia MySQL (DB_SSL / DB_SSL_CA).
// No necesitan base de datos, credenciales de Azure, ni que mysql2/dotenv estén instalados (ver helpers/dbStubs.js).
// Certificados: se usa una CA pública de la lista que trae Node (tls.rootCertificates) como PEM de prueba;
// no se inventa ni se descarga ningún certificado.
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const { spawnSync } = require('node:child_process');

const { buildSslOptions, loadCaBundle, parseDbSsl, DbSslConfigError } = require('../utils/dbSsl');
const { installDbStubs } = require('./helpers/dbStubs');

const BACKEND_DIR = path.resolve(__dirname, '..');
const MIGRATE = path.join(BACKEND_DIR, 'scripts', 'migrate.js');
const PRELOAD = path.join(__dirname, 'helpers', 'preloadDbStubs.js');

const [ROOT_A, ROOT_B] = tls.rootCertificates; // PEM públicos incluidos en Node
let tmpDir;
let validCaFile; // un certificado
let bundleCaFile; // dos certificados

beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sportanet-ssl-'));
    validCaFile = path.join(tmpDir, 'ca.pem');
    bundleCaFile = path.join(tmpDir, 'bundle.pem');
    fs.writeFileSync(validCaFile, ROOT_A);
    fs.writeFileSync(bundleCaFile, `${ROOT_A}\n${ROOT_B}\n`);
});
afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

const noWarn = () => assert.fail('no debía emitirse ninguna advertencia');

describe('parseDbSsl', () => {
    test('interpreta valores verdaderos y falsos, sin importar mayúsculas ni espacios', () => {
        for (const v of ['true', 'TRUE', ' True ', '1', 'yes', 'on']) assert.equal(parseDbSsl(v), true, v);
        for (const v of ['false', 'FALSE', '0', 'no', 'off', '', '   ', undefined, null]) assert.equal(parseDbSsl(v), false, String(v));
    });

    test('un valor desconocido es un error (un typo no puede desactivar TLS en silencio)', () => {
        assert.throws(() => parseDbSsl('tru'), (err) => err instanceof DbSslConfigError && err.code === 'DB_SSL_INVALID');
        assert.throws(() => parseDbSsl('required'), { code: 'DB_SSL_INVALID' });
    });
});

describe('buildSslOptions: DB_SSL=false (local / Docker)', () => {
    test('sin DB_SSL no devuelve opciones ssl ni advierte', () => {
        assert.equal(buildSslOptions({}, { warn: noWarn }), undefined);
    });

    test('DB_SSL=false explícito no devuelve opciones ssl', () => {
        assert.equal(buildSslOptions({ DB_SSL: 'false', DB_SSL_CA: '' }, { warn: noWarn }), undefined);
    });

    test('con DB_SSL=false no lee ni valida DB_SSL_CA (aunque no exista), pero advierte que no hay TLS', () => {
        const warnings = [];
        const result = buildSslOptions(
            { DB_SSL: 'false', DB_SSL_CA: path.join(tmpDir, 'no-existe.pem') },
            { warn: (m) => warnings.push(m) }
        );
        assert.equal(result, undefined);
        assert.equal(warnings.length, 1);
        assert.match(warnings[0], /DB_SSL_CA.*DB_SSL no es true.*NO usa TLS/);
    });
});

describe('buildSslOptions: DB_SSL=true', () => {
    test('sin DB_SSL_CA activa TLS con rejectUnauthorized true y sin ca (CA del sistema)', () => {
        const ssl = buildSslOptions({ DB_SSL: 'true' }, { warn: noWarn });
        assert.deepEqual(ssl, { rejectUnauthorized: true });
        assert.equal('ca' in ssl, false);
    });

    test('con DB_SSL_CA válido carga el contenido del certificado (no la ruta) y mantiene rejectUnauthorized', () => {
        const ssl = buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: validCaFile }, { warn: noWarn });
        assert.equal(ssl.rejectUnauthorized, true);
        assert.ok(Array.isArray(ssl.ca));
        assert.equal(ssl.ca.length, 1);
        assert.equal(ssl.ca[0].trim(), ROOT_A.trim());
        assert.ok(!JSON.stringify(ssl).includes(validCaFile), 'la ruta no debe pasarse a mysql2');
    });

    test('admite un bundle con varios certificados (como el que pide Microsoft: DigiCert G2 + Microsoft RSA 2017)', () => {
        const ssl = buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: bundleCaFile });
        assert.equal(ssl.ca.length, 2);
        assert.equal(ssl.rejectUnauthorized, true);
    });

    test('ignora texto ajeno entre certificados y espacios alrededor de la ruta', () => {
        const messy = path.join(tmpDir, 'messy.pem');
        fs.writeFileSync(messy, `# comentario\n${ROOT_A}\nbasura\n${ROOT_B}\n`);
        const ssl = buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: `  ${messy}  ` });
        assert.equal(ssl.ca.length, 2);
    });

    test('rejectUnauthorized nunca puede desactivarse mediante variables de entorno', () => {
        const ssl = buildSslOptions({
            DB_SSL: 'true',
            DB_SSL_REJECT_UNAUTHORIZED: 'false',
            NODE_TLS_REJECT_UNAUTHORIZED: '0'
        });
        assert.equal(ssl.rejectUnauthorized, true);
    });

    test('una ruta relativa se resuelve desde backend/ (igual que backend/.env)', () => {
        let seen;
        const ssl = buildSslOptions(
            { DB_SSL: 'true', DB_SSL_CA: 'certs/azure-mysql-ca-bundle.pem' },
            { readFileSync: (p) => { seen = p; return ROOT_A; } }
        );
        assert.equal(seen, path.join(BACKEND_DIR, 'certs', 'azure-mysql-ca-bundle.pem'));
        assert.equal(ssl.ca.length, 1);
    });

    test('una ruta absoluta se respeta tal cual', () => {
        let seen;
        buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: validCaFile }, { readFileSync: (p) => { seen = p; return ROOT_A; } });
        assert.equal(seen, validCaFile);
    });
});

describe('buildSslOptions: certificados inexistentes o inválidos (fail-closed)', () => {
    test('archivo inexistente => DB_SSL_CA_NOT_FOUND con la ruta en el mensaje', () => {
        const missing = path.join(tmpDir, 'no-existe.pem');
        assert.throws(
            () => buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: missing }),
            (err) => err instanceof DbSslConfigError && err.code === 'DB_SSL_CA_NOT_FOUND' && err.message.includes(missing)
        );
    });

    test('ruta que es un directorio => DB_SSL_CA_UNREADABLE', () => {
        assert.throws(() => buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: tmpDir }), { code: 'DB_SSL_CA_UNREADABLE' });
    });

    test('archivo vacío => DB_SSL_CA_INVALID', () => {
        const empty = path.join(tmpDir, 'empty.pem');
        fs.writeFileSync(empty, '');
        assert.throws(() => buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: empty }), { code: 'DB_SSL_CA_INVALID' });
    });

    test('texto que no es PEM => DB_SSL_CA_INVALID', () => {
        const txt = path.join(tmpDir, 'notes.txt');
        fs.writeFileSync(txt, 'esto no es un certificado');
        assert.throws(() => buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: txt }), { code: 'DB_SSL_CA_INVALID' });
    });

    test('certificado binario DER (como se descarga el de Microsoft) => DB_SSL_CA_INVALID con pista de conversión', () => {
        const der = path.join(tmpDir, 'microsoft.crt');
        fs.writeFileSync(der, Buffer.from([0x30, 0x82, 0x05, 0xa3, 0x30, 0x82, 0x03, 0x8b, 0xa0, 0x03, 0x02, 0x01, 0x02]));
        assert.throws(
            () => buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: der }),
            (err) => err.code === 'DB_SSL_CA_INVALID' && /DER/.test(err.message) && /openssl/.test(err.message)
        );
    });

    test('estructura PEM con contenido corrupto => DB_SSL_CA_INVALID', () => {
        const bad = path.join(tmpDir, 'corrupt.pem');
        fs.writeFileSync(bad, '-----BEGIN CERTIFICATE-----\nAAAAAAAA\n-----END CERTIFICATE-----\n');
        assert.throws(() => buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: bad }), { code: 'DB_SSL_CA_INVALID' });
    });

    test('un certificado bueno junto a uno corrupto también se rechaza', () => {
        const mixed = path.join(tmpDir, 'mixed.pem');
        fs.writeFileSync(mixed, `${ROOT_A}\n-----BEGIN CERTIFICATE-----\nAAAAAAAA\n-----END CERTIFICATE-----\n`);
        assert.throws(() => buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: mixed }), { code: 'DB_SSL_CA_INVALID' });
    });

    test('certificados todos caducados => DB_SSL_CA_EXPIRED', () => {
        assert.throws(
            () => loadCaBundle(validCaFile, { now: new Date('2999-01-01T00:00:00Z') }),
            { code: 'DB_SSL_CA_EXPIRED' }
        );
    });

    test('el mensaje de error no filtra el contenido del certificado', () => {
        const bad = path.join(tmpDir, 'corrupt.pem');
        fs.writeFileSync(bad, '-----BEGIN CERTIFICATE-----\nSECRETO123\n-----END CERTIFICATE-----\n');
        assert.throws(() => buildSslOptions({ DB_SSL: 'true', DB_SSL_CA: bad }), (err) => !err.message.includes('SECRETO123'));
    });

    test('DB_SSL con valor inválido falla incluso si DB_SSL_CA es correcto', () => {
        assert.throws(() => buildSslOptions({ DB_SSL: 'maybe', DB_SSL_CA: validCaFile }), { code: 'DB_SSL_INVALID' });
    });
});

// ---------------------------------------------------------------------------------------------------------------
// Pools: db/connection.js y db/connectionAd.js (con mysql2 simulado)
// ---------------------------------------------------------------------------------------------------------------
const ENV_KEYS = [
    'DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'DB_SSL', 'DB_SSL_CA',
    'DB_AD_HOST', 'DB_AD_PORT', 'DB_AD_NAME', 'DB_AD_USER', 'DB_AD_PASSWORD', 'NODE_ENV'
];

// Carga un módulo de db/ con un entorno controlado y devuelve la config con la que se creó el pool.
function loadPool(relativeModule, env) {
    const saved = {};
    for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
    Object.assign(process.env, env);

    const calls = [];
    const restoreLoad = installDbStubs((kind, config) => calls.push({ kind, config }));
    const modulePath = require.resolve(relativeModule);
    delete require.cache[modulePath];
    try {
        require(modulePath);
        return calls;
    } finally {
        delete require.cache[modulePath];
        restoreLoad();
        for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    }
}

const AD_ENV = { DB_NAME: 'sportanet_v1', DB_USER: 'app', DB_AD_NAME: 'spn_ad', DB_AD_USER: 'ad_user', DB_AD_PASSWORD: 'x' };

describe('db/connection.js (pool principal)', () => {
    test('sin variables: configuración local de siempre, sin ssl', () => {
        const [{ kind, config }] = loadPool('../db/connection', {});
        assert.equal(kind, 'createPool');
        assert.deepEqual(config, {
            connectionLimit: 10, waitForConnections: true,
            host: 'localhost', port: 3306, user: 'root', password: 'root', database: 'sportanet_v1'
        });
        assert.equal('ssl' in config, false);
    });

    test('entorno tipo Docker (docker-compose.yml): host db, sin ssl', () => {
        const [{ config }] = loadPool('../db/connection', {
            DB_HOST: 'db', DB_PORT: '3306', DB_USER: 'sportanet', DB_PASSWORD: 'sportanet', DB_NAME: 'sportanet_v1', NODE_ENV: 'production'
        });
        assert.equal(config.host, 'db');
        assert.equal(config.user, 'sportanet');
        assert.equal('ssl' in config, false);
    });

    test('DB_SSL=false explícito: sin ssl', () => {
        const [{ config }] = loadPool('../db/connection', { DB_SSL: 'false' });
        assert.equal('ssl' in config, false);
    });

    test('DB_SSL=true + DB_SSL_CA: ssl con rejectUnauthorized true y la CA cargada; el resto de la config no cambia', () => {
        const [{ config }] = loadPool('../db/connection', {
            DB_HOST: 'srv.mysql.database.azure.com', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'sportanet_v1',
            DB_SSL: 'true', DB_SSL_CA: validCaFile
        });
        assert.equal(config.ssl.rejectUnauthorized, true);
        assert.equal(config.ssl.ca.length, 1);
        assert.equal(config.host, 'srv.mysql.database.azure.com');
        assert.equal(config.connectionLimit, 10);
    });

    test('DB_SSL=true sin DB_SSL_CA: ssl con rejectUnauthorized true', () => {
        const [{ config }] = loadPool('../db/connection', { DB_SSL: 'true' });
        assert.deepEqual(config.ssl, { rejectUnauthorized: true });
    });

    test('DB_SSL=true con CA inexistente: falla al cargar y NO crea ningún pool (sin caída a conexión insegura)', () => {
        const calls = [];
        const saved = {};
        for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
        process.env.DB_SSL = 'true';
        process.env.DB_SSL_CA = path.join(tmpDir, 'no-existe.pem');
        const restoreLoad = installDbStubs((kind, config) => calls.push({ kind, config }));
        const modulePath = require.resolve('../db/connection');
        delete require.cache[modulePath];
        try {
            assert.throws(() => require(modulePath), { code: 'DB_SSL_CA_NOT_FOUND' });
            assert.equal(calls.length, 0);
        } finally {
            delete require.cache[modulePath];
            restoreLoad();
            for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
        }
    });
});

describe('db/connectionAd.js (pool SPN_AD)', () => {
    test('DB_SSL sin definir: sin ssl y misma config que antes', () => {
        const [{ kind, config }] = loadPool('../db/connectionAd', AD_ENV);
        assert.equal(kind, 'createPool');
        assert.deepEqual(config, {
            connectionLimit: 5, waitForConnections: true,
            host: 'localhost', port: 3306, user: 'ad_user', password: 'x', database: 'spn_ad'
        });
    });

    test('DB_SSL=false: sin ssl', () => {
        const [{ config }] = loadPool('../db/connectionAd', { ...AD_ENV, DB_SSL: 'false' });
        assert.equal('ssl' in config, false);
    });

    test('DB_SSL=true + DB_SSL_CA: ssl con rejectUnauthorized true y la CA cargada', () => {
        const [{ config }] = loadPool('../db/connectionAd', { ...AD_ENV, DB_SSL: 'true', DB_SSL_CA: bundleCaFile });
        assert.equal(config.ssl.rejectUnauthorized, true);
        assert.equal(config.ssl.ca.length, 2);
        assert.equal(config.user, 'ad_user');
    });

    test('DB_SSL=true con CA corrupta: lanza DB_SSL_CA_INVALID', () => {
        const bad = path.join(tmpDir, 'bad.pem');
        fs.writeFileSync(bad, 'no es un certificado');
        assert.throws(() => loadPool('../db/connectionAd', { ...AD_ENV, DB_SSL: 'true', DB_SSL_CA: bad }), { code: 'DB_SSL_CA_INVALID' });
    });

    test('las validaciones de seguridad existentes siguen vigentes (faltan variables / misma base)', () => {
        assert.throws(() => loadPool('../db/connectionAd', {}), /Faltan variables de entorno para SPN_AD/);
        assert.throws(() => loadPool('../db/connectionAd', { ...AD_ENV, DB_AD_NAME: 'sportanet_v1' }), /DB_AD_NAME no puede ser la base principal/);
    });
});

// ---------------------------------------------------------------------------------------------------------------
// scripts/migrate.js (proceso hijo con mysql2/promise simulado)
// ---------------------------------------------------------------------------------------------------------------
function runMigrate(args, env) {
    const childEnv = { ...process.env };
    for (const k of Object.keys(childEnv)) if (/^DB_/.test(k) || k === 'NODE_ENV') delete childEnv[k];
    const result = spawnSync(process.execPath, ['--require', PRELOAD, MIGRATE, ...args], {
        cwd: BACKEND_DIR, env: { ...childEnv, ...env }, encoding: 'utf8', timeout: 30000
    });
    const marker = /__DB_CONFIG__(.*)/.exec(result.stdout || '');
    return { ...result, attempt: marker ? JSON.parse(marker[1]) : null };
}

describe('scripts/migrate.js', () => {
    test('principal sin DB_SSL: intenta conectar sin ssl y lo indica', () => {
        const r = runMigrate(['--status'], {});
        assert.ok(r.attempt, r.stderr);
        assert.equal(r.attempt.kind, 'createConnection');
        assert.equal('ssl' in r.attempt.config, false);
        assert.match(r.stdout, /TLS desactivado/);
        assert.equal(r.attempt.config.host, 'localhost');
        assert.equal(r.attempt.config.multipleStatements, true);
    });

    test('principal estilo Docker (DB_HOST=db) sin DB_SSL: sin ssl', () => {
        const r = runMigrate(['--yes'], { DB_HOST: 'db', DB_USER: 'sportanet', DB_PASSWORD: 'sportanet', DB_NAME: 'sportanet_v1' });
        assert.equal(r.attempt.config.host, 'db');
        assert.equal('ssl' in r.attempt.config, false);
    });

    test('principal con DB_SSL=true + CA: la conexión lleva ssl con rejectUnauthorized true y la CA', () => {
        const r = runMigrate(['--status'], { DB_SSL: 'true', DB_SSL_CA: validCaFile });
        assert.ok(r.attempt, r.stderr);
        assert.equal(r.attempt.config.ssl.rejectUnauthorized, true);
        assert.equal(r.attempt.config.ssl.ca.length, 1);
        assert.match(r.stdout, /TLS activado \(rejectUnauthorized=true, CA de DB_SSL_CA\)/);
    });

    test('principal con DB_SSL=true y CA inexistente: sale con error y NO intenta conectar', () => {
        const r = runMigrate(['--status'], { DB_SSL: 'true', DB_SSL_CA: path.join(tmpDir, 'no-existe.pem') });
        assert.equal(r.status, 1);
        assert.equal(r.attempt, null);
        assert.match(r.stderr, /DB_SSL_CA apunta a un archivo que no existe/);
    });

    test('principal con DB_SSL=true y CA inválida: sale con error y NO intenta conectar', () => {
        const bad = path.join(tmpDir, 'bad.pem');
        fs.writeFileSync(bad, 'no es un certificado');
        const r = runMigrate(['--status'], { DB_SSL: 'true', DB_SSL_CA: bad });
        assert.equal(r.status, 1);
        assert.equal(r.attempt, null);
        assert.match(r.stderr, /formato PEM/);
    });

    test('DB_SSL con valor inválido: sale con error y NO intenta conectar', () => {
        const r = runMigrate(['--status'], { DB_SSL: 'quizas' });
        assert.equal(r.status, 1);
        assert.equal(r.attempt, null);
        assert.match(r.stderr, /DB_SSL tiene un valor no válido/);
    });

    const AD_RUN_ENV = { DB_AD_NAME: 'spn_ad', DB_AD_USER: 'ad_user', DB_AD_PASSWORD: 'x' };

    test('--ad sin DB_SSL: usa credenciales de SPN_AD y no lleva ssl', () => {
        const r = runMigrate(['--ad', '--status'], AD_RUN_ENV);
        assert.equal(r.attempt.config.user, 'ad_user');
        assert.equal('ssl' in r.attempt.config, false);
    });

    test('--ad con DB_SSL=true + CA: la conexión de SPN_AD lleva ssl con rejectUnauthorized true', () => {
        const r = runMigrate(['--ad', '--status'], { ...AD_RUN_ENV, DB_SSL: 'true', DB_SSL_CA: bundleCaFile });
        assert.ok(r.attempt, r.stderr);
        assert.equal(r.attempt.config.user, 'ad_user');
        assert.equal(r.attempt.config.ssl.rejectUnauthorized, true);
        assert.equal(r.attempt.config.ssl.ca.length, 2);
    });

    test('--ad con DB_SSL=true y CA inexistente: error y sin intento de conexión', () => {
        const r = runMigrate(['--ad', '--status'], { ...AD_RUN_ENV, DB_SSL: 'true', DB_SSL_CA: path.join(tmpDir, 'no-existe.pem') });
        assert.equal(r.status, 1);
        assert.equal(r.attempt, null);
    });

    test('--reset en BD *_test usa la misma config TLS en la conexión inicial (sin database)', () => {
        const r = runMigrate(['--reset'], { DB_NAME: 'sportanet_test', DB_SSL: 'true', DB_SSL_CA: validCaFile });
        assert.ok(r.attempt, r.stderr);
        assert.equal(r.attempt.config.ssl.rejectUnauthorized, true);
        assert.equal('database' in r.attempt.config, false);
    });
});
