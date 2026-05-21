import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { createUsdBaseMaterial } from './usdMaterialNormalization.ts';
import { collectUsdSerializationContext } from './usdSerializationContext.ts';
import { applyUsdMaterialMetadata, buildUsdBaseLayerContent } from './usdSceneSerialization.ts';

const createTexturedTriangleGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  return geometry;
};

const createInterleavedTexturedTriangleGeometry = () => {
  const geometry = new THREE.BufferGeometry();
  const interleaved = new THREE.InterleavedBuffer(
    new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    5,
  );
  geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(interleaved, 3, 0));
  geometry.setAttribute('uv', new THREE.InterleavedBufferAttribute(interleaved, 2, 3));
  return geometry;
};

test('buildUsdBaseLayerContent serializes scene nodes alongside shared mesh and material libraries', async () => {
  const root = new THREE.Group();
  root.name = 'demo_robot';

  const primitive = new THREE.Object3D();
  primitive.name = 'box';
  primitive.userData.usdGeomType = 'Cube';
  primitive.userData.usdDisplayColor = '#12ab34';
  applyUsdMaterialMetadata(primitive, { color: '#12ab34' });

  const mesh = new THREE.Mesh(createTexturedTriangleGeometry(), createUsdBaseMaterial('#ffffff'));
  mesh.name = 'mesh';
  mesh.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(mesh, { texture: 'textures/checker.png' });

  const guide = new THREE.Group();
  guide.name = 'guide';
  guide.userData.usdPurpose = 'guide';

  root.add(primitive, mesh, guide);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'demo_robot',
  });
  const content = await buildUsdBaseLayerContent(root, context);

  assert.match(content, /defaultPrim = "demo_robot"/);
  assert.match(content, /def Xform "demo_robot"/);
  assert.match(content, /class Scope "__MeshLibrary"/);
  assert.match(content, /class Mesh "Geometry_0"/);
  assert.match(content, /def Scope "Looks"/);
  assert.match(content, /def Scope "joints"/);
  assert.match(content, /prepend references = <\/demo_robot\/__MeshLibrary\/Geometry_0>/);
  assert.match(content, /rel material:binding = <\/demo_robot\/Looks\/Material_0>/);
  assert.match(content, /asset inputs:file = @\.\.\/assets\/checker\.png@/);
  assert.match(content, /custom string urdf:materialColor = "#12ab34"/);
  assert.match(content, /uniform token purpose = "guide"/);
});

test('buildUsdBaseLayerContent serializes interleaved mesh attributes without changing output shape', async () => {
  const root = new THREE.Group();
  root.name = 'demo_robot';

  const mesh = new THREE.Mesh(
    createInterleavedTexturedTriangleGeometry(),
    createUsdBaseMaterial('#ffffff'),
  );
  mesh.name = 'interleaved_mesh';
  mesh.userData.usdDisplayColor = '#ffffff';
  applyUsdMaterialMetadata(mesh, { texture: 'textures/checker.png' });

  root.add(mesh);

  const context = await collectUsdSerializationContext(root, {
    rootPrimName: 'demo_robot',
  });
  const content = await buildUsdBaseLayerContent(root, context);

  assert.match(content, /point3f\[] points = \[\n\s+\(0, 0, 0\), \(1, 0, 0\), \(0, 1, 0\)\n\s+\]/);
  assert.match(content, /texCoord2f\[] primvars:st = \[\n\s+\(0, 0\), \(1, 0\), \(0, 1\)\n\s+\]/);
  assert.match(content, /uniform token primvars:st:interpolation = "faceVarying"/);
});
