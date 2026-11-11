// backend/utils/dbFail.js
// Respuesta uniforme ante un error de BD, sin filtrar detalles internos.
//
// - Duplicados (ER_DUP_ENTRY): 409 con un código claro (EMAIL_TAKEN / PHONE_TAKEN / DUPLICATE).
// - Cualquier otro error: 500 genérico. Para errores SQL/inesperados solo se registra el CÓDIGO: el objeto de
//   mysql2 incluye el SQL con los valores (p. ej. el hash de la contraseña) y el mensaje puede nombrar tablas
//   y columnas ("Data too long for column 'full_name'"), así que nada de eso sale ni a la respuesta ni al log.
// Los mensajes de errores conocidos de conexión/red sí se registran para facilitar el diagnóstico de conectividad.
// `scope` es solo una etiqueta del log (p. ej. 'auth', 'users').
const CONNECTION_ERROR_CODES = new Set([
    'ECONNREFUSED',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EHOSTUNREACH',
    'ECONNRESET',
    'EAI_AGAIN',
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'CERT_HAS_EXPIRED',
    'SELF_SIGNED_CERT_IN_CHAIN',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    'DEPTH_ZERO_SELF_SIGNED_CERT',
    'HANDSHAKE_SSL_ERROR',
    'ERR_SSL_WRONG_VERSION_NUMBER',
    'ERR_TLS_CERT_ALTNAME_INVALID'
]);

function dbFail(err, res, scope = 'db') {
    if (err && err.code === 'ER_DUP_ENTRY') {
        // Se mira el NOMBRE de la clave, no el texto: un email como "phone@x.com" también contiene "phone".
        // MySQL 8 informa 'users.email'; MariaDB y MySQL 5.7, 'email'.
        const key = ((String(err.sqlMessage || '').match(/for key '([^']+)'/) || [])[1]) || '';
        if (/(^|\.)email$/.test(key)) return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_TAKEN' });
        if (/(^|\.)phone$/.test(key)) return res.status(409).json({ error: 'Phone already registered', code: 'PHONE_TAKEN' });
        return res.status(409).json({ error: 'Duplicate value', code: 'DUPLICATE' });
    }
    const code = err && err.code ? err.code : 'sin código';
    if (err && CONNECTION_ERROR_CODES.has(code) && typeof err.message === 'string') {
        console.error(`[${scope}] error de BD:`, code, err.message);
    } else {
        console.error(`[${scope}] error de BD:`, code);
    }
    return res.status(500).json({ error: 'Internal error', code: 'DB_ERROR' });
}

module.exports = dbFail;
