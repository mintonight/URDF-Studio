import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotData, type RobotFile } from '@/types';
import { useAssemblyStore } from './assemblyStore.ts';

function resetAssemblyStore() {
  const state = useAssemblyStore.getState();
  state.clearHistory();
  state.exitAssembly();
  state.setAssembly(null);
}

function createRobot(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
    materials: {},
    closedLoopConstraints: [],
  };
}

function createRobotWithOffsetChild(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      tool_link: {
        ...DEFAULT_LINK,
        id: 'tool_link',
        name: 'tool_link',
      },
    },
    joints: {
      tool_mount: {
        ...DEFAULT_JOINT,
        id: 'tool_mount',
        name: 'tool_mount',
        type: JointType.FIXED,
        parentLinkId: 'base_link',
        childLinkId: 'tool_link',
        origin: {
          xyz: { x: 1.2, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
    materials: {},
    closedLoopConstraints: [],
  };
}

test('updateBridge keeps bridge display name in sync with joint name changes', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('bridge-sync');

  const leftFile: RobotFile = {
    name: 'robots/left.usd',
    content: '',
    format: 'usd',
  };
  const rightFile: RobotFile = {
    name: 'robots/right.usd',
    content: '',
    format: 'usd',
  };

  const leftComponent = store.addComponent(leftFile, {
    preResolvedRobotData: createRobot('left_robot'),
  });
  const rightComponent = store.addComponent(rightFile, {
    preResolvedRobotData: createRobot('right_robot'),
  });

  assert.ok(leftComponent);
  assert.ok(rightComponent);

  const bridge = store.addBridge({
    name: 'bridge_alpha',
    parentComponentId: leftComponent!.id,
    parentLinkId: 'base_link',
    childComponentId: rightComponent!.id,
    childLinkId: 'base_link',
    joint: {
      ...DEFAULT_JOINT,
      name: 'bridge_alpha',
      type: JointType.FIXED,
      parentLinkId: 'base_link',
      childLinkId: 'base_link',
    },
  });

  useAssemblyStore.getState().updateBridge(bridge.id, {
    joint: {
      ...bridge.joint,
      name: 'bridge_beta',
    },
  });

  const updatedBridge = useAssemblyStore.getState().assemblyState?.bridges[bridge.id];
  assert.equal(updatedBridge?.name, 'bridge_beta');
  assert.equal(updatedBridge?.joint.name, 'bridge_beta');
});

test('addBridge realigns the child component transform so a non-root child link snaps to the parent link', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('bridge-auto-align');

  const parentComponent = store.addComponent(
    {
      name: 'robots/parent.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('parent_robot'),
    },
  );
  const childComponent = store.addComponent(
    {
      name: 'robots/child.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobotWithOffsetChild('child_robot'),
    },
  );

  assert.ok(parentComponent);
  assert.ok(childComponent);

  store.addBridge({
    name: 'snap_child_tool_to_parent',
    parentComponentId: parentComponent!.id,
    parentLinkId: 'base_link',
    childComponentId: childComponent!.id,
    childLinkId: 'tool_link',
    joint: {
      type: JointType.FIXED,
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  });

  const childTransform =
    useAssemblyStore.getState().assemblyState?.components[childComponent!.id]?.transform;
  assert.deepEqual(childTransform, {
    position: { x: -1.2, y: 0, z: 0.25 },
    rotation: { r: 0, p: 0, y: 0 },
  });
});

test('addBridge rejects a second incoming bridge for the same child component', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('bridge-single-parent');

  const leftParent = store.addComponent(
    {
      name: 'robots/left.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('left_robot'),
    },
  );
  const rightParent = store.addComponent(
    {
      name: 'robots/right.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('right_robot'),
    },
  );
  const childComponent = store.addComponent(
    {
      name: 'robots/child.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('child_robot'),
    },
  );

  assert.ok(leftParent);
  assert.ok(rightParent);
  assert.ok(childComponent);

  store.addBridge({
    name: 'bridge_left_child',
    parentComponentId: leftParent!.id,
    parentLinkId: 'base_link',
    childComponentId: childComponent!.id,
    childLinkId: 'base_link',
    joint: {
      type: JointType.FIXED,
    },
  });

  assert.throws(
    () =>
      store.addBridge({
        name: 'bridge_right_child',
        parentComponentId: rightParent!.id,
        parentLinkId: 'base_link',
        childComponentId: childComponent!.id,
        childLinkId: 'base_link',
        joint: {
          type: JointType.FIXED,
        },
      }),
    /already has an incoming bridge: bridge_/,
  );

  const assemblyState = useAssemblyStore.getState().assemblyState;
  assert.ok(assemblyState);
  assert.equal(Object.keys(assemblyState!.bridges).length, 1);
});

test('addBridge rejects a non-fixed bridge that would close an assembly cycle', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('bridge-non-fixed-cycle');

  const leftComponent = store.addComponent(
    {
      name: 'robots/left.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('left_robot'),
    },
  );
  const rightComponent = store.addComponent(
    {
      name: 'robots/right.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('right_robot'),
    },
  );

  assert.ok(leftComponent);
  assert.ok(rightComponent);

  const fixedBridge = store.addBridge({
    name: 'bridge_left_right',
    parentComponentId: leftComponent!.id,
    parentLinkId: 'base_link',
    childComponentId: rightComponent!.id,
    childLinkId: 'base_link',
    joint: {
      type: JointType.FIXED,
    },
  });

  assert.ok(fixedBridge);

  assert.throws(
    () =>
      store.addBridge({
        name: 'bridge_right_left',
        parentComponentId: rightComponent!.id,
        parentLinkId: 'base_link',
        childComponentId: leftComponent!.id,
        childLinkId: 'base_link',
        joint: {
          type: JointType.REVOLUTE,
        },
      }),
    /would close a cycle with joint type "revolute". Only fixed cyclic bridges can be converted into closed-loop constraints\./,
  );

  const assemblyState = useAssemblyStore.getState().assemblyState;
  assert.ok(assemblyState);
  assert.equal(Object.keys(assemblyState!.bridges).length, 1);
});

