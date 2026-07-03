import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';
import * as THREE from 'three';
import { context as r3fContext } from '@react-three/fiber';
import { create } from 'zustand';

import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type RobotData,
  type RobotFile,
} from '@/types';
import { useRendererBackend } from './useRendererBackend.ts';

const sourceFile: RobotFile = {
  name: 'robots/demo/demo.usd',
  format: 'urdf',
  content: '<robot name="usd_robotstate_placeholder"><link name="world" /></robot>',
};
const EMPTY_ASSETS: Record<string, string> = {};

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
  Object.defineProperty(globalThis, 'DOMParser', {
    value: dom.window.DOMParser,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Document', {
    value: dom.window.Document,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'Element', {
    value: dom.window.Element,
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

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  return { dom, root: createRoot(container) };
}

function createRobotData(color: string): RobotData {
  return {
    name: 'demo',
    rootLinkId: 'base',
    links: {
      base: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base',
        name: 'base',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
    },
    joints: {},
    materials: {
      base: { color },
    },
  };
}

function createJointOriginRobotData(jointZ: number): RobotData {
  return {
    name: 'joint_origin_demo',
    rootLinkId: 'base',
    links: {
      base: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base',
        name: 'base',
      },
      payload: {
        ...structuredClone(DEFAULT_LINK),
        id: 'payload',
        name: 'payload',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
    },
    joints: {
      lift_joint: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'lift_joint',
        name: 'lift_joint',
        type: JointType.FIXED,
        parentLinkId: 'base',
        childLinkId: 'payload',
        origin: {
          xyz: { x: 0, y: 0, z: jointZ },
          rpy: { r: 0, p: 0, y: 0 },
        },
      },
    },
    materials: {},
  };
}

function createCollisionOriginRobotData(collisionX: number): RobotData {
  return {
    name: 'mjcf_collision_origin_demo',
    rootLinkId: 'base',
    links: {
      base: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base',
        name: 'base',
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: DEFAULT_LINK.collision.color,
          origin: {
            xyz: { x: collisionX, y: 0, z: 0 },
            rpy: { r: 0, p: 0, y: 0 },
          },
        },
      },
    },
    joints: {},
    materials: {},
  };
}

function createPrismaticGroundRobotData(): RobotData {
  return {
    name: 'prismatic_ground_demo',
    rootLinkId: 'base',
    links: {
      base: {
        ...structuredClone(DEFAULT_LINK),
        id: 'base',
        name: 'base',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.01, y: 0.01, z: 0.01 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 10 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
      foot: {
        ...structuredClone(DEFAULT_LINK),
        id: 'foot',
        name: 'foot',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#808080',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 1, y: 1, z: 1 },
          color: '#ef4444',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
    },
    joints: {
      lift_joint: {
        ...structuredClone(DEFAULT_JOINT),
        id: 'lift_joint',
        name: 'lift_joint',
        type: JointType.PRISMATIC,
        parentLinkId: 'base',
        childLinkId: 'foot',
        origin: {
          xyz: { x: 0, y: 0, z: 0 },
          rpy: { r: 0, p: 0, y: 0 },
        },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 100, velocity: 10 },
      },
    },
    materials: {},
  };
}

const useR3fStore = create(() => ({
  gl: {
    getContext: () => ({
      isContextLost: () => false,
      getExtension: () => null,
      getParameter: () => '',
    }),
    compile: () => {},
  },
  invalidate: () => {},
  camera: new THREE.PerspectiveCamera(),
  scene: new THREE.Scene(),
  controls: null,
  internal: {
    subscribe: () => () => {},
  },
}));

function findFirstMesh(root: THREE.Object3D): THREE.Mesh {
  let found: THREE.Mesh | null = null as THREE.Mesh | null;
  root.traverse((child) => {
    if (!found && (child as THREE.Mesh).isMesh) {
      found = child as THREE.Mesh;
    }
  });
  assert.ok(found, 'expected rendered robot to contain a mesh');
  return found;
}

function findFirstColliderGroup(root: THREE.Object3D): THREE.Object3D {
  let found: THREE.Object3D | null = null;
  root.traverse((child) => {
    if (!found && (child as { isURDFCollider?: boolean }).isURDFCollider === true) {
      found = child;
    }
  });
  assert.ok(found, 'expected rendered robot to contain a collision group');
  return found;
}

function getMeshHexColor(mesh: THREE.Mesh): string {
  const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  assert.ok(material && 'color' in material && material.color instanceof THREE.Color);
  return `#${material.color.getHexString()}`;
}

function Probe({
  robotData,
  onRobotLoaded,
  sourceFile: probeSourceFile = sourceFile,
  availableFiles,
  showVisual = true,
  showCollision = false,
  initialJointAngles,
}: {
  robotData: RobotData;
  onRobotLoaded: (robot: THREE.Object3D) => void;
  sourceFile?: RobotFile;
  availableFiles?: RobotFile[];
  showVisual?: boolean;
  showCollision?: boolean;
  initialJointAngles?: Record<string, number>;
}) {
  useRendererBackend({
    sourceFile: probeSourceFile,
    availableFiles,
    assets: EMPTY_ASSETS,
    showVisual,
    showCollision,
    showCollisionAlwaysOnTop: true,
    allowUrdfXmlFallback: false,
    robotData,
    initialJointAngles,
    onRobotLoaded,
  });

  return null;
}

function renderProbe(
  root: Root,
  robotData: RobotData,
  onRobotLoaded: (robot: THREE.Object3D) => void,
  options: {
    sourceFile?: RobotFile;
    availableFiles?: RobotFile[];
    showVisual?: boolean;
    showCollision?: boolean;
    initialJointAngles?: Record<string, number>;
  } = {},
) {
  return root.render(
    React.createElement(
      r3fContext.Provider,
      { value: useR3fStore as unknown as React.ContextType<typeof r3fContext> },
      React.createElement(Probe, { robotData, onRobotLoaded, ...options }),
    ),
  );
}

async function flushAsyncWork() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCondition(condition: () => boolean, message: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await act(async () => {
      await flushAsyncWork();
    });

    if (condition()) {
      return;
    }
  }

  assert.fail(message);
}

