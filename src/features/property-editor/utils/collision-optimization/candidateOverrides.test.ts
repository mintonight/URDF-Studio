import assert from 'node:assert/strict';
import test from 'node:test';

import { GeometryType } from '@/types';
import type { UrdfVisual } from '@/types';

import type { CollisionOptimizationCandidate } from '../collisionOptimization.ts';
import type { MeshAnalysis } from '../geometryConversion.ts';
import type { CollisionTargetRef } from './collisionTargets.ts';
import {
  applyCandidateTypeOverride,
  getCandidateOverrideOptions,
} from './candidateOverrides.ts';

function createGeometry(type: GeometryType, overrides: Partial<UrdfVisual> = {}): UrdfVisual {
  return {
    type,
    dimensions: { x: 0.2, y: 0.8, z: 0.2 },
    color: '#ef4444',
    origin: {
      xyz: { x: 0.1, y: 0.2, z: 0.3 },
      rpy: { r: 0.4, p: 0.5, y: 0.6 },
    },
    ...overrides,
  };
}

function createTarget(
  id: string,
  type: GeometryType,
  geometryOverrides: Partial<UrdfVisual> = {},
): CollisionTargetRef {
  return {
    id,
    linkId: 'base',
    linkName: 'base',
    objectIndex: 0,
    bodyIndex: null,
    geometry: createGeometry(type, geometryOverrides),
    isPrimary: true,
    sequenceIndex: 0,
  };
}

const MESH_ANALYSIS: MeshAnalysis = {
  bounds: {
    x: 0.8,
    y: 0.2,
    z: 0.2,
    cx: 0,
    cy: 0,
    cz: 0,
  },
  primitiveFits: {
    cylinder: {
      axis: { x: 0, y: 1, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      radius: 0.1,
      length: 0.7,
      volume: 0.021991148575128552,
    },
    capsule: {
      axis: { x: 0, y: 1, z: 0 },
      center: { x: 0, y: 0, z: 0 },
      radius: 0.1,
      length: 0.7,
      volume: 0.02513274122871835,
    },
  },
};

test('getCandidateOverrideOptions exposes the supported manual override types', () => {
  assert.deepEqual(
    getCandidateOverrideOptions({
      target: createTarget('mesh-target', GeometryType.MESH),
      eligible: true,
      currentType: GeometryType.MESH,
      suggestedType: GeometryType.BOX,
      status: 'ready',
    }),
    [
      GeometryType.MESH,
      GeometryType.CAPSULE,
      GeometryType.CYLINDER,
      GeometryType.BOX,
      GeometryType.SPHERE,
    ],
  );

  assert.deepEqual(
    getCandidateOverrideOptions({
      target: createTarget('pair-a', GeometryType.CYLINDER),
      secondaryTarget: createTarget('pair-b', GeometryType.CYLINDER),
      eligible: true,
      currentType: GeometryType.CYLINDER,
      suggestedType: GeometryType.CAPSULE,
      status: 'ready',
    }),
    [GeometryType.CAPSULE, GeometryType.CYLINDER],
  );
});

test('applyCandidateTypeOverride disables a single candidate when overriding to its current type', () => {
  const candidate: CollisionOptimizationCandidate = {
    target: createTarget('mesh-target', GeometryType.MESH, { meshPath: 'meshes/base.stl' }),
    eligible: true,
    currentType: GeometryType.MESH,
    suggestedType: GeometryType.BOX,
    status: 'ready',
    reason: 'mesh-smart-fit',
    nextGeometry: createGeometry(GeometryType.BOX),
    affectedTargetIds: ['mesh-target'],
  };

  const overridden = applyCandidateTypeOverride(candidate, GeometryType.MESH, {
    'mesh-target': MESH_ANALYSIS,
  });

  assert.equal(overridden.eligible, false);
  assert.equal(overridden.suggestedType, null);
  assert.equal(overridden.status, 'disabled');
  assert.equal(overridden.nextGeometry, undefined);
  assert.equal(overridden.affectedTargetIds, undefined);
});

test('applyCandidateTypeOverride converts mesh candidates with the provided analysis', () => {
  const target = createTarget('mesh-target', GeometryType.MESH, {
    meshPath: 'meshes/base.stl',
    dimensions: { x: 1, y: 1, z: 1 },
  });
  const candidate: CollisionOptimizationCandidate = {
    target,
    eligible: false,
    currentType: GeometryType.MESH,
    suggestedType: null,
    status: 'disabled',
  };

  const overridden = applyCandidateTypeOverride(candidate, GeometryType.CYLINDER, {
    'mesh-target': MESH_ANALYSIS,
  });

  assert.equal(overridden.eligible, true);
  assert.equal(overridden.suggestedType, GeometryType.CYLINDER);
  assert.equal(overridden.status, 'ready');
  assert.equal(overridden.reason, 'mesh-manual-fit');
  assert.equal(overridden.nextGeometry?.type, GeometryType.CYLINDER);
  assert.equal(overridden.nextGeometry?.meshPath, undefined);
  assert.deepEqual(overridden.nextGeometry?.origin?.rpy, target.geometry.origin.rpy);
});

test('applyCandidateTypeOverride switches coaxial merge candidates and updates nested mutations immutably', () => {
  const nextGeometry = createGeometry(GeometryType.CAPSULE);
  const mutationGeometry = createGeometry(GeometryType.CAPSULE, {
    origin: {
      xyz: { x: -0.1, y: -0.2, z: -0.3 },
      rpy: { r: -0.4, p: -0.5, y: -0.6 },
    },
  });
  const candidate: CollisionOptimizationCandidate = {
    target: createTarget('pair-a', GeometryType.CYLINDER),
    secondaryTarget: createTarget('pair-b', GeometryType.CYLINDER),
    eligible: true,
    currentType: GeometryType.CYLINDER,
    suggestedType: GeometryType.CAPSULE,
    status: 'ready',
    reason: 'coaxial-merge-to-capsule',
    nextGeometry,
    mutations: [
      {
        linkId: 'base',
        objectIndex: 0,
        type: 'update',
        nextGeometry: mutationGeometry,
      },
      {
        linkId: 'child',
        objectIndex: 0,
        type: 'remove',
      },
    ],
  };

  const overridden = applyCandidateTypeOverride(candidate, GeometryType.CYLINDER, {});

  assert.equal(overridden.suggestedType, GeometryType.CYLINDER);
  assert.equal(overridden.reason, 'coaxial-merge-to-cylinder');
  assert.equal(overridden.nextGeometry?.type, GeometryType.CYLINDER);
  assert.equal(overridden.mutations?.[0]?.nextGeometry?.type, GeometryType.CYLINDER);
  assert.equal(overridden.mutations?.[1]?.type, 'remove');
  assert.notEqual(overridden.nextGeometry, nextGeometry);
  assert.notEqual(overridden.nextGeometry?.origin, nextGeometry.origin);
  assert.notEqual(overridden.mutations?.[0]?.nextGeometry, mutationGeometry);
  assert.notEqual(overridden.mutations?.[0]?.nextGeometry?.origin, mutationGeometry.origin);
});
