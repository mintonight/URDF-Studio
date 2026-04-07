import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { GeometryType, JointType, type AssemblyState } from '@/types';
import { useAssemblySelectionStore } from '@/store/assemblySelectionStore';
import { useSelectionStore } from '@/store/selectionStore';

import { BridgeCreateModal } from './BridgeCreateModal.tsx';

function assertNearlyEqual(actual: number, expected: number, message?: string) {
  assert.ok(Math.abs(actual - expected) < 1e-6, message ?? `${actual} !== ${expected}`);
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

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
  (globalThis as { HTMLSelectElement?: typeof HTMLSelectElement }).HTMLSelectElement =
    dom.window.HTMLSelectElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent = dom.window.KeyboardEvent;
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
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

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function createAssemblyState(): AssemblyState {
  return {
    name: 'test-assembly',
    components: {
      component_a: {
        id: 'component_a',
        name: 'Component A',
        sourceFile: 'component_a.urdf',
        transform: {
          position: { x: 0, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        robot: {
          name: 'robot_a',
          rootLinkId: 'component_a/base_link',
          links: {
            'component_a/base_link': {
              id: 'component_a/base_link',
              name: 'base_link',
              visual: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
              collision: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
            },
            'component_a/tool_link': {
              id: 'component_a/tool_link',
              name: 'tool_link',
              visual: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
              collision: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
            },
          },
          joints: {
            'component_a/tool_joint': {
              id: 'component_a/tool_joint',
              name: 'tool_joint',
              type: JointType.FIXED,
              parentLinkId: 'component_a/base_link',
              childLinkId: 'component_a/tool_link',
              origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              dynamics: { damping: 0, friction: 0 },
              hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
            },
          },
        },
      },
      component_b: {
        id: 'component_b',
        name: 'Component B',
        sourceFile: 'component_b.urdf',
        transform: {
          position: { x: 4, y: 0, z: 0 },
          rotation: { r: 0, p: 0, y: 0 },
        },
        robot: {
          name: 'robot_b',
          rootLinkId: 'component_b/base_link',
          links: {
            'component_b/base_link': {
              id: 'component_b/base_link',
              name: 'base_link',
              visual: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
              collision: {
                type: GeometryType.BOX,
                dimensions: { x: 1, y: 1, z: 1 },
                color: '#ffffff',
                origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
              },
            },
          },
          joints: {},
        },
      },
    },
    bridges: {},
  };
}

function findButtonByText(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (button) => button.textContent?.trim() === text,
  ) as HTMLButtonElement | null;
}

function findTextInput(container: HTMLElement) {
  return container.querySelector('input[type="text"]') as HTMLInputElement | null;
}

function findInputByAriaLabel(container: HTMLElement, label: string) {
  return container.querySelector(`input[aria-label="${label}"]`) as HTMLInputElement | null;
}

function findJointTypeSelect(container: HTMLElement) {
  return container.querySelector(
    '[data-bridge-inline-field="type"] select',
  ) as HTMLSelectElement | null;
}

function findHardwareInterfaceSelect(container: HTMLElement) {
  return container.querySelector(
    '[data-bridge-inline-field="hardware-interface"] select',
  ) as HTMLSelectElement | null;
}

async function waitForWindowTimers(dom: JSDOM, ms: number) {
  await new Promise<void>((resolve) => {
    dom.window.setTimeout(resolve, ms);
  });
}

async function pressAndHoldButton(dom: JSDOM, button: HTMLButtonElement, ms: number) {
  const PointerEventCtor = dom.window.PointerEvent ?? dom.window.MouseEvent;
  button.dispatchEvent(new PointerEventCtor('pointerdown', { bubbles: true, pointerId: 1 }));
  await Promise.resolve();
  await waitForWindowTimers(dom, ms);
  button.dispatchEvent(new PointerEventCtor('pointerup', { bubbles: true, pointerId: 1 }));
  button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

function getReactProps(node: Element): Record<string, unknown> {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'React props key should exist on rendered element');
  return (node as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown>;
}

function setFormControlValue(
  dom: JSDOM,
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
) {
  const prototype =
    element instanceof dom.window.HTMLSelectElement
      ? dom.window.HTMLSelectElement.prototype
      : dom.window.HTMLInputElement.prototype;
  const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

  assert.ok(valueSetter, 'form control value setter should exist');
  valueSetter.call(element, value);

  const reactProps = getReactProps(element);
  const onChange = reactProps.onChange;
  assert.equal(typeof onChange, 'function', 'React onChange handler should exist');

  (
    onChange as (event: {
      target: HTMLInputElement | HTMLSelectElement;
      currentTarget: HTMLInputElement | HTMLSelectElement;
    }) => void
  )({
    target: element,
    currentTarget: element,
  });

  element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  element.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
}

function expectFieldGroup(container: ParentNode, fieldKey: string, controlTag: 'input' | 'select') {
  const row = container.querySelector<HTMLElement>(`[data-bridge-field="${fieldKey}"]`);
  assert.ok(row, `expected field group "${fieldKey}" to exist`);
  assert.ok(row.querySelector('label'), `expected field group "${fieldKey}" to keep its label`);
  assert.ok(
    row.querySelector(controlTag),
    `expected field group "${fieldKey}" to contain a ${controlTag}`,
  );
}

function expectInlineFieldRow(
  container: ParentNode,
  fieldKey: string,
  controlTag: 'input' | 'select',
) {
  const row = container.querySelector<HTMLElement>(`[data-bridge-inline-field="${fieldKey}"]`);
  assert.ok(row, `expected inline field row "${fieldKey}" to exist`);
  assert.ok(
    row.querySelector('label'),
    `expected inline field row "${fieldKey}" to keep its label`,
  );
  assert.ok(
    row.querySelector(controlTag),
    `expected inline field row "${fieldKey}" to contain a ${controlTag}`,
  );
}

function expectSelectSlot(container: ParentNode, fieldKey: string) {
  const row = container.querySelector<HTMLElement>(`[data-bridge-field="${fieldKey}"]`);
  assert.ok(row, `expected select slot "${fieldKey}" to exist`);
  assert.ok(row.querySelector('select'), `expected select slot "${fieldKey}" to contain a select`);
}

test('bridge create modal keeps the compact grouped layout and removes legacy hint copy', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;
  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    const dialogRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(dialogRoot, 'bridge dialog should render');
    assert.equal(dialogRoot.style.width, '620px');

    assert.doesNotMatch(container.textContent ?? '', /桥接关节/);
    assert.doesNotMatch(container.textContent ?? '', /保持窗口打开时/);

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.equal(parentCard.dataset.bridgeComponentSummary, 'Component A');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'tool_link');
    assert.doesNotMatch(parentCard.textContent ?? '', /--\s*\/\s*--/);
    const parentHeader = parentCard.querySelector<HTMLElement>(
      '[data-bridge-side-header="parent"]',
    );
    assert.ok(parentHeader, 'parent side header should render');
    assert.match(parentHeader.className, /grid/);
    assert.match(parentHeader.textContent ?? '', /父侧/);
    assert.match(parentHeader.textContent ?? '', /选择父侧/);
    assert.doesNotMatch(parentHeader.textContent ?? '', /父组件/);
    assert.doesNotMatch(parentHeader.textContent ?? '', /父连杆/);
    assert.doesNotMatch(parentHeader.textContent ?? '', /Component A/);
    assert.doesNotMatch(parentHeader.textContent ?? '', /tool_link/);
    const parentActions = parentCard.querySelector<HTMLElement>(
      '[data-bridge-side-actions="parent"]',
    );
    assert.ok(parentActions, 'parent side actions should render');
    assert.match(parentActions.className, /justify-self-end/);
    const parentLabelRow = parentCard.querySelector<HTMLElement>(
      '[data-bridge-side-labels="parent"]',
    );
    assert.equal(
      parentLabelRow,
      null,
      'parent side labels should now share the same header row as the side controls',
    );
    const identityRow = container.querySelector<HTMLElement>('[data-bridge-row="identity"]');
    assert.ok(identityRow, 'identity row should render');
    assert.match(identityRow.className, /grid/);
    assert.match(identityRow.className, /items-center/);
    expectInlineFieldRow(identityRow, 'name', 'input');
    expectInlineFieldRow(identityRow, 'type', 'select');
    const nameRow = identityRow.querySelector<HTMLElement>('[data-bridge-inline-field="name"]');
    assert.ok(nameRow, 'name row should render');
    assert.match(nameRow.className, /contents/);
    const nameLabel = nameRow.querySelector('label');
    assert.ok(nameLabel, 'name row should keep its label');
    assert.match(nameLabel.className, /justify-end/);

    const parentFieldsRow = parentCard.querySelector<HTMLElement>(
      '[data-bridge-side-fields="parent"]',
    );
    assert.ok(
      parentFieldsRow,
      'parent side should keep component and link fields in one row group',
    );
    expectSelectSlot(parentFieldsRow, 'parent-component');
    expectSelectSlot(parentFieldsRow, 'parent-link');
    const relationConnector = container.querySelector<HTMLElement>(
      '[data-bridge-connector="joint-link"]',
    );
    assert.ok(
      relationConnector,
      'joint relation connector should render between parent and child panels',
    );

    const originRow = container.querySelector<HTMLElement>('[data-bridge-row="origin"]');
    assert.ok(originRow, 'origin row should render');
    expectInlineFieldRow(originRow, 'origin-x', 'input');
    expectInlineFieldRow(originRow, 'origin-y', 'input');
    expectInlineFieldRow(originRow, 'origin-z', 'input');
    assert.equal(
      originRow.querySelector('[data-bridge-axis="x"]') !== null,
      true,
      'origin X should render an axis-coded shell',
    );
    assert.equal(
      originRow.querySelector('[data-bridge-axis="y"]') !== null,
      true,
      'origin Y should render an axis-coded shell',
    );
    assert.equal(
      originRow.querySelector('[data-bridge-axis="z"]') !== null,
      true,
      'origin Z should render an axis-coded shell',
    );

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.focus();
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const childCard = container.querySelector<HTMLElement>('[data-bridge-side="child"]');
    assert.ok(childCard, 'child side card should render');
    assert.equal(childCard.dataset.bridgeComponentSummary, 'Component B');
    assert.equal(childCard.dataset.bridgeLinkSummary, 'base_link');
    assert.doesNotMatch(childCard.textContent ?? '', /--\s*\/\s*--/);
    const childHeader = childCard.querySelector<HTMLElement>('[data-bridge-side-header="child"]');
    assert.ok(childHeader, 'child side header should render');
    assert.match(childHeader.textContent ?? '', /子侧/);
    assert.match(childHeader.textContent ?? '', /选择子侧/);
    assert.doesNotMatch(childHeader.textContent ?? '', /子组件/);
    assert.doesNotMatch(childHeader.textContent ?? '', /子连杆/);
    assert.doesNotMatch(childHeader.textContent ?? '', /Component B/);
    assert.doesNotMatch(childHeader.textContent ?? '', /base_link/);
    const childActions = childCard.querySelector<HTMLElement>('[data-bridge-side-actions="child"]');
    assert.ok(childActions, 'child side actions should render');
    assert.match(childActions.className, /justify-self-end/);
    const childLabelRow = childCard.querySelector<HTMLElement>('[data-bridge-side-labels="child"]');
    assert.equal(
      childLabelRow,
      null,
      'child side labels should now share the same header row as the side controls',
    );
    const childFieldsRow = childCard.querySelector<HTMLElement>(
      '[data-bridge-side-fields="child"]',
    );
    assert.ok(childFieldsRow, 'child side should keep component and link fields in one row group');
    expectSelectSlot(childFieldsRow, 'child-component');
    expectSelectSlot(childFieldsRow, 'child-link');
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal uses friendly MJCF link labels in summaries and selectors', async () => {
  const { dom, container, root } = createComponentRoot();
  const assemblyState = createAssemblyState();
  const mjcfRootLink = assemblyState.components.component_a.robot.links['component_a/base_link'];

  mjcfRootLink.name = 'world_body_0';
  mjcfRootLink.visual = {
    ...mjcfRootLink.visual,
    mjcfMesh: { name: 'bin' },
  };
  mjcfRootLink.collision = {
    ...mjcfRootLink.collision,
    mjcfMesh: { name: 'bin' },
  };
  assemblyState.components.component_a.robot.inspectionContext = {
    sourceFormat: 'mjcf',
    mjcf: {
      siteCount: 0,
      tendonCount: 0,
      tendonActuatorCount: 0,
      bodiesWithSites: [],
      tendons: [],
    },
  };

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState,
          lang: 'en',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/base_link' });
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'Bin');

    const parentLinkSelect = container.querySelector<HTMLSelectElement>(
      '[data-bridge-field="parent-link"] select',
    );
    assert.ok(parentLinkSelect, 'parent link select should render');

    const optionLabels = Array.from(parentLinkSelect.options).map((option) => option.text.trim());
    assert.ok(optionLabels.includes('Bin'), 'friendly MJCF link label should be listed');
    assert.ok(
      !optionLabels.includes('world_body_0'),
      'raw anonymous MJCF body name should stay hidden from the selector',
    );
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
  }
});