test('useRendererBackend patches a link color edit without reloading the backend scene', async () => {
  const { dom, root } = createComponentRoot();
  const loadedRobots: THREE.Object3D[] = [];

  try {
    await act(async () => {
      renderProbe(root, createRobotData('#808080'), (robot) => {
        loadedRobots.push(robot);
      });
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected initial robot load to complete',
    );

    assert.equal(loadedRobots.length, 1);
    const runtimeRobot = loadedRobots[0];
    const mesh = findFirstMesh(runtimeRobot);
    assert.equal(getMeshHexColor(mesh), '#808080');

    await act(async () => {
      renderProbe(root, createRobotData('#12ab34'), (robot) => {
        loadedRobots.push(robot);
      });
    });
    await waitForCondition(
      () => getMeshHexColor(mesh) === '#12ab34',
      'expected link color patch to update the existing mesh',
    );

    assert.equal(loadedRobots.length, 1);
    assert.equal(getMeshHexColor(mesh), '#12ab34');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('useRendererBackend preserves root height when collision parsing reloads after joint pose changes', async () => {
  const { dom, root } = createComponentRoot();
  const loadedRobots: THREE.Object3D[] = [];
  const robotData = createPrismaticGroundRobotData();

  try {
    await act(async () => {
      renderProbe(root, robotData, (robot) => {
        loadedRobots.push(robot);
      });
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected initial robot load to complete',
    );

    const initialRootZ = loadedRobots[0].position.z;
    assert.ok(
      Math.abs(initialRootZ - 0.5) < 1e-6,
      `expected initial root z to align visual bottom to ground, got ${initialRootZ}`,
    );

    await act(async () => {
      renderProbe(
        root,
        robotData,
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          showCollision: true,
          initialJointAngles: {
            lift_joint: -0.4,
          },
        },
      );
    });
    await waitForCondition(
      () => loadedRobots.length === 2,
      'expected collision parsing change to reload the runtime robot',
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 120));
    });

    const reloadedRootZ = loadedRobots[1].position.z;
    assert.ok(
      Math.abs(reloadedRootZ - initialRootZ) < 1e-6,
      `expected reloaded root z ${reloadedRootZ} to preserve ${initialRootZ}`,
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('useRendererBackend patches a joint origin edit without reloading the backend scene', async () => {
  const { dom, root } = createComponentRoot();
  const loadedRobots: THREE.Object3D[] = [];

  try {
    await act(async () => {
      renderProbe(root, createJointOriginRobotData(0), (robot) => {
        loadedRobots.push(robot);
      });
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected initial robot load to complete',
    );

    const runtimeRobot = loadedRobots[0] as THREE.Object3D & {
      joints?: Record<string, THREE.Object3D>;
    };
    const runtimeJoint = runtimeRobot.joints?.lift_joint;
    assert.ok(runtimeJoint, 'expected runtime joint to exist');
    assert.equal(runtimeJoint.position.z, 0);

    await act(async () => {
      renderProbe(root, createJointOriginRobotData(1.25), (robot) => {
        loadedRobots.push(robot);
      });
    });
    await waitForCondition(
      () => Math.abs(runtimeJoint.position.z - 1.25) < 1e-6,
      'expected joint origin patch to update the existing runtime joint',
    );

    assert.equal(loadedRobots.length, 1);
    assert.equal(runtimeRobot.joints?.lift_joint, runtimeJoint);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('useRendererBackend patches a MJCF collision origin source edit without reloading the backend scene', async () => {
  const { dom, root } = createComponentRoot();
  const loadedRobots: THREE.Object3D[] = [];
  const mjcfSourceFile: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base"><geom pos="0.1 0 0" /></body></worldbody></mujoco>',
  };

  try {
    await act(async () => {
      renderProbe(
        root,
        createCollisionOriginRobotData(0.1),
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: mjcfSourceFile,
          availableFiles: [mjcfSourceFile],
          showVisual: false,
          showCollision: true,
        },
      );
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected initial robot load to complete',
    );

    const runtimeRobot = loadedRobots[0];
    const colliderGroup = findFirstColliderGroup(runtimeRobot);
    assert.equal(colliderGroup.position.x, 0.1);

    const patchedMjcfSourceFile: RobotFile = {
      ...mjcfSourceFile,
      content: '<mujoco><worldbody><body name="base"><geom pos="0.2 0 0" /></body></worldbody></mujoco>',
    };
    await act(async () => {
      renderProbe(
        root,
        createCollisionOriginRobotData(0.2),
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: patchedMjcfSourceFile,
          availableFiles: [patchedMjcfSourceFile],
          showVisual: false,
          showCollision: true,
        },
      );
    });
    await waitForCondition(
      () => Math.abs(colliderGroup.position.x - 0.2) < 1e-6,
      'expected collision origin patch to update the existing collider group',
    );

    assert.equal(loadedRobots.length, 1);
    assert.equal(findFirstColliderGroup(runtimeRobot), colliderGroup);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('useRendererBackend patches a MJCF visual dimension source edit without reloading the backend scene', async () => {
  const { dom, root } = createComponentRoot();
  const loadedRobots: THREE.Object3D[] = [];
  const mjcfSourceFile: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base"><geom type="box" size="0.5 0.5 0.5" /></body></worldbody></mujoco>',
  };

  try {
    await act(async () => {
      renderProbe(
        root,
        createRobotData('#808080'),
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: mjcfSourceFile,
          availableFiles: [mjcfSourceFile],
        },
      );
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected initial robot load to complete',
    );

    const runtimeRobot = loadedRobots[0];
    const mesh = findFirstMesh(runtimeRobot);
    assert.equal(mesh.scale.x, 1);

    const patchedRobotData = createRobotData('#808080');
    patchedRobotData.links.base.visual.dimensions = { x: 2, y: 1, z: 1 };
    const patchedMjcfSourceFile: RobotFile = {
      ...mjcfSourceFile,
      content: '<mujoco><worldbody><body name="base"><geom type="box" size="1 0.5 0.5" /></body></worldbody></mujoco>',
    };
    await act(async () => {
      renderProbe(
        root,
        patchedRobotData,
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: patchedMjcfSourceFile,
          availableFiles: [patchedMjcfSourceFile],
        },
      );
    });
    await waitForCondition(
      () => Math.abs(mesh.scale.x - 2) < 1e-6,
      'expected visual dimensions patch to update the existing mesh',
    );

    assert.equal(loadedRobots.length, 1);
    assert.equal(findFirstMesh(runtimeRobot), mesh);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('useRendererBackend accepts a MJCF inertial source edit without reloading the backend scene', async () => {
  const { dom, root } = createComponentRoot();
  const loadedRobots: THREE.Object3D[] = [];
  const mjcfSourceFile: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="base" mass="1" /></worldbody></mujoco>',
  };
  const initialRobotData = createRobotData('#808080');
  initialRobotData.links.base.inertial!.mass = 1;

  try {
    await act(async () => {
      renderProbe(
        root,
        initialRobotData,
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: mjcfSourceFile,
          availableFiles: [mjcfSourceFile],
        },
      );
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected initial robot load to complete',
    );

    const runtimeRobot = loadedRobots[0];
    const patchedRobotData = structuredClone(initialRobotData);
    patchedRobotData.links.base.inertial!.mass = 2;
    const patchedMjcfSourceFile: RobotFile = {
      ...mjcfSourceFile,
      content: '<mujoco><worldbody><body name="base" mass="2" /></worldbody></mujoco>',
    };
    await act(async () => {
      renderProbe(
        root,
        patchedRobotData,
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: patchedMjcfSourceFile,
          availableFiles: [patchedMjcfSourceFile],
        },
      );
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected inertial edit to avoid a second backend scene load',
    );

    assert.equal(loadedRobots[0], runtimeRobot);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('useRendererBackend patches a MJCF joint limit source edit without reloading the backend scene', async () => {
  const { dom, root } = createComponentRoot();
  const loadedRobots: THREE.Object3D[] = [];
  const mjcfSourceFile: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="payload"><joint name="lift_joint" range="-1 1" /></body></worldbody></mujoco>',
  };
  const initialRobotData = createJointOriginRobotData(0);
  initialRobotData.joints.lift_joint.type = JointType.REVOLUTE;
  initialRobotData.joints.lift_joint.axis = { x: 0, y: 0, z: 1 };
  initialRobotData.joints.lift_joint.limit = {
    lower: -1,
    upper: 1,
    effort: 10,
    velocity: 5,
  };

  try {
    await act(async () => {
      renderProbe(
        root,
        initialRobotData,
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: mjcfSourceFile,
          availableFiles: [mjcfSourceFile],
        },
      );
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected initial robot load to complete',
    );

    const runtimeRobot = loadedRobots[0] as THREE.Object3D & {
      joints?: Record<string, THREE.Object3D & { limit?: { lower: number; upper: number } }>;
    };
    const runtimeJoint = runtimeRobot.joints?.lift_joint;
    assert.ok(runtimeJoint, 'expected runtime joint to exist');
    assert.equal(runtimeJoint.limit?.upper, 1);

    const patchedRobotData = structuredClone(initialRobotData);
    patchedRobotData.joints.lift_joint.limit = {
      lower: -2,
      upper: 2,
      effort: 10,
      velocity: 5,
    };
    const patchedMjcfSourceFile: RobotFile = {
      ...mjcfSourceFile,
      content: '<mujoco><worldbody><body name="payload"><joint name="lift_joint" range="-2 2" /></body></worldbody></mujoco>',
    };
    await act(async () => {
      renderProbe(
        root,
        patchedRobotData,
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: patchedMjcfSourceFile,
          availableFiles: [patchedMjcfSourceFile],
        },
      );
    });
    await waitForCondition(
      () => Math.abs((runtimeJoint.limit?.upper ?? 0) - 2) < 1e-6,
      'expected joint limit patch to update the existing runtime joint',
    );

    assert.equal(loadedRobots.length, 1);
    assert.equal(runtimeRobot.joints?.lift_joint, runtimeJoint);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('useRendererBackend patches a MJCF joint type source edit without reloading the backend scene', async () => {
  const { dom, root } = createComponentRoot();
  const loadedRobots: THREE.Object3D[] = [];
  const mjcfSourceFile: RobotFile = {
    name: 'robot.xml',
    format: 'mjcf',
    content: '<mujoco><worldbody><body name="payload"><joint name="lift_joint" type="hinge" /></body></worldbody></mujoco>',
  };
  const initialRobotData = createJointOriginRobotData(0);
  initialRobotData.joints.lift_joint.type = JointType.REVOLUTE;
  initialRobotData.joints.lift_joint.axis = { x: 0, y: 0, z: 1 };

  try {
    await act(async () => {
      renderProbe(
        root,
        initialRobotData,
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: mjcfSourceFile,
          availableFiles: [mjcfSourceFile],
        },
      );
    });
    await waitForCondition(
      () => loadedRobots.length === 1,
      'expected initial robot load to complete',
    );

    const runtimeRobot = loadedRobots[0] as THREE.Object3D & {
      joints?: Record<string, THREE.Object3D & { jointType?: string }>;
    };
    const runtimeJoint = runtimeRobot.joints?.lift_joint;
    assert.ok(runtimeJoint, 'expected runtime joint to exist');
    assert.equal(runtimeJoint.jointType, JointType.REVOLUTE);

    const patchedRobotData = structuredClone(initialRobotData);
    patchedRobotData.joints.lift_joint.type = JointType.PRISMATIC;
    patchedRobotData.joints.lift_joint.axis = { x: 1, y: 0, z: 0 };
    const patchedMjcfSourceFile: RobotFile = {
      ...mjcfSourceFile,
      content: '<mujoco><worldbody><body name="payload"><joint name="lift_joint" type="slide" /></body></worldbody></mujoco>',
    };
    await act(async () => {
      renderProbe(
        root,
        patchedRobotData,
        (robot) => {
          loadedRobots.push(robot);
        },
        {
          sourceFile: patchedMjcfSourceFile,
          availableFiles: [patchedMjcfSourceFile],
        },
      );
    });
    await waitForCondition(
      () => runtimeJoint.jointType === JointType.PRISMATIC,
      'expected joint type patch to update the existing runtime joint',
    );

    assert.equal(loadedRobots.length, 1);
    assert.equal(runtimeRobot.joints?.lift_joint, runtimeJoint);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
