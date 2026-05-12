import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { MeshPhysicalMaterial } from 'three';

import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js';
import { ThreeRenderDelegateInterface } from './ThreeRenderDelegateInterface.js';

const {
    applySnapshotMaterialsToMeshes,
    applySnapshotMaterialRecord,
    resolveSnapshotMaterialEmissionEnabled,
    applySnapshotTextureInput,
    getSnapshotTextureApplyFailureSummary,
    recordSnapshotTextureApplyFailure,
    clearSnapshotTextureApplyFailure,
    getStage,
    setDriverStageResolveState,
    getDriverStageResolveSummary,
} = ThreeRenderDelegateMaterialOps.prototype;
const {
    applyStageFallbackMaterialParameters,
    warmupRobotSceneSnapshotFromDriver,
    getLastRobotSceneWarmupSummary,
} = ThreeRenderDelegateInterface.prototype;

const materialOpsPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    './ThreeRenderDelegateMaterialOps.js',
);

function createMaterialOpsContext({
    materials = {},
    meshes = {},
} = {}) {
    return {
        meshes,
        materials,
        _preferredVisualMaterialByLinkCache: new Map(),
        registry: {
            getTexture() {
                return Promise.reject(new Error('missing-texture'));
            },
        },
        normalizeMaterialTexturePath(value) {
            return typeof value === 'string' ? value.trim() || null : null;
        },
        getSnapshotTextureApplyFailureSummary,
        recordSnapshotTextureApplyFailure,
        clearSnapshotTextureApplyFailure,
    };
}

function createShaderPrim(attributes) {
    return {
        GetAttribute(name) {
            if (!attributes.has(name)) {
                return null;
            }
            return {
                Get() {
                    return attributes.get(name);
                },
            };
        },
    };
}

function createStageFallbackContext() {
    const delegate = Object.create(ThreeRenderDelegateInterface.prototype);
    delegate.registry = {
        getTexture() {
            return Promise.reject(new Error('missing-texture'));
        },
    };
    delegate.config = {};
    return delegate;
}

test('applySnapshotMaterialsToMeshes records subset and inherit failures instead of swallowing them', () => {
    const meshId = '/robot/base_link/visuals.proto_mesh_id0';
    const hydraMesh = {
        _id: meshId,
        _pendingMaterialId: null,
        _pendingGeomSubsetSections: null,
        _mesh: { material: null },
        tryApplyPendingGeomSubsetMaterials() {
            throw new Error('subset-apply-failed');
        },
        tryInheritVisualMaterialFromLink() {
            throw new Error('inherit-material-failed');
        },
    };
    const context = createMaterialOpsContext({
        meshes: {
            [meshId]: hydraMesh,
        },
    });

    const summary = applySnapshotMaterialsToMeshes.call(context);

    assert.equal(summary.subsetFailureCount, 1);
    assert.equal(summary.inheritFailureCount, 1);
    assert.deepEqual(summary.subsetFailureMeshIds, [meshId]);
    assert.deepEqual(summary.inheritFailureMeshIds, [meshId]);
});

test('applySnapshotMaterialsToMeshes logs subset and inherit failures to console', async () => {
    const source = await readFile(materialOpsPath, 'utf8');

    assert.match(source, /Failed to apply pending geometry subset materials/);
    assert.match(source, /Failed to inherit visual material from link/);
});

test('applySnapshotTextureInput records explicit texture apply failures', async () => {
    const material = new MeshPhysicalMaterial({ name: 'test-material' });
    const context = createMaterialOpsContext();

    assert.equal(
        applySnapshotTextureInput.call(context, material, '/textures/missing.png', 'map'),
        true,
    );

    await new Promise((resolve) => setTimeout(resolve, 0));

    const summary = getSnapshotTextureApplyFailureSummary.call(context);

    assert.equal(summary.count, 1);
    assert.deepEqual(summary.failures, [
        {
            materialName: 'test-material',
            materialProperty: 'map',
            texturePath: '/textures/missing.png',
            error: 'missing-texture',
        },
    ]);
    assert.equal(material.userData.snapshotTextureApplyFailed, true);
    assert.deepEqual(material.userData.snapshotTextureApplyFailures.map, {
        texturePath: '/textures/missing.png',
        error: 'missing-texture',
    });
});

