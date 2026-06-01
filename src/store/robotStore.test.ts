import test from 'node:test';
import assert from 'node:assert/strict';

import { useRobotStore } from './robotStore.ts';
import { DEFAULT_VISUAL_COLOR, GeometryType, JointType } from '@/types';
import { updateCollisionGeometryByObjectIndex } from '@/core/robot';

function resetRobotStore() {
  const state = useRobotStore.getState();
  state.resetRobot({
    name: 'robot_a',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: 'none' as any,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: 'none' as any,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        inertial: {
          mass: 0,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
        },
      },
    },
    joints: {},
    rootLinkId: 'base_link',
  });
  state.clearHistory();
}

function createRobotData(name: string) {
  return {
    name,
    links: {
      base_link: {
        ...useRobotStore.getState().links.base_link,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
    rootLinkId: 'base_link',
  };
}

test('setRobot can replace USD load state without appending undo history', () => {
  resetRobotStore();

  const state = useRobotStore.getState();
  state.setName('edited_robot');
  assert.equal(useRobotStore.getState()._history.past.length, 1);

  state.setRobot(createRobotData('usd_runtime_robot'), {
    skipHistory: true,
  });

  assert.equal(useRobotStore.getState().name, 'usd_runtime_robot');
  assert.equal(useRobotStore.getState()._history.past.length, 1);
});

test('addChild offsets the default child link body away from the parent joint', () => {
  resetRobotStore();

  const { linkId, jointId } = useRobotStore.getState().addChild('base_link');
  const nextState = useRobotStore.getState();
  const newLink = nextState.links[linkId];
  const newJoint = nextState.joints[jointId];

  assert.equal(newJoint.origin.xyz.z, 0.5);
  assert.equal(newLink.visual.origin.xyz.z, 0.25);
  assert.equal(newLink.collision.origin.xyz.z, 0.25);
  assert.ok(newLink.inertial?.origin);
  assert.equal(newLink.inertial.origin.xyz.z, 0.25);
});

test('resetRobot creates a base_link whose frame sits at the bottom of the default body', () => {
  useRobotStore.getState().resetRobot();

  const state = useRobotStore.getState();
  const rootLink = state.links[state.rootLinkId];

  assert.equal(rootLink.visual.origin.xyz.z, 0.25);
  assert.equal(rootLink.collision.origin.xyz.z, 0.25);
  assert.ok(rootLink.inertial?.origin);
  assert.equal(rootLink.inertial.origin.xyz.z, 0.25);
});

test('setRobot can reset undo history for a fresh USD file load', () => {
  resetRobotStore();

  const state = useRobotStore.getState();
  state.setName('edited_robot');
  assert.equal(useRobotStore.getState()._history.past.length, 1);

  state.setRobot(createRobotData('fresh_usd_robot'), {
    resetHistory: true,
    label: 'Load USD stage',
  });

  const nextState = useRobotStore.getState();
  assert.equal(nextState.name, 'fresh_usd_robot');
  assert.deepEqual(nextState._history, { past: [], future: [] });
  assert.equal(nextState._activity.at(-1)?.label, 'Load USD stage');
});

test('setJointAngle skips store notifications when solved joint motion is unchanged', () => {
  resetRobotStore();

  const baseLink = useRobotStore.getState().links.base_link;
  assert.ok(baseLink);
  useRobotStore.getState().setRobot(
    {
      name: 'joint_angle_robot',
      links: {
        base_link: baseLink,
        child_link: {
          ...baseLink,
          id: 'child_link',
          name: 'child_link',
        },
      },
      joints: {
        hinge: {
          id: 'hinge',
          name: 'hinge',
          type: JointType.REVOLUTE,
          parentLinkId: 'base_link',
          childLinkId: 'child_link',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          axis: { x: 0, y: 0, z: 1 },
          limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
          dynamics: { damping: 0, friction: 0 },
          hardware: {
            armature: 0,
            motorType: '',
            motorId: '',
            motorDirection: 1,
          },
          angle: 0.25,
        },
      },
      rootLinkId: 'base_link',
    },
    { skipHistory: true },
  );

  let notifications = 0;
  const unsubscribe = useRobotStore.subscribe(() => {
    notifications += 1;
  });

  useRobotStore.getState().setJointAngle('hinge', 0.25);
  unsubscribe();

  assert.equal(notifications, 0);
  assert.equal(useRobotStore.getState().joints.hinge?.angle, 0.25);
});

test('setRobot syncs link visual colors from tracked materials during load', () => {
  resetRobotStore();

  const state = useRobotStore.getState();
  state.setRobot(
    {
      name: 'material_sync_robot',
      links: {
        base_link: {
          ...state.links.base_link,
          id: 'base_link',
          name: 'base_link',
          visual: {
            ...state.links.base_link.visual,
            type: GeometryType.BOX,
            color: '#808080',
            dimensions: { x: 0.2, y: 0.3, z: 0.4 },
          },
        },
      },
      joints: {},
      rootLinkId: 'base_link',
      materials: {
        base_link: { color: '#12ab34' },
      },
    },
    {
      skipHistory: true,
    },
  );

  const nextState = useRobotStore.getState();
  assert.equal(nextState.links.base_link.visual.color, '#12ab34');
  assert.equal(nextState.materials?.base_link?.color, '#12ab34');
});

test('setRobot preserves inspection context for AI inspection and follow-up chat', () => {
  resetRobotStore();

  const state = useRobotStore.getState();
  state.setRobot(
    {
      name: 'inspection_context_robot',
      links: {
        base_link: {
          ...state.links.base_link,
        },
      },
      joints: {},
      rootLinkId: 'base_link',
      inspectionContext: {
        sourceFormat: 'mjcf',
        mjcf: {
          siteCount: 3,
          tendonCount: 1,
          tendonActuatorCount: 1,
          bodiesWithSites: [
            {
              bodyId: 'torso',
              siteCount: 2,
              siteNames: ['imu', 'camera'],
            },
          ],
          tendons: [
            {
              name: 'hip_tendon',
              type: 'fixed',
              attachmentRefs: ['torso', 'leg'],
              attachments: [],
              actuatorNames: ['hip_motor'],
            },
          ],
        },
      },
    },
    {
      skipHistory: true,
    },
  );

  const nextState = useRobotStore.getState();
  assert.equal(nextState.inspectionContext?.sourceFormat, 'mjcf');
  assert.equal(nextState.inspectionContext?.mjcf?.siteCount, 3);
  assert.equal(nextState.inspectionContext?.mjcf?.tendons[0]?.name, 'hip_tendon');
});

test('updateMjcfTendon updates editable tendon visualization fields', () => {
  resetRobotStore();

  useRobotStore.getState().setRobot(
    {
      name: 'tendon_robot',
      links: {
        base_link: {
          ...useRobotStore.getState().links.base_link,
        },
      },
      joints: {},
      rootLinkId: 'base_link',
      inspectionContext: {
        sourceFormat: 'mjcf',
        mjcf: {
          siteCount: 2,
          tendonCount: 1,
          tendonActuatorCount: 0,
          bodiesWithSites: [],
          tendons: [
            {
              name: 'finger_tendon',
              type: 'spatial',
              width: 0.003,
              rgba: [1, 0, 0, 1],
              attachmentRefs: ['site_a', 'site_b'],
              attachments: [
                { type: 'site', ref: 'site_a' },
                { type: 'site', ref: 'site_b' },
              ],
              actuatorNames: [],
            },
          ],
        },
      },
    },
    { skipHistory: true },
  );

  useRobotStore.getState().updateMjcfTendon(
    'finger_tendon',
    {
      width: 0.012,
      rgba: [0.1, 0.2, 0.3, 0.4],
    },
    { skipHistory: true },
  );

  const tendon = useRobotStore.getState().inspectionContext?.mjcf?.tendons[0];
  assert.equal(tendon?.width, 0.012);
  assert.deepEqual(tendon?.rgba, [0.1, 0.2, 0.3, 0.4]);
});

test('updateLink keeps robot materials in sync with visual color edits', () => {
  resetRobotStore();

  const state = useRobotStore.getState();
  state.updateLink('base_link', {
    visual: {
      ...state.links.base_link.visual,
      type: GeometryType.BOX,
      color: '#12ab34',
    },
  });

  const nextState = useRobotStore.getState();
  assert.equal(nextState.links.base_link.visual.color, '#12ab34');
  assert.equal(nextState.materials?.base_link?.color, '#12ab34');
});

test('updateLink keeps robot materials in sync with primary visual texture edits', () => {
  resetRobotStore();

  const state = useRobotStore.getState();
  state.materials = {
    ...(state.materials || {}),
    base_link: {
      color: '#0e0e10',
      texture: 'textures/legacy.png',
      usdMaterial: {
        mapPath: 'textures/legacy.png',
        roughness: 0.6,
      },
    },
  };

  state.updateLink('base_link', {
    visual: {
      ...state.links.base_link.visual,
      type: GeometryType.MESH,
      meshPath: 'meshes/base_link.stl',
      color: '#0e0e10',
      authoredMaterials: [{ texture: 'textures/updated.png' }],
    },
  });

  const nextState = useRobotStore.getState();
  assert.equal(nextState.materials?.base_link?.color, '#0e0e10');
  assert.equal(nextState.materials?.base_link?.texture, 'textures/updated.png');
  assert.equal(nextState.materials?.base_link?.usdMaterial, undefined);
});

test('updateLink persists collision body transform edits in robot state', () => {
  resetRobotStore();

  const state = useRobotStore.getState();
  const linkWithCollisionBodies = {
    ...state.links.base_link,
    collision: {
      ...state.links.base_link.collision,
      type: GeometryType.BOX,
      dimensions: { x: 0.2, y: 0.2, z: 0.2 },
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
    collisionBodies: [
      {
        ...state.links.base_link.collision,
        type: GeometryType.BOX,
        dimensions: { x: 0.1, y: 0.1, z: 0.1 },
        origin: {
          xyz: { x: 0.1, y: 0.2, z: 0.3 },
          rpy: { r: 0.1, p: 0.2, y: 0.3 },
        },
      },
    ],
  };

  state.updateLink('base_link', linkWithCollisionBodies);

  const movedCollisionLink = updateCollisionGeometryByObjectIndex(
    useRobotStore.getState().links.base_link,
    1,
    {
      origin: {
        xyz: { x: 0.4, y: 0.5, z: 0.6 },
        rpy: { r: 0.4, p: 0.5, y: 0.6 },
      },
    },
  );

  useRobotStore.getState().updateLink('base_link', movedCollisionLink);

  const nextState = useRobotStore.getState();
  assert.deepEqual(nextState.links.base_link.collisionBodies?.[0]?.origin?.xyz, {
    x: 0.4,
    y: 0.5,
    z: 0.6,
  });
  assert.deepEqual(nextState.links.base_link.collisionBodies?.[0]?.origin?.rpy, {
    r: 0.4,
    p: 0.5,
    y: 0.6,
  });
});

test('empty skeleton root link and newly added child links share the same default visual color', () => {
  useRobotStore.getState().resetRobot();

  const initialState = useRobotStore.getState();
  assert.equal(initialState.links[initialState.rootLinkId]?.visual.color, DEFAULT_VISUAL_COLOR);

  const { linkId } = initialState.addChild(initialState.rootLinkId);
  const nextState = useRobotStore.getState();

  assert.equal(nextState.links[linkId]?.visual.color, DEFAULT_VISUAL_COLOR);
});
