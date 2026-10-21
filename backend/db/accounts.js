// backend/db/accounts.js
// Alta de cuentas desde el registro público. Va aparte de db/users.js porque un Organizador
// necesita DOS inserts (users + event_organizers) que deben ser todo-o-nada: se usa una transacción.
const pool = require('./connection');

// Únicos roles que se pueden asignar desde el formulario público. Admin NO está: se crea solo por la BD.
// Segunda barrera por si algún día otro código llamara a createAccount con un rol indebido.
const SELF_SERVICE_ROLES = new Set(['Participant', 'Organizer']);

// Crea el usuario y, si es Organizer, su fila en event_organizers con display_name = nombre del usuario.
// pwdHash debe venir ya hasheada con bcrypt. Devuelve el nuevo user_id.
// Cualquier fallo revierte todo: no puede quedar un Organizer sin su fila de organizador (ni al revés).
async function createAccount({ full_name, email, phone, pwdHash, role }) {
    if (!SELF_SERVICE_ROLES.has(role)) {
        throw new Error('Rol no permitido en el registro público');
    }

    const conn = await pool.promise().getConnection();
    try {
        await conn.beginTransaction();
        const [result] = await conn.query(
            'INSERT INTO users (full_name, email, phone, pwd, role) VALUES (?, ?, ?, ?, ?)',
            [full_name, email, phone, pwdHash, role]
        );
        const userId = result.insertId;
        if (role === 'Organizer') {
            await conn.query(
                'INSERT INTO event_organizers (user_id, display_name) VALUES (?, ?)',
                [userId, full_name]
            );
        }
        await conn.commit();
        return userId;
    } catch (err) {
        try { await conn.rollback(); } catch (_) { /* el error original es el que importa */ }
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = { createAccount, SELF_SERVICE_ROLES };