test('applySnapshotTextureInput clears prior texture failure once assignment succeeds', async () => {
    const material = new MeshPhysicalMaterial({ name: 'recovering-material' });
    let shouldFail = true;
    const context = {
        ...createMaterialOpsContext(),
        registry: {
            getTexture() {
                if (shouldFail) {
                    return Promise.reject(new Error('temporary-miss'));
                }
                return Promise.resolve({
                    clone() {
                        return {
                            needsUpdate: false,
                            colorSpace: null,
                        };
                    },
                });
            },
        },
    };

    assert.equal(
        applySnapshotTextureInput.call(context, material, '/textures/recover.png', 'map'),
        true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(getSnapshotTextureApplyFailureSummary.call(context).count, 1);

    shouldFail = false;
    assert.equal(
        applySnapshotTextureInput.call(context, material, '/textures/recover.png', 'map'),
        true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const summary = getSnapshotTextureApplyFailureSummary.call(context);
    assert.equal(summary.count, 0);
    assert.equal(material.userData.snapshotTextureApplyFailed, undefined);
    assert.equal(material.userData.snapshotTextureApplyFailures, undefined);
});

test('applyStageFallbackMaterialParameters ignores OmniPBR default white emission unless enabled', () => {
    const material = new MeshPhysicalMaterial({ color: 0x000000 });
    const context = createStageFallbackContext();
    const shaderPrim = createShaderPrim(
        new Map([
            ['info:id', 'OmniPBR'],
            ['inputs:diffuse_color_constant', [0, 0, 0]],
            ['inputs:emissive_color_constant', [1, 1, 1]],
        ]),
    );

    applyStageFallbackMaterialParameters.call(context, material, shaderPrim);

    assert.equal(material.color.getHexString(), '000000');
    assert.equal(material.emissive.getHexString(), '000000');
});

test('applySnapshotMaterialRecord ignores OmniPBR default white emission unless enabled', () => {
    const material = new MeshPhysicalMaterial({ color: 0x000000, emissive: 0x000000 });
    const context = {
        ...createMaterialOpsContext(),
        inferColorHexFromMaterialName() {
            return null;
        },
        shouldTreatNamedHexDiffuseAsSrgb() {
            return false;
        },
        resolveSnapshotMaterialEmissionEnabled,
        applySnapshotTextureInput,
    };

    applySnapshotMaterialRecord.call(context, material, {
        isOmniPbr: true,
        color: [0, 0, 0],
        emissive: [1, 1, 1],
    });

    assert.equal(material.color.getHexString(), '000000');
    assert.equal(material.emissive.getHexString(), '000000');
});

test('getStage records async driver stage resolution failures explicitly', async () => {
    const context = {
        _resolvedDriverStage: null,
        _pendingDriverStagePromise: null,
        _driverStageResolveState: 'idle',
        _driverStageResolveSource: 'none',
        _driverStageResolveError: null,
        _driverStageResolveUpdatedAtMs: null,
        config: {
            driver() {
                return {
                    GetStage() {
                        return Promise.reject(new Error('async-stage-failed'));
                    },
                };
            },
        },
        allowDriverStageLookup: true,
        deferDriverStageLookupInSyncHotPath: false,
        isHydraSyncHotPathActive() {
            return false;
        },
        setDriverStageResolveState,
        getDriverStageResolveSummary,
    };

    assert.equal(getStage.call(context), null);
    assert.equal(getDriverStageResolveSummary.call(context).status, 'pending');

    const pendingPromise = context._pendingDriverStagePromise;
    assert.ok(pendingPromise);
    await pendingPromise;

    const summary = getDriverStageResolveSummary.call(context);
    assert.equal(summary.status, 'rejected');
    assert.equal(summary.source, 'driver-async');
    assert.equal(summary.error, 'async-stage-failed');
    assert.equal(summary.pending, false);
});

test('warmupRobotSceneSnapshotFromDriver exposes driver stage diagnostics in the cached summary', () => {
    const context = {
        config: {},
        _runtimeBridgeCacheStageKey: null,
        _robotSceneSnapshotByStageSource: new Map(),
        _lastRobotSceneWarmupSummary: null,
        getStageSourcePath() {
            return '/robots/test.usd';
        },
        getRobotSceneSnapshotFromDriver() {
            return {
                source: 'robot-scene-snapshot',
                rawSnapshot: {},
            };
        },
        normalizeRobotSceneSnapshot() {
            return {
                stageSourcePath: '/robots/test.usd',
                render: {},
                robotMetadataSnapshot: {
                    jointCatalogEntries: [],
                    linkDynamicsEntries: [],
                },
            };
        },
        hydratePendingProtoMeshes() {
            return {
                attemptedCount: 1,
                completedCount: 1,
                pendingCount: 0,
            };
        },
        applySnapshotMaterialsToMeshes() {
            return {
                boundCount: 0,
                inheritedCount: 0,
                subsetFailureCount: 2,
                inheritFailureCount: 1,
                textureFailureCount: 3,
            };
        },
        emitRobotSceneSnapshotReady() { },
        getDriverStageResolveSummary() {
            return {
                status: 'rejected',
                source: 'driver-async',
                error: 'async-stage-failed',
                pending: false,
            };
        },
    };

    const summary = warmupRobotSceneSnapshotFromDriver.call(context, { GetRobotSceneSnapshot() { return {}; } });

    assert.equal(summary.driverStageResolveStatus, 'rejected');
    assert.equal(summary.driverStageResolveSource, 'driver-async');
    assert.equal(summary.driverStageResolveError, 'async-stage-failed');
    assert.equal(summary.snapshotMaterialSubsetFailureCount, 2);
    assert.equal(summary.snapshotMaterialInheritFailureCount, 1);
    assert.equal(summary.snapshotTextureFailureCount, 3);
    assert.deepEqual(getLastRobotSceneWarmupSummary.call(context), summary);
});
