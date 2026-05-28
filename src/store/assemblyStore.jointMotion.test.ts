import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_JOINT, DEFAULT_LINK, JointType, type RobotData, type RobotFile } from '@/types';
import { useRobotStore } from './robotStore.ts';

function resetAssemblyStore() {
  const state = useRobotStore.getState();
  state.clearHistory();
  state.exitAssembly();
  state.setAssembly(null);
}

function createRobotWithRevolute(name: string): RobotData {
  return {
    name,
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      arm_link: {
        ...DEFAULT_LINK,
        id: 'arm_link',
        name: 'arm_link',
      },
    },
    joints: {
      arm_joint: {
        ...DEFAULT_JOINT,
        id: 'arm_joint',
        name: 'arm_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'arm_link',
        angle: 0,
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
    materials: {},
    closedLoopConstraints: [],
  };
}

function seedSingleComponentAssembly(name: string) {
  const store = useRobotStore.getState();
  store.initAssembly(name);

  const file: RobotFile = {
    name: `robots/${name}.usd`,
    content: '',
    format: 'usd',
  };
  const component = store.addComponent(file, {
    preResolvedRobotData: createRobotWithRevolute(`${name}_robot`),
  });
  assert.ok(component);
  // After addComponent namespaces ids with the component prefix, the
  // canonical key for the seed joint is `${component.id}_arm_joint`.
  const armJointId = `${component!.id}_arm_joint`;
  return { component: component!, armJointId };
}

test('setComponentJointMotion writes joint.angle in place without changing assemblyState reference', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('inplace-angle');

  const before = useRobotStore.getState().assemblyState;
  assert.ok(before);
  const beforeAngle = before!.components[component.id]?.robot.joints[armJointId]?.angle;
  assert.equal(beforeAngle, 0);

  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 1.234 }, {});

  const after = useRobotStore.getState().assemblyState;
  // Critical contract: assemblyState reference is unchanged so React
  // subscribers do NOT fire.
  assert.equal(after, before);
  // But the joint angle is updated in place.
  assert.equal(after!.components[component.id]!.robot.joints[armJointId]!.angle, 1.234);
});

test('setComponentJointMotion bumps assemblyJointMotionRevision but not assemblyRevision', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('motion-revision');

  const baseline = useRobotStore.getState();
  const baselineAssemblyRevision = baseline.assemblyRevision;
  const baselineMotionRevision = baseline.assemblyJointMotionRevision;

  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.5 }, {});

  const afterFirst = useRobotStore.getState();
  assert.equal(afterFirst.assemblyRevision, baselineAssemblyRevision);
  assert.equal(afterFirst.assemblyJointMotionRevision, baselineMotionRevision + 1);

  // A second write bumps motion revision again.
  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.7 }, {});

  const afterSecond = useRobotStore.getState();
  assert.equal(afterSecond.assemblyRevision, baselineAssemblyRevision);
  assert.equal(afterSecond.assemblyJointMotionRevision, baselineMotionRevision + 2);
});

test('setComponentJointMotion does not fire subscribers selecting only assemblyState', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('subscriber-quiet');

  let assemblyStateSubscriberCalls = 0;
  const unsubscribe = useRobotStore.subscribe((state, previous) => {
    if (state.assemblyState !== previous.assemblyState) {
      assemblyStateSubscriberCalls += 1;
    }
  });

  try {
    useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.3 }, {});
    useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.6 }, {});
    useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.9 }, {});
    assert.equal(
      assemblyStateSubscriberCalls,
      0,
      'in-place joint motion writes must not change assemblyState reference',
    );
  } finally {
    unsubscribe();
  }
});

test('setComponentJointMotion no-ops when angle is unchanged', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('noop-equal');

  const baselineMotionRevision = useRobotStore.getState().assemblyJointMotionRevision;
  // First write — angle is 0 -> 0, no change → revision should NOT bump.
  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0 }, {});
  assert.equal(useRobotStore.getState().assemblyJointMotionRevision, baselineMotionRevision);

  // Real change bumps.
  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.1 }, {});
  assert.equal(
    useRobotStore.getState().assemblyJointMotionRevision,
    baselineMotionRevision + 1,
  );

  // Same value again — no bump.
  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.1 }, {});
  assert.equal(
    useRobotStore.getState().assemblyJointMotionRevision,
    baselineMotionRevision + 1,
  );
});

test('setComponentJointMotion writes quaternion in place', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('inplace-quat');

  const before = useRobotStore.getState().assemblyState;
  useRobotStore
    .getState()
    .setComponentJointMotion(component.id, {}, { [armJointId]: { x: 0, y: 0.5, z: 0, w: 0.866 } });
  const after = useRobotStore.getState().assemblyState;
  assert.equal(after, before, 'reference should still be stable');
  const q = after!.components[component.id]!.robot.joints[armJointId]!.quaternion;
  assert.deepEqual(q, { x: 0, y: 0.5, z: 0, w: 0.866 });
});

