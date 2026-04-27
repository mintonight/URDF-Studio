import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import type { RobotState } from '@/types';
import { GeometryType, JointType } from '@/types';
import { useUIStore } from '@/store';
import { TreeEditor } from '../TreeEditor.tsx';

function createRobotState(): RobotState {
  return {
    name: 'demo',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [],
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
      child_link: {
        id: 'child_link',
        name: 'child_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [],
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {
      joint_1: {
        id: 'joint_1',
        name: 'joint_1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
        dynamics: { damping: 0, friction: 0 },
        hardware: {
          armature: 0,
          motorType: '',
          motorId: '',
          motorDirection: 1,
        },
      },
    },
    rootLinkId: 'base_link',
    selection: { type: 'link', id: 'base_link' },
  };
}

function createRobotStateWithoutJoints(): RobotState {
  return {
    name: 'demo',
    links: {
      base_link: {
        id: 'base_link',
        name: 'base_link',
        visible: true,
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        visualBodies: [],
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.4, y: 0.3, z: 0.2 },
          color: '#ff0000',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collisionBodies: [],
        inertial: {
          mass: 1,
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
          inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
        },
      },
    },
    joints: {},
    rootLinkId: 'base_link',
    selection: { type: 'link', id: 'base_link' },
  };
}

function createRobotStateWithJointCount(jointCount: number): RobotState {
  const robot = createRobotState();
  const links: RobotState['links'] = { ...robot.links };
  const joints: RobotState['joints'] = {};

  let previousLinkId = 'base_link';
  for (let index = 0; index < jointCount; index += 1) {
    const jointId = `joint_${index + 1}`;
    const childLinkId = `child_link_${index + 1}`;
    links[childLinkId] = {
      id: childLinkId,
      name: childLinkId,
      visible: true,
      visual: {
        type: GeometryType.BOX,
        dimensions: { x: 0.2, y: 0.2, z: 0.2 },
        color: '#00ff00',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      visualBodies: [],
      collision: {
        type: GeometryType.BOX,
        dimensions: { x: 0.2, y: 0.2, z: 0.2 },
        color: '#00ff00',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      },
      collisionBodies: [],
      inertial: {
        mass: 1,
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        inertia: { ixx: 1, ixy: 0, ixz: 0, iyy: 1, iyz: 0, izz: 1 },
      },
    };
    joints[jointId] = {
      id: jointId,
      name: jointId,
      type: JointType.REVOLUTE,
      parentLinkId: previousLinkId,
      childLinkId,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
      dynamics: { damping: 0, friction: 0 },
      hardware: {
        armature: 0,
        motorType: '',
        motorId: '',
        motorDirection: 1,
      },
    };
    previousLinkId = childLinkId;
  }

  return {
    ...robot,
    links,
    joints,
  };
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
  Object.defineProperty(globalThis, 'localStorage', {
    value: dom.window.localStorage,
    configurable: true,
  });
  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
  (globalThis as { SVGElement?: typeof SVGElement }).SVGElement = dom.window.SVGElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  if (!('attachEvent' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('detachEvent' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
      value: () => {},
      configurable: true,
    });
  }

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);
  return { dom, container, root };
}

async function renderTreeEditor(root: Root) {
  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 132,
    },
  });

  await act(async () => {
    root.render(
      <TreeEditor
        robot={createRobotState()}
        onSelect={() => {}}
        onAddChild={() => {}}
        onAddCollisionBody={() => {}}
        onDelete={() => {}}
        onNameChange={() => {}}
        onUpdate={() => {}}
        showVisual
        setShowVisual={() => {}}
        mode="editor"
        lang="en"
        theme="light"
        collapsed={false}
        onToggle={() => {}}
        showJointPanel
        onJointAngleChange={() => {}}
      />,
    );
  });
}

async function renderTreeEditorWithRobot(root: Root, robot: RobotState) {
  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 132,
    },
  });

  await act(async () => {
    root.render(
      <TreeEditor
        robot={robot}
        onSelect={() => {}}
        onAddChild={() => {}}
        onAddCollisionBody={() => {}}
        onDelete={() => {}}
        onNameChange={() => {}}
        onUpdate={() => {}}
        showVisual
        setShowVisual={() => {}}
        mode="editor"
        lang="en"
        theme="light"
        collapsed={false}
        onToggle={() => {}}
        showJointPanel
        onJointAngleChange={() => {}}
      />,
    );
  });
}

