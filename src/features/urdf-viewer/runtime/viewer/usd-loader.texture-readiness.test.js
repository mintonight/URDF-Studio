import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { getTextureLoadProgress, waitForTextureLoadReady } from "./usd-loader-progress.js";

const loaderPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "./usd-loader.js",
);

test("getTextureLoadProgress preserves pending texture work from loader and manager snapshots", () => {
    const progress = getTextureLoadProgress({
        registry: {
            getTextureLoadSnapshot: () => ({
                started: 2,
                completed: 1,
                failed: 0,
                pending: 0,
                manager: {
                    pending: 1,
                },
            }),
        },
    });

    assert.deepEqual(progress, {
        started: 2,
        completed: 1,
        failed: 0,
        pending: 1,
        settled: 1,
        total: 2,
    });
});

test("waitForTextureLoadReady stays in finalizing-scene until texture pending count drains", async () => {
    const snapshots = [
        { started: 2, completed: 0, failed: 0, pending: 2, settled: 0, total: 2 },
        { started: 2, completed: 1, failed: 0, pending: 1, settled: 1, total: 2 },
        { started: 2, completed: 2, failed: 0, pending: 0, settled: 2, total: 2 },
        { started: 2, completed: 2, failed: 0, pending: 0, settled: 2, total: 2 },
    ];
    let index = 0;
    let nowMs = 0;
    const progressUpdates = [];
    const messages = [];
    const percentUpdates = [];
    const yieldCalls = [];

    const result = await waitForTextureLoadReady({
        getTextureProgress: () => snapshots[Math.min(index++, snapshots.length - 1)] ?? null,
        isLoadStillActive: () => true,
        emitProgress: (progress) => {
            progressUpdates.push(progress);
        },
        setMessage: (message) => {
            messages.push(message);
        },
        setProgress: (percent) => {
            percentUpdates.push(percent);
        },
        yieldForNextCheck: async (delayMs = 0) => {
            yieldCalls.push(delayMs);
            nowMs += Math.max(1, delayMs);
        },
        now: () => nowMs,
        quietPollsRequired: 2,
        timeoutMs: 500,
    });

    assert.equal(result.status, "settled");
    assert.deepEqual(
        progressUpdates.map((progress) => ({
            phase: progress.phase,
            progressMode: progress.progressMode,
            loadedCount: progress.loadedCount,
            totalCount: progress.totalCount,
        })),
        [
            {
                phase: "finalizing-scene",
                progressMode: "count",
                loadedCount: 0,
                totalCount: 2,
            },
            {
                phase: "finalizing-scene",
                progressMode: "count",
                loadedCount: 1,
                totalCount: 2,
            },
            {
                phase: "finalizing-scene",
                progressMode: "count",
                loadedCount: 2,
                totalCount: 2,
            },
            {
                phase: "finalizing-scene",
                progressMode: "count",
                loadedCount: 2,
                totalCount: 2,
            },
        ],
    );
    assert.deepEqual(messages, [
        "Loading scene textures... 0/2",
        "Loading scene textures... 1/2",
        "Loading scene textures... 2/2",
        "Loading scene textures... 2/2",
    ]);
    assert.deepEqual(percentUpdates, [96, 97.5, 99, 99]);
    assert.deepEqual(yieldCalls, [48, 48, 0]);
});

test("usd-loader waits for texture readiness before switching the stage to ready", async () => {
    const source = await readFile(loaderPath, "utf8");
    const waitIndex = source.indexOf("const textureLoadReadyResult = await waitForTextureLoadReady({");
    const readyIndex = source.lastIndexOf("state.ready = true;");

    assert.notEqual(waitIndex, -1);
    assert.notEqual(readyIndex, -1);
    assert.ok(waitIndex < readyIndex);
    assert.match(
        source,
        /emitProgress\(\{\s*phase: "ready",\s*progressMode: "percent",\s*progressPercent: 100,/m,
    );
});
