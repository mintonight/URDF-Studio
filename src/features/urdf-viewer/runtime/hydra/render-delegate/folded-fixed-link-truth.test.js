import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Quaternion, Vector3 } from 'three';

import { ThreeRenderDelegateCore } from './ThreeRenderDelegateCore.js';
import { ThreeRenderDelegateMaterialOps } from './ThreeRenderDelegateMaterialOps.js';
import { resolveSemanticChildLinkTargetFromResolvedPrimPath } from './shared-basic.js';

function createTranslationMatrix(x, y, z) {
    return new Matrix4().makeTranslation(x, y, z);
}

function createRotationXMatrix(radians) {
    return new Matrix4().makeRotationX(radians);
}

function decomposeTranslation(matrix) {
    const position = new Vector3();
    matrix.decompose(position, new Quaternion(), new Vector3());
    return position.toArray().map((value) => Number(value.toFixed(6)));
}

function assertMatrixClose(actual, expected, message) {
    actual.elements.forEach((value, index) => {
        assert.ok(
            Math.abs(value - expected.elements[index]) < 1e-6,
            `${message} (element ${index}): expected ${expected.elements[index]}, got ${value}`,
        );
    });
}

function createFoldedChildDelegate(overrides = {}) {
    const delegate = Object.create(ThreeRenderDelegateCore.prototype);
    Object.assign(delegate, {
        getUrdfTruthForCurrentStage() {
            return {
                visualsByLinkName: new Map(),
                collisionsByLinkName: new Map(),
                jointByChildLinkName: new Map(),
            };
        },
        getResolvedVisualTransformPrimPathForMeshId() {
            return null;
        },
        getResolvedPrimPathForMeshId() {
            return null;
        },
        getUrdfLinkWorldTransformFromJointChain() {
            return null;
        },
        getPreferredLinkWorldTransform() {
            return null;
        },
        getWorldTransformForPrimPath() {
            return null;
        },
        shouldUseUrdfVisualFallbackForMesh() {
            return true;
        },
    }, overrides);
    return delegate;
}

test('resolves folded visual and collision prims back to semantic child links', () => {
    const visualTarget = resolveSemanticChildLinkTargetFromResolvedPrimPath({
        owningLinkPath: '/Robot/torso_link',
        resolvedPrimPath: '/Robot/torso_link/visuals/head_link/mesh',
        sectionName: 'visuals',
        validLinkNames: new Map([['head_link', []], ['torso_link', []]]),
    });
    const collisionTarget = resolveSemanticChildLinkTargetFromResolvedPrimPath({
        owningLinkPath: '/Robot/torso_link',
        resolvedPrimPath: '/Robot/torso_link/collisions/head_link/mesh',
        sectionName: 'collisions',
        validLinkNames: new Map([['head_link', {}], ['torso_link', {}]]),
    });
    const assetTarget = resolveSemanticChildLinkTargetFromResolvedPrimPath({
        owningLinkPath: '/Robot/torso_link',
        resolvedPrimPath: '/Robot/torso_link/visuals/torso_link_rev_1_0/mesh',
        sectionName: 'visuals',
        validLinkNames: new Map([['head_link', []], ['torso_link', []]]),
    });

    assert.deepEqual(visualTarget, {
        linkName: 'head_link',
        linkPath: '/Robot/head_link',
    });
    assert.deepEqual(collisionTarget, {
        linkName: 'head_link',
        linkPath: '/Robot/head_link',
    });
    assert.equal(assetTarget, null);
});

