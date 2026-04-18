import test from 'node:test';
import assert from 'node:assert/strict';

import {
    getRenderRobotMetadataSnapshot,
    normalizeRenderRobotMetadataSnapshot,
    warmupRenderRobotMetadataSnapshot,
} from './robot-metadata.js';

test('normalizeRenderRobotMetadataSnapshot preserves explicit stale metadata annotations', () => {
    const snapshot = normalizeRenderRobotMetadataSnapshot({
        stageSourcePath: '/robots/test.usd',
        generatedAtMs: 123,
        source: 'usd-stage-cpp',
        stale: true,
        errorFlags: ['urdf-truth-load-failed', 'physics-joint-records-unavailable'],
        truthLoadError: 'urdf-truth-fetch-http-404',
        linkParentPairs: [],
        jointCatalogEntries: [],
        linkDynamicsEntries: [],
        meshCountsByLinkPath: {},
    });

    assert.ok(snapshot);
    assert.equal(snapshot.stale, true);
    assert.deepEqual(snapshot.errorFlags, [
        'urdf-truth-load-failed',
        'physics-joint-records-unavailable',
    ]);
    assert.equal(snapshot.truthLoadError, 'urdf-truth-fetch-http-404');
});

test('getRenderRobotMetadataSnapshot drops cached stale metadata snapshots', () => {
    const renderInterface = {
        getCachedRobotMetadataSnapshot() {
            return {
                stageSourcePath: '/robots/test.usd',
                generatedAtMs: 456,
                source: 'usd-stage-cpp',
                stale: true,
                errorFlags: ['urdf-truth-load-failed'],
                truthLoadError: 'truth-load-failed',
                linkParentPairs: [],
                jointCatalogEntries: [],
                linkDynamicsEntries: [],
                meshCountsByLinkPath: {},
            };
        },
    };

    assert.equal(
        getRenderRobotMetadataSnapshot(renderInterface, '/robots/test.usd'),
        null,
    );
});

test('warmupRenderRobotMetadataSnapshot rejects when warmup throws', async () => {
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    const renderInterface = {
        startRobotMetadataWarmupForStage() {
            throw new Error('warmup-failed');
        },
        getCachedRobotMetadataSnapshot() {
            return {
                stageSourcePath: '/robots/test.usd',
                generatedAtMs: 456,
                source: 'usd-stage-cpp',
                stale: true,
                errorFlags: ['urdf-truth-load-failed'],
                truthLoadError: 'truth-load-failed',
                linkParentPairs: [],
                jointCatalogEntries: [],
                linkDynamicsEntries: [],
                meshCountsByLinkPath: {},
            };
        },
    };

    try {
        await assert.rejects(
            warmupRenderRobotMetadataSnapshot(renderInterface, {
                stageSourcePath: '/robots/test.usd',
            }),
            /Failed to warm up render robot metadata snapshot/,
        );
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0]?.[0] || ''), /Failed to warm up render robot metadata snapshot/);
    assert.match(String(loggedErrors[0]?.[1] || ''), /warmup-failed/);
});

test('warmupRenderRobotMetadataSnapshot rejects stale metadata snapshots returned by the warmup path', async () => {
    const renderInterface = {
        async startRobotMetadataWarmupForStage() {
            return {
                stageSourcePath: '/robots/test.usd',
                generatedAtMs: 456,
                source: 'usd-stage-cpp',
                stale: true,
                errorFlags: ['urdf-truth-load-failed'],
                truthLoadError: 'truth-load-failed',
                linkParentPairs: [],
                jointCatalogEntries: [],
                linkDynamicsEntries: [],
                meshCountsByLinkPath: {},
            };
        },
    };

    await assert.rejects(
        warmupRenderRobotMetadataSnapshot(renderInterface, {
            stageSourcePath: '/robots/test.usd',
        }),
        /not usable/,
    );
});

test('warmupRenderRobotMetadataSnapshot logs asynchronous warmup rejections instead of only bubbling them upward', async () => {
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        const renderInterface = {
            async startRobotMetadataWarmupForStage() {
                throw new Error('warmup-promise-failed');
            },
        };

        await assert.rejects(
            warmupRenderRobotMetadataSnapshot(renderInterface, {
                stageSourcePath: '/robots/test.usd',
            }),
            /Render robot metadata warmup rejected/,
        );
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0]?.[0] || ''), /Render robot metadata warmup rejected/);
    assert.match(String(loggedErrors[0]?.[1] || ''), /warmup-promise-failed/);
});

test('getRenderRobotMetadataSnapshot can suppress getter failure logs when the caller will report the higher-level failure', () => {
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        const renderInterface = {
            getCachedRobotMetadataSnapshot() {
                throw new Error('getter-crashed');
            },
        };

        assert.equal(getRenderRobotMetadataSnapshot(renderInterface, '/robots/test.usd', { logErrors: false }), null);
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 0);
});

test('getRenderRobotMetadataSnapshot logs getter failures instead of silently hiding them', () => {
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        const renderInterface = {
            getCachedRobotMetadataSnapshot() {
                throw new Error('getter-crashed');
            },
        };

        assert.equal(
            getRenderRobotMetadataSnapshot(renderInterface, '/robots/test.usd'),
            null,
        );
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0]?.[0] || ''), /Failed to read cached render robot metadata snapshot/);
});

test('getRenderRobotMetadataSnapshot can rethrow getter failures in strict mode', () => {
    const renderInterface = {
        getCachedRobotMetadataSnapshot() {
            throw new Error('getter-crashed');
        },
    };

    assert.throws(
        () => getRenderRobotMetadataSnapshot(renderInterface, '/robots/test.usd', { strictErrors: true }),
        /Failed to read cached render robot metadata snapshot/,
    );
});

test('warmupRenderRobotMetadataSnapshot rejects when strict fallback cache read fails', async () => {
    const renderInterface = {
        async startRobotMetadataWarmupForStage() {
            return null;
        },
        getCachedRobotMetadataSnapshot() {
            throw new Error('getter-crashed');
        },
    };

    await assert.rejects(
        warmupRenderRobotMetadataSnapshot(renderInterface, {
            stageSourcePath: '/robots/test.usd',
        }),
        /Failed to read cached render robot metadata snapshot/,
    );
});
