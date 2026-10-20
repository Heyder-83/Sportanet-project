// backend/utils/dbFail.js
// Respuesta uniforme ante un error de BD, sin filtrar detalles internos.
//
// - Duplicados (ER_DUP_ENTRY): 409 con un código claro (EMAIL_TAKEN / PHONE_TAKEN / DUPLICATE).
// - Cualquier otro error: 500 genérico. Al servidor solo se registra el CÓDIGO del error: el objeto de error
//   de mysql2 incluye el SQL con los valores (p. ej. el hash de la contraseña) y su mensaje nombra
//   tablas y columnas ("Data too long for column 'full_name'"), así que nada de eso sale ni a la respuesta ni al log.
// `scope` es solo una etiqueta del log (p. ej. 'auth', 'users').
function dbFail(err, res, scope = 'db') {
    if (err && err.code === 'ER_DUP_ENTRY') {
        // Se mira el NOMBRE de la clave, no el texto: un email como "phone@x.com" también contiene "phone".
        // MySQL 8 informa 'users.email'; MariaDB y MySQL 5.7, 'email'.
        const key = ((String(err.sqlMessage || '').match(/for key '([^']+)'/) || [])[1]) || '';
        if (/(^|\.)email$/.test(key)) return res.status(409).json({ error: 'Email already registered', code: 'EMAIL_TAKEN' });
        if (/(^|\.)phone$/.test(key)) return res.status(409).json({ error: 'Phone already registered', code: 'PHONE_TAKEN' });
        return res.status(409).json({ error: 'Duplicate value', code: 'DUPLICATE' });
    }
    console.error(`[${scope}] error de BD:`, err && err.code ? err.code : 'sin código');
    return res.status(500).json({ error: 'Internal error', code: 'DB_ERROR' });
}

module.exports = dbFail;