test('updateBridge re-aligns the child component transform when the bridge child link changes', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('bridge-link-realign');

  const parentComponent = store.addComponent(
    {
      name: 'robots/parent.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('parent_robot'),
    },
  );
  const childComponent = store.addComponent(
    {
      name: 'robots/child.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobotWithOffsetChild('child_robot'),
    },
  );

  assert.ok(parentComponent);
  assert.ok(childComponent);

  const bridge = store.addBridge({
    name: 'retarget_child_link',
    parentComponentId: parentComponent!.id,
    parentLinkId: 'base_link',
    childComponentId: childComponent!.id,
    childLinkId: 'base_link',
    joint: {
      type: JointType.FIXED,
      origin: {
        xyz: { x: 0.5, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  });

  assert.deepEqual(
    useAssemblyStore.getState().assemblyState?.components[childComponent!.id]?.transform,
    {
      position: { x: 0.5, y: 0, z: 0.25 },
      rotation: { r: 0, p: 0, y: 0 },
    },
  );

  store.updateBridge(bridge.id, {
    childLinkId: 'tool_link',
    joint: {
      ...bridge.joint,
      childLinkId: 'tool_link',
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: { r: 0, p: 0, y: 0 },
      },
    },
  });

  const childTransform =
    useAssemblyStore.getState().assemblyState?.components[childComponent!.id]?.transform;
  assert.deepEqual(childTransform, {
    position: { x: -1.2, y: 0, z: 0.25 },
    rotation: { r: 0, p: 0, y: 0 },
  });
});

test('updateBridge rejects retargeting a bridge onto a child component that already has an incoming bridge', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('bridge-update-single-parent');

  const parentA = store.addComponent(
    {
      name: 'robots/parent_a.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('parent_a_robot'),
    },
  );
  const parentB = store.addComponent(
    {
      name: 'robots/parent_b.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('parent_b_robot'),
    },
  );
  const childA = store.addComponent(
    {
      name: 'robots/child_a.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('child_a_robot'),
    },
  );
  const childB = store.addComponent(
    {
      name: 'robots/child_b.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('child_b_robot'),
    },
  );

  assert.ok(parentA);
  assert.ok(parentB);
  assert.ok(childA);
  assert.ok(childB);

  const occupiedBridge = store.addBridge({
    name: 'bridge_parent_a_child_a',
    parentComponentId: parentA!.id,
    parentLinkId: 'base_link',
    childComponentId: childA!.id,
    childLinkId: 'base_link',
    joint: {
      type: JointType.FIXED,
    },
  });
  const movableBridge = store.addBridge({
    name: 'bridge_parent_b_child_b',
    parentComponentId: parentB!.id,
    parentLinkId: 'base_link',
    childComponentId: childB!.id,
    childLinkId: 'base_link',
    joint: {
      type: JointType.FIXED,
    },
  });

  assert.ok(occupiedBridge);
  assert.ok(movableBridge);

  assert.throws(
    () =>
      store.updateBridge(movableBridge.id, {
        childComponentId: childA!.id,
        childLinkId: 'base_link',
        joint: {
          ...movableBridge.joint,
          childLinkId: 'base_link',
        },
      }),
    /already has an incoming bridge: bridge_/,
  );

  const updatedBridge = useAssemblyStore.getState().assemblyState?.bridges[movableBridge.id];
  assert.equal(updatedBridge?.childComponentId, childB!.id);
  assert.equal(updatedBridge?.childLinkId, 'base_link');
});

test('updateBridge rejects changing a fixed cyclic bridge into a non-fixed bridge', () => {
  resetAssemblyStore();

  const store = useAssemblyStore.getState();
  store.initAssembly('bridge-update-non-fixed-cycle');

  const leftComponent = store.addComponent(
    {
      name: 'robots/left.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('left_robot'),
    },
  );
  const rightComponent = store.addComponent(
    {
      name: 'robots/right.usd',
      content: '',
      format: 'usd',
    },
    {
      preResolvedRobotData: createRobot('right_robot'),
    },
  );

  assert.ok(leftComponent);
  assert.ok(rightComponent);

  store.addBridge({
    name: 'bridge_left_right',
    parentComponentId: leftComponent!.id,
    parentLinkId: 'base_link',
    childComponentId: rightComponent!.id,
    childLinkId: 'base_link',
    joint: {
      type: JointType.FIXED,
    },
  });
  const cyclicBridge = store.addBridge({
    name: 'bridge_right_left',
    parentComponentId: rightComponent!.id,
    parentLinkId: 'base_link',
    childComponentId: leftComponent!.id,
    childLinkId: 'base_link',
    joint: {
      type: JointType.FIXED,
    },
  });

  assert.ok(cyclicBridge);

  assert.throws(
    () =>
      store.updateBridge(cyclicBridge.id, {
        joint: {
          ...cyclicBridge.joint,
          type: JointType.REVOLUTE,
        },
      }),
    /would close a cycle with joint type "revolute". Only fixed cyclic bridges can be converted into closed-loop constraints\./,
  );

  const updatedBridge = useAssemblyStore.getState().assemblyState?.bridges[cyclicBridge.id];
  assert.equal(updatedBridge?.joint.type, JointType.FIXED);
});