test('ignores generic visual and collision container scopes when resolving semantic child links', () => {
    const genericTargets = [
        '/Robot/torso_link/visuals/visual_0/mesh',
        '/Robot/torso_link/collisions/collision_0/cube',
        '/Robot/torso_link/visuals/group_0/mesh',
        '/Robot/torso_link/visuals/xform_0/mesh',
        '/Robot/torso_link/visuals/Scene/mesh',
        '/Robot/torso_link/visuals/root/mesh',
    ];
    const validLinkNames = new Map([
        ['torso_link', []],
        ['visual_0', []],
        ['collision_0', []],
        ['group_0', []],
        ['xform_0', []],
        ['Scene', []],
        ['root', []],
    ]);

    for (const resolvedPrimPath of genericTargets) {
        const sectionName = resolvedPrimPath.includes('/collisions/') ? 'collisions' : 'visuals';
        assert.equal(resolveSemanticChildLinkTargetFromResolvedPrimPath({
            owningLinkPath: '/Robot/torso_link',
            resolvedPrimPath,
            sectionName,
            validLinkNames,
        }), null, `expected "${resolvedPrimPath}" to stay attached to torso_link`);
    }
});

test('uses semantic child link transforms for folded visual prims in URDF truth fallback', () => {
    const headVisualEntry = {
        localMatrix: new Matrix4().identity(),
    };
    const torsoVisualEntry = {
        localMatrix: createTranslationMatrix(9, 9, 9),
    };
    const delegate = createFoldedChildDelegate({
        getUrdfTruthForCurrentStage() {
            return {
                visualsByLinkName: new Map([
                    ['torso_link', [torsoVisualEntry]],
                    ['head_link', [headVisualEntry]],
                ]),
                collisionsByLinkName: new Map(),
                jointByChildLinkName: new Map(),
            };
        },
        getResolvedVisualTransformPrimPathForMeshId() {
            return '/Robot/torso_link/visuals/head_link/mesh';
        },
        getUrdfLinkWorldTransformFromJointChain(linkPath) {
            if (linkPath === '/Robot/head_link') {
                return createTranslationMatrix(1, 2, 3);
            }
            return createTranslationMatrix(9, 9, 9);
        },
        getPreferredLinkWorldTransform(linkPath) {
            if (linkPath === '/Robot/torso_link') {
                return new Matrix4().identity();
            }
            return null;
        },
        getWorldTransformForPrimPath() {
            return new Matrix4().identity();
        },
    });

    const matrix = delegate.getVisualWorldTransformFromUrdfTruth('/Robot/torso_link/visuals.proto_mesh_id0');

    assert.deepEqual(decomposeTranslation(matrix), [1, 2, 3]);
    assert.equal(delegate.getUrdfVisualEntryForMeshId('/Robot/torso_link/visuals.proto_mesh_id0'), headVisualEntry);
});

test('uses semantic child link transforms for folded collision prims in URDF truth fallback', () => {
    const headCollisionEntry = {
        originQuatWxyz: [1, 0, 0, 0],
        localMatrix: new Matrix4().identity(),
    };
    const torsoCollisionEntry = {
        originQuatWxyz: [1, 0, 0, 0],
        localMatrix: createTranslationMatrix(9, 9, 9),
    };
    const delegate = createFoldedChildDelegate({
        getUrdfTruthForCurrentStage() {
            return {
                visualsByLinkName: new Map(),
                collisionsByLinkName: new Map([
                    ['torso_link', {
                        all: [torsoCollisionEntry],
                        byType: new Map([['mesh', [torsoCollisionEntry]]]),
                    }],
                    ['head_link', {
                        all: [headCollisionEntry],
                        byType: new Map([['mesh', [headCollisionEntry]]]),
                    }],
                ]),
                jointByChildLinkName: new Map(),
            };
        },
        getResolvedPrimPathForMeshId() {
            return '/Robot/torso_link/collisions/head_link/mesh';
        },
        getUrdfLinkWorldTransformFromJointChain(linkPath) {
            if (linkPath === '/Robot/head_link') {
                return createTranslationMatrix(4, 5, 6);
            }
            return createTranslationMatrix(9, 9, 9);
        },
    });

    const matrix = delegate.getCollisionWorldTransformFromUrdfTruth('/Robot/torso_link/collisions.proto_mesh_id0');

    assert.deepEqual(decomposeTranslation(matrix), [4, 5, 6]);
    assert.equal(delegate.getUrdfCollisionEntryForMeshId('/Robot/torso_link/collisions.proto_mesh_id0'), headCollisionEntry);
});

