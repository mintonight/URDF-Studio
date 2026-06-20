import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import type { AssemblyState } from '@/types';

import { chooseSnapCandidate, resolveJointSnapFromHit, type ResolvedJointSnapCandidate } from './jointSnapResolver.ts';

function assertVecNearlyEqual(actual: THREE.Vector3, expected: THREE.Vector3, message?: string) {
  assert.ok(actual.distanceTo(expected) < 1e-4, message ?? `${actual.toArray()} !== ${expected.toArray()}`);
}

function candidate(kind: ResolvedJointSnapCandidate['kind'], pointWorld: THREE.Vector3): ResolvedJointSnapCandidate {
  return {
    kind,
    pointWorld,
    poseWorld: new THREE.Matrix4().setPosition(pointWorld),
  };
}

function buildCamera(): THREE.OrthographicCamera {
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

function buildRuntime(): { robot: THREE.Group; mesh: THREE.Mesh; orphan: THREE.Mesh } {
  const robot = new THREE.Group();

  const link = new THREE.Group();
  (link as THREE.Object3D & { isURDFLink?: boolean }).isURDFLink = true;
  link.name = 'comp_a_base_link';
  link.position.set(10, 0, 0);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]), 3),
  );
  const mesh = new THREE.Mesh(geometry);
  link.add(mesh);
  robot.add(link);

  const orphan = new THREE.Mesh(geometry);
  robot.add(orphan);

  robot.updateMatrixWorld(true);
  return { robot, mesh, orphan };
}

const ASSEMBLY_STATE = {
  components: {
    comp_a: {
      id: 'comp_a',
      name: 'A',
      robot: {
        links: {
          comp_a_base_link: { id: 'comp_a_base_link', name: 'base_link' },
        },
      },
    },
  },
} as unknown as AssemblyState;

test('resolveJointSnapFromHit maps a hit back to its component link and world frame', () => {
  const { mesh } = buildRuntime();

  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: new THREE.Vector3(10.5, 0.3, 0) },
    ASSEMBLY_STATE,
    ['surface', 'faceCenter'],
  );

  assert.ok(result);
  assert.equal(result!.componentId, 'comp_a');
  assert.equal(result!.linkId, 'comp_a_base_link');
  assertVecNearlyEqual(
    new THREE.Vector3().setFromMatrixPosition(result!.linkWorldMatrix),
    new THREE.Vector3(10, 0, 0),
  );

  const kinds = result!.candidates.map((candidate) => candidate.kind).sort();
  assert.deepEqual(kinds, ['faceCenter', 'surface']);

  const faceCenter = result!.candidates.find((candidate) => candidate.kind === 'faceCenter');
  assertVecNearlyEqual(faceCenter!.pointWorld, new THREE.Vector3(10 + 2 / 3, 2 / 3, 0));
});

test('resolveJointSnapFromHit prefers smart face candidates over raw surface hits', () => {
  const { mesh } = buildRuntime();

  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: new THREE.Vector3(10.5, 0.3, 0) },
    ASSEMBLY_STATE,
    ['surface', 'faceCenter'],
  );

  assert.equal(result!.chosen.kind, 'faceCenter');
  assertVecNearlyEqual(result!.chosen.pointWorld, new THREE.Vector3(10 + 2 / 3, 2 / 3, 0));
});

test('chooseSnapCandidate uses screen radius and priority while ignoring surface as an active snap', () => {
  const camera = buildCamera();
  const hitPoint = new THREE.Vector3(0, 0, 0);
  const chosen = chooseSnapCandidate(
    [
      candidate('surface', hitPoint.clone()),
      candidate('bboxCenter', new THREE.Vector3(0.2, 0, 0)),
      candidate('faceCenter', new THREE.Vector3(0.05, 0, 0)),
    ],
    hitPoint,
    { camera, domSize: { width: 1000, height: 1000 } },
  );

  assert.equal(chosen.kind, 'faceCenter');
});

test('chooseSnapCandidate can override to a free surface point', () => {
  const hitPoint = new THREE.Vector3(0, 0, 0);
  const chosen = chooseSnapCandidate(
    [
      candidate('surface', hitPoint.clone()),
      candidate('faceCenter', new THREE.Vector3(0.05, 0, 0)),
    ],
    hitPoint,
    { freePointOverride: true },
  );

  assert.equal(chosen.kind, 'surface');
  assertVecNearlyEqual(chosen.pointWorld, hitPoint);
});

test('resolveJointSnapFromHit returns null for hits without a link ancestor or face', () => {
  const { mesh, orphan } = buildRuntime();

  assert.equal(
    resolveJointSnapFromHit({ object: orphan, faceIndex: 0, point: new THREE.Vector3() }, ASSEMBLY_STATE, null),
    null,
  );
  assert.equal(
    resolveJointSnapFromHit({ object: mesh, faceIndex: null, point: new THREE.Vector3() }, ASSEMBLY_STATE, null),
    null,
  );
});
