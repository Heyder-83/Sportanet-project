const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createStabilityMonitor, createRateLimiter } = require('../middleware/stability');

const fakeRes = () => {
    const headers = {};
    return {
        headers,
        statusCode: 200,
        body: undefined,
        setHeader(name, value) { headers[name] = value; },
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        end() {
            return this;
        }
    };
};

test('createRateLimiter bloquea ráfagas excesivas y expone métricas', async () => {
    const monitor = createStabilityMonitor();
    const limiter = createRateLimiter(monitor, {
        windowMs: 1000,
        maxRequests: 2,
        keyGenerator: (req) => req.ip || 'unknown'
    });

    let nextCalled = 0;
    const next = () => { nextCalled += 1; };

    const first = fakeRes();
    const second = fakeRes();
    const third = fakeRes();

    limiter({ ip: '127.0.0.1', path: '/api/auth/login' }, first, next);
    limiter({ ip: '127.0.0.1', path: '/api/auth/login' }, second, next);
    limiter({ ip: '127.0.0.1', path: '/api/auth/login' }, third, next);

    assert.equal(nextCalled, 2);
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(third.statusCode, 429);
    assert.deepEqual(third.body, { error: 'Too many requests', code: 'RATE_LIMITED' });

    const snapshot = monitor.snapshot();
    assert.equal(snapshot.acceptedRequests, 2);
    assert.equal(snapshot.blockedRequests, 1);
    assert.equal(snapshot.totalRequests, 3);
    assert.ok(snapshot.requestsPerWindow >= 1);
});
