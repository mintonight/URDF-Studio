import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';

import { LinkDynamicsController } from './link-dynamics.js';

test('LinkDynamicsController exposes error state when catalog cannot build (stage missing)', () => {
    const controller = new LinkDynamicsController();
    const renderInterface = {
        meshes: {
            '/Robot/base_link/visuals.proto_mesh_id0': {},
        },
    };

    controller.startLinkDynamicsCatalogBuildIfNeeded(renderInterface);

    assert.equal(controller.catalogStatus, 'error');
    assert.equal(controller.catalogError, 'no-stage');
});

test('LinkDynamicsController marks catalog ready when data already exists', () => {
    const controller = new LinkDynamicsController();
    controller.linkDynamicsByLinkPath.set('/Robot/base_link', {});

    const renderInterface = {
        meshes: {
            '/Robot/base_link/visuals.proto_mesh_id0': {},
        },
    };

    controller.startLinkDynamicsCatalogBuildIfNeeded(renderInterface);

    assert.equal(controller.catalogStatus, 'ready');
    assert.equal(controller.catalogError, null);
});

test('LinkDynamicsController builds catalog from stage and reports ready', async () => {
    const controller = new LinkDynamicsController();
    controller.buildLinkDynamicsCatalog = async function () {
        this.linkDynamicsByLinkPath.set('/Robot/base_link', {
            linkPath: '/Robot/base_link',
            mass: 1,
            centerOfMassLocal: new Vector3(),
            diagonalInertia: null,
            principalAxesLocal: new Quaternion(),
        });
    };

    const renderInterface = {
        meshes: {
            '/Robot/base_link/visuals.proto_mesh_id0': {},
        },
        getStage() {
            return {
                GetRootLayer() {
                    return {
                        identifier: '/robots/test-fail.usd',
                    };
                },
            };
        },
    };

    await controller.startLinkDynamicsCatalogBuildIfNeeded(renderInterface);

    assert.equal(controller.catalogStatus, 'ready');
    assert.equal(controller.catalogError, null);
    assert.equal(controller.linkDynamicsByLinkPath.size, 1);
    assert.equal(controller.linkDynamicsBuildPromise, null);
});

test('LinkDynamicsController exposes build failures as catalog errors', async () => {
    const controller = new LinkDynamicsController();
    controller.buildLinkDynamicsCatalog = async function () {
        throw new Error('catalog-build-failed');
    };
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        const renderInterface = {
            meshes: {
                '/Robot/base_link/visuals.proto_mesh_id0': {},
            },
            getStage() {
                return {
                    GetRootLayer() {
                        return {
                            identifier: '/robots/test.usd',
                        };
                    },
                };
            },
        };

        await assert.rejects(
            controller.startLinkDynamicsCatalogBuildIfNeeded(renderInterface),
            /catalog-build-failed/,
        );
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(controller.catalogStatus, 'error');
    assert.equal(controller.catalogError, 'catalog-build-failed');
    assert.equal(controller.linkDynamicsBuildPromise, null);
    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0]?.[0] || ''), /Link dynamics catalog build failed/);
});

test('LinkDynamicsController logs root layer export failures instead of silently swallowing them', () => {
    const controller = new LinkDynamicsController();
    controller.setStageSourcePath('/robots/test.usd');

    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        assert.equal(
            controller.safeExportRootLayerText({
                GetRootLayer() {
                    throw new Error('root-layer-export-failed');
                },
            }),
            '',
        );
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0]?.[0] || ''), /Failed to export USD root layer text/);
});

test('LinkDynamicsController logs referenced stage open failures instead of silently swallowing them', async () => {
    const controller = new LinkDynamicsController();

    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        await assert.doesNotReject(async () => {
            const stage = await controller.safeOpenUsdStage({
                UsdStage: {
                    Open() {
                        throw new Error('stage-open-failed');
                    },
                },
            }, '/robots/payload.usd');

            assert.equal(stage, null);
        });
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0]?.[0] || ''), /Failed to open USD stage/);
});