test('getMergedRobotData picks up in-place joint motion via cache invalidation', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('merger-cache');

  const firstMerge = useRobotStore.getState().getMergedRobotData();
  assert.ok(firstMerge);
  const firstAngle = firstMerge!.joints[armJointId]?.angle;
  assert.equal(firstAngle, 0);

  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 1.5 }, {});

  const secondMerge = useRobotStore.getState().getMergedRobotData();
  assert.ok(secondMerge);
  assert.equal(secondMerge!.joints[armJointId]?.angle, 1.5);
  // The merged data should be a fresh object (cache invalidated by motion
  // revision), not the same reference.
  assert.notEqual(secondMerge, firstMerge);
});

test('flushPendingAssemblyJointMotion converts in-place writes into a real assemblyState swap with history', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('flush-roundtrip');

  const before = useRobotStore.getState().assemblyState;
  const baselineAssemblyRevision = useRobotStore.getState().assemblyRevision;

  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.42 }, {});

  // Pre-flush: same reference.
  assert.equal(useRobotStore.getState().assemblyState, before);

  const flushed = useRobotStore
    .getState()
    .flushPendingAssemblyJointMotion({ label: 'flush-test', skipHistory: false });
  assert.equal(flushed, true);

  const afterFlush = useRobotStore.getState().assemblyState;
  // Post-flush: new reference (so subscribers see the change).
  assert.notEqual(afterFlush, before);
  // The angle survives the round trip.
  assert.equal(afterFlush!.components[component.id]!.robot.joints[armJointId]!.angle, 0.42);
  // assemblyRevision bumped (because applyAssemblyMutation always bumps it).
  assert.ok(useRobotStore.getState().assemblyRevision > baselineAssemblyRevision);

  // History has the patch and undo restores the original angle.
  useRobotStore.getState().undo();
  const afterUndo = useRobotStore.getState().assemblyState;
  assert.equal(afterUndo!.components[component.id]!.robot.joints[armJointId]!.angle, 0);

  // Redo recovers the flushed angle.
  useRobotStore.getState().redo();
  const afterRedo = useRobotStore.getState().assemblyState;
  assert.equal(afterRedo!.components[component.id]!.robot.joints[armJointId]!.angle, 0.42);
});

test('flushPendingAssemblyJointMotion is a no-op when nothing is pending', () => {
  resetAssemblyStore();
  seedSingleComponentAssembly('flush-empty');

  const flushed = useRobotStore.getState().flushPendingAssemblyJointMotion();
  assert.equal(flushed, false);
});

test('flushPendingAssemblyJointMotion preserves the latest value across multiple in-place writes', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('flush-coalesce');

  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.1 }, {});
  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.5 }, {});
  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.9 }, {});

  useRobotStore.getState().flushPendingAssemblyJointMotion();
  const finalAngle =
    useRobotStore.getState().assemblyState!.components[component.id]!.robot.joints[armJointId]!
      .angle;
  assert.equal(finalAngle, 0.9);

  // Undo brings it back to the ORIGINAL (pre-first-write) value, not the
  // intermediate 0.5. The fast-path captures the first "original" only.
  useRobotStore.getState().undo();
  const undoAngle =
    useRobotStore.getState().assemblyState!.components[component.id]!.robot.joints[armJointId]!
      .angle;
  assert.equal(undoAngle, 0);
});

test('in-place joint motion survives a subsequent structural mutation without entering history', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('inplace-survives-rename');

  // Step 1: in-place joint motion write — transient runtime state.
  useRobotStore.getState().setComponentJointMotion(component.id, { [armJointId]: 0.77 }, {});

  // Step 2: structural mutation via the canonical immer path.
  useRobotStore.getState().updateComponentName(component.id, 'renamed_component');

  // The joint angle persists in the live state (structural sharing keeps the
  // joint object identity stable, and we in-place mutated it).
  const afterRename = useRobotStore.getState().assemblyState;
  assert.equal(
    afterRename!.components[component.id]!.robot.joints[armJointId]!.angle,
    0.77,
    'in-place angle should survive the produceWithPatches that renamed the component',
  );

  // Undo: reverts ONLY the rename, leaves the in-place joint angle alone.
  useRobotStore.getState().undo();
  const afterUndo = useRobotStore.getState().assemblyState;
  assert.equal(
    afterUndo!.components[component.id]!.name,
    component.name,
    'rename undo should restore the original name',
  );
  assert.equal(
    afterUndo!.components[component.id]!.robot.joints[armJointId]!.angle,
    0.77,
    'rename undo should NOT revert the transient in-place joint angle',
  );
});

test('setComponentJointMotion is a no-op when the component or joint is missing', () => {
  resetAssemblyStore();
  const { component, armJointId } = seedSingleComponentAssembly('missing-joint');

  const baselineMotionRevision = useRobotStore.getState().assemblyJointMotionRevision;
  // Missing component.
  useRobotStore.getState().setComponentJointMotion('does-not-exist', { [armJointId]: 1 }, {});
  assert.equal(useRobotStore.getState().assemblyJointMotionRevision, baselineMotionRevision);

  // Missing joint within an existing component.
  useRobotStore.getState().setComponentJointMotion(component.id, { ghost_joint: 1 }, {});
  assert.equal(useRobotStore.getState().assemblyJointMotionRevision, baselineMotionRevision);

  // Non-finite angle is filtered out.
  useRobotStore
    .getState()
    .setComponentJointMotion(component.id, { [armJointId]: Number.NaN }, {});
  assert.equal(useRobotStore.getState().assemblyJointMotionRevision, baselineMotionRevision);
});
