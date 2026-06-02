import test from 'node:test';
import assert from 'node:assert/strict';

import { GeometryType, type RobotData } from '@/types';
import { buildRobotSnapshotForAssemblySnapshot } from './robotStoreInternals';

const baseRobotState = (): RobotData =>
  ({
    name: 'paint_box_robot',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.NONE,
          dimensions: { x: 0, y: 0, z: 0 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
      },
    },
    joints: {},
    rootLinkId: 'base_link',
    components: {},
    bridges: {},
    assemblyState: null,
  }) as RobotData;

test('buildRobotSnapshotForAssemblySnapshot does not clone current assembly when target is null', () => {
  const state = baseRobotState() as RobotData & { assemblyState: unknown };
  state.assemblyState = {
    name: 'runtime_assembly',
    transform: {
      position: { x: 0, y: 0, z: 0 },
      rotation: { r: 0, p: 0, y: 0 },
    },
    components: {
      runtime_component: {
        uncloneableRuntimeHandle: () => null,
      },
    },
    bridges: {},
  };

  const snapshot = buildRobotSnapshotForAssemblySnapshot(state as RobotData, null);

  assert.equal(snapshot.name, 'paint_box_robot');
  assert.equal(snapshot.assemblyState, null);
  assert.deepEqual(snapshot.components, {});
  assert.deepEqual(snapshot.bridges, {});
});