test('LinkDynamicsController surfaces cached metadata getter failures as catalog errors', async () => {
    const controller = new LinkDynamicsController();
    const originalConsoleError = console.error;
    const loggedErrors = [];
    console.error = (...args) => {
        loggedErrors.push(args);
    };

    try {
        const renderInterface = {
            meshes: {
                '/Robot/base_link/visuals.proto_mesh_id0': {},
            },
            getCachedRobotMetadataSnapshot() {
                throw new Error('cached-metadata-crashed');
            },
            getStage() {
                return {
                    GetRootLayer() {
                        return {
                            identifier: '/robots/test.usd',
                        };
                    },
                };
            },
        };

        await assert.rejects(
            controller.startLinkDynamicsCatalogBuildIfNeeded(renderInterface),
            /Failed to read cached render robot metadata snapshot/,
        );
    }
    finally {
        console.error = originalConsoleError;
    }

    assert.equal(controller.catalogStatus, 'error');
    assert.match(String(controller.catalogError || ''), /Failed to read cached render robot metadata snapshot/);
    assert.equal(loggedErrors.length, 1);
    assert.match(String(loggedErrors[0]?.[0] || ''), /Failed to read cached render robot metadata snapshot before link dynamics catalog build/);
});

test('LinkDynamicsController logs driver lookup failures during transform prefetch', () => {
    const controller = new LinkDynamicsController();
    const renderInterface = {
        prefetchPrimTransformsFromDriver() {},
        config: {
            driver() {
                throw new Error('driver-getter-failed');
            },
        },
    };

    const originalConsoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
        warnings.push(args);
    };

    try {
        controller.prefetchLinkWorldTransforms(renderInterface);
    }
    finally {
        console.warn = originalConsoleWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0] || ''), /Failed to resolve USD driver for transform prefetch/);
});

test('LinkDynamicsController logs transform prefetch call failures instead of silently swallowing them', () => {
    const controller = new LinkDynamicsController();
    const renderInterface = {
        prefetchPrimTransformsFromDriver() {
            throw new Error('prefetch-failed');
        },
        config: {
            driver() {
                return { id: 'driver' };
            },
        },
    };

    const originalConsoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
        warnings.push(args);
    };

    try {
        controller.prefetchLinkWorldTransforms(renderInterface);
    }
    finally {
        console.warn = originalConsoleWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0] || ''), /Failed to prefetch link world transforms/);
});

test('LinkDynamicsController logs stage world transform getter failures when all signatures fail', () => {
    const controller = new LinkDynamicsController();
    const renderInterface = {
        getWorldTransformForPrimPath() {
            throw new Error('world-transform-failed');
        },
    };

    const originalConsoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
        warnings.push(args);
    };

    try {
        assert.equal(
            controller.getDirectStageLinkWorldMatrixForPath(renderInterface, '/Robot/base_link'),
            null,
        );
    }
    finally {
        console.warn = originalConsoleWarn;
    }

    assert.equal(warnings.length, 1);
    assert.match(String(warnings[0]?.[0] || ''), /Failed to read direct stage link world transform/);
});

test('LinkDynamicsController keeps legacy stage world transform fallback without warning when fallback succeeds', () => {
    const controller = new LinkDynamicsController();
    const expectedMatrix = new Matrix4().makeTranslation(1, 2, 3);
    const renderInterface = {
        getWorldTransformForPrimPath(_linkPath, options) {
            if (options?.clone === true) {
                throw new Error('clone-option-unsupported');
            }
            return expectedMatrix.clone();
        },
    };

    const originalConsoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
        warnings.push(args);
    };

    try {
        const resolved = controller.getDirectStageLinkWorldMatrixForPath(renderInterface, '/Robot/base_link');
        assert.ok(resolved instanceof Matrix4);
        assert.deepEqual(resolved.elements, expectedMatrix.elements);
    }
    finally {
        console.warn = originalConsoleWarn;
    }

    assert.equal(warnings.length, 0);
});

test('LinkDynamicsController logs preferred and visual link transform getter failures instead of silently swallowing them', () => {
    const controller = new LinkDynamicsController();
    const renderInterface = {
        getPreferredLinkWorldTransform() {
            throw new Error('preferred-transform-failed');
        },
        getStageOrVisualLinkWorldTransform() {
            throw new Error('stage-or-visual-transform-failed');
        },
        getVisualLinkFrameTransform() {
            throw new Error('visual-transform-failed');
        },
        meshes: {},
    };

    const originalConsoleWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => {
        warnings.push(args);
    };

    try {
        assert.equal(
            controller.getPreferredLinkWorldMatrixForPath(renderInterface, '/Robot/base_link'),
            null,
        );
        assert.equal(
            controller.getVisualLinkWorldMatrixForPath(renderInterface, '/Robot/base_link'),
            null,
        );
    }
    finally {
        console.warn = originalConsoleWarn;
    }

    assert.equal(warnings.length, 3);
    assert.match(String(warnings[0]?.[0] || ''), /Failed to read preferred link world transform/);
    assert.match(String(warnings[1]?.[0] || ''), /Failed to read stage-or-visual link world transform/);
    assert.match(String(warnings[2]?.[0] || ''), /Failed to read visual link world transform/);
});
