import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { URDFVisual } from '@/core/parsers/urdf/loader';
import {
  buildColladaRootNormalizationHints,
  createLoadingManager,
  createMeshLoader,
} from '@/core/loaders';
import { parseURDF } from '@/core/parsers/urdf/parser';
import { GeometryType, type UrdfLink, type UrdfVisual as LinkGeometry } from '@/types';

import { applyGeometryPatchInPlace } from './robotLoaderGeometryPatch';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

function getWorldBox(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object);
}

function expectBoxEquals(actual: THREE.Box3, expected: THREE.Box3, epsilon = 1e-6) {
  const actualMin = actual.min.toArray();
  const expectedMin = expected.min.toArray();
  const actualMax = actual.max.toArray();
  const expectedMax = expected.max.toArray();

  actualMin.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedMin[index]) < epsilon);
  });
  actualMax.forEach((value, index) => {
    assert.ok(Math.abs(value - expectedMax[index]) < epsilon);
  });
}

const makeGeometry = (overrides: Partial<LinkGeometry> = {}): LinkGeometry => ({
  type: GeometryType.BOX,
  dimensions: { x: 0.1, y: 0.2, z: 0.3 },
  color: '#808080',
  origin: {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  },
  visible: true,
  meshPath: undefined,
  ...overrides,
});

const makeLink = (overrides: Partial<UrdfLink> = {}): UrdfLink => ({
  id: 'rr_thigh_link',
  name: 'RR_thigh',
  visual: makeGeometry(),
  collision: makeGeometry({ type: GeometryType.NONE, meshPath: undefined }),
  collisionBodies: [],
  visible: true,
  ...overrides,
});

async function waitForPatchedChild(group: THREE.Object3D): Promise<THREE.Object3D> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const child = group.children[0];
    if (child) {
      return child;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error('Timed out waiting for patched mesh object.');
}

test(
  'applyGeometryPatchInPlace preserves b2w base_link Collada scene roots before reattaching',
  { skip: typeof Worker === 'undefined' },
  async () => {
    const meshPath = 'test/unitree_ros/robots/b2w_description/meshes/base_link.dae';
    const urdfContent = fs.readFileSync(
      'test/unitree_ros/robots/b2w_description/urdf/b2w_description.urdf',
      'utf8',
    );
    const colladaRootNormalizationHints = buildColladaRootNormalizationHints(
      parseURDF(urdfContent).links,
    );
    const meshDataUrl = `data:text/xml;base64,${Buffer.from(fs.readFileSync(meshPath, 'utf8')).toString('base64')}`;
    const manager = createLoadingManager({
      [meshPath]: meshDataUrl,
      'package://b2w_description/meshes/base_link.dae': meshDataUrl,
      base_link: meshDataUrl,
      'base_link.dae': meshDataUrl,
    });
    const meshLoader = createMeshLoader(
      {
        [meshPath]: meshDataUrl,
        'package://b2w_description/meshes/base_link.dae': meshDataUrl,
        base_link: meshDataUrl,
        'base_link.dae': meshDataUrl,
      },
      manager,
      '',
      { colladaRootNormalizationHints },
    );
    const referenceObject = await new Promise<THREE.Object3D>((resolve, reject) => {
      meshLoader('package://b2w_description/meshes/base_link.dae', manager, (result, err) => {
        if (err) {
          reject(err);
          return;
        }

        resolve(result);
      });
    });
    const referenceBox = getWorldBox(referenceObject);

    const robotModel = new THREE.Group() as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
    };
    const linkObject = new THREE.Group();
    linkObject.name = 'base_link';
    (linkObject as any).isURDFLink = true;
    const visualGroup = new URDFVisual();
    linkObject.add(visualGroup);
    robotModel.add(linkObject);
    robotModel.links = { base_link: linkObject };

    const previousLinkData = makeLink({
      id: 'base_link',
      name: 'base_link',
      visual: makeGeometry({
        type: GeometryType.BOX,
        meshPath: undefined,
      }),
    });
    const linkData = makeLink({
      id: 'base_link',
      name: 'base_link',
      visual: makeGeometry({
        type: GeometryType.MESH,
        meshPath: 'package://b2w_description/meshes/base_link.dae',
        dimensions: { x: 1, y: 1, z: 1 },
      }),
    });

    const applied = applyGeometryPatchInPlace({
      robotModel,
      patch: {
        linkName: 'base_link',
        previousLinkData,
        linkData,
        visualChanged: true,
        collisionChanged: false,
        collisionBodiesChanged: false,
        inertialChanged: false,
        visibilityChanged: false,
      },
      assets: {
        [meshPath]: meshDataUrl,
        base_link: meshDataUrl,
        'base_link.dae': meshDataUrl,
      },
      colladaRootNormalizationHints,
      showVisual: true,
      showCollision: false,
      linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
      invalidate: () => {},
    });

    assert.equal(applied, true);

    const patchedObject = await waitForPatchedChild(visualGroup);

    assert.ok(Math.abs(patchedObject.rotation.x - referenceObject.rotation.x) < 1e-6);
    assert.ok(Math.abs(patchedObject.rotation.y - referenceObject.rotation.y) < 1e-6);
    assert.ok(Math.abs(patchedObject.rotation.z - referenceObject.rotation.z) < 1e-6);
    assert.ok(Math.abs(patchedObject.quaternion.x - referenceObject.quaternion.x) < 1e-6);
    assert.ok(Math.abs(patchedObject.quaternion.y - referenceObject.quaternion.y) < 1e-6);
    assert.ok(Math.abs(patchedObject.quaternion.z - referenceObject.quaternion.z) < 1e-6);
    assert.ok(Math.abs(patchedObject.quaternion.w - referenceObject.quaternion.w) < 1e-6);
    expectBoxEquals(getWorldBox(patchedObject), referenceBox);
  },
);