test('prefers the resolved stage link frame even when it is identity', () => {
    const stageIdentity = new Matrix4().identity();
    const visualBasis = createRotationXMatrix(Math.PI / 2);
    const delegate = createFoldedChildDelegate({
        getWorldTransformForPrimPath(linkPath) {
            return linkPath === '/Robot/FL_thigh' ? stageIdentity.clone() : null;
        },
        getVisualLinkFrameTransform(linkPath) {
            return linkPath === '/Robot/FL_thigh' ? visualBasis.clone() : null;
        },
    });

    const resolved = delegate.getStageOrVisualLinkWorldTransform('/Robot/FL_thigh');

    assert.ok(resolved);
    assertMatrixClose(
        resolved,
        stageIdentity,
        'identity stage link frames should not be replaced by authored visual mesh basis transforms',
    );
});

test('falls back to the visual link frame only when the stage link frame is unavailable', () => {
    const visualBasis = createRotationXMatrix(Math.PI / 2);
    const delegate = createFoldedChildDelegate({
        getWorldTransformForPrimPath() {
            return null;
        },
        getVisualLinkFrameTransform(linkPath) {
            return linkPath === '/Robot/FL_thigh' ? visualBasis.clone() : null;
        },
    });

    const resolved = delegate.getStageOrVisualLinkWorldTransform('/Robot/FL_thigh');

    assert.ok(resolved);
    assertMatrixClose(
        resolved,
        visualBasis,
        'visual link frame fallback should remain available when the stage link transform cannot be resolved',
    );
});

test('falls back to the URDF visual pose when the resolved semantic visual prim injects an extra local basis rotation', () => {
    const linkWorld = createTranslationMatrix(1, 2, 3);
    const resolvedVisualWorld = linkWorld.clone().multiply(createRotationXMatrix(Math.PI / 2));
    const delegate = Object.create(ThreeRenderDelegateMaterialOps.prototype);
    Object.assign(delegate, {
        _urdfVisualFallbackDecisionCache: new Map(),
        config: {},
        getUrdfTruthLinkContextForMeshId() {
            return {
                proto: {
                    linkPath: '/Robot/FL_thigh',
                    protoIndex: 0,
                    sectionName: 'visuals',
                    protoType: 'mesh',
                },
                ownerLinkPath: '/Robot/FL_thigh',
                effectiveLinkName: 'FL_thigh',
                effectiveLinkPath: '/Robot/FL_thigh',
                resolvedPrimPath: '/Robot/FL_thigh/visuals/FL_thigh/mesh',
            };
        },
        getUrdfVisualEntryForMeshId() {
            return {
                localMatrix: new Matrix4().identity(),
            };
        },
        getUrdfLinkWorldTransformFromJointChain(linkPath) {
            return linkPath === '/Robot/FL_thigh' ? linkWorld.clone() : null;
        },
        getPreferredLinkWorldTransform(linkPath) {
            return linkPath === '/Robot/FL_thigh' ? linkWorld.clone() : null;
        },
        getResolvedVisualTransformPrimPathForMeshId() {
            return '/Robot/FL_thigh/visuals/FL_thigh/mesh';
        },
        getWorldTransformForPrimPath(primPath) {
            if (primPath === '/Robot/FL_thigh') {
                return linkWorld.clone();
            }
            if (primPath === '/Robot/FL_thigh/visuals/FL_thigh/mesh') {
                return resolvedVisualWorld.clone();
            }
            return null;
        },
    });

    assert.equal(
        delegate.shouldUseUrdfVisualFallbackForMesh('/Robot/FL_thigh/visuals.proto_mesh_id0'),
        true,
    );

    const matrix = delegate.getVisualWorldTransformFromUrdfTruth('/Robot/FL_thigh/visuals.proto_mesh_id0');

    assert.ok(matrix);
    assertMatrixClose(
        matrix,
        linkWorld,
        'semantic visual prim fallback should preserve the URDF local pose when the stage injects only a basis rotation',
    );
});
