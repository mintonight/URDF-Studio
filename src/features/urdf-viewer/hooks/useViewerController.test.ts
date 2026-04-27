import test from 'node:test';
import assert from 'node:assert/strict';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  JointType,
  type JointQuaternion,
  type RobotState,
} from '@/types';
import {
  EMPTY_JOINT_INTERACTION_PREVIEW,
  useJointInteractionPreviewStore,
  useSelectionStore,
} from '@/store';

import { useViewerController } from './useViewerController.ts';

function renderHook() {
  let hookValue: ReturnType<typeof useViewerController> | null = null;

  function Probe() {
    hookValue = useViewerController({ active: false });
    return null;
  }

  renderToStaticMarkup(React.createElement(Probe));
  assert.ok(hookValue, 'hook should render');
  return hookValue;
}

function installDom() {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://localhost/',
    pretendToBeVisual: true,
  });

  (globalThis as { window?: Window }).window = dom.window as unknown as Window;
  (globalThis as { document?: Document }).document = dom.window.document;
  Object.defineProperty(globalThis, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'HTMLElement', {
    value: dom.window.HTMLElement,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    value: dom.window.requestAnimationFrame.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    value: dom.window.cancelAnimationFrame.bind(dom.window),
    configurable: true,
  });
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', {
    value: true,
    configurable: true,
  });

  return dom;
}

function createClosedLoopRobotFixture(): RobotState {
  return {
    name: 'closed-loop-fixture',
    rootLinkId: 'base',
    selection: { type: 'joint', id: 'joint_a' },
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
      },
      link_a: {
        ...DEFAULT_LINK,
        id: 'link_a',
        name: 'link_a',
      },
      link_b: {
        ...DEFAULT_LINK,
        id: 'link_b',
        name: 'link_b',
      },
    },
    joints: {
      joint_a: {
        ...DEFAULT_JOINT,
        id: 'joint_a',
        name: 'joint_a',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'link_a',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
      },
      joint_b: {
        ...DEFAULT_JOINT,
        id: 'joint_b',
        name: 'joint_b',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'link_b',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
      },
    },
    closedLoopConstraints: [
      {
        id: 'connect-rotating-links',
        type: 'connect',
        linkAId: 'link_a',
        linkBId: 'link_b',
        anchorWorld: { x: 1, y: 0, z: 0 },
        anchorLocalA: { x: 1, y: 0, z: 0 },
        anchorLocalB: { x: 1, y: 0, z: 0 },
        source: { format: 'mjcf', body1Name: 'link_a', body2Name: 'link_b' },
      },
    ],
  };
}

function createMimicRobotFixture(): RobotState {
  return {
    name: 'mimic-fixture',
    rootLinkId: 'base',
    selection: { type: 'joint', id: 'follower_joint' },
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
      },
      leader_link: {
        ...DEFAULT_LINK,
        id: 'leader_link',
        name: 'leader_link',
      },
      follower_link: {
        ...DEFAULT_LINK,
        id: 'follower_link',
        name: 'follower_link',
      },
    },
    joints: {
      leader_joint: {
        ...DEFAULT_JOINT,
        id: 'leader_joint',
        name: 'leader_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'leader_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
      },
      follower_joint: {
        ...DEFAULT_JOINT,
        id: 'follower_joint',
        name: 'follower_joint',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'follower_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
        mimic: {
          joint: 'leader_joint',
          multiplier: -2,
          offset: 0.1,
        },
      },
    },
  };
}

function createSimpleRobotFixture(): RobotState {
  return {
    name: 'simple-fixture',
    rootLinkId: 'base',
    selection: { type: 'joint', id: 'joint_a' },
    links: {
      base: {
        ...DEFAULT_LINK,
        id: 'base',
        name: 'base',
      },
      link_a: {
        ...DEFAULT_LINK,
        id: 'link_a',
        name: 'link_a',
      },
    },
    joints: {
      joint_a: {
        ...DEFAULT_JOINT,
        id: 'joint_a',
        name: 'joint_a',
        type: JointType.REVOLUTE,
        parentLinkId: 'base',
        childLinkId: 'link_a',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -Math.PI, upper: Math.PI, effort: 1, velocity: 1 },
        angle: 0,
      },
    },
  };
}

type RuntimeJoint = RobotState['joints'][string] & {
  jointValue: number;
  quaternion?: JointQuaternion;
  setJointValue: (angle: number) => void;
  finalizeJointValue: () => void;
  setJointQuaternion: (quaternion: JointQuaternion) => void;
};

