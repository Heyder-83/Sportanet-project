// backend/db/admins.js
// Consultas de SPN_AD (la base aparte de administradores). Usa el pool propio de db/connectionAd.js.
const pool = require('./connectionAd');

// ¿Existe este TSU en la lista de reserva? Consulta de lectura SIN bloqueo: sirve para rechazar rápido un TSU
// inválido antes de gastar bcrypt. La asignación real y definitiva es createAdminWithTsu.
async function tsuIsAvailable(tsu) {
    const [rows] = await pool.promise().query('SELECT 1 FROM tsu_reserve WHERE tsu_plain = ?', [tsu]);
    return rows.length === 1;
}

// Asigna un TSU de la lista de reserva a una cuenta nueva, TODO en una transacción:
//   1) DELETE del TSU de la lista: solo lo gana UNA petición aunque lleguen varias a la vez (la fila se bloquea);
//   2) INSERT del administrador, ya activo, con solo el HASH del TSU (el TSU en claro desaparece de la BD).
// Si algo falla se revierte todo y el TSU sigue disponible. Devuelve el nuevo admin_id, o null si el TSU
// no estaba en la lista (no existe o ya se usó).
async function createAdminWithTsu({ tsu, tsuHash, full_name, pwdHash }) {
    const conn = await pool.promise().getConnection();
    try {
        await conn.beginTransaction();
        const [claimed] = await conn.query('DELETE FROM tsu_reserve WHERE tsu_plain = ?', [tsu]);
        if (claimed.affectedRows !== 1) {
            await conn.rollback();
            return null;
        }
        const [result] = await conn.query(
            "INSERT INTO admins (full_name, pwd, tsu_hash, tsu_used_at, status, activated_at) VALUES (?, ?, ?, NOW(), 'active', NOW())",
            [full_name, pwdHash, tsuHash]
        );
        await conn.commit();
        return result.insertId;
    } catch (err) {
        try { await conn.rollback(); } catch (_) { /* el error original es el que importa */ }
        throw err;
    } finally {
        conn.release();
    }
}

// Estado de una cuenta para el middleware de autenticación. Devuelve { admin_id, full_name, status } o null.
async function findAdminById(adminId) {
    const [rows] = await pool.promise().query(
        'SELECT admin_id, full_name, status FROM admins WHERE admin_id = ?',
        [adminId]
    );
    return rows[0] || null;
}

// RESERVA un intento de inicio de sesión ANTES de comprobar la contraseña, en una transacción con la fila
// bloqueada (SELECT ... FOR UPDATE). Así, aunque lleguen muchas peticiones a la vez, el contador y el
// bloqueo se actualizan de uno en uno y no se pueden evaluar más de `maxAttempts` contraseñas por ciclo.
// Devuelve:
//   { state: 'unknown' }                          la cuenta no existe o aún está 'pending' (no se cuenta nada)
//   { state: 'locked', retryAfterSeconds }        bloqueada por intentos: no se evalúa la contraseña
//   { state: 'ok', admin: {id, full_name, pwd, status}, attempts, locking }
//        intento reservado; `locking` = este intento es el que llega al límite y deja la cuenta bloqueada
//        (el contador vuelve a 0 y locked_until queda a `lockMinutes` minutos).
async function reserveLoginAttempt(adminId, { maxAttempts, lockMinutes }) {
    const conn = await pool.promise().getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
            `SELECT admin_id, full_name, pwd, status, failed_attempts,
                    (locked_until IS NOT NULL AND locked_until > NOW()) AS is_locked,
                    TIMESTAMPDIFF(SECOND, NOW(), locked_until) AS retry_after
               FROM admins WHERE admin_id = ? FOR UPDATE`,
            [adminId]
        );
        const row = rows[0];
        if (!row || row.status === 'pending') {
            await conn.commit();
            return { state: 'unknown' };
        }
        if (Number(row.is_locked) === 1) {
            await conn.commit();
            return { state: 'locked', retryAfterSeconds: Math.max(1, Number(row.retry_after) || 1) };
        }
        const attempts = Number(row.failed_attempts) + 1;
        const locking = attempts >= maxAttempts;
        await conn.query(
            'UPDATE admins SET failed_attempts = ?, locked_until = IF(?, NOW() + INTERVAL ? MINUTE, NULL) WHERE admin_id = ?',
            [locking ? 0 : attempts, locking ? 1 : 0, lockMinutes, adminId]
        );
        await conn.commit();
        return {
            state: 'ok',
            attempts,
            locking,
            admin: { id: row.admin_id, full_name: row.full_name, pwd: row.pwd, status: row.status }
        };
    } catch (err) {
        try { await conn.rollback(); } catch (_) { /* el error original es el que importa */ }
        throw err;
    } finally {
        conn.release();
    }
}

// Contraseña correcta: se limpia el contador y cualquier bloqueo, y se anota el inicio de sesión.
async function recordLoginSuccess(adminId) {
    await pool.promise().query('UPDATE admins SET failed_attempts = 0, locked_until = NULL WHERE admin_id = ?', [adminId]);
    await pool.promise().query("INSERT INTO admin_logins (admin_id, outcome) VALUES (?, 'success')", [adminId]);
}

// Contraseña incorrecta. Si ese intento dejó la cuenta bloqueada, se anotan los dos hechos.
async function recordLoginFailure(adminId, { locking }) {
    if (locking) {
        await pool.promise().query(
            "INSERT INTO admin_logins (admin_id, outcome) VALUES (?, 'bad_password'), (?, 'locked')",
            [adminId, adminId]
        );
    } else {
        await pool.promise().query("INSERT INTO admin_logins (admin_id, outcome) VALUES (?, 'bad_password')", [adminId]);
    }
}

// Acceso denegado sin evaluar la contraseña (cuenta bloqueada) o con la contraseña correcta pero cuenta suspendida.
// El enum de admin_logins no tiene un valor aparte: 'locked' significa «acceso bloqueado».
async function recordLoginBlocked(adminId) {
    await pool.promise().query("INSERT INTO admin_logins (admin_id, outcome) VALUES (?, 'locked')", [adminId]);
}

module.exports = {
    tsuIsAvailable,
    createAdminWithTsu,
    findAdminById,
    reserveLoginAttempt,
    recordLoginSuccess,
    recordLoginFailure,
    recordLoginBlocked
};
