import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK } from '@/types/constants';
import type { AssemblyState, RobotFile, RobotState } from '@/types';
import { GeometryType, JointType } from '@/types';
import {
  useAssemblySelectionStore,
  useRobotStore,
  useSelectionStore,
  useUIStore,
} from '@/store';

import { TreeEditor } from './TreeEditor.tsx';

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
  const htmlElementPrototype = dom.window.HTMLElement.prototype as HTMLElement & {
    attachEvent?: () => undefined;
    detachEvent?: () => undefined;
  };
  htmlElementPrototype.attachEvent = () => undefined;
  htmlElementPrototype.detachEvent = () => undefined;

  return dom;
}

function installFixedHeightResizeObserver(dom: JSDOM, height: number) {
  class FixedHeightResizeObserver {
    private readonly callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
    }

    observe(target: Element) {
      this.callback(
        [
          {
            target,
            contentRect: {
              width: 264,
              height,
              x: 0,
              y: 0,
              top: 0,
              right: 264,
              bottom: height,
              left: 0,
              toJSON: () => ({}),
            },
          } as ResizeObserverEntry,
        ],
        this as unknown as ResizeObserver,
      );
    }

    unobserve() {
      return undefined;
    }

    disconnect() {
      return undefined;
    }
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: FixedHeightResizeObserver,
    configurable: true,
  });
  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: FixedHeightResizeObserver,
    configurable: true,
  });
}

function clearResizeObserver(dom: JSDOM) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: undefined,
    configurable: true,
  });
  Object.defineProperty(dom.window, 'ResizeObserver', {
    value: undefined,
    configurable: true,
  });
}

function createRobotState(): RobotState {
  return {
    name: 'demo',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
  };
}

