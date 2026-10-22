const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG_PATH = path.join(__dirname, '..', 'config.json');

function normalizeConfigValue(value, fallback) {
    if (value === undefined || value === null || value === '') {
        return fallback;
    }
    return value;
}

function stripJsonComments(source) {
    let result = '';
    let inString = false;
    let escaped = false;

    for (let i = 0; i < source.length; i += 1) {
        const char = source[i];
        const next = source[i + 1];

        if (inString) {
            result += char;
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            result += char;
            continue;
        }

        if (char === '/' && next === '/') {
            while (i < source.length && source[i] !== '\n') {
                i += 1;
            }
            continue;
        }

        if (char === '/' && next === '*') {
            i += 2;
            while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
                i += 1;
            }
            i += 1;
            continue;
        }

        result += char;
    }

    return result;
}

function loadLoadConfig(filePath = DEFAULT_CONFIG_PATH) {
    try {
        const raw = fs.readFileSync(filePath, 'utf8');
        const clean = stripJsonComments(raw);
        const parsed = JSON.parse(clean);

        return {
            baseUrl: normalizeConfigValue(parsed.baseUrl, 'http://127.0.0.1:5000/api/health/metrics'),
            plan: normalizeConfigValue(parsed.plan, 'Calls = {20,4,5 min}'),
            maxCallsPerBurst: Number(normalizeConfigValue(parsed.maxCallsPerBurst, 20)),
            estimatedServerLimit: Number(normalizeConfigValue(parsed.estimatedServerLimit, 120)),
            thresholdRatio: Number(normalizeConfigValue(parsed.thresholdRatio, 0.8)),
            slowThresholdMs: Number(normalizeConfigValue(parsed.slowThresholdMs, 1500)),
            warningThresholdMs: Number(normalizeConfigValue(parsed.warningThresholdMs, 800)),
            criticalThresholdMs: Number(normalizeConfigValue(parsed.criticalThresholdMs, 1500))
        };
    } catch (err) {
        return {
            baseUrl: 'http://127.0.0.1:5000/api/health/metrics',
            plan: 'Calls = {20,4,5 min}',
            maxCallsPerBurst: 20,
            estimatedServerLimit: 120,
            thresholdRatio: 0.8,
            slowThresholdMs: 1500,
            warningThresholdMs: 800,
            criticalThresholdMs: 1500
        };
    }
}

function mergeLoadConfig(baseConfig, overrides = {}) {
    const next = { ...baseConfig };
    for (const [key, value] of Object.entries(overrides)) {
        if (value !== undefined && value !== null && value !== '') {
            next[key] = value;
        }
    }
    return next;
}

module.exports = {
    loadLoadConfig,
    mergeLoadConfig
};
