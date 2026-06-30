import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { LinkAxesController } from './link-axes.js';

function createMockRenderInterface(matrix) {
  return {
    meshes: {
      '/Robot/base_link/visuals.proto_mesh_id0': {
        _mesh: {
          matrix,
        },
      },
    },
    getWorldTransformForPrimPath(path) {
      return path === '/Robot/base_link' ? matrix.clone() : null;
    },
  };
}

function approxEqual(left, right, epsilon = 1e-9) {
  return Math.abs(left - right) <= epsilon;
}

test('LinkAxesController reuses shared origin axes visuals for USD overlays', () => {
  const usdRoot = new THREE.Group();
  const controller = new LinkAxesController();
  const linkWorldMatrix = new THREE.Matrix4().makeTranslation(1.25, -0.5, 2.75);

  controller.rebuild(usdRoot, createMockRenderInterface(linkWorldMatrix), {
    showLinkAxes: true,
    axisSize: 0.5,
    overlay: true,
  });

  const axesGroup = usdRoot.getObjectByName('Link Axes');
  assert.ok(axesGroup instanceof THREE.Group);
  assert.equal(axesGroup.children.length, 1);

  const originAxes = axesGroup.children[0];
  assert.equal(originAxes.name, 'origin:/Robot/base_link');
  assert.equal(originAxes.children.length, 3);
  assert.equal(originAxes.matrix.elements[12], 1.25);
  assert.equal(originAxes.matrix.elements[13], -0.5);
  assert.equal(originAxes.matrix.elements[14], 2.75);

  const childPositions = originAxes.children.map((child) => child.position.clone());
  assert.ok(childPositions.some((position) => (
    approxEqual(position.x, 0.25) && approxEqual(position.y, 0) && approxEqual(position.z, 0)
  )));
  assert.ok(childPositions.some((position) => (
    approxEqual(position.x, 0) && approxEqual(position.y, 0.25) && approxEqual(position.z, 0)
  )));
  assert.ok(childPositions.some((position) => (
    approxEqual(position.x, 0) && approxEqual(position.y, 0) && approxEqual(position.z, 0.25)
  )));

  originAxes.traverse((child) => {
    if (!child.isMesh) return;
    const material = child.material;
    const materials = Array.isArray(material) ? material : [material];
    materials.forEach((entry) => {
      assert.equal(entry.depthTest, false);
      assert.equal(entry.depthWrite, false);
      assert.equal(entry.transparent, true);
    });
    assert.equal(child.renderOrder, 10001);
  });
});

test('LinkAxesController prefers the current posed link frame when provided', () => {
  const usdRoot = new THREE.Group();
  const controller = new LinkAxesController();
  const stageMatrix = new THREE.Matrix4().makeTranslation(1, 2, 3);
  const posedMatrix = new THREE.Matrix4().makeTranslation(4, 5, 6);

  controller.rebuild(usdRoot, {
    ...createMockRenderInterface(stageMatrix),
    getPreferredLinkWorldTransform() {
      return stageMatrix.clone();
    },
  }, {
    showLinkAxes: true,
    axisSize: 0.2,
    linkFrameResolver() {
      return posedMatrix.clone();
    },
    overlay: false,
  });

  const axesGroup = usdRoot.getObjectByName('Link Axes');
  assert.ok(axesGroup instanceof THREE.Group);
  assert.equal(axesGroup.children.length, 1);

  const originAxes = axesGroup.children[0];
  assert.equal(originAxes.matrix.elements[12], 4);
  assert.equal(originAxes.matrix.elements[13], 5);
  assert.equal(originAxes.matrix.elements[14], 6);
});
