const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_REQUESTS = 120;

function createStabilityMonitor() {
    const state = {
        acceptedRequests: 0,
        blockedRequests: 0,
        totalRequests: 0,
        windowMs: DEFAULT_WINDOW_MS,
        requestsPerWindow: 0,
        timestamps: []
    };

    const prune = (now = Date.now()) => {
        const maxAge = state.windowMs;
        while (state.timestamps.length && now - state.timestamps[0] > maxAge) {
            state.timestamps.shift();
        }
    };

    const record = (allowed) => {
        const now = Date.now();
        prune(now);
        state.timestamps.push(now);
        state.requestsPerWindow = state.timestamps.length;
        state.totalRequests += 1;

        if (allowed) {
            state.acceptedRequests += 1;
        } else {
            state.blockedRequests += 1;
        }
    };

    return {
        recordAccepted: () => record(true),
        recordBlocked: () => record(false),
        snapshot: () => {
            const now = Date.now();
            prune(now);
            return {
                acceptedRequests: state.acceptedRequests,
                blockedRequests: state.blockedRequests,
                totalRequests: state.totalRequests,
                requestsPerWindow: state.timestamps.length,
                windowMs: state.windowMs
            };
        }
    };
}

function createRateLimiter(monitor, options = {}) {
    const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
    const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
    const keyGenerator = options.keyGenerator ?? (() => 'global');
    const buckets = new Map();

    return function rateLimit(req, res, next) {
        if (req.path === '/api/health/metrics') {
            return next();
        }

        const key = String(keyGenerator(req));
        const now = Date.now();
        const bucket = buckets.get(key) ?? [];

        while (bucket.length && now - bucket[0] > windowMs) {
            bucket.shift();
        }

        if (bucket.length >= maxRequests) {
            monitor.recordBlocked();
            return res.status(429).json({ error: 'Too many requests', code: 'RATE_LIMITED' });
        }

        bucket.push(now);
        buckets.set(key, bucket);
        monitor.recordAccepted();

        req.rateLimit = {
            key,
            limit: maxRequests,
            remaining: Math.max(0, maxRequests - bucket.length),
            resetInMs: Math.max(0, windowMs - (now - bucket[0]))
        };

        return next();
    };
}

module.exports = {
    createStabilityMonitor,
    createRateLimiter
};
