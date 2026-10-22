const UNIT_TO_SECONDS = {
    seg: 1,
    min: 60,
    hor: 60 * 60,
    dia: 60 * 60 * 24
};

function normalizeUnit(unit) {
    const normalized = String(unit || '').trim().toLowerCase();
    if (!UNIT_TO_SECONDS[normalized]) {
        throw new Error('Unidad inválida: solo se admiten seg, min, hor y dia.');
    }
    return normalized;
}

function parseCallsSpec(spec) {
    if (spec === undefined || spec === null) {
        throw new Error('Falta la configuración de llamadas.');
    }

    if (typeof spec === 'object' && !Array.isArray(spec)) {
        const { calls, everySeconds, periodSeconds, period, unit, duration, durationSeconds } = spec;
        const resolvedCalls = Number(calls);
        const resolvedEvery = Number(everySeconds ?? spec.every ?? 1);
        const resolvedDuration = Number(periodSeconds ?? durationSeconds ?? period ?? 1);
        const resolvedUnit = normalizeUnit(unit ?? 'seg');

        if (!Number.isInteger(resolvedCalls) || resolvedCalls <= 0) {
            throw new Error('Calls debe ser un entero positivo.');
        }
        if (!Number.isFinite(resolvedEvery) || resolvedEvery <= 0) {
            throw new Error('La frecuencia debe ser un número positivo.');
        }
        if (!Number.isFinite(resolvedDuration) || resolvedDuration <= 0) {
            throw new Error('El periodo debe ser un número positivo.');
        }

        return {
            calls: resolvedCalls,
            everySeconds: resolvedEvery,
            periodSeconds: resolvedDuration * UNIT_TO_SECONDS[resolvedUnit],
            unit: resolvedUnit
        };
    }

    const raw = String(spec).trim();
    const withPrefix = raw.replace(/^Calls\s*=\s*/i, '').trim();
    const body = withPrefix.replace(/^\{|\}$/g, '').trim();

    const parts = body.split(',').map((item) => item.trim()).filter(Boolean);
    if (parts.length < 3) {
        throw new Error('Formato inválido. Usa Calls = {número, frecuencia, duración unidad}.');
    }

    const [callsText, everyText, durationText] = parts;
    const calls = Number(callsText);
    const everySeconds = Number(everyText);
    const durationMatch = durationText.match(/^(\d+)\s*(seg|min|hor|dia)$/i);

    if (!Number.isInteger(calls) || calls <= 0) {
        throw new Error('Calls debe ser un entero positivo.');
    }
    if (!Number.isFinite(everySeconds) || everySeconds <= 0) {
        throw new Error('La frecuencia de llamadas debe ser un entero positivo.');
    }
    if (!durationMatch) {
        throw new Error('El tercer parámetro debe seguir el formato: 1-60 seg|min|hor|dia');
    }

    const durationValue = Number(durationMatch[1]);
    const unit = normalizeUnit(durationMatch[2]);

    if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 60) {
        throw new Error('El periodo debe estar entre 1 - 60.');
    }

    return {
        calls,
        everySeconds,
        periodSeconds: durationValue * UNIT_TO_SECONDS[unit],
        unit
    };
}

function buildCallPlan(options = {}) {
    const { calls, everySeconds, periodSeconds, thresholdRatio = 0.8 } = options;
    const burstWindowSeconds = Number(everySeconds);
    const totalPeriodSeconds = Number(periodSeconds);

    if (!Number.isInteger(calls) || calls <= 0) {
        throw new Error('Calls debe ser un entero positivo.');
    }
    if (!Number.isFinite(burstWindowSeconds) || burstWindowSeconds <= 0) {
        throw new Error('La frecuencia de llamadas debe ser positiva.');
    }
    if (!Number.isFinite(totalPeriodSeconds) || totalPeriodSeconds <= 0) {
        throw new Error('La duración del periodo debe ser positiva.');
    }

    const repetitions = Math.max(1, Math.ceil(totalPeriodSeconds / burstWindowSeconds));
    const totalCalls = calls * repetitions;
    const throttleThreshold = Math.max(1, Math.ceil(calls * thresholdRatio));

    return {
        calls,
        everySeconds: burstWindowSeconds,
        burstWindowSeconds: burstWindowSeconds,
        periodSeconds: totalPeriodSeconds,
        repetitions,
        totalCalls,
        thresholdRatio,
        throttleThreshold
    };
}

module.exports = {
    parseCallsSpec,
    buildCallPlan,
    UNIT_TO_SECONDS
};