test('TreeEditor joint section persists its collapsed disclosure state', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderTreeEditor(root);

  const toggle = container.querySelector<HTMLButtonElement>(
    '[data-testid="tree-editor-joint-section-toggle"]',
  );
  assert.ok(toggle, 'joint section toggle should render');

  await act(async () => {
    toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });

  assert.equal(useUIStore.getState().panelSections.tree_editor_joint_panel, true);

  const content = container.querySelector<HTMLElement>(
    '[data-testid="tree-editor-joint-section-content"]',
  );
  assert.ok(content, 'joint section content should render');
  assert.match(content.className, /max-h-0/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('TreeEditor joint section exposes an invisible boundary resize handle', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderTreeEditor(root);

  const resizeHandle = container.querySelector<HTMLElement>(
    '[data-testid="tree-editor-joint-section-resize-handle"]',
  );
  assert.ok(resizeHandle, 'joint section boundary resize handle should render');
  assert.match(resizeHandle.className, /\bbg-transparent\b/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('TreeEditor joint section grows when dragging its boundary downward', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderTreeEditor(root);

  const resizeHandle = container.querySelector<HTMLElement>(
    '[data-testid="tree-editor-joint-section-resize-handle"]',
  );
  assert.ok(resizeHandle, 'joint section boundary resize handle should render');

  await act(async () => {
    resizeHandle.dispatchEvent(
      new dom.window.MouseEvent('mousedown', {
        bubbles: true,
        clientY: 200,
      }),
    );
    dom.window.document.dispatchEvent(
      new dom.window.MouseEvent('mousemove', {
        bubbles: true,
        clientY: 260,
      }),
    );
    dom.window.document.dispatchEvent(
      new dom.window.MouseEvent('mouseup', {
        bubbles: true,
      }),
    );
  });

  assert.equal(useUIStore.getState().panelLayout.treeJointPanelHeight, 192);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('TreeEditor joint section keeps the supplied height on its root container', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderTreeEditor(root);

  const sectionRoot = container.querySelector<HTMLElement>(
    '[data-testid="tree-editor-joint-section-content"]',
  )?.parentElement as HTMLDivElement | null;
  assert.ok(sectionRoot, 'joint section root should render');
  assert.equal(sectionRoot.style.height, '132px');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('TreeEditor joint section shows an empty state when there are no joints', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderTreeEditorWithRobot(root, createRobotStateWithoutJoints());

  const toggle = container.querySelector<HTMLElement>(
    '[data-testid="tree-editor-joint-section-toggle"]',
  );
  assert.ok(toggle, 'joint section toggle should still render');
  assert.match(container.textContent ?? '', /No joints yet/i);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('TreeEditor joint section root uses a flex column layout so the joint list can scroll', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderTreeEditorWithRobot(root, createRobotStateWithJointCount(8));

  const sectionRoot = container.querySelector<HTMLElement>(
    '[data-testid="tree-editor-joint-section-content"]',
  )?.parentElement as HTMLDivElement | null;
  assert.ok(sectionRoot, 'joint section root should render');
  assert.match(sectionRoot.className, /\bflex\b/);
  assert.match(sectionRoot.className, /\bflex-col\b/);
  assert.match(sectionRoot.className, /\boverflow-hidden\b/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('TreeEditor joint section keeps its list shrinkable inside the left sidebar', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderTreeEditor(root);

  const content = container.querySelector<HTMLElement>(
    '[data-testid="tree-editor-joint-section-content"]',
  );
  assert.ok(content, 'joint section content should render');

  const scrollViewport = content.firstElementChild as HTMLDivElement | null;
  assert.ok(scrollViewport, 'joint section scroll viewport should render');
  assert.match(
    scrollViewport.className,
    /\bmin-w-0\b/,
    'joint section scroll viewport should be allowed to shrink with the left sidebar width',
  );

  const jointCard = container.querySelector<HTMLElement>('[data-panel-hovered]');
  assert.ok(jointCard, 'joint section should render a joint card');
  const jointList = jointCard.parentElement as HTMLDivElement | null;
  assert.ok(jointList, 'joint list wrapper should render');
  assert.match(
    jointList.className,
    /\bmin-w-0\b/,
    'joint list wrapper should not hold the sidebar at its intrinsic width',
  );
  assert.match(
    jointList.className,
    /\bw-full\b/,
    'joint list wrapper should track the sidebar width',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
