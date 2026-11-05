// backend/test/helpers/dbStubs.js
// Intercepta `dotenv`, `mysql2` y `mysql2/promise` para probar la configuración de conexión SIN base de datos,
// SIN credenciales de Azure y sin depender de que esos paquetes estén instalados ni de un backend/.env real.
// - dotenv: no carga nada (las pruebas controlan process.env a mano).
// - mysql2.createPool / mysql2/promise.createConnection: solo registran la configuración recibida.
const Module = require('node:module');

function installDbStubs(onConfig) {
    const originalLoad = Module._load;
    Module._load = function patchedLoad(request, ...rest) {
        if (request === 'dotenv') return { config: () => ({ parsed: {} }) };
        if (request === 'mysql2') {
            return { createPool: (config) => { onConfig('createPool', config); return { stub: true }; } };
        }
        if (request === 'mysql2/promise') {
            return {
                createConnection: async (config) => {
                    onConfig('createConnection', config);
                    throw new Error('stub: conexión simulada (sin base de datos)');
                }
            };
        }
        return originalLoad.call(this, request, ...rest);
    };
    return () => { Module._load = originalLoad; };
}

module.exports = { installDbStubs };