test('applyGeometryPatchInPlace updates visual material colors in place for link color edits', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';
  (linkObject as any).isURDFLink = true;

  const visualGroup = new URDFVisual();
  const authoredMaterial = new THREE.MeshPhongMaterial({
    color: new THREE.Color('#808080'),
    name: 'authored_base_link',
  });
  const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), authoredMaterial);
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      color: '#808080',
    }),
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      color: '#12ab34',
    }),
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: true,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.notEqual(visualMesh.material, authoredMaterial);
  assert.equal(visualMesh.material instanceof THREE.MeshStandardMaterial, true);
  assert.equal(
    (visualMesh.material as unknown as THREE.MeshStandardMaterial).color.getHexString(),
    '12ab34',
  );
  assert.equal(
    (visualMesh.material as unknown as THREE.MeshStandardMaterial).userData.urdfColorApplied,
    true,
  );
});

test('applyGeometryPatchInPlace rebuilds visual meshes when authored material textures change', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';
  (linkObject as any).isURDFLink = true;

  const visualGroup = new URDFVisual();
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshPhongMaterial({ color: new THREE.Color('#808080') }),
  );
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      color: '#808080',
    }),
  });
  const linkData = makeLink({
    id: 'base_link',
    name: 'base_link',
    visual: makeGeometry({
      color: '#808080',
      authoredMaterials: [{ texture: 'textures/coat.png' }],
    }),
  });

  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: true,
      collisionChanged: false,
      collisionBodiesChanged: false,
      inertialChanged: false,
      visibilityChanged: false,
    },
    assets: {},
    showVisual: true,
    showCollision: false,
    linkMeshMapRef: { current: new Map<string, THREE.Mesh[]>() },
    invalidate: () => {},
  });

  assert.equal(applied, true);
  assert.equal(visualGroup.children.length, 1);
  assert.notEqual(visualGroup.children[0], visualMesh);
});
