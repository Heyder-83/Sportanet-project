const { test } = require('node:test');
const assert = require('node:assert/strict');

const { parseCallsSpec, buildCallPlan } = require('../utils/loadPlan');

test('parseCallsSpec acepta el formato Calls = {n, frecuencia, duración unidad}', () => {
    const plan = parseCallsSpec('Calls = {20,4,5 min}');
    assert.deepEqual(plan, { calls: 20, everySeconds: 4, periodSeconds: 300, unit: 'min' });
});

test('parseCallsSpec valida unidades permitidas y rango del periodo', () => {
    assert.throws(() => parseCallsSpec('Calls = {20,4,0 seg}'), /period/);
    assert.throws(() => parseCallsSpec('Calls = {20,4,61 min}'), /1 - 60/);
    assert.throws(() => parseCallsSpec('Calls = {20,4,5 mes}'), /seg|min|hor|dia/);
});

test('buildCallPlan calcula la serie de llamadas y el umbral de frenado', () => {
    const plan = buildCallPlan({ calls: 20, everySeconds: 4, periodSeconds: 300, thresholdRatio: 0.8 });
    assert.equal(plan.totalCalls, 1500);
    assert.equal(plan.burstWindowSeconds, 4);
    assert.equal(plan.throttleThreshold, 16);
    assert.equal(plan.repetitions, 75);
});