test('bridge create modal keeps joint type compact and omits extra explanation copy', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    const helperRow = container.querySelector<HTMLElement>('[data-bridge-row="joint-behavior"]');
    assert.equal(helperRow, null, 'joint type helper copy should not render');

    const hardwareInterfaceSelect = findHardwareInterfaceSelect(container);
    assert.ok(hardwareInterfaceSelect, 'hardware interface select should still render');
    assert.doesNotMatch(container.textContent ?? '', /绕单一轴线旋转/);
    assert.doesNotMatch(container.textContent ?? '', /无位置上下限/);
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal lets users switch back to the parent side and repick it', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const parentButton = findButtonByText(container, '选择父侧');
    assert.ok(parentButton, 'parent side picker button should render');

    await act(async () => {
      parentButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/base_link' });
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.equal(parentCard.dataset.bridgeComponentSummary, 'Component A');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'base_link');
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal adds compact +/-90 degree rotation shortcuts for each Euler axis', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<number | undefined> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(bridge?.joint.origin?.rpy.r);
          },
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const rollDecreaseButton = container.querySelector('button[aria-label="横滚 减少 90°"]');
    const rollIncreaseButton = container.querySelector('button[aria-label="横滚 增加 90°"]');
    assert.ok(rollDecreaseButton, 'roll decrease shortcut button should exist');
    assert.ok(rollIncreaseButton, 'roll increase shortcut button should exist');
    assert.equal(container.textContent?.includes('-90'), true);
    assert.equal(container.textContent?.includes('+90'), true);

    await act(async () => {
      rollIncreaseButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    assert.equal(previewUpdates.at(-1), Math.PI / 2);

    await act(async () => {
      rollDecreaseButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    assert.equal(previewUpdates.at(-1), 0);
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal clears stale selection state on open so picking starts from a clean slate', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: 'link', id: 'component_a/tool_link' },
    hoveredSelection: { type: 'link', id: 'component_a/tool_link' },
    interactionGuard: null,
  });
  useAssemblySelectionStore.setState({
    selection: { type: 'component', id: 'component_a' },
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    const parentCard = container.querySelector<HTMLElement>('[data-bridge-side="parent"]');
    assert.ok(parentCard, 'parent side card should render');
    assert.equal(parentCard.dataset.bridgeComponentSummary, '--');
    assert.equal(parentCard.dataset.bridgeLinkSummary, '--');
    assert.deepEqual(useSelectionStore.getState().selection, { type: null, id: null });
    assert.deepEqual(useSelectionStore.getState().hoveredSelection, { type: null, id: null });
    assert.deepEqual(useAssemblySelectionStore.getState().selection, { type: null, id: null });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    assert.equal(parentCard.dataset.bridgeComponentSummary, 'Component A');
    assert.equal(parentCard.dataset.bridgeLinkSummary, 'tool_link');
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      hoveredSelection: { type: null, id: null },
      interactionGuard: null,
    });
    useAssemblySelectionStore.setState({
      selection: { type: null, id: null },
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal auto-selects each component root link so preview can move the child immediately', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<{
    parentLinkId: string;
    childLinkId: string;
    originX: number | undefined;
  } | null> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(
              bridge
                ? {
                    parentLinkId: bridge.parentLinkId,
                    childLinkId: bridge.childLinkId,
                    originX: bridge.joint.origin?.xyz.x,
                  }
                : null,
            );
          },
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    const parentComponentSelect = container.querySelector<HTMLSelectElement>(
      '[data-bridge-field="parent-component"] select',
    );
    assert.ok(parentComponentSelect, 'parent component select should render');

    await act(async () => {
      setFormControlValue(dom, parentComponentSelect, 'component_a');
      await Promise.resolve();
    });

    const parentLinkSelect = container.querySelector<HTMLSelectElement>(
      '[data-bridge-field="parent-link"] select',
    );
    assert.ok(parentLinkSelect, 'parent link select should render');
    assert.equal(
      parentLinkSelect.value,
      'component_a/base_link',
      'parent component selection should default to the root link',
    );

    const childComponentSelect = container.querySelector<HTMLSelectElement>(
      '[data-bridge-field="child-component"] select',
    );
    assert.ok(childComponentSelect, 'child component select should render');
    await act(async () => {
      setFormControlValue(dom, childComponentSelect, 'component_b');
      await Promise.resolve();
    });

    const childLinkSelect = container.querySelector<HTMLSelectElement>(
      '[data-bridge-field="child-link"] select',
    );
    assert.ok(childLinkSelect, 'child link select should render');
    assert.equal(
      childLinkSelect.value,
      'component_b/base_link',
      'child component selection should default to the root link',
    );
    const lastPreview = previewUpdates.at(-1);
    assert.ok(lastPreview, 'bridge preview should be emitted once both sides are selected');
    assert.equal(lastPreview.parentLinkId, 'component_a/base_link');
    assert.equal(lastPreview.childLinkId, 'component_b/base_link');
    assertNearlyEqual(
      lastPreview.originX ?? 0,
      1.002,
      'root-link auto preview should suggest a visual contact offset instead of center overlap',
    );
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal suggests a default bridge name and auto-uses it on confirm', async () => {
  const { dom, container, root } = createComponentRoot();
  const createdNames: string[] = [];
  const createdOriginXs: number[] = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: (params) => {
            createdNames.push(params.name);
            createdOriginXs.push(params.joint.origin.xyz.x);
          },
          onPreviewChange: () => {},
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const nameInput = findTextInput(container);
    assert.ok(nameInput, 'name input should render');
    assert.equal(
      nameInput.value,
      '',
      'generated bridge name should stay as placeholder until edited',
    );
    assert.equal(nameInput.placeholder, 'Component_A-Component_B');

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');
    assert.equal(
      confirmButton.disabled,
      false,
      'generated bridge name should keep confirm enabled',
    );

    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
    });

    assert.deepEqual(createdNames, ['Component_A-Component_B']);
    assertNearlyEqual(
      createdOriginXs[0] ?? 0,
      1.002,
      'bridge creation should commit the auto-suggested contact offset by default',
    );
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal increments the generated bridge name when the default name already exists', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;
  const assemblyState = createAssemblyState();
  assemblyState.bridges.existing_bridge = {
    id: 'existing_bridge',
    name: 'Component_A-Component_B',
    parentComponentId: 'component_a',
    parentLinkId: 'component_a/tool_link',
    childComponentId: 'component_b',
    childLinkId: 'component_b/base_link',
    joint: {
      id: 'existing_bridge',
      name: 'existing_bridge',
      type: JointType.FIXED,
      parentLinkId: 'component_a/tool_link',
      childLinkId: 'component_b/base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    },
  };

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState,
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const nameInput = findTextInput(container);
    assert.ok(nameInput, 'name input should render');
    assert.equal(nameInput.placeholder, 'Component_A-Component_B-1');
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal updates the preview immediately when origin steppers change xyz values', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<number | undefined> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(bridge?.joint.origin?.xyz.x);
          },
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const increaseXButton = container.querySelector(
      'button[aria-label="Increase X"]',
    ) as HTMLButtonElement | null;
    assert.ok(increaseXButton, 'origin X increase button should render');
    const autoSuggestedOriginX = previewUpdates.at(-1) ?? 0;

    await act(async () => {
      increaseXButton.click();
      await Promise.resolve();
    });

    assertNearlyEqual(previewUpdates.at(-1) ?? 0, autoSuggestedOriginX + 0.01);
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal keeps incrementing origin steppers while the + button is held', async () => {
  const { dom, container, root } = createComponentRoot();
  const previewUpdates: Array<number | undefined> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: (bridge) => {
            previewUpdates.push(bridge?.joint.origin?.xyz.x);
          },
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const increaseXButton = container.querySelector(
      'button[aria-label="Increase X"]',
    ) as HTMLButtonElement | null;
    assert.ok(increaseXButton, 'origin X increase button should render');
    const autoSuggestedOriginX = previewUpdates.at(-1) ?? 0;

    await act(async () => {
      await pressAndHoldButton(dom, increaseXButton, 520);
      await Promise.resolve();
    });

    const distinctPositiveUpdates = Array.from(
      new Set(
        previewUpdates
          .filter(
            (value): value is number => typeof value === 'number' && value > autoSuggestedOriginX,
          )
          .map((value) => (value - autoSuggestedOriginX).toFixed(2)),
      ),
    );
    assert.equal(distinctPositiveUpdates[0], '0.01');
    assert.equal(distinctPositiveUpdates.length >= 2, true);
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal wires press-and-hold handlers onto the quick +90 rotation button', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const rollIncreaseButton = container.querySelector(
      'button[aria-label="横滚 增加 90°"]',
    ) as HTMLButtonElement | null;
    assert.ok(rollIncreaseButton, 'roll increase shortcut button should exist');
    const reactProps = getReactProps(rollIncreaseButton);
    assert.equal(typeof reactProps.onPointerDown, 'function');
    assert.equal(typeof reactProps.onPointerUp, 'function');
    assert.equal(typeof reactProps.onPointerCancel, 'function');
    assert.equal(typeof reactProps.onLostPointerCapture, 'function');
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal submits configurable limits for non-fixed joints', async () => {
  const { dom, container, root } = createComponentRoot();
  const createdJoints: Array<{
    type: JointType;
    limit?: { lower: number; upper: number; effort: number; velocity: number };
    hardwareInterface?: 'effort' | 'position' | 'velocity';
  }> = [];
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: (params) => {
            createdJoints.push({
              type: params.joint.type,
              limit: params.joint.limit,
              hardwareInterface: params.joint.hardware?.hardwareInterface,
            });
          },
          onPreviewChange: () => {},
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    const hardwareInterfaceSelect = findHardwareInterfaceSelect(container);
    assert.ok(hardwareInterfaceSelect, 'hardware interface select should render for motion joints');

    const lowerInput = findInputByAriaLabel(container, '位置下限');
    const upperInput = findInputByAriaLabel(container, '位置上限');
    const effortInput = findInputByAriaLabel(container, '力矩');
    const velocityInput = findInputByAriaLabel(container, '速度');
    assert.ok(lowerInput, 'lower limit input should render');
    assert.ok(upperInput, 'upper limit input should render');
    assert.ok(effortInput, 'effort input should render');
    assert.ok(velocityInput, 'velocity input should render');

    await act(async () => {
      setFormControlValue(dom, hardwareInterfaceSelect, 'effort');
      setFormControlValue(dom, lowerInput, '-0.5');
      setFormControlValue(dom, upperInput, '1.25');
      setFormControlValue(dom, effortInput, '42');
      setFormControlValue(dom, velocityInput, '3.5');
      await Promise.resolve();
    });

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');
    assert.equal(confirmButton.disabled, false);

    await act(async () => {
      confirmButton.click();
      await Promise.resolve();
    });

    assert.deepEqual(createdJoints.at(-1), {
      type: JointType.REVOLUTE,
      limit: {
        lower: -0.5,
        upper: 1.25,
        effort: 42,
        velocity: 3.5,
      },
      hardwareInterface: 'effort',
    });
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal disables confirm when the lower limit exceeds the upper limit', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState: createAssemblyState(),
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/tool_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    const lowerInput = findInputByAriaLabel(container, '位置下限');
    const upperInput = findInputByAriaLabel(container, '位置上限');
    assert.ok(lowerInput, 'lower limit input should render');
    assert.ok(upperInput, 'upper limit input should render');

    await act(async () => {
      setFormControlValue(dom, lowerInput, '2');
      setFormControlValue(dom, upperInput, '1');
      await Promise.resolve();
    });

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');
    assert.equal(confirmButton.disabled, true);
    assert.match(container.textContent ?? '', /下限必须小于或等于上限/);
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});

