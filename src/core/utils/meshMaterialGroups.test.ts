import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  applyVisualMeshMaterialGroupsToObject,
  resolveMeshFaceSelection,
  resolveRuntimeMeshMaterialGroupKey,
} from './meshMaterialGroups';

test('resolveMeshFaceSelection expands to a coplanar island', () => {
  const geometry = new THREE.PlaneGeometry(1, 1, 1, 1);

  assert.deepEqual(resolveMeshFaceSelection(geometry, 0, 'face'), [0]);
  assert.deepEqual(resolveMeshFaceSelection(geometry, 0, 'island'), [0, 1]);
});

test('applyVisualMeshMaterialGroupsToObject restores geometry groups and material slots', () => {
  const root = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1, 1, 1),
    new THREE.MeshStandardMaterial({ color: '#808080', name: 'base' }),
  );
  root.add(mesh);

  const meshKey = resolveRuntimeMeshMaterialGroupKey(mesh, root);
  applyVisualMeshMaterialGroupsToObject(root, {
    authoredMaterials: [
      { name: 'base', color: '#808080' },
      {
        name: 'paint_slot_1',
        color: '#33aa44',
        opacity: 0.45,
        roughness: 0.2,
        metalness: 0.8,
        emissive: '#112233',
        emissiveIntensity: 1.2,
      },
    ],
    meshMaterialGroups: [
      { meshKey, start: 0, count: 3, materialIndex: 1 },
      { meshKey, start: 3, count: 3, materialIndex: 0 },
    ],
  });

  assert.equal(Array.isArray(mesh.material), true);
  if (!Array.isArray(mesh.material)) {
    throw new Error('mesh material should be an array after grouped material application');
  }
  const materials = mesh.material;
  assert.equal(materials.length, 2);
  const paintedMaterial = materials[1] as THREE.MeshStandardMaterial;
  assert.equal(paintedMaterial.color.getHexString(), '33aa44');
  assert.equal(paintedMaterial.toneMapped, false);
  assert.equal(
    (paintedMaterial.userData.originalColor as THREE.Color).getHexString(),
    '33aa44',
  );
  assert.ok(Math.abs(paintedMaterial.opacity - 0.45) <= 1e-6);
  assert.equal(paintedMaterial.transparent, true);
  assert.ok(Math.abs(paintedMaterial.roughness - 0.2) <= 1e-6);
  assert.ok(Math.abs(paintedMaterial.metalness - 0.8) <= 1e-6);
  assert.equal(paintedMaterial.emissive.getHexString(), '112233');
  assert.ok(Math.abs(paintedMaterial.emissiveIntensity - 1.2) <= 1e-6);
  assert.deepEqual(
    mesh.geometry.groups.map(({ start, count, materialIndex }) => ({
      start,
      count,
      materialIndex,
    })),
    [
      { start: 0, count: 3, materialIndex: 1 },
      { start: 3, count: 3, materialIndex: 0 },
    ],
  );
});