function createRuntimeRobotFixture(robot: RobotState) {
  const runtimeJoints = Object.fromEntries(
    Object.entries(robot.joints).map(([jointId, joint]) => {
      const runtimeJoint: RuntimeJoint = {
        ...joint,
        jointValue: joint.angle ?? 0,
        setJointValue(angle: number) {
          this.angle = angle;
          this.jointValue = angle;
        },
        finalizeJointValue() {},
        setJointQuaternion(quaternion: JointQuaternion) {
          this.quaternion = quaternion;
        },
      };

      return [jointId, runtimeJoint];
    }),
  );

  return {
    ...robot,
    joints: runtimeJoints,
  };
}

async function mountController(closedLoopRobotState: RobotState) {
  return mountControllerWithProps({
    active: false,
    closedLoopRobotState,
  });
}

async function mountControllerWithProps(props: Parameters<typeof useViewerController>[0]) {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  useJointInteractionPreviewStore.getState().clearPreview();

  const root = createRoot(container);
  let hookValue: ReturnType<typeof useViewerController> | null = null;

  function Probe() {
    hookValue = useViewerController(props);
    return null;
  }

  await act(async () => {
    root.render(React.createElement(Probe));
  });

  return {
    dom,
    root,
    getHook() {
      assert.ok(hookValue, 'hook should stay mounted');
      return hookValue;
    },
  };
}

async function nextAnimationFrame(dom: JSDOM) {
  await new Promise<void>((resolve) => {
    dom.window.requestAnimationFrame(() => resolve());
  });
}

function assertAlmostEqual(actual: number | undefined, expected: number, epsilon = 1e-3) {
  assert.equal(typeof actual, 'number');
  assert.ok(
    Math.abs((actual ?? 0) - expected) <= epsilon,
    `${actual} should be within ${epsilon} of ${expected}`,
  );
}

function resetSelectionStore() {
  const state = useSelectionStore.getState();
  state.setHoverFrozen(false);
  state.clearHover();
  state.setHoveredSelection({ type: null, id: null });
}

test('handleAutoFitGround delegates to the active runtime auto-fit handler when registered', () => {
  const hook = renderHook();
  let callCount = 0;

  hook.registerRuntimeAutoFitGroundHandler(() => {
    callCount += 1;
  });

  hook.handleAutoFitGround();

  assert.equal(callCount, 1);
});