function createRobotStateWithJoint(): RobotState {
  return {
    name: 'demo',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
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

function createDeepRobotState(depth: number): RobotState {
  const links: RobotState['links'] = {
    base_link: {
      ...DEFAULT_LINK,
      id: 'base_link',
      name: 'base_link',
    },
  };
  const joints: RobotState['joints'] = {};

  let parentLinkId = 'base_link';
  for (let index = 1; index <= depth; index += 1) {
    const childLinkId = `piper_link_${index}`;
    const jointId = `piper_joint_${index}`;

    links[childLinkId] = {
      ...DEFAULT_LINK,
      id: childLinkId,
      name: childLinkId,
    };
    joints[jointId] = {
      id: jointId,
      name: jointId,
      type: JointType.FIXED,
      parentLinkId,
      childLinkId,
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      axis: { x: 0, y: 0, z: 1 },
      limit: { lower: 0, upper: 0, effort: 0, velocity: 0 },
      dynamics: { damping: 0, friction: 0 },
      hardware: {
        armature: 0,
        motorType: '',
        motorId: '',
        motorDirection: 1,
      },
    };
    parentLinkId = childLinkId;
  }

  return {
    name: 'piper',
    links,
    joints,
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
  };
}

function createRobotFile(name: string): RobotFile {
  return {
    name,
    format: 'urdf',
    content: '<robot name="demo"><link name="base_link" /></robot>',
  };
}

function createMeshFile(name: string): RobotFile {
  return {
    name,
    format: 'mesh',
    content: '',
  };
}

function createAssemblyState(): AssemblyState {
  return {
    name: 'demo_assembly',
    components: {
      comp_arm: {
        id: 'comp_arm',
        name: 'arm_component',
        sourceFile: 'robots/arm_component.urdf',
        robot: createRobotState(),
        visible: true,
      },
      comp_tool: {
        id: 'comp_tool',
        name: 'tool_component',
        sourceFile: 'robots/tool_component.urdf',
        robot: createRobotState(),
        visible: true,
      },
    },
    bridges: {},
  };
}

function createSingleComponentAssemblyState(): AssemblyState {
  const robot = createRobotStateWithJoint();
  robot.name = 'T1';

  return {
    name: 'T1',
    components: {
      comp_t1: {
        id: 'comp_t1',
        name: 'T1',
        sourceFile: 'test/mujoco_menagerie-main/booster_t1/t1.xml',
        robot,
        visible: true,
      },
    },
    bridges: {},
  };
}

async function clickByText(dom: JSDOM, container: HTMLElement, text: string) {
  const target = Array.from(dom.window.document.querySelectorAll('button, span')).find(
    (element) => element.textContent?.trim() === text,
  );
  assert.ok(target, `expected element with text "${text}"`);

  await act(async () => {
    target.dispatchEvent(
      new dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function clickButtonByTitle(dom: JSDOM, title: string) {
  const target = Array.from(dom.window.document.querySelectorAll('button')).find(
    (element) => element.getAttribute('title') === title,
  );
  assert.ok(target, `expected button with title "${title}"`);

  await act(async () => {
    target.dispatchEvent(
      new dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function findSectionRootByLabel(container: HTMLElement, label: string) {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
    (element) => element.textContent?.trim() === label,
  );
  assert.ok(labelElement, `expected section label "${label}"`);

  let current = labelElement.parentElement;
  while (current) {
    if (
      typeof current.className === 'string' &&
      current.className.includes('flex-col') &&
      current.className.includes('border-b')
    ) {
      return current;
    }
    current = current.parentElement;
  }

  assert.fail(`expected section root for label "${label}"`);
}

function findFlexSectionRootByLabel(container: HTMLElement, label: string) {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
    (element) => element.textContent?.trim() === label,
  );
  assert.ok(labelElement, `expected section label "${label}"`);

  let current = labelElement.parentElement;
  while (current) {
    if (current.style.flex) {
      return current;
    }
    current = current.parentElement;
  }

  assert.fail(`expected flex section root for label "${label}"`);
}

function renderTreeEditor(options: {
  root: Root;
  availableFiles: RobotFile[];
  onRequestLoadRobot: (
    file: RobotFile,
    intent: 'direct' | 'preview' | 'discard',
  ) =>
    | Promise<'loaded' | 'needs-preview-or-discard-confirm' | 'blocked'>
    | 'loaded'
    | 'needs-preview-or-discard-confirm'
    | 'blocked';
}) {
  return act(async () => {
    options.root.render(
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
        availableFiles={options.availableFiles}
        onRequestLoadRobot={options.onRequestLoadRobot}
      />,
    );
  });
}

test('TreeEditor asks whether to preview or discard before opening another library model with unsaved edits', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/arm_b.urdf');
  const requests: Array<{ fileName: string; intent: 'direct' | 'preview' | 'discard' }> = [];

  try {
    await renderTreeEditor({
      root,
      availableFiles: [targetFile],
      onRequestLoadRobot: async (file, intent) => {
        requests.push({ fileName: file.name, intent });
        return intent === 'direct' ? 'needs-preview-or-discard-confirm' : 'loaded';
      },
    });

    await clickByText(dom, container, 'arm_b.urdf');

    const dialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(dialog, 'expected unsaved model switch dialog to open');
    assert.equal(
      dialog.textContent?.includes('Current model has unsaved edits'),
      true,
    );

    await clickByText(dom, container, 'Discard and switch');

    assert.deepEqual(requests, [
      { fileName: 'robots/arm_b.urdf', intent: 'direct' },
      { fileName: 'robots/arm_b.urdf', intent: 'discard' },
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor shows and edits the robot name from the structure tree root', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);
  const nameChanges: string[] = [];

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onNameChange={(name) => nameChanges.push(name)}
          onUpdate={() => {}}
          showVisual
          setShowVisual={() => {}}
          mode="editor"
          lang="en"
          theme="light"
          collapsed={false}
          onToggle={() => {}}
          availableFiles={[]}
        />,
      );
    });

    assert.equal(container.textContent?.includes('Robot Name'), false);
    const robotName = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent?.trim() === 'demo',
    );
    assert.ok(robotName, 'expected robot name in structure tree');

    await act(async () => {
      robotName.dispatchEvent(
        new dom.window.MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const input = container.querySelector<HTMLInputElement>('input');
    assert.ok(input, 'expected robot name edit input');
    assert.equal(input.value, 'demo');

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        dom.window.HTMLInputElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(input, 'renamed_demo');
      input.dispatchEvent(
        new dom.window.FocusEvent('focusout', { bubbles: true, cancelable: true }),
      );
    });

    assert.deepEqual(nameChanges, ['renamed_demo']);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor opens a clickable structure graph from the structure tree header', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);
  const selections: Array<{ type: 'link' | 'joint'; id: string }> = [];
  const longJointName = 'hip_roll_joint_with_full_display_name_for_graph_view';
  const robotWithLongJointName = createRobotStateWithJoint();
  robotWithLongJointName.joints.joint_1.name = longJointName;

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={robotWithLongJointName}
          onSelect={(type, id) => selections.push({ type, id })}
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
          availableFiles={[]}
        />,
      );
    });

    await clickButtonByTitle(dom, 'Open Structure Graph');

    const dialog = dom.window.document.querySelector(
      '[role="dialog"][aria-label="Structure Graph"]',
    );
    assert.ok(dialog, 'expected structure graph dialog to open');
    assert.equal(
      dialog.getAttribute('aria-modal'),
      'false',
      'structure graph should be a floating window instead of a blocking modal overlay',
    );
    assert.equal(dialog.textContent?.includes('base_link'), true);
    assert.equal(dialog.textContent?.includes(longJointName), true);
    assert.equal(dialog.textContent?.includes(`${longJointName.slice(0, 15)}...`), false);
    assert.equal(dialog.textContent?.includes('child_link'), true);

    const graphLayer = dialog.querySelector('[data-testid="structure-graph-layer"]');
    assert.ok(graphLayer, 'expected structure graph layer');
    const initialTransform = graphLayer.getAttribute('transform') ?? '';
    const transformValues = initialTransform.match(/translate\(([-\d.]+) ([-\d.]+)\) scale/);
    assert.ok(transformValues, 'expected a translated vertical tree graph');
    assert.equal(
      Number(transformValues[2]) < 40,
      true,
      'vertical tree should start near the top of the graph surface',
    );
    assert.equal(
      dialog.querySelector('[data-structure-graph-accent]'),
      null,
      'structure graph nodes should not render the old colored side strip',
    );

    const canvas = dialog.querySelector('[data-testid="structure-graph-canvas"]');
    assert.ok(canvas, 'expected zoomable graph canvas');
    const initialScale = Number(initialTransform.match(/scale\(([-\d.]+)\)/)?.[1] ?? '0');

    await act(async () => {
      canvas.dispatchEvent(
        new dom.window.WheelEvent('wheel', {
          bubbles: true,
          cancelable: true,
          deltaY: -120,
          clientX: 240,
          clientY: 180,
        }),
      );
    });

    assert.notEqual(
      graphLayer.getAttribute('transform'),
      initialTransform,
      'mouse wheel should zoom the graph canvas',
    );
    const zoomedScale = Number(
      graphLayer.getAttribute('transform')?.match(/scale\(([-\d.]+)\)/)?.[1] ?? '0',
    );
    assert.equal(
      zoomedScale > initialScale * 1.45,
      true,
      'mouse wheel zoom should stay responsive inside the graph canvas',
    );

    const childLinkNode = dialog.querySelector('[role="button"][aria-label="Link child_link"]');
    assert.ok(childLinkNode, 'expected child link graph node');
    const childRectsBeforeHover = childLinkNode.querySelectorAll('rect').length;

    await act(async () => {
      childLinkNode.dispatchEvent(
        new dom.window.MouseEvent('mouseover', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.equal(
      childLinkNode.querySelectorAll('rect').length > childRectsBeforeHover,
      true,
      'structure graph nodes should show an immediate hover surface',
    );

    await act(async () => {
      childLinkNode.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const jointNode = dialog.querySelector(
      `[role="button"][aria-label="Joint ${longJointName}"]`,
    );
    assert.ok(jointNode, 'expected joint graph node');

    await act(async () => {
      jointNode.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(selections, [
      { type: 'link', id: 'child_link' },
      { type: 'joint', id: 'joint_1' },
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor structure graph renders a single imported robot as a top-level component', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);
  const selections: Array<{ type: 'link' | 'joint'; id: string }> = [];

  useSelectionStore.setState({ selection: { type: null, id: null } });
  useAssemblySelectionStore.getState().clearSelection();

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
          onSelect={(type, id) => selections.push({ type, id })}
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
          availableFiles={[]}
          assemblyState={createSingleComponentAssemblyState()}
          onAddComponent={() => {}}
        />,
      );
    });

    await clickButtonByTitle(dom, 'Open Structure Graph');

    const dialog = dom.window.document.querySelector(
      '[role="dialog"][aria-label="Structure Graph"]',
    );
    assert.ok(dialog, 'expected structure graph dialog to open');

    assert.equal(dialog.querySelector('[aria-label="Assembly T1"]'), null);
    assert.equal(dialog.querySelector('[aria-label="Robot T1"]'), null);

    const componentNode = dialog.querySelector('[role="button"][aria-label="Component T1"]');
    assert.ok(componentNode, 'expected the single import to render as a top-level component');
    assert.ok(dialog.querySelector('[role="button"][aria-label="Link base_link"]'));
    assert.ok(dialog.querySelector('[role="button"][aria-label="Joint joint_1"]'));

    await act(async () => {
      componentNode.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(useAssemblySelectionStore.getState().selection, {
      type: 'component',
      id: 'comp_t1',
    });
    assert.deepEqual(selections, [{ type: 'link', id: 'base_link' }]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor structure graph renders workspace assemblies as top-level components', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);
  const selections: Array<{ type: 'link' | 'joint'; id: string }> = [];

  useSelectionStore.setState({ selection: { type: null, id: null } });
  useAssemblySelectionStore.getState().clearSelection();

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotState()}
          onSelect={(type, id) => selections.push({ type, id })}
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
          availableFiles={[]}
          assemblyState={createAssemblyState()}
          onAddComponent={() => {}}
        />,
      );
    });

    await clickButtonByTitle(dom, 'Open Structure Graph');

    const dialog = dom.window.document.querySelector(
      '[role="dialog"][aria-label="Structure Graph"]',
    );
    assert.ok(dialog, 'expected structure graph dialog to open');

    assert.equal(dialog.querySelector('[aria-label="Assembly demo_assembly"]'), null);
    const armComponentNode = dialog.querySelector(
      '[role="button"][aria-label="Component arm_component"]',
    );
    const toolComponentNode = dialog.querySelector(
      '[role="button"][aria-label="Component tool_component"]',
    );
    assert.ok(armComponentNode, 'expected arm component as a top-level graph node');
    assert.ok(toolComponentNode, 'expected tool component as a top-level graph node');

    await act(async () => {
      armComponentNode.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(useAssemblySelectionStore.getState().selection, {
      type: 'component',
      id: 'comp_arm',
    });
    assert.deepEqual(selections, [{ type: 'link', id: 'base_link' }]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor forwards the preview decision for pending library switches', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/arm_c.urdf');
  const requests: Array<{ fileName: string; intent: 'direct' | 'preview' | 'discard' }> = [];

  try {
    await renderTreeEditor({
      root,
      availableFiles: [targetFile],
      onRequestLoadRobot: async (file, intent) => {
        requests.push({ fileName: file.name, intent });
        return intent === 'direct' ? 'needs-preview-or-discard-confirm' : 'loaded';
      },
    });

    await clickByText(dom, container, 'arm_c.urdf');
    await clickByText(dom, container, 'Preview target model');

    assert.deepEqual(requests, [
      { fileName: 'robots/arm_c.urdf', intent: 'direct' },
      { fileName: 'robots/arm_c.urdf', intent: 'preview' },
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor opens robot files as the current model and reserves add for assembly insertion', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/arm_preview.urdf');
  const previewRequests: string[] = [];
  const loadRequests: Array<{ fileName: string; intent: 'direct' | 'preview' | 'discard' }> = [];
  const addRequests: string[] = [];

  try {
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
          availableFiles={[targetFile]}
          onLoadRobot={(file) => {
            previewRequests.push(file.name);
          }}
          onRequestLoadRobot={async (file, intent) => {
            loadRequests.push({ fileName: file.name, intent });
            return 'loaded' as const;
          }}
          onAddComponent={(file) => {
            addRequests.push(file.name);
          }}
        />,
      );
    });

    await clickByText(dom, container, 'arm_preview.urdf');

    assert.deepEqual(previewRequests, []);
    assert.deepEqual(loadRequests, [{ fileName: 'robots/arm_preview.urdf', intent: 'direct' }]);
    assert.deepEqual(addRequests, []);

    await clickButtonByTitle(dom, 'Load to Workspace');

    assert.deepEqual(addRequests, ['robots/arm_preview.urdf']);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor renders workspace components and bridges inside the single structure tree', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
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
          availableFiles={[]}
          assemblyState={createAssemblyState()}
          onAddComponent={() => {}}
        />,
      );
    });

    const structureTreeLabels = Array.from(container.querySelectorAll('span')).filter(
      (element) => element.textContent?.trim() === 'Structure Tree',
    );
    assert.equal(structureTreeLabels.length, 1);
    assert.doesNotMatch(container.textContent ?? '', /Assembly View/);
    assert.doesNotMatch(container.textContent ?? '', /Components/);
    assert.match(container.textContent ?? '', /arm_component/);
    assert.match(container.textContent ?? '', /Bridges/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor keeps deep structure rows constrained to the sidebar width', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useSelectionStore.setState({ selection: { type: null, id: null } });
  const deepRobot = createDeepRobotState(8);
  useRobotStore.getState().setRobot(deepRobot, { skipHistory: true, resetHistory: true });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={deepRobot}
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
          availableFiles={[]}
        />,
      );
    });

    const deepestLabel = container.querySelector(
      'span[title="piper_link_8"]',
    ) as HTMLSpanElement | null;
    assert.ok(deepestLabel, 'deep imported branches should render expanded by default');

    const structureScrollArea = deepestLabel.closest('.custom-scrollbar') as HTMLElement | null;
    assert.ok(structureScrollArea, 'deep label should be inside the structure tree scroll area');
    assert.match(
      structureScrollArea.className,
      /\boverflow-x-hidden\b/,
      'structure rows should truncate inside the sidebar instead of requiring horizontal scrolling',
    );

    const widthWrapper = structureScrollArea.firstElementChild as HTMLElement | null;
    assert.ok(widthWrapper, 'structure scroll area should have a width wrapper');
    assert.match(widthWrapper.className, /\bw-full\b/);
    assert.match(widthWrapper.className, /\bmin-w-0\b/);
    assert.ok(
      !/\bmin-w-max\b/.test(widthWrapper.className),
      'structure tree should not force max-content width for deep branches',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    useRobotStore.getState().resetRobot(createRobotState());
    dom.window.close();
  }
});

test('TreeEditor keeps non-robot asset row clicks as previews', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createMeshFile('assets/poster.png');
  const previewRequests: string[] = [];
  const loadRequests: Array<{ fileName: string; intent: 'direct' | 'preview' | 'discard' }> = [];

  try {
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
          availableFiles={[targetFile]}
          onLoadRobot={(file) => {
            previewRequests.push(file.name);
          }}
          onRequestLoadRobot={async (file, intent) => {
            loadRequests.push({ fileName: file.name, intent });
            return 'loaded' as const;
          }}
          onAddComponent={() => {}}
        />,
      );
    });

    await clickByText(dom, container, 'poster.png');

    assert.deepEqual(previewRequests, ['assets/poster.png']);
    assert.deepEqual(loadRequests, []);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor uses an invisible edge hit area for the file browser resize handle', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeFileBrowserHeight: 216,
      treePanelHeightMode: 'custom',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await renderTreeEditor({
      root,
      availableFiles: [],
      onRequestLoadRobot: () => 'loaded',
    });

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-file-browser-resize-handle"]',
    );
    assert.ok(resizeHandle, 'file browser resize handle should render');
    assert.match(resizeHandle.className, /\bbg-transparent\b/);
    assert.ok(!/\bbg-border-black\b/.test(resizeHandle.className));

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
          clientY: 20,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', {
          bubbles: true,
        }),
      );
    });

    assert.equal(useUIStore.getState().panelLayout.treeFileBrowserHeight, 40);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor sidebar resize handle spans the full sidebar with a thin visible rail', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeSidebarWidth: 288,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await renderTreeEditor({
      root,
      availableFiles: [],
      onRequestLoadRobot: () => 'loaded',
    });

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-sidebar-resize-handle"]',
    );
    assert.ok(resizeHandle, 'sidebar resize handle should render');
    assert.match(resizeHandle.className, /\btop-0\b/);
    assert.match(resizeHandle.className, /\bbottom-0\b/);
    assert.match(resizeHandle.className, /\bcursor-col-resize\b/);
    assert.ok(
      !/\bhover:bg-/.test(resizeHandle.className),
      'the broad hit area should stay visually transparent on hover',
    );

    const visibleRail = resizeHandle.querySelector<HTMLElement>(
      '[data-testid="tree-editor-sidebar-resize-rail"]',
    );
    assert.ok(visibleRail, 'sidebar resize handle should render a separate visible rail');
    assert.match(visibleRail.className, /\btop-0\b/);
    assert.match(visibleRail.className, /\bbottom-0\b/);
    assert.match(visibleRail.className, /\bw-px\b/);
    assert.match(visibleRail.className, /\bgroup-hover:bg-system-blue\/50\b/);

    await act(async () => {
      resizeHandle.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          clientX: 288,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mousemove', {
          bubbles: true,
          clientX: 338,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', {
          bubbles: true,
        }),
      );
    });

    assert.equal(useUIStore.getState().panelLayout.treeSidebarWidth, 338);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor previews sidebar width without committing store updates until drag end', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeSidebarWidth: 288,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await renderTreeEditor({
      root,
      availableFiles: [],
      onRequestLoadRobot: () => 'loaded',
    });

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-sidebar-resize-handle"]',
    );
    assert.ok(resizeHandle, 'sidebar resize handle should render');
    const sidebar = resizeHandle.parentElement as HTMLElement | null;
    assert.ok(sidebar, 'resize handle should live inside the sidebar element');

    await act(async () => {
      resizeHandle.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          clientX: 288,
        }),
      );
    });

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mousemove', {
          bubbles: true,
          clientX: 338,
        }),
      );
    });

    assert.equal(sidebar.style.width, '338px');
    assert.equal(
      useUIStore.getState().panelLayout.treeSidebarWidth,
      288,
      'drag preview should not write every mousemove into the global UI store',
    );

    await act(async () => {
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', {
          bubbles: true,
        }),
      );
    });

    assert.equal(useUIStore.getState().panelLayout.treeSidebarWidth, 338);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor lets the joint section grow by dragging the boundary downward', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 132,
      treePanelHeightMode: 'custom',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
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

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-resize-handle"]',
    );
    assert.ok(resizeHandle, 'joint section resize handle should render');
    assert.match(resizeHandle.className, /\bbg-transparent\b/);

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
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor balances the initial asset, joint, and structure sections', async () => {
  const dom = installDom();
  installFixedHeightResizeObserver(dom, 720);
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeFileBrowserHeight: 216,
      treeJointPanelHeight: 132,
      treePanelHeightMode: 'balanced',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
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

    const fileBrowserRoot = findSectionRootByLabel(container, 'Asset Library');
    const jointSectionRoot = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-content"]',
    )?.parentElement as HTMLDivElement | null;
    assert.ok(jointSectionRoot, 'joint section root should render');

    assert.equal(fileBrowserRoot.style.height, '240px');
    assert.equal(jointSectionRoot.style.height, '240px');
    assert.equal(useUIStore.getState().panelLayout.treePanelHeightMode, 'balanced');
  } finally {
    await act(async () => {
      root.unmount();
    });
    clearResizeObserver(dom);
    dom.window.close();
  }
});

