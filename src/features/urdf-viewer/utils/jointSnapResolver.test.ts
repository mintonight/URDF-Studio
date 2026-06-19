import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';

import type { AssemblyState } from '@/types';

import { resolveJointSnapFromHit } from './jointSnapResolver.ts';

function assertVecNearlyEqual(actual: THREE.Vector3, expected: THREE.Vector3, message?: string) {
  assert.ok(actual.distanceTo(expected) < 1e-4, message ?? `${actual.toArray()} !== ${expected.toArray()}`);
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

test('resolveJointSnapFromHit chooses the candidate closest to the cursor hit', () => {
  const { mesh } = buildRuntime();

  const result = resolveJointSnapFromHit(
    { object: mesh, faceIndex: 0, point: new THREE.Vector3(10.5, 0.3, 0) },
    ASSEMBLY_STATE,
    ['surface', 'faceCenter'],
  );

  assert.equal(result!.chosen.kind, 'surface');
  assertVecNearlyEqual(result!.chosen.pointWorld, new THREE.Vector3(10.5, 0.3, 0));
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
