// backend/utils/dbSsl.js
// Configuración TLS/SSL para las conexiones a MySQL (pool principal, pool SPN_AD y script de migraciones).
//
// Variables de entorno:
//   DB_SSL     true | false (también 1/0, yes/no, on/off). Vacío o ausente = false (entorno local / Docker).
//   DB_SSL_CA  Ruta a un archivo PEM con el/los certificados de la CA raíz (p. ej. Azure Database for MySQL).
//              Una ruta relativa se resuelve desde backend/ (igual que backend/.env). Opcional: sin ella se usan
//              las CA de confianza de Node.
//
// Con DB_SSL=true:
//   - se activa TLS y rejectUnauthorized queda SIEMPRE en true (no hay forma de desactivar la validación);
//   - si DB_SSL_CA apunta a un archivo inexistente, ilegible o inválido se lanza un error claro (fail-closed):
//     nunca se cae a una conexión sin TLS ni a una sin validar.
// Con DB_SSL=false: no se añade ninguna opción `ssl` y la conexión se comporta como hasta ahora.
//
// mysql2 necesita el CONTENIDO del certificado (string o array de strings), no la ruta: por eso se lee aquí.
const fs = require('node:fs');
const path = require('node:path');
const { X509Certificate } = require('node:crypto');

const BACKEND_ROOT = path.resolve(__dirname, '..');

const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);
const FALSE_VALUES = new Set(['false', '0', 'no', 'off', '']);
const PEM_BLOCK = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

class DbSslConfigError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'DbSslConfigError';
        this.code = code;
    }
}

// Interpreta DB_SSL. Un valor desconocido (p. ej. "tru") es un error: un typo no debe desactivar TLS en silencio.
function parseDbSsl(value) {
    if (value === undefined || value === null) return false;
    const normalized = String(value).trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
    throw new DbSslConfigError('DB_SSL_INVALID', `DB_SSL tiene un valor no válido ("${value}"). Usa true o false.`);
}

// Lee y valida el archivo PEM de la CA. Devuelve un array con un string por certificado (admite bundles).
// `readFileSync` y `now` son inyectables solo para las pruebas.
function loadCaBundle(caPath, { readFileSync = fs.readFileSync, now = new Date() } = {}) {
    const resolved = path.isAbsolute(caPath) ? caPath : path.resolve(BACKEND_ROOT, caPath);

    let content;
    try {
        content = readFileSync(resolved, 'utf8');
    } catch (err) {
        if (err && err.code === 'ENOENT') {
            throw new DbSslConfigError('DB_SSL_CA_NOT_FOUND',
                `DB_SSL_CA apunta a un archivo que no existe: ${resolved}`);
        }
        throw new DbSslConfigError('DB_SSL_CA_UNREADABLE',
            `No se pudo leer el certificado CA de DB_SSL_CA (${(err && err.code) || 'error desconocido'}): ${resolved}`);
    }

    const blocks = String(content).match(PEM_BLOCK) || [];
    if (!blocks.length) {
        throw new DbSslConfigError('DB_SSL_CA_INVALID',
            `El archivo de DB_SSL_CA no contiene ningún certificado en formato PEM (-----BEGIN CERTIFICATE-----): ${resolved}. ` +
            'Si el certificado está en formato DER (.crt binario), conviértelo a PEM con openssl.');
    }

    let anyCurrentlyValid = false;
    blocks.forEach((block, i) => {
        let cert;
        try {
            cert = new X509Certificate(block);
        } catch {
            throw new DbSslConfigError('DB_SSL_CA_INVALID',
                `El certificado #${i + 1} del archivo de DB_SSL_CA no es un X.509 válido: ${resolved}`);
        }
        const from = new Date(cert.validFrom);
        const to = new Date(cert.validTo);
        // Si la fecha no se puede interpretar, no se bloquea por eso: la validación real la hace TLS al conectar.
        if ((Number.isNaN(from.getTime()) || from <= now) && (Number.isNaN(to.getTime()) || now <= to)) {
            anyCurrentlyValid = true;
        }
    });
    if (!anyCurrentlyValid) {
        throw new DbSslConfigError('DB_SSL_CA_EXPIRED',
            `Ningún certificado del archivo de DB_SSL_CA está vigente (caducados o aún no válidos): ${resolved}`);
    }
    return blocks;
}

// Devuelve las opciones `ssl` de mysql2, o undefined cuando DB_SSL no es true.
// Cuando es true: rejectUnauthorized SIEMPRE true; `ca` solo si se indicó DB_SSL_CA.
function buildSslOptions(env = process.env, { warn = console.warn, ...loadOptions } = {}) {
    const enabled = parseDbSsl(env.DB_SSL);
    const caPath = typeof env.DB_SSL_CA === 'string' ? env.DB_SSL_CA.trim() : '';

    if (!enabled) {
        if (caPath) {
            warn('[seguridad] DB_SSL_CA está definido pero DB_SSL no es true: la conexión a MySQL NO usa TLS.');
        }
        return undefined;
    }

    const ssl = { rejectUnauthorized: true };
    if (caPath) ssl.ca = loadCaBundle(caPath, loadOptions);
    return ssl;
}

// Atajo para esparcir en la config de mysql2: `{ ...sslOption(env) }` => `{}` o `{ ssl: {...} }`.
function sslOption(env = process.env, options) {
    const ssl = buildSslOptions(env, options);
    return ssl ? { ssl } : {};
}

module.exports = { buildSslOptions, sslOption, loadCaBundle, parseDbSsl, DbSslConfigError, BACKEND_ROOT };