test('TreeEditor switches balanced sections to persisted custom heights after drag', async () => {
  const dom = installDom();
  installFixedHeightResizeObserver(dom, 720);
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeFileBrowserHeight: 216,
      treeJointPanelHeight: 132,
      treePanelHeightMode: 'balanced',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
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

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-resize-handle"]',
    );
    assert.ok(resizeHandle, 'joint section resize handle should render');

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

    assert.equal(useUIStore.getState().panelLayout.treePanelHeightMode, 'custom');
    assert.equal(useUIStore.getState().panelLayout.treeFileBrowserHeight, 240);
    assert.equal(useUIStore.getState().panelLayout.treeJointPanelHeight, 300);
  } finally {
    await act(async () => {
      root.unmount();
    });
    clearResizeObserver(dom);
    dom.window.close();
  }
});

test('TreeEditor restores file browser and structure disclosure state after remounting', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);
  let remountedRoot: Root | null = null as Root | null;

  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeFileBrowserHeight: 216,
      treePanelHeightMode: 'custom',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/persisted_sidebar.urdf');

  try {
    await renderTreeEditor({
      root,
      availableFiles: [targetFile],
      onRequestLoadRobot: () => 'loaded',
    });

    assert.match(container.textContent ?? '', /persisted_sidebar\.urdf/);
    assert.match(container.textContent ?? '', /base_link/);

    await clickByText(dom, container, 'Asset Library');
    await clickByText(dom, container, 'Structure Tree');

    assert.equal(useUIStore.getState().panelSections.tree_editor_file_browser, true);
    assert.equal(useUIStore.getState().panelSections.tree_editor_structure, true);

    await act(async () => {
      root.unmount();
    });

    remountedRoot = createRoot(container);

    await renderTreeEditor({
      root: remountedRoot,
      availableFiles: [targetFile],
      onRequestLoadRobot: () => 'loaded',
    });

    assert.doesNotMatch(container.textContent ?? '', /persisted_sidebar\.urdf/);
    assert.doesNotMatch(container.textContent ?? '', /base_link/);
  } finally {
    await act(async () => {
      remountedRoot?.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor keeps the file browser at its fixed height when the structure tree is collapsed', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeFileBrowserHeight: 216,
      treePanelHeightMode: 'custom',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/sidebar-height-lock.urdf');

  try {
    await renderTreeEditor({
      root,
      availableFiles: [targetFile],
      onRequestLoadRobot: () => 'loaded',
    });

    await clickByText(dom, container, 'Structure Tree');

    const fileBrowserRoot = findSectionRootByLabel(container, 'Asset Library');
    assert.doesNotMatch(
      fileBrowserRoot.className,
      /\bflex-1\b/,
      'file browser should not absorb the freed space when the structure tree collapses',
    );
    assert.match(
      fileBrowserRoot.className,
      /\bshrink-0\b/,
      'file browser should keep its fixed-height layout when the structure tree collapses',
    );
    assert.equal(
      fileBrowserRoot.style.height,
      '216px',
      'file browser should keep its stored height so the structure tree collapses upward',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor structure section avoids animating its full flex layout when toggled', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await renderTreeEditor({
      root,
      availableFiles: [],
      onRequestLoadRobot: () => 'loaded',
    });

    const structureRoot = findFlexSectionRootByLabel(container, 'Structure Tree');
    assert.doesNotMatch(
      structureRoot.className,
      /\btransition-all\b/,
      'structure section should not animate full layout properties because that makes the sidebar jitter on collapse/expand',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor keeps the structure header height and chevron size stable when a source file is shown', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
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
          currentFileName="robots/imports/very_long_robot_filename_that_should_truncate_cleanly.urdf"
        />,
      );
    });

    const structureLabel = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
      (element) => element.textContent?.trim() === 'Structure Tree',
    );
    assert.ok(structureLabel, 'structure section label should render');

    const structureHeaderLeft = structureLabel.parentElement;
    assert.ok(structureHeaderLeft, 'structure header left section should render');
    assert.match(
      structureHeaderLeft.className,
      /\bflex-1\b/,
      'structure header left section should absorb the remaining width',
    );
    assert.match(
      structureHeaderLeft.className,
      /\boverflow-hidden\b/,
      'structure header left section should truncate long source file names instead of shrinking icons',
    );

    const structureHeader = structureHeaderLeft.parentElement as HTMLElement | null;
    assert.ok(structureHeader, 'structure header should render');
    assert.match(
      structureHeader.className,
      /\bh-8\b/,
      'structure header should keep a fixed height when the source file chip appears',
    );

    const chevron = structureHeaderLeft.querySelector('svg');
    assert.ok(chevron, 'structure header chevron should render');
    assert.match(
      chevron.getAttribute('class') ?? '',
      /\bshrink-0\b/,
      'structure header chevron should not shrink when the source file chip is visible',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor joint section can grow past the old compact cap when dragged downward', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 240,
      treePanelHeightMode: 'custom',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
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

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-resize-handle"]',
    );
    assert.ok(resizeHandle, 'joint section resize handle should render');

    await act(async () => {
      resizeHandle.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          clientY: 140,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mousemove', {
          bubbles: true,
          clientY: 320,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', {
          bubbles: true,
        }),
      );
    });

    assert.equal(useUIStore.getState().panelLayout.treeJointPanelHeight, 420);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor still renders the joint section when the robot has no joints', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 132,
      treePanelHeightMode: 'custom',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
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

    const jointToggle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-toggle"]',
    );
    assert.ok(jointToggle, 'joint section should render even without joints');

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-resize-handle"]',
    );
    assert.ok(resizeHandle, 'joint section boundary handle should still render');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor renders the joint section before the structure section so collapsing it does not move the joint header', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 132,
      treePanelHeightMode: 'custom',
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
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

    const structureLabel = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
      (element) => element.textContent?.trim() === 'Structure Tree',
    );
    const jointToggle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-toggle"]',
    );
    assert.ok(structureLabel, 'structure section label should render');
    assert.ok(jointToggle, 'joint section toggle should render');

    const structureHeader = structureLabel.closest<HTMLElement>('div');
    const jointHeader = jointToggle.closest<HTMLElement>('div');
    assert.ok(structureHeader, 'structure section header should render');
    assert.ok(jointHeader, 'joint section header should render');
    assert.equal(
      Boolean(
        jointHeader.compareDocumentPosition(structureHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      true,
      'joint section should render before the structure section so the structure tree moves up when the joint content collapses',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
