import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  collisionBaseMaterial,
  configureCollisionOverlayMaterial,
  createCollisionOverlayMaterial,
  createHighlightOverrideMaterial,
  enhanceMaterials,
  enhanceSingleMaterial,
} from './materials';
import {
  cloneMaterialWithCoplanarOffset,
  isCoplanarOffsetMaterial,
} from '@/core/loaders/coplanarMaterialOffset';

test('enhanceSingleMaterial preserves OBJ vertex colors for baked export meshes', () => {
  const sourceMaterial = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    vertexColors: true,
  });

  const enhancedMaterial = enhanceSingleMaterial(sourceMaterial) as THREE.MeshStandardMaterial;

  assert.equal(enhancedMaterial instanceof THREE.MeshStandardMaterial, true);
  assert.equal(enhancedMaterial.vertexColors, true);
  assert.equal(enhancedMaterial.toneMapped, false);
  assert.equal(enhancedMaterial.color.getHexString(), 'f7f7f7');
});

test('enhanceSingleMaterial keeps textured materials in exact-color mode', () => {
  const texture = new THREE.Texture();
  const sourceMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: texture,
  });

  const enhancedMaterial = enhanceSingleMaterial(sourceMaterial) as THREE.MeshStandardMaterial;

  assert.equal(enhancedMaterial instanceof THREE.MeshStandardMaterial, true);
  assert.equal(enhancedMaterial.map, texture);
  assert.equal(enhancedMaterial.toneMapped, true);
});

test('createHighlightOverrideMaterial gives MJCF tendon visuals a high-contrast hover overlay', () => {
  const sourceMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#ff0000'),
    opacity: 1,
    transparent: false,
  });
  sourceMaterial.userData.isMjcfTendonMaterial = true;
  sourceMaterial.emissive = new THREE.Color('#220000');
  sourceMaterial.emissiveIntensity = 0.05;

  const highlightedMaterial = createHighlightOverrideMaterial(
    sourceMaterial,
    'visual',
  ) as THREE.MeshStandardMaterial;

  assert.equal(highlightedMaterial.transparent, true);
  assert.equal(highlightedMaterial.depthTest, false);
  assert.equal(highlightedMaterial.depthWrite, false);
  assert.equal(highlightedMaterial.opacity, 1);
  assert.ok(highlightedMaterial.color.r >= sourceMaterial.color.r);
  assert.ok(highlightedMaterial.color.g > sourceMaterial.color.g);
  assert.ok(highlightedMaterial.color.b > sourceMaterial.color.b);
  assert.ok(highlightedMaterial.emissiveIntensity >= 0.9);
  assert.equal(highlightedMaterial.userData.isHighlightOverrideMaterial, true);
});

test('enhanceSingleMaterial preserves layered collada depth state for coplanar overlays', () => {
  const sourceMaterial = cloneMaterialWithCoplanarOffset(
    new THREE.MeshPhongMaterial({ color: 0x111111 }),
    2,
  );
  sourceMaterial.depthTest = false;
  sourceMaterial.depthWrite = false;
  sourceMaterial.alphaTest = 0.25;
  sourceMaterial.userData.customFlag = 'preserved';

  const enhancedMaterial = enhanceSingleMaterial(sourceMaterial) as THREE.MeshStandardMaterial;

  assert.equal(enhancedMaterial instanceof THREE.MeshStandardMaterial, true);
  assert.equal(isCoplanarOffsetMaterial(enhancedMaterial), true);
  assert.equal(enhancedMaterial.userData.customFlag, 'preserved');
  assert.equal(enhancedMaterial.polygonOffset, true);
  assert.equal(enhancedMaterial.polygonOffsetFactor, sourceMaterial.polygonOffsetFactor);
  assert.equal(enhancedMaterial.polygonOffsetUnits, sourceMaterial.polygonOffsetUnits);
  assert.equal(enhancedMaterial.depthTest, false);
  assert.equal(enhancedMaterial.depthWrite, false);
  assert.equal(enhancedMaterial.alphaTest, 0.25);
});

test('enhanceMaterials keeps G1-class visual meshes in the shared shadow pass', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
  );

  const triangleCount = 51410;
  const index = new Uint32Array(triangleCount * 3);
  for (let i = 0; i < index.length; i += 3) {
    index[i] = 0;
    index[i + 1] = 1;
    index[i + 2] = 2;
  }
  geometry.setIndex(new THREE.BufferAttribute(index, 1));

  const mesh = new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color: 0xa0a0a0 }));

  mesh.castShadow = false;
  mesh.receiveShadow = false;

  enhanceMaterials(mesh);

  assert.equal(mesh.material instanceof THREE.MeshStandardMaterial, true);
  assert.equal(mesh.castShadow, true);
  assert.equal(mesh.receiveShadow, true);
});

test('configureCollisionOverlayMaterial normalizes overlay depth and polygon settings', () => {
  const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });

  const configuredMaterial = configureCollisionOverlayMaterial(material);

  assert.equal(configuredMaterial, material);
  assert.equal(configuredMaterial.transparent, true);
  assert.equal(configuredMaterial.depthWrite, false);
  assert.equal(configuredMaterial.depthTest, false);
  assert.equal(configuredMaterial.polygonOffset, true);
  assert.equal(configuredMaterial.polygonOffsetFactor, -1);
  assert.equal(configuredMaterial.polygonOffsetUnits, -4);
  assert.equal(configuredMaterial.userData.isCollisionMaterial, true);
});

test('createCollisionOverlayMaterial and the shared collision material stay in sync', () => {
  const createdMaterial = createCollisionOverlayMaterial('collision_test');

  assert.equal(createdMaterial instanceof THREE.MeshStandardMaterial, true);
  assert.equal(createdMaterial.name, 'collision_test');
  assert.equal(createdMaterial.depthWrite, false);
  assert.equal(createdMaterial.depthTest, false);
  assert.equal(createdMaterial.polygonOffset, true);
  assert.equal(createdMaterial.polygonOffsetFactor, -1);
  assert.equal(createdMaterial.polygonOffsetUnits, -4);
  assert.equal(createdMaterial.opacity, 0.35);
  assert.equal(createdMaterial.transparent, true);
  assert.equal(createdMaterial.userData.isCollisionMaterial, true);

  assert.equal(collisionBaseMaterial.depthWrite, false);
  assert.equal(collisionBaseMaterial.depthTest, false);
  assert.equal(collisionBaseMaterial.polygonOffset, true);
  assert.equal(collisionBaseMaterial.userData.isCollisionMaterial, true);
  assert.equal(collisionBaseMaterial.userData.isSharedMaterial, true);
});
