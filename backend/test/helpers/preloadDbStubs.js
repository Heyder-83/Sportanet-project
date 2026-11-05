// backend/test/helpers/preloadDbStubs.js
// Se carga con `node --require` para ejecutar scripts/migrate.js en un proceso hijo con los stubs de dbStubs.js.
// Imprime la configuración con la que se intentó conectar en una línea marcada, para que la prueba la lea.
const { installDbStubs } = require('./dbStubs');

installDbStubs((kind, config) => {
    process.stdout.write(`\n__DB_CONFIG__${JSON.stringify({ kind, config })}\n`);
});
