import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { GeometryType, JointType, type RobotState } from '@/types';

import { createUsdAssetRegistry } from './usdAssetRegistry.ts';
import { buildUsdLinkSceneRoot } from './usdLinkSceneBuilder.ts';

if (typeof globalThis.ProgressEvent === 'undefined') {
  class ProgressEventPolyfill extends Event {
    loaded: number;
    total: number;
    lengthComputable: boolean;

    constructor(
      type: string,
      init: { loaded?: number; total?: number; lengthComputable?: boolean } = {},
    ) {
      super(type);
      this.loaded = init.loaded ?? 0;
      this.total = init.total ?? 0;
      this.lengthComputable = init.lengthComputable ?? false;
    }
  }

  globalThis.ProgressEvent = ProgressEventPolyfill as typeof ProgressEvent;
}

const createTwoLinkRobot = (): RobotState => {
  return {
    name: 'two_link_robot',
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
    joints: {
      joint_link1: {
        id: 'joint_link1',
        name: 'joint_link1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'link1',
        origin: { xyz: { x: 1, y: 2, z: 3 }, rpy: { r: 0, p: 0, y: Math.PI / 2 } },
        axis: { x: 0, y: 0, z: 1 },
        angle: 0,
        limit: { lower: -Math.PI / 2, upper: Math.PI / 3, effort: 12, velocity: 4 },
        dynamics: { damping: 0, friction: 0 },
        hardware: { armature: 0, motorType: 'None', motorId: '', motorDirection: 1 },
      },
    },
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.2, z: 0.1 },
          color: '#4f46e5',
          origin: { xyz: { x: 0.25, y: 0.5, z: 0.75 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [
          {
            type: GeometryType.SPHERE,
            dimensions: { x: 0.15, y: 0, z: 0 },
            color: '#f97316',
            origin: { xyz: { x: -0.25, y: 0, z: 0.1 }, rpy: { r: 0, p: 0, y: 0 } },
          },
        ],
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.5, y: 0.3, z: 0.2 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
      link1: {
        id: 'link1',
        name: 'link1',
        visible: true,
        visual: {
          type: GeometryType.CYLINDER,
          dimensions: { x: 0.08, y: 0.6, z: 0 },
          color: '#22c55e',
          origin: { xyz: { x: 0, y: 0, z: 0.3 }, rpy: { r: 0, p: Math.PI / 2, y: 0 } },
        },
        collision: {
          type: GeometryType.SPHERE,
          dimensions: { x: 0.12, y: 0, z: 0 },
          color: '#f59e0b',
          origin: { xyz: { x: 0, y: 0, z: 0.6 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    materials: {
      base_link: {
        color: '#12ab34',
        texture: 'textures/base_color.png',
      },
    },
  };
};

test('buildUsdLinkSceneRoot builds visual and collision scopes with joint-authored child transforms', async () => {
  const robot = createTwoLinkRobot();
  const visitedLinks: string[] = [];
  const { registry } = createUsdAssetRegistry({
    'textures/base_color.png':
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFAAH/e+m+7wAAAABJRU5ErkJggg==',
  });

  const root = await buildUsdLinkSceneRoot({
    robot,
    registry,
    onLinkVisit: async (link) => {
      visitedLinks.push(link.id);
    },
  });

  assert.equal(root.name, 'base_link');
  assert.deepEqual(visitedLinks, ['base_link', 'link1']);
  assert.deepEqual(root.userData.usdLink, { id: 'base_link', name: 'base_link' });

  const visuals = root.getObjectByName('visuals');
  assert.ok(visuals instanceof THREE.Group);
  const collisions = root.getObjectByName('collisions');
  assert.ok(collisions instanceof THREE.Group);

  const baseVisual = visuals.children[0];
  assert.equal(baseVisual.name, 'visual_0');
  assert.equal(baseVisual.userData.usdMaterial.color, '#12ab34');
  assert.equal(baseVisual.userData.usdMaterial.texture, 'textures/base_color.png');
  assert.equal(baseVisual.getObjectByName('box')?.userData.usdDisplayColor, '#12ab34');
  assert.equal(visuals.children[1]?.name, 'visual_1');
  assert.equal(visuals.children[1]?.userData.usdMaterial?.texture, undefined);
  assert.equal(visuals.children[1]?.getObjectByName('sphere')?.userData.usdDisplayColor, '#f97316');

  const childLink = root.getObjectByName('link1');
  assert.ok(childLink instanceof THREE.Group);
  assert.deepEqual(childLink.position.toArray(), [1, 2, 3]);
  assert.ok(
    childLink.quaternion.angleTo(
      new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2, 'ZYX')),
    ) < 1e-6,
  );

  const childCollisionMesh = childLink.getObjectByName('collision_0');
  assert.ok(childCollisionMesh instanceof THREE.Object3D);
  assert.equal(childCollisionMesh.userData.usdPurpose, 'guide');
});
