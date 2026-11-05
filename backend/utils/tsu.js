// backend/utils/tsu.js
// Utilidades del TSU (Token de Seguridad Único): formato y hash.
const crypto = require('node:crypto');
const { TSU_HMAC_KEY } = require('../config/tsu');

// Serial alfanumérico de 16 a 64 caracteres. Debe coincidir con el CHECK de tsu_reserve en
// Base de Datos/spn_ad/schema.sql: un TSU que la BD aceptara pero esta regla rechazara no se podría usar nunca.
const TSU_RE = /^[A-Za-z0-9]{16,64}$/;
const isValidTsuFormat = (v) => typeof v === 'string' && TSU_RE.test(v);

// HMAC-SHA-256 en hexadecimal (64 caracteres, la columna admins.tsu_hash). Es de una sola vía: del hash no se
// puede recuperar el TSU. Con clave del servidor, un hash robado de la BD no se puede contrastar contra una lista
// de TSU probables sin esa clave.
const hashTsu = (tsu) => crypto.createHmac('sha256', TSU_HMAC_KEY).update(tsu, 'utf8').digest('hex');

module.exports = { isValidTsuFormat, hashTsu };
