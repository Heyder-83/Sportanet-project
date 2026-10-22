#!/usr/bin/env node

const { URL } = require('node:url');
const { parseCallsSpec, buildCallPlan } = require('../utils/loadPlan');
const { loadLoadConfig, mergeLoadConfig } = require('../utils/loadConfig');

const args = process.argv.slice(2);
const optionValue = (flag, fallback) => {
    const index = args.indexOf(flag);
    if (index === -1) return fallback;
    return args[index + 1] ?? fallback;
};

const configBase = loadLoadConfig();
const config = mergeLoadConfig(configBase, {
    baseUrl: optionValue('--url', configBase.baseUrl),
    plan: optionValue('--plan', configBase.plan),
    thresholdRatio: Number(optionValue('--threshold', String(configBase.thresholdRatio))) || configBase.thresholdRatio,
    slowThresholdMs: Number(optionValue('--slow-threshold-ms', String(configBase.slowThresholdMs))) || configBase.slowThresholdMs
});

const baseUrl = config.baseUrl;
const planSpec = config.plan;
const thresholdRatio = Number(config.thresholdRatio) || 0.8;
const slowThresholdMs = Number(config.slowThresholdMs) || 1500;

const plan = parseCallsSpec(planSpec);
const schedule = buildCallPlan({ ...plan, thresholdRatio });

const url = new URL(baseUrl);
const deadlines = {
    startedAt: Date.now(),
    finishAt: Date.now() + (plan.periodSeconds * 1000)
};

let completed = 0;
let success = 0;
let errors = 0;
let blocked = 0;
let slow = 0;

async function triggerBurst() {
    const callers = [];

    for (let i = 0; i < plan.calls; i += 1) {
        callers.push((async () => {
            try {
                const started = Date.now();
                const res = await fetch(url);
                const elapsedMs = Date.now() - started;
                if (res.status === 429) {
                    blocked += 1;
                    return;
                }
                if (res.ok) {
                    success += 1;
                } else {
                    errors += 1;
                }
                if (elapsedMs > slowThresholdMs) {
                    slow += 1;
                }
            } catch (err) {
                errors += 1;
            } finally {
                completed += 1;
            }
        })());
    }

    await Promise.all(callers);
}

(async () => {
    const burstIntervalMs = plan.everySeconds * 1000;
    const endAt = deadlines.startedAt + (plan.periodSeconds * 1000);
    let nextBurstTime = deadlines.startedAt;

    while (Date.now() < endAt) {
        if (Date.now() >= nextBurstTime) {
            await triggerBurst();
            nextBurstTime += burstIntervalMs;
        } else {
            const waitMs = Math.min(50, nextBurstTime - Date.now());
            if (waitMs > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitMs));
            }
        }
    }

    const elapsedMs = Date.now() - deadlines.startedAt;
    const rps = elapsedMs > 0 ? (completed / elapsedMs * 1000).toFixed(2) : '0';

    const summary = {
        callsConfig: plan,
        schedule,
        url: url.toString(),
        totalCallsAttempted: completed,
        success,
        blocked,
        errors,
        slowResponses: slow,
        elapsedMs,
        rps: Number(rps),
        threshold: {
            ratio: thresholdRatio,
            perBurstLimit: schedule.throttleThreshold,
            marker: `La prueba dispara un frenado cuando una ráfaga supera ${schedule.throttleThreshold} llamadas en ${plan.everySeconds} segundos.`
        }
    };

    console.log(JSON.stringify(summary, null, 2));
})();