test('paint tool state switches back to select when the paint panel closes', async () => {
  const { root, getHook } = await mountControllerWithProps({
    active: false,
  });

  try {
    assert.equal(getHook().paintColor, '#ff6c0a');
    assert.equal(getHook().paintStatus, null);

    await act(async () => {
      getHook().handleToolModeChange('paint');
      getHook().setPaintStatus({ tone: 'success', message: 'painted' });
    });

    assert.equal(getHook().toolMode, 'paint');
    assert.deepEqual(getHook().paintStatus, { tone: 'success', message: 'painted' });

    await act(async () => {
      getHook().handleClosePaintTool();
    });

    assert.equal(getHook().toolMode, 'select');
    assert.equal(getHook().paintStatus, null);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('handleHoverWrapper keeps the shared hover store in sync and still forwards the callback', async () => {
  resetSelectionStore();
  const forwarded: Array<{
    type: 'link' | 'joint' | 'tendon' | null;
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
    helperKind?: string;
    highlightObjectId?: number;
  }> = [];
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    onHover: (type, id, subType, objectIndex, helperKind, highlightObjectId) => {
      forwarded.push({ type, id, subType, objectIndex, helperKind, highlightObjectId });
    },
  });

  try {
    await act(async () => {
      getHook().handleHoverWrapper('link', 'base_link', 'visual', 2);
    });

    assert.deepEqual(useSelectionStore.getState().hoveredSelection, {
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 2,
      helperKind: undefined,
      highlightObjectId: undefined,
    });
    assert.deepEqual(forwarded, [
      {
        type: 'link',
        id: 'base_link',
        subType: 'visual',
        objectIndex: 2,
        helperKind: undefined,
        highlightObjectId: undefined,
      },
    ]);

    await act(async () => {
      getHook().handleHoverWrapper(null, null);
    });

    assert.deepEqual(useSelectionStore.getState().hoveredSelection, { type: null, id: null });
  } finally {
    await act(async () => {
      root.unmount();
    });
    resetSelectionStore();
  }
});

test('handleRuntimeJointAngleChange publishes live closed-loop preview compensation before commit', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const { dom, root, getHook } = await mountController(closedLoopRobotState);

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleRuntimeJointAngleChange('joint_a', 0.42);
      await nextAnimationFrame(dom);
    });

    const panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.42);
    assertAlmostEqual(panelAngles.joint_b, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);

    assert.deepEqual(
      useJointInteractionPreviewStore.getState().preview,
      EMPTY_JOINT_INTERACTION_PREVIEW,
    );

    await act(async () => {
      getHook().handleJointChangeCommit('joint_a', 0.42);
    });

    assert.deepEqual(
      useJointInteractionPreviewStore.getState().preview,
      EMPTY_JOINT_INTERACTION_PREVIEW,
    );
  } finally {
    useJointInteractionPreviewStore.getState().clearPreview();
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleRobotLoaded sanitizes runtime Three.js quaternions before closed-loop preview cloning', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  runtimeRobot.joints.joint_a.quaternion = new THREE.Quaternion(
    0,
    0.5,
    0,
    0.8660254,
  ) as unknown as JointQuaternion;
  const { dom, root, getHook } = await mountController(closedLoopRobotState);

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    const mergedQuaternion = getHook().closedLoopRobotState?.joints.joint_a?.quaternion;
    assert.deepEqual(mergedQuaternion, {
      x: 0,
      y: 0.5,
      z: 0,
      w: 0.8660254,
    });
    assert.equal(Object.getPrototypeOf(mergedQuaternion), Object.prototype);
    assert.notEqual(mergedQuaternion, runtimeRobot.joints.joint_a.quaternion);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('closedLoopRobotState sanitizes runtime-shaped joints before preview session cloning', async () => {
  const runtimeClosedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeLikeJoint = {
    ...runtimeClosedLoopRobotState.joints.joint_a,
    quaternion: new THREE.Quaternion(0, 0.25, 0, 0.9682458),
    setJointValue(angle: number) {
      this.angle = angle;
    },
  } as unknown as RobotState['joints'][string];

  const { dom, root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState: {
      ...runtimeClosedLoopRobotState,
      joints: {
        ...runtimeClosedLoopRobotState.joints,
        joint_a: runtimeLikeJoint,
      },
    },
  });

  try {
    const previewRobotState = getHook().closedLoopRobotState;
    assert.ok(previewRobotState);
    assert.doesNotThrow(() => structuredClone(previewRobotState));
    assert.deepEqual(previewRobotState.joints.joint_a?.quaternion, {
      x: 0,
      y: 0.25,
      z: 0,
      w: 0.9682458,
    });
    assert.equal(
      'setJointValue' in (previewRobotState.joints.joint_a as unknown as Record<string, unknown>),
      false,
    );
    assert.equal(Object.getPrototypeOf(previewRobotState.joints.joint_a), Object.prototype);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleRuntimeJointAnglesChange keeps USD drag previews local until the drag ends', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const committedJointChanges: Array<{ jointName: string; angle: number }> = [];
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    onJointChange: (jointName, angle) => {
      committedJointChanges.push({ jointName, angle });
    },
    syncJointChangesToApp: true,
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().setIsDragging(true);
      getHook().handleRuntimeJointAnglesChange({ joint_a: 0.35 });
    });

    assert.deepEqual(committedJointChanges, []);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.35);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.35);

    await act(async () => {
      getHook().setIsDragging(false);
      getHook().handleRuntimeJointAnglesChange({ joint_a: 0.45 });
    });

    assert.deepEqual(committedJointChanges, [{ jointName: 'joint_a', angle: 0.45 }]);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.45);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.45);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('previewIkJointKinematics keeps the IK drag preview out of the joint panel store', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const { root, getHook } = await mountControllerWithProps({
    active: false,
    jointAngleState: { joint_a: 0 },
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().previewIkJointKinematics({ joint_a: 0.35 }, {});
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.35);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0);

    await act(async () => {
      getHook().clearIkJointKinematicsPreview();
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('clearIkJointKinematicsPreview restores the latest committed joint baseline', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const { root, getHook } = await mountControllerWithProps({
    active: false,
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleJointChangeCommit('joint_a', 0.3);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.3);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.3);

    await act(async () => {
      getHook().previewIkJointKinematics({ joint_a: 0.65 }, {});
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.65);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.3);

    await act(async () => {
      getHook().clearIkJointKinematicsPreview();
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.3);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.3);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('closedLoopRobotState keeps the runtime-loaded joint pose when external joint motion state is empty', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  runtimeRobot.joints.joint_a.setJointValue(0.25);
  runtimeRobot.joints.joint_b.setJointValue(-0.85);

  const { root, getHook } = await mountControllerWithProps({
    active: false,
    closedLoopRobotState,
    jointMotionState: {},
  });

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    const resolvedClosedLoopRobotState = getHook().closedLoopRobotState;
    assert.ok(resolvedClosedLoopRobotState);
    assertAlmostEqual(resolvedClosedLoopRobotState.joints.joint_a?.angle, 0.25);
    assertAlmostEqual(resolvedClosedLoopRobotState.joints.joint_b?.angle, -0.85);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('empty jointMotionState does not clear the runtime baseline used by IK preview reset', async () => {
  const robotState = createSimpleRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  runtimeRobot.joints.joint_a.setJointValue(0.2);

  const { root, getHook } = await mountControllerWithProps({
    active: false,
    jointMotionState: {},
  });

  try {
    await act(async () => {
      getHook().handleJointPanelRobotLoaded(runtimeRobot);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.2);

    await act(async () => {
      getHook().previewIkJointKinematics({ joint_a: 0.65 }, {});
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.65);

    await act(async () => {
      getHook().clearIkJointKinematicsPreview();
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.2);
    assertAlmostEqual(getHook().jointPanelStore.getSnapshot().jointAngles.joint_a, 0.2);
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});

test('setIsDragging freezes hover state immediately for active viewers', async () => {
  resetSelectionStore();
  const { root, getHook } = await mountControllerWithProps({
    active: true,
  });

  try {
    useSelectionStore.getState().setHoveredSelection({
      type: 'link',
      id: 'base_link',
      subType: 'visual',
      objectIndex: 0,
    });

    await act(async () => {
      getHook().setIsDragging(true);
    });

    let selectionState = useSelectionStore.getState();
    assert.equal(selectionState.hoverFrozen, true);
    assert.deepEqual(selectionState.hoveredSelection, { type: null, id: null });

    await act(async () => {
      getHook().setIsDragging(false);
    });

    selectionState = useSelectionStore.getState();
    assert.equal(selectionState.hoverFrozen, false);
  } finally {
    resetSelectionStore();
    await act(async () => {
      root.unmount();
    });
  }
});

test('handleJointAngleChange batches closed-loop slider preview into one frame-aligned update', async () => {
  const closedLoopRobotState = createClosedLoopRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(closedLoopRobotState);
  const { dom, root, getHook } = await mountController(closedLoopRobotState);

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleJointAngleChange('joint_a', 0.42);
    });

    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0);
    assert.deepEqual(getHook().jointPanelStore.getSnapshot().jointAngles, {
      joint_a: 0,
      joint_b: 0,
    });

    await act(async () => {
      await nextAnimationFrame(dom);
    });

    const panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.joint_a, 0.42);
    assertAlmostEqual(panelAngles.joint_b, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_a?.angle, 0.42);
    assertAlmostEqual(runtimeRobot.joints.joint_b?.angle, 0.42);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('handleJointAngleChange expands mimic-coupled joints before commit', async () => {
  const robotState = createMimicRobotFixture();
  const runtimeRobot = createRuntimeRobotFixture(robotState);
  const { root, getHook } = await mountController(robotState);

  try {
    await act(async () => {
      getHook().handleRobotLoaded(runtimeRobot);
    });

    await act(async () => {
      getHook().handleJointAngleChange('follower_joint', 0.3);
    });

    const panelAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(panelAngles.leader_joint, -0.1);
    assertAlmostEqual(panelAngles.follower_joint, 0.3);
    assertAlmostEqual(runtimeRobot.joints.leader_joint?.angle, -0.1);
    assertAlmostEqual(runtimeRobot.joints.follower_joint?.angle, 0.3);

    assert.deepEqual(
      useJointInteractionPreviewStore.getState().preview,
      EMPTY_JOINT_INTERACTION_PREVIEW,
    );

    await act(async () => {
      getHook().handleJointChangeCommit('follower_joint', 0.3);
    });

    const committedAngles = getHook().jointPanelStore.getSnapshot().jointAngles;
    assertAlmostEqual(committedAngles.leader_joint, -0.1);
    assertAlmostEqual(committedAngles.follower_joint, 0.3);
    assert.deepEqual(
      useJointInteractionPreviewStore.getState().preview,
      EMPTY_JOINT_INTERACTION_PREVIEW,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
  }
});
