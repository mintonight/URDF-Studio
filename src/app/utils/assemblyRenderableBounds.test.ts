import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType, type RobotData } from '@/types';

import { computeRobotRenderableBoundsFromAssets } from './assemblyRenderableBounds.ts';

function createMeshFallbackRobot(): RobotData {
  return {
    name: 'mesh_fallback_demo',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          origin: {
            xyz: { x: 0, y: 0, z: 0.05 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
        },
      },
      foot_link: {
        ...DEFAULT_LINK,
        id: 'foot_link',
        name: 'foot_link',
        visible: true,
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
          dimensions: { x: 1, y: 1, z: 1 },
          meshPath: 'robots/demo/missing-foot.stl',
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          origin: {
            xyz: { x: 0, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    joints: {
      foot_joint: {
        ...DEFAULT_JOINT,
        id: 'foot_joint',
        name: 'foot_joint',
        type: JointType.FIXED,
        parentLinkId: 'base_link',
        childLinkId: 'foot_link',
        origin: {
          xyz: { x: 0, y: 0, z: -0.8 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
  };
}

test('computeRobotRenderableBoundsFromAssets fails fast when a mesh visual cannot resolve', async () => {
  await assert.rejects(
    computeRobotRenderableBoundsFromAssets(createMeshFallbackRobot(), {
      'robots/demo/placeholder.txt': 'data:text/plain,noop',
    }),
    /Mesh asset could not be resolved/i,
  );
});
