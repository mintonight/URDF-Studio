import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { useAssemblySelectionStore } from '@/store/assemblySelectionStore';
import { useSelectionStore } from '@/store/selectionStore';
import {
  DEFAULT_JOINT,
  DEFAULT_LINK,
  GeometryType,
  JointType,
  type AssemblyState,
  type RobotData,
  type UrdfJoint,
} from '@/types';
import { AssemblyTreeView } from './AssemblyTreeView.tsx';

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
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent = dom.window.KeyboardEvent;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(dom.window.HTMLElement.prototype, 'attachEvent', {
    value: () => {},
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'detachEvent', {
    value: () => {},
    configurable: true,
  });

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function createRobot(name: string, rootLinkId = 'base_link'): RobotData {
  return {
    name,
    rootLinkId,
    links: {
      [rootLinkId]: {
        ...DEFAULT_LINK,
        id: rootLinkId,
        name: rootLinkId,
      },
    },
    joints: {},
    materials: {},
    closedLoopConstraints: [],
  };
}

function createAssemblyState(): AssemblyState {
  const leftRootLinkId = 'comp_left_base_link';
  const rightRootLinkId = 'comp_right_base_link';
  const bridgeJoint: UrdfJoint = {
    ...DEFAULT_JOINT,
    id: 'bridge_1',
    name: 'bridge_alpha',
    type: JointType.FIXED,
    parentLinkId: leftRootLinkId,
    childLinkId: rightRootLinkId,
  };

  return {
    name: 'my_Robot',
    components: {
      comp_left: {
        id: 'comp_left',
        name: 'arm_module',
        sourceFile: 'robots/arm.usd',
        robot: createRobot('arm_module', leftRootLinkId),
      },
      comp_right: {
        id: 'comp_right',
        name: 'hand_module',
        sourceFile: 'robots/hand.usd',
        robot: createRobot('hand_module', rightRootLinkId),
      },
    },
    bridges: {
      bridge_1: {
        id: 'bridge_1',
        name: 'bridge_alpha',
        parentComponentId: 'comp_left',
        parentLinkId: 'base_link',
        childComponentId: 'comp_right',
        childLinkId: 'base_link',
        joint: bridgeJoint,
      },
    },
  };
}

function createSingleComponentAssemblyState(): AssemblyState {
  const assemblyState = createAssemblyState();
  return {
    ...assemblyState,
    components: {
      comp_left: assemblyState.components.comp_left,
    },
    bridges: {},
  };
}

function createNamespacedMjcfComponentAssemblyState(): AssemblyState {
  return {
    name: 't1_workspace',
    components: {
      comp_t1: {
        id: 'comp_t1',
        name: 'T1',
        sourceFile: 'test/mujoco_menagerie-main/booster_t1/t1.xml',
        robot: {
          name: 'T1',
          rootLinkId: 'comp_t1_world',
          links: {
            comp_t1_world: {
              ...DEFAULT_LINK,
              id: 'comp_t1_world',
              name: 'world',
              visual: {
                ...DEFAULT_LINK.visual,
                type: GeometryType.NONE,
              },
              collision: {
                ...DEFAULT_LINK.collision,
                type: GeometryType.NONE,
              },
              inertial: {
                ...DEFAULT_LINK.inertial,
                mass: 0,
              },
            },
            comp_t1_Trunk: {
              ...DEFAULT_LINK,
              id: 'comp_t1_Trunk',
              name: 't1_Trunk',
            },
          },
          joints: {
            comp_t1_joint_0: {
              ...DEFAULT_JOINT,
              id: 'comp_t1_joint_0',
              name: 't1_joint_0',
              type: JointType.FLOATING,
              parentLinkId: 'comp_t1_world',
              childLinkId: 'comp_t1_Trunk',
            },
          },
          materials: {},
          closedLoopConstraints: [],
          inspectionContext: {
            sourceFormat: 'mjcf',
          },
        },
      },
    },
    bridges: {},
  };
}

function findButtonByText(text: string): HTMLButtonElement | null {
  return Array.from(document.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | null;
}

function findRowByTitle(container: HTMLElement, title: string): HTMLDivElement | null {
  const node = container.querySelector(`[title="${title}"]`);
  let current = node?.parentElement ?? null;
  while (current && current !== container) {
    if (current.tagName === 'DIV' && current.className.includes('cursor-pointer')) {
      return current as HTMLDivElement;
    }
    current = current.parentElement;
  }
  return node?.closest('div') as HTMLDivElement | null;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = input.ownerDocument.defaultView?.HTMLInputElement.prototype;
  const valueSetter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    : undefined;

  assert.ok(valueSetter, 'HTMLInputElement value setter should exist');
  valueSetter.call(input, value);
}

function getReactProps(node: Element): Record<string, unknown> {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'React props key should exist on rendered element');
  return (node as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown>;
}

function dispatchReactChange(input: HTMLInputElement, value: string) {
  setInputValue(input, value);
  const reactProps = getReactProps(input);
  const onChange = reactProps.onChange;
  assert.equal(typeof onChange, 'function', 'React onChange handler should exist');

  (onChange as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactKeyDown(input: HTMLInputElement, key: string) {
  const reactProps = getReactProps(input);
  const onKeyDown = reactProps.onKeyDown;
  assert.equal(typeof onKeyDown, 'function', 'React onKeyDown handler should exist');

  (
    onKeyDown as (event: {
      key: string;
      target: HTMLInputElement;
      currentTarget: HTMLInputElement;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void
  )({
    key,
    target: input,
    currentTarget: input,
    preventDefault: () => {},
    stopPropagation: () => {},
  });
}

function dispatchReactMouseHandler(node: Element, handlerName: 'onMouseEnter' | 'onMouseLeave') {
  const reactProps = getReactProps(node);
  const handler = reactProps[handlerName];
  assert.equal(typeof handler, 'function', `React ${handlerName} handler should exist`);

  (
    handler as (event: {
      currentTarget: Element;
      target: Element;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void
  )({
    currentTarget: node,
    target: node,
    preventDefault: () => {},
    stopPropagation: () => {},
  });
}

test('AssemblyTreeView supports assembly rename and bridge context menu actions', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    const removedBridges: string[] = [];

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={(id) => {
            removedBridges.push(id);
          }}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    const assemblyLabel = container.querySelector('[title="my_Robot"]') as HTMLSpanElement | null;
    assert.ok(assemblyLabel, 'assembly label should render');
    assert.equal(
      assemblyLabel.className.includes('uppercase'),
      false,
      'assembly label should not force uppercase styling',
    );

    const assemblyRow = findRowByTitle(container, 'my_Robot');
    assert.ok(assemblyRow, 'assembly row should render');

    await act(async () => {
      assemblyRow.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 120,
          clientY: 72,
        }),
      );
    });

    const renameAssemblyButton = findButtonByText(translations.en.rename);
    assert.ok(renameAssemblyButton, 'assembly context menu should expose rename');

    await act(async () => {
      renameAssemblyButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    const assemblyInput = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(assemblyInput, 'assembly rename input should render');

    await act(async () => {
      dispatchReactKeyDown(assemblyInput, 'Escape');
    });

    const bridgeRow = findRowByTitle(container, 'bridge_alpha');
    assert.ok(bridgeRow, 'bridge row should render');

    await act(async () => {
      bridgeRow.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 156,
          clientY: 138,
        }),
      );
    });

    const renameBridgeButton = findButtonByText(translations.en.rename);
    assert.ok(renameBridgeButton, 'bridge context menu should expose rename');

    const deleteBridgeButton = findButtonByText(translations.en.deleteBranch);
    assert.ok(deleteBridgeButton, 'bridge context menu should expose delete');

    await act(async () => {
      deleteBridgeButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(removedBridges, ['bridge_1']);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView promotes components to top-level structure rows', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    assert.doesNotMatch(
      container.textContent ?? '',
      /Components/,
      'components should appear directly in the structure tree, not inside a Components folder',
    );
    assert.match(container.textContent ?? '', /arm_module/);
    assert.match(container.textContent ?? '', /hand_module/);
    assert.match(container.textContent ?? '', /Bridges/);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView keeps the create-bridge action visible in narrow sidebars', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={() => {}}
          onCreateBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    const createBridgeButton = container.querySelector<HTMLButtonElement>(
      `button[title="${translations.en.createBridge}"]`,
    );
    assert.ok(createBridgeButton, 'create bridge button should render');
    assert.match(
      createBridgeButton.className,
      /\bshrink-0\b/,
      'create bridge action must not be squeezed out by the bridge label/count',
    );

    const buttonLabel = createBridgeButton.querySelector('span');
    assert.ok(buttonLabel, 'create bridge button should keep a text label for wider sidebars');
    assert.match(
      buttonLabel.className,
      /\bhidden\b/,
      'narrow sidebars should keep the icon visible by hiding the text label first',
    );
    assert.match(
      buttonLabel.className,
      /@\[260px\]:inline/,
      'button text should reappear when the sidebar has enough width',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView hides bridge controls when the workspace has only one component and no bridges', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createSingleComponentAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={() => {}}
          onCreateBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    assert.doesNotMatch(container.textContent ?? '', /Bridges/);
    assert.equal(container.querySelector(`button[title="${translations.en.createBridge}"]`), null);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView shows original names inside namespaced MJCF components', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createNamespacedMjcfComponentAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={() => {}}
          onCreateBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    const expandComponentButton = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${translations.en.expand} T1"]`,
    );
    assert.ok(expandComponentButton, 'component expand button should render');

    await act(async () => {
      expandComponentButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.ok(
      container.querySelector('[title="joint_0 · Floating"]'),
      'component-prefixed MJCF joint names should display as their original source names',
    );
    assert.equal(container.querySelector('[title="t1_joint_0 · Floating"]'), null);
    assert.equal(container.querySelector('[title="world"]'), null);
    assert.equal(
      Array.from(container.querySelectorAll('[title]')).some(
        (element) => element.getAttribute('title') === 't1',
      ),
      false,
    );
    assert.ok(container.querySelector('[title="Trunk"]'));
    assert.equal(container.querySelector('[title="t1_Trunk"]'), null);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView keeps component selection by default and routes component clicks to root-link picking during bridge selection', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createAssemblyState()}
          onSelect={(type, id, subType) => {
            useSelectionStore.getState().setSelection({ type, id, subType });
          }}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    const componentRow = findRowByTitle(container, 'arm_module');
    assert.ok(componentRow, 'component row should render');

    await act(async () => {
      componentRow.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(useAssemblySelectionStore.getState().selection, {
      type: 'component',
      id: 'comp_left',
    });
    assert.deepEqual(useSelectionStore.getState().selection, { type: null, id: null });

    await act(async () => {
      useAssemblySelectionStore.getState().clearSelection();
      useSelectionStore.getState().clearSelection();
      useSelectionStore.getState().setInteractionGuard(() => true);
    });

    await act(async () => {
      componentRow.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(useAssemblySelectionStore.getState().selection, { type: null, id: null });
    assert.deepEqual(useSelectionStore.getState().selection, {
      type: 'link',
      id: 'comp_left_base_link',
      subType: undefined,
    });
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView marks bridged components with an icon-only connected lock status', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    const lockedStatus = container.querySelector(
      `[title="${translations.en.bridgedComponentLockedHint}"]`,
    );
    assert.ok(lockedStatus, 'bridged component locked status should render');
    assert.equal(
      lockedStatus.textContent?.trim(),
      '',
      'bridged component status should not render a visible text badge',
    );
    assert.ok(
      lockedStatus.querySelector('.lucide-link-2'),
      'bridged component status should use a connection icon as the primary cue',
    );
    assert.ok(
      lockedStatus.querySelector('.lucide-lock-keyhole'),
      'bridged component status should keep a lock cue for constrained motion',
    );
    assert.equal(container.textContent?.includes(translations.en.bridgedComponent), false);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView highlights the owning component row when hover targets one of its links', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    const componentRow = findRowByTitle(container, 'arm_module');
    assert.ok(componentRow, 'component row should render');
    const hoveredRowStateClass =
      'bg-system-blue/10 text-text-primary ring-1 ring-inset ring-system-blue/15';
    assert.equal(componentRow.className.includes(hoveredRowStateClass), false);

    await act(async () => {
      useSelectionStore.getState().setHoveredSelection({ type: 'link', id: 'comp_left_base_link' });
    });

    assert.equal(componentRow.className.includes(hoveredRowStateClass), true);

    await act(async () => {
      useSelectionStore.getState().clearHover();
    });

    assert.equal(componentRow.className.includes(hoveredRowStateClass), false);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView writes an exact component root-link hover target so only the hovered component lights up', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={() => {}}
          onRenameAssembly={() => {}}
          onRemoveBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    const leftComponentRow = findRowByTitle(container, 'arm_module');
    const rightComponentRow = findRowByTitle(container, 'hand_module');
    assert.ok(leftComponentRow, 'left component row should render');
    assert.ok(rightComponentRow, 'right component row should render');
    const hoveredRowStateClass =
      'bg-system-blue/10 text-text-primary ring-1 ring-inset ring-system-blue/15';

    await act(async () => {
      dispatchReactMouseHandler(leftComponentRow, 'onMouseEnter');
    });

    assert.deepEqual(useSelectionStore.getState().hoveredSelection, {
      type: 'link',
      id: 'comp_left_base_link',
    });
    assert.equal(leftComponentRow.className.includes(hoveredRowStateClass), true);
    assert.equal(rightComponentRow.className.includes(hoveredRowStateClass), false);

    await act(async () => {
      dispatchReactMouseHandler(leftComponentRow, 'onMouseLeave');
    });

    assert.deepEqual(useSelectionStore.getState().hoveredSelection, { type: null, id: null });
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('AssemblyTreeView keeps labels non-selectable while supporting component and bridge rename from double click and context menu', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      deferredHoveredSelection: { type: null, id: null },
      hoverFrozen: false,
      attentionSelection: { type: null, id: null },
      interactionGuard: null,
      focusTarget: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });

    const componentRenames: Array<{ id: string; name: string }> = [];
    const jointUpdates: Array<{ id: string; data: unknown }> = [];

    await act(async () => {
      root.render(
        <AssemblyTreeView
          assemblyState={createAssemblyState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onUpdate={(type, id, data) => {
            if (type === 'joint') {
              jointUpdates.push({ id, data });
            }
          }}
          onRenameAssembly={() => {}}
          onRenameComponent={(id, name) => {
            componentRenames.push({ id, name });
          }}
          onRemoveBridge={() => {}}
          mode="editor"
          t={translations.en}
        />,
      );
    });

    const treeRoot = container.firstElementChild as HTMLDivElement | null;
    assert.ok(treeRoot, 'tree root should render');
    assert.equal(
      treeRoot.className.includes('select-none'),
      true,
      'assembly tree should disable text selection in display mode',
    );

    const componentLabel = container.querySelector(
      '[title="arm_module"]',
    ) as HTMLSpanElement | null;
    assert.ok(componentLabel, 'component label should render');

    await act(async () => {
      componentLabel.dispatchEvent(
        new dom.window.MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    let renameInput = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(renameInput, 'component rename input should render on double click');
    assert.equal(
      renameInput.className.includes('select-text'),
      true,
      'rename input should remain selectable',
    );

    await act(async () => {
      assert.ok(renameInput);
      dispatchReactChange(renameInput, 'arm_module_v2');
    });

    renameInput = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(renameInput, 'component rename input should stay mounted after change');

    await act(async () => {
      assert.ok(renameInput);
      dispatchReactKeyDown(renameInput, 'Enter');
    });

    assert.deepEqual(componentRenames, [{ id: 'comp_left', name: 'arm_module_v2' }]);

    const bridgeLabel = container.querySelector('[title="bridge_alpha"]') as HTMLSpanElement | null;
    assert.ok(bridgeLabel, 'bridge label should render');

    await act(async () => {
      bridgeLabel.dispatchEvent(
        new dom.window.MouseEvent('dblclick', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    renameInput = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(renameInput, 'bridge rename input should render on double click');

    await act(async () => {
      assert.ok(renameInput);
      dispatchReactChange(renameInput, 'bridge_beta');
    });

    renameInput = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(renameInput, 'bridge rename input should stay mounted after change');

    await act(async () => {
      assert.ok(renameInput);
      dispatchReactKeyDown(renameInput, 'Enter');
    });

    assert.equal(jointUpdates.length, 1, 'bridge rename should update the bridge joint');
    assert.equal(jointUpdates[0]?.id, 'bridge_1');
    assert.equal((jointUpdates[0]?.data as UrdfJoint).name, 'bridge_beta');

    const componentRow = findRowByTitle(container, 'arm_module');
    assert.ok(componentRow, 'component row should render');

    await act(async () => {
      componentRow.dispatchEvent(
        new dom.window.MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: 112,
          clientY: 94,
        }),
      );
    });

    const renameMenuButton = findButtonByText(translations.en.rename);
    assert.ok(renameMenuButton, 'component context menu should expose rename');

    await act(async () => {
      renameMenuButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    renameInput = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(renameInput, 'component rename input should also render from the context menu');
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
