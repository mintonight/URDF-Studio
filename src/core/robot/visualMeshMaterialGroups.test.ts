import test from 'node:test';
import assert from 'node:assert/strict';

import type { UrdfVisual } from '@/types';

import { applyMeshMaterialPaintEdit } from './visualMeshMaterialGroups';

function makeMeshGeometry(overrides: Partial<UrdfVisual> = {}): UrdfVisual {
  return {
    type: 'mesh' as UrdfVisual['type'],
    dimensions: { x: 1, y: 1, z: 1 },
    color: '#808080',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    meshPath: 'mesh.obj',
    ...overrides,
  };
}

test('applyMeshMaterialPaintEdit stores full mesh material groups for painted faces', () => {
  const geometry = makeMeshGeometry();

  const result = applyMeshMaterialPaintEdit({
    geometry,
    meshKey: '0',
    triangleCount: 4,
    selectedFaceIndices: [1, 2],
    paintColor: '#ff5500',
    baseMaterial: { name: 'base', color: '#808080' },
  });

  assert.deepEqual(result.authoredMaterials, [
    { name: 'base', color: '#808080' },
    { name: 'paint_slot_1', color: '#ff5500' },
  ]);
  assert.deepEqual(result.meshMaterialGroups, [
    { meshKey: '0', start: 0, count: 3, materialIndex: 0 },
    { meshKey: '0', start: 3, count: 6, materialIndex: 1 },
    { meshKey: '0', start: 9, count: 3, materialIndex: 0 },
  ]);
  assert.equal(result.changed, true);
});

test('applyMeshMaterialPaintEdit erases painted faces and collapses empty custom groups', () => {
  const geometry = makeMeshGeometry({
    authoredMaterials: [
      { name: 'base', color: '#808080' },
      { name: 'paint_slot_1', color: '#ff5500' },
    ],
    meshMaterialGroups: [
      { meshKey: '0', start: 0, count: 3, materialIndex: 0 },
      { meshKey: '0', start: 3, count: 6, materialIndex: 1 },
      { meshKey: '0', start: 9, count: 3, materialIndex: 0 },
    ],
  });

  const result = applyMeshMaterialPaintEdit({
    geometry,
    meshKey: '0',
    triangleCount: 4,
    selectedFaceIndices: [1, 2],
    paintColor: '#ff5500',
    erase: true,
    baseMaterial: { name: 'base', color: '#808080' },
  });

  assert.deepEqual(result.authoredMaterials, [{ name: 'base', color: '#808080' }]);
  assert.equal(result.meshMaterialGroups, undefined);
  assert.equal(result.changed, true);
});

test('applyMeshMaterialPaintEdit reports an erase no-op on an unpainted face', () => {
  const result = applyMeshMaterialPaintEdit({
    geometry: makeMeshGeometry(),
    meshKey: '0',
    triangleCount: 4,
    selectedFaceIndices: [1],
    paintColor: '#ff5500',
    erase: true,
    baseMaterial: { name: 'base', color: '#808080' },
  });

  assert.equal(result.changed, false);
  assert.equal(result.meshMaterialGroups, undefined);
});

test('applyMeshMaterialPaintEdit captures the effective base before the first paint edit', () => {
  const result = applyMeshMaterialPaintEdit({
    geometry: makeMeshGeometry({
      color: '#ffffff',
      authoredMaterials: [{ name: 'stale_imported_material', color: '#ff6c0a' }],
    }),
    meshKey: '0',
    triangleCount: 2,
    selectedFaceIndices: [0, 1],
    paintColor: '#3366ff',
    baseMaterial: { name: 'effective_base', color: '#ffffff' },
  });

  assert.deepEqual(result.authoredMaterials, [
    { name: 'effective_base', color: '#ffffff' },
    { name: 'paint_slot_1', color: '#3366ff' },
  ]);
});

test('applyMeshMaterialPaintEdit preserves the base texture while painting UV meshes via material groups', () => {
  const geometry = makeMeshGeometry({
    authoredMaterials: [{ name: 'base', texture: 'textures/base.png', color: '#ffffff' }],
  });

  const result = applyMeshMaterialPaintEdit({
    geometry,
    meshKey: '0',
    triangleCount: 2,
    selectedFaceIndices: [0],
    paintColor: '#3366ff',
    baseMaterial: { name: 'base', texture: 'textures/base.png', color: '#ffffff' },
  });

  assert.deepEqual(result.authoredMaterials, [
    { name: 'base', texture: 'textures/base.png', color: '#ffffff' },
    { name: 'paint_slot_1', color: '#3366ff' },
  ]);
  assert.deepEqual(result.meshMaterialGroups, [
    { meshKey: '0', start: 0, count: 3, materialIndex: 1 },
    { meshKey: '0', start: 3, count: 3, materialIndex: 0 },
  ]);
  assert.equal(result.changed, true);
});
