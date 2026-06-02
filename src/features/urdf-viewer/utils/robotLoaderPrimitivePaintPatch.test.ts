import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { JSDOM } from 'jsdom';

import { URDFVisual } from '@/core/parsers/urdf/loader';
import {
  DEFAULT_LINK,
  GeometryType,
  type UrdfLink,
  type UrdfVisual as LinkGeometry,
} from '@/types';

import { applyGeometryPatchInPlace } from './robotLoaderGeometryPatch';

const dom = new JSDOM('<!doctype html><html><body></body></html>');
globalThis.DOMParser = dom.window.DOMParser as typeof DOMParser;
globalThis.XMLSerializer = dom.window.XMLSerializer as typeof XMLSerializer;
globalThis.ProgressEvent = dom.window.ProgressEvent as typeof ProgressEvent;

const makeGeometry = (overrides: Partial<LinkGeometry> = {}): LinkGeometry => ({
  type: GeometryType.BOX,
  dimensions: { x: 1, y: 1, z: 1 },
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
  ...DEFAULT_LINK,
  id: 'base_link',
  name: 'base_link',
  visual: makeGeometry(),
  collision: makeGeometry({ type: GeometryType.NONE, meshPath: undefined }),
  visualBodies: [],
  collisionBodies: [],
  visible: true,
  ...overrides,
});

test('applyGeometryPatchInPlace applies paint material groups to primitive box visuals in place', () => {
  const robotModel = new THREE.Group() as THREE.Group & {
    links?: Record<string, THREE.Object3D>;
  };
  const linkObject = new THREE.Group();
  linkObject.name = 'base_link';
  (linkObject as any).isURDFLink = true;

  const visualGroup = new URDFVisual();
  const visualMesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: new THREE.Color('#808080') }),
  );
  visualGroup.add(visualMesh);
  linkObject.add(visualGroup);
  robotModel.add(linkObject);
  robotModel.links = { base_link: linkObject };

  const previousLinkData = makeLink({
    visual: makeGeometry({
      authoredMaterials: [{ name: 'base_gray', color: '#808080' }],
      meshMaterialGroups: [],
      color: undefined,
    }),
  });

  const linkData = makeLink({
    visual: makeGeometry({
      authoredMaterials: [
        { name: 'base_gray', color: '#808080' },
        { name: 'paint_base_link_0_1', color: '#007aff' },
      ],
      meshMaterialGroups: [
        { meshKey: '0', start: 0, count: 6, materialIndex: 1 },
        { meshKey: '0', start: 6, count: 30, materialIndex: 0 },
      ],
      color: undefined,
    }),
  });

  const originalChild = visualGroup.children[0];
  const applied = applyGeometryPatchInPlace({
    robotModel,
    patch: {
      linkName: 'base_link',
      previousLinkData,
      linkData,
      visualChanged: true,
      visualBodiesChanged: false,
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
  assert.equal(visualGroup.children[0], originalChild);
  assert.ok(Array.isArray(visualMesh.material), 'expected primitive visual to gain material slots');
  if (!Array.isArray(visualMesh.material)) {
    assert.fail('expected primitive visual to gain material slots');
  }
  assert.deepEqual(
    visualMesh.material.map((material) => `#${material.color.getHexString()}`),
    ['#808080', '#007aff'],
  );
  assert.deepEqual(
    visualMesh.geometry.groups.map(({ start, count, materialIndex }) => ({
      start,
      count,
      materialIndex,
    })),
    [
      { start: 0, count: 6, materialIndex: 1 },
      { start: 6, count: 30, materialIndex: 0 },
    ],
  );
});
