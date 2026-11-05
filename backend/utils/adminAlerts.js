// backend/utils/adminAlerts.js
// Avisos al log del sistema por la actividad de inicio de sesión de los administradores (SPNdev.2).
// Solo se escribe el admin_id y números: NUNCA el nombre, la contraseña, el token ni el hash.
// Más adelante estas funciones podrán, además, enviar el aviso al correo dedicado de historial de acciones:
// el resto del código solo llama a estas tres y no cambia.
const loginOk = (adminId) => {
    console.log(`[admin] inicio de sesión correcto: admin_id=${adminId}`);
};

const loginFailed = (adminId, attempts, maxAttempts) => {
    console.warn(`[admin] intento fallido: admin_id=${adminId} (${attempts}/${maxAttempts})`);
};

const accountLocked = (adminId, lockMinutes) => {
    console.error(`[ALERTA-ADMIN] admin_id=${adminId} bloqueado ${lockMinutes} min por llegar al límite de intentos fallidos`);
};

module.exports = { loginOk, loginFailed, accountLocked };
