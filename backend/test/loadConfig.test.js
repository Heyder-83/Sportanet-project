const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { loadLoadConfig, mergeLoadConfig } = require('../utils/loadConfig');

test('loadLoadConfig devuelve la config centralizada del backend', () => {
    const config = loadLoadConfig();
    assert.equal(typeof config.plan, 'string');
    assert.ok(config.plan.includes('Calls'));
    assert.ok(config.thresholdRatio > 0);
    assert.ok(config.slowThresholdMs > 0);
});

test('loadLoadConfig acepta JSON con comentarios y usa el plan del archivo', () => {
    const tempFile = path.join(__dirname, 'tmp-load-config.json');
    fs.writeFileSync(tempFile, `{
      // prueba de carga
      "baseUrl": "http://example.test/metrics",
      "plan": "Calls = {10000,1,1 min}",
      "maxCallsPerBurst": 10000,
      "estimatedServerLimit": 10000,
      "thresholdRatio": 1,
      "slowThresholdMs": 2000,
      "warningThresholdMs": 1200,
      "criticalThresholdMs": 2000
    }`);

    try {
        const config = loadLoadConfig(tempFile);
        assert.equal(config.plan, 'Calls = {10000,1,1 min}');
        assert.equal(config.maxCallsPerBurst, 10000);
        assert.equal(config.thresholdRatio, 1);
        assert.equal(config.slowThresholdMs, 2000);
    } finally {
        fs.unlinkSync(tempFile);
    }
});

test('mergeLoadConfig conserva la config base y aplica overrides por CLI', () => {
    const config = mergeLoadConfig({
        plan: 'Calls = {50,2,10 min}',
        thresholdRatio: 0.9,
        slowThresholdMs: 3000,
        baseUrl: 'http://example.test/metrics'
    }, {
        plan: 'Calls = {10,1,1 seg}',
        thresholdRatio: 0.5
    });

    assert.equal(config.plan, 'Calls = {10,1,1 seg}');
    assert.equal(config.thresholdRatio, 0.5);
    assert.equal(config.slowThresholdMs, 3000);
    assert.equal(config.baseUrl, 'http://example.test/metrics');
});
