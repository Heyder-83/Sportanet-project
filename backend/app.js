// backend/app.js
// Archivo principal del servidor Express
// - Configura middlewares (CORS, JSON)
// - Registra rutas de la API (/api/users, /api/auth, /api/events)
// - Inicia el servidor en el puerto configurado
const express = require('express');
const cors = require('cors');
const { createStabilityMonitor, createRateLimiter } = require('./middleware/stability');
require('./config/jwt'); // falla al arrancar si JWT_SECRET no está definido (y carga el .env)
const app = express();
const port = process.env.PORT || 5000;
const stabilityMonitor = createStabilityMonitor();
const rateLimiter = createRateLimiter(stabilityMonitor, {
    windowMs: 60_000,
    maxRequests: 120,
    keyGenerator: (req) => req.ip || 'global'
});

// Middlewares
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use((req, res, next) => {
    if (req.path === '/api/health/metrics') return next();
    return rateLimiter(req, res, next);
});

app.get('/api/health/metrics', (req, res) => {
    res.json(stabilityMonitor.snapshot());
});

// Rutas principales de la API
// /api/users -> CRUD de usuarios
// /api/auth  -> Registro y login (emisión de JWT)
app.use('/api/users', require('./routes/users'));
app.use('/api/auth', require('./routes/auth'));
// /api/events -> eventos públicos (listado y detalle, sin login)
app.use('/api/events', require('./routes/events'));

// /api/admin -> alta de cuentas de administración (SPN_AD, base aparte). Solo se monta si SPN_AD está
// configurada (DB_AD_NAME); en ese caso exige también DB_AD_USER, DB_AD_PASSWORD y TSU_HMAC_KEY y falla al arrancar si faltan.
if (process.env.DB_AD_NAME) {
    app.use('/api/admin', require('./routes/adminAuth'));
} else {
    console.log('SPN_AD no configurada (DB_AD_NAME): rutas /api/admin desactivadas');
}

// Server

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        return res.status(400).json({ error: "JSON malformado", code: "INVALID_JSON" });
    }
    console.error(err);
    res.status(500).json({ error: "Error interno" });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