test('bridge create modal disables confirm for a non-fixed bridge that would close an assembly cycle', async () => {
  const { dom, container, root } = createComponentRoot();
  const originalConsoleError = console.error;
  const assemblyState = createAssemblyState();
  assemblyState.bridges.bridge_component_a_component_b = {
    id: 'bridge_component_a_component_b',
    name: 'Component_A-Component_B',
    parentComponentId: 'component_a',
    parentLinkId: 'component_a/tool_link',
    childComponentId: 'component_b',
    childLinkId: 'component_b/base_link',
    joint: {
      id: 'bridge_component_a_component_b',
      name: 'bridge_component_a_component_b',
      type: JointType.FIXED,
      parentLinkId: 'component_a/tool_link',
      childLinkId: 'component_b/base_link',
      origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
      dynamics: { damping: 0, friction: 0 },
      hardware: { armature: 0, motorType: '', motorId: '', motorDirection: 1 },
    },
  };

  useSelectionStore.setState({
    selection: { type: null, id: null },
    interactionGuard: null,
  });

  console.error = (...args: unknown[]) => {
    if (args.some((arg) => typeof arg === 'string' && arg.includes('not wrapped in act'))) {
      return;
    }

    originalConsoleError(...args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(BridgeCreateModal, {
          isOpen: true,
          onClose: () => {},
          onCreate: () => {},
          onPreviewChange: () => {},
          assemblyState,
          lang: 'zh',
        }),
      );
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_b/base_link' });
      await Promise.resolve();
    });

    const childButton = findButtonByText(container, '选择子侧');
    assert.ok(childButton, 'child side picker button should render');

    await act(async () => {
      childButton.click();
      await Promise.resolve();
    });

    await act(async () => {
      useSelectionStore.getState().setSelection({ type: 'link', id: 'component_a/base_link' });
      await Promise.resolve();
    });

    const jointTypeSelect = findJointTypeSelect(container);
    assert.ok(jointTypeSelect, 'joint type select should render');

    const confirmButton = findButtonByText(container, '确认');
    assert.ok(confirmButton, 'confirm button should render');
    assert.equal(confirmButton.disabled, false, 'fixed cyclic bridges should remain allowed');

    await act(async () => {
      setFormControlValue(dom, jointTypeSelect, JointType.REVOLUTE);
      await Promise.resolve();
    });

    assert.equal(confirmButton.disabled, true);
    assert.match(container.textContent ?? '', /成环桥接仅支持 fixed 关节/);
  } finally {
    useSelectionStore.setState({
      selection: { type: null, id: null },
      interactionGuard: null,
    });
    await destroyComponentRoot(dom, root);
    console.error = originalConsoleError;
  }
});
