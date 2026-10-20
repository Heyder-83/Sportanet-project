// backend/db/users.js
// Consultas de usuarios reutilizables por middleware y rutas.
// Solo columnas verificadas en Base de Datos/schema.sql (tabla `users`).
// Las funciones "públicas" nunca seleccionan `pwd`, y las listas de columnas son fijas:
// ningún nombre de columna sale de datos del cliente.
const pool = require('./connection');

const db = () => pool.promise();

// Columnas que se pueden devolver por la API. Sin pwd; deleted_at no hace falta porque
// las consultas públicas excluyen las cuentas eliminadas.
const PUBLIC_COLUMNS = 'user_id, full_name, email, phone, role, is_active, created_at, updated_at';

// Únicos campos que un cliente puede cambiar en su cuenta. role / is_active NO están aquí a propósito.
const UPDATABLE_COLUMNS = ['full_name', 'email', 'phone', 'pwd'];

// Estado de cuenta para el middleware de autenticación (incluye cuentas eliminadas o desactivadas).
// Devuelve { user_id, email, role, is_active, deleted_at } o null si no existe.
async function findUserById(userId) {
    const [rows] = await db().query(
        'SELECT user_id, email, role, is_active, deleted_at FROM users WHERE user_id = ?',
        [userId]
    );
    return rows[0] || null;
}

// Credenciales para el login. ÚNICA función que devuelve `pwd` (el hash bcrypt), y solo para compararlo en
// routes/auth.js: nunca debe copiarse a una respuesta. Incluye cuentas desactivadas o eliminadas porque el
// login responde distinto en cada caso (después de comprobar la contraseña). Devuelve la fila o null.
async function findAuthUserByEmail(email) {
    const [rows] = await db().query(
        'SELECT user_id, full_name, email, phone, pwd, is_active, deleted_at FROM users WHERE email = ?',
        [email]
    );
    return rows[0] || null;
}

// Usuarios no eliminados (los desactivados aparecen, con is_active = 0).
async function listActiveUsers() {
    const [rows] = await db().query(
        `SELECT ${PUBLIC_COLUMNS} FROM users WHERE deleted_at IS NULL ORDER BY user_id`
    );
    return rows;
}

// Un usuario no eliminado, o null.
async function findPublicUserById(userId) {
    const [rows] = await db().query(
        `SELECT ${PUBLIC_COLUMNS} FROM users WHERE user_id = ? AND deleted_at IS NULL`,
        [userId]
    );
    return rows[0] || null;
}

// Crea un usuario con rol y estado por defecto del esquema (Participant, activo).
// pwdHash debe venir ya hasheada con bcrypt. Devuelve el nuevo user_id.
async function createUser({ full_name, email, phone, pwdHash }) {
    const [result] = await db().query(
        'INSERT INTO users (full_name, email, phone, pwd) VALUES (?, ?, ?, ?)',
        [full_name, email, phone, pwdHash]
    );
    return result.insertId;
}

// Actualiza solo campos de UPDATABLE_COLUMNS presentes en `fields` (pwd ya hasheada). Devuelve filas afectadas.
async function updateUser(userId, fields) {
    const cols = UPDATABLE_COLUMNS.filter((c) => fields[c] !== undefined);
    if (cols.length === 0) return 0;
    const assignments = cols.map((c) => `${c} = ?`).join(', ');
    const [result] = await db().query(
        `UPDATE users SET ${assignments} WHERE user_id = ? AND deleted_at IS NULL`,
        [...cols.map((c) => fields[c]), userId]
    );
    return result.affectedRows;
}

// Borrado lógico: la fila y su historial se conservan (PROJECT_LOGIC §10). Devuelve filas afectadas.
// El email y el teléfono siguen ocupados por la restricción UNIQUE.
async function softDeleteUser(userId) {
    const [result] = await db().query(
        'UPDATE users SET is_active = 0, deleted_at = NOW() WHERE user_id = ? AND deleted_at IS NULL',
        [userId]
    );
    return result.affectedRows;
}

module.exports = {
    findUserById,
    findAuthUserByEmail,
    listActiveUsers,
    findPublicUserById,
    createUser,
    updateUser,
    softDeleteUser
};
