import assert from 'node:assert/strict';
import test from 'node:test';

import * as THREE from 'three';
import type { LineSegments, Material, Mesh } from 'three';

import { ignoreRaycast } from '@/shared/utils/three/ignoreRaycast';
import { narrowLineRaycast } from '@/shared/utils/three/narrowLineRaycast';
import { createInertiaBox, createOriginAxes } from './visualizationFactories.ts';

function collectMeshMaterials(originAxes: ReturnType<typeof createOriginAxes>) {
  const materials: Material[] = [];

  originAxes.traverse((child) => {
    if (!(child as Mesh).isMesh) {
      return;
    }

    const material = (child as Mesh).material;
    if (Array.isArray(material)) {
      materials.push(...material);
      return;
    }

    materials.push(material);
  });

  return materials;
}

test('createOriginAxes defaults to participating in depth occlusion', () => {
  const originAxes = createOriginAxes(0.1);
  const materials = collectMeshMaterials(originAxes);

  assert.ok(materials.length > 0, 'origin axes should create mesh materials');
  materials.forEach((material) => {
    assert.equal(material.depthTest, true);
    assert.equal(material.depthWrite, true);
    assert.equal(material.transparent, false);
  });
});

test('createInertiaBox keeps fill visual-only and uses the outline for narrow picking', () => {
  const inertiaBox = createInertiaBox(1, 2, 3, new THREE.Quaternion());
  const fillMesh = inertiaBox.children.find((child) => (child as Mesh).isMesh) as Mesh | undefined;
  const outline = inertiaBox.children.find((child) => (child as LineSegments).isLineSegments) as
    | LineSegments
    | undefined;

  assert.ok(fillMesh, 'inertia box should include a filled mesh');
  assert.ok(outline, 'inertia box should include an outline');
  assert.equal(fillMesh?.raycast, ignoreRaycast);
  assert.equal(outline?.raycast, narrowLineRaycast);
});
