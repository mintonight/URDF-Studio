import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import type { AppMode, RobotState, UrdfLink } from '@/types';
import { GeometryType } from '@/types';
import { translations } from '@/shared/i18n';
import { useUIStore } from '@/store';
import { LinkProperties } from './LinkProperties.tsx';

function createLink(): UrdfLink {
  return {
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
}

function createRobot(link: UrdfLink): RobotState {
  return {
    name: 'demo',
    links: {
      [link.id]: link,
    },
    joints: {},
    rootLinkId: link.id,
    selection: {
      type: 'link',
      id: link.id,
      subType: 'visual',
      objectIndex: 0,
    },
  };
}

function renderLinkProperties(
  mode: AppMode,
  detailLinkTab: 'visual' | 'collision' | 'physics' = 'visual',
) {
  const link = createLink();
  const robot = createRobot(link);
  useUIStore.getState().setDetailLinkTab(detailLinkTab);

  return renderToStaticMarkup(
    React.createElement(LinkProperties, {
      data: link,
      robot,
      mode,
      selection: robot.selection,
      onUpdate: () => {},
      motorLibrary: {},
      assets: {},
      onUploadAsset: () => {},
      t: translations.en,
      lang: 'en',
    }),
  );
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
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { PointerEvent?: typeof PointerEvent }).PointerEvent =
    dom.window.PointerEvent ?? dom.window.MouseEvent;
  (globalThis as { InputEvent?: typeof InputEvent }).InputEvent = dom.window.InputEvent;
  (globalThis as { FocusEvent?: typeof FocusEvent }).FocusEvent = dom.window.FocusEvent;
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
  if (!('setPointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'setPointerCapture', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('releasePointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'releasePointerCapture', {
      value: () => {},
      configurable: true,
    });
  }
  if (!('hasPointerCapture' in dom.window.HTMLElement.prototype)) {
    Object.defineProperty(dom.window.HTMLElement.prototype, 'hasPointerCapture', {
      value: () => false,
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

function getReactProps(node: Element) {
  const reactPropsKey = Object.keys(node).find((key) => key.startsWith('__reactProps$'));
  assert.ok(reactPropsKey, 'React props key should exist on rendered element');
  return (node as unknown as Record<string, unknown>)[reactPropsKey] as Record<string, unknown>;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const prototype = input.ownerDocument.defaultView?.HTMLInputElement.prototype;
  const valueSetter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set
    : undefined;

  assert.ok(valueSetter, 'HTMLInputElement value setter should exist');
  valueSetter.call(input, value);
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

function dispatchReactBlur(input: HTMLInputElement) {
  const reactProps = getReactProps(input);
  const onBlur = reactProps.onBlur;
  assert.equal(typeof onBlur, 'function', 'React onBlur handler should exist');

  (onBlur as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactCheckboxChange(input: HTMLInputElement, checked: boolean) {
  const prototype = input.ownerDocument.defaultView?.HTMLInputElement.prototype;
  const checkedSetter = prototype
    ? Object.getOwnPropertyDescriptor(prototype, 'checked')?.set
    : undefined;

  assert.ok(checkedSetter, 'HTMLInputElement checked setter should exist');
  checkedSetter.call(input, checked);

  const reactProps = getReactProps(input);
  const onChange = reactProps.onChange;
  assert.equal(typeof onChange, 'function', 'React checkbox onChange handler should exist');

  (onChange as (event: { target: HTMLInputElement; currentTarget: HTMLInputElement }) => void)({
    target: input,
    currentTarget: input,
  });
}

function dispatchReactClick(button: HTMLButtonElement) {
  const reactProps = getReactProps(button);
  const onClick = reactProps.onClick;
  assert.equal(typeof onClick, 'function', 'React onClick handler should exist');

  (
    onClick as (event: {
      currentTarget: HTMLButtonElement;
      target: HTMLButtonElement;
      preventDefault: () => void;
      stopPropagation: () => void;
    }) => void
  )({
    currentTarget: button,
    target: button,
    preventDefault: () => {},
    stopPropagation: () => {},
  });
}

function findInlineNumberInputByLabel(container: Element, labelText: string) {
  const label = Array.from(container.querySelectorAll('label')).find(
    (node) => node.textContent === labelText,
  );
  assert.ok(label, `label "${labelText}" should render`);
  const input = label.parentElement?.querySelector('input[type="text"]');
  assert.ok(input, `input for label "${labelText}" should render`);
  return input as HTMLInputElement;
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

test('editor mode renders link-only editing layout without embedded joint properties', () => {
  const markup = renderLinkProperties('editor');

  assert.doesNotMatch(markup, new RegExp(translations.en.selectedJoint));
  assert.match(markup, new RegExp(translations.en.visualGeometry));
  assert.match(markup, new RegExp(translations.en.collisionGeometry));
  assert.match(markup, new RegExp(translations.en.physics));
});

test('tab buttons and rotation mode controls stay shrinkable for narrow property sidebars', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('physics');
    useUIStore.setState({ rotationDisplayMode: 'euler_deg' });

    const link = createLink();
    const robot = createRobot(link);

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    const tabButton = container.querySelector(
      'button[title="Collision Geometry"]',
    ) as HTMLButtonElement | null;
    assert.ok(tabButton, 'collision geometry tab button should render');
    assert.match(
      tabButton.className,
      /\bmin-w-0\b/,
      'geometry tab buttons should be allowed to shrink within the property sidebar',
    );
    const tabLabel = tabButton.querySelector('span');
    assert.ok(tabLabel, 'geometry tab button should wrap its text in a label span');
    assert.match(
      tabLabel.className,
      /\btruncate\b/,
      'geometry tab labels should truncate instead of overflowing narrow sidebars',
    );

    const rotationModeButton = container.querySelector(
      `button[title="${translations.en.eulerDegrees}"]`,
    ) as HTMLButtonElement | null;
    assert.ok(rotationModeButton, 'rotation mode segmented control should render');
    assert.match(
      rotationModeButton.className,
      /\bmin-w-0\b/,
      'segmented control buttons should be allowed to shrink inside the sidebar',
    );
    const rotationModeLabel = rotationModeButton.querySelector('span:last-child');
    assert.ok(rotationModeLabel, 'rotation mode button should render a text label');
    assert.match(
      rotationModeLabel.className,
      /\btruncate\b/,
      'segmented control labels should truncate instead of overflowing narrow sidebars',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('visual geometry dimension labels stay shrinkable inside narrow inline rows', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('visual');

    const link = createLink();
    const robot = createRobot(link);

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    const widthLabel = container.querySelector('span[title="Width"]') as HTMLSpanElement | null;
    assert.ok(widthLabel, 'geometry dimension label should render');
    assert.match(
      widthLabel.className,
      /\btruncate\b/,
      'geometry dimension labels should truncate instead of overflowing the sidebar',
    );
    assert.match(
      widthLabel.parentElement?.className ?? '',
      /\bmin-w-0\b/,
      'geometry dimension rows should stay shrinkable inside the dimension grid',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('physics tab keeps diagonal inertia inline and principal axes in a matrix layout', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    const link = createLink();
    const robot = createRobot(link);

    await act(async () => {
      useUIStore.getState().setDetailLinkTab('physics');
      root.render(
        React.createElement(LinkProperties, {
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: () => {},
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    const i1Label = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'I1',
    );
    assert.ok(i1Label, 'I1 label should render');
    assert.equal(i1Label.parentElement?.className.includes('items-center'), true);
    assert.ok(
      i1Label.parentElement?.querySelector('input'),
      'I1 label should share its row with a number input',
    );
    const diagonalGrid = i1Label.parentElement?.parentElement;
    assert.ok(diagonalGrid, 'diagonal inertia grid should render');
    assert.match(
      diagonalGrid.className,
      /\bmin-w-0\b/,
      'diagonal inertia grid should be allowed to shrink within the sidebar',
    );
    assert.match(
      diagonalGrid.className,
      /\bw-full\b/,
      'diagonal inertia grid should fill the available inline width without overflowing',
    );

    const xHeader = Array.from(container.querySelectorAll('span')).find(
      (node) => node.textContent === 'X',
    );
    assert.ok(xHeader, 'principal axes X header should render');
    assert.equal(xHeader.parentElement?.textContent?.includes('A1'), false);

    const a1Label = Array.from(container.querySelectorAll('div')).find(
      (node) => node.textContent?.trim() === 'A1',
    );
    assert.ok(a1Label, 'principal axes A1 label should render');
    const a1Row = a1Label.parentElement;
    assert.ok(a1Row, 'principal axes A1 label should belong to a row container');
    assert.equal(
      a1Row.children.length,
      4,
      'principal axes A1 row should keep one label column plus three value columns',
    );
    assert.match(
      a1Row.className,
      /\bmin-w-0\b/,
      'principal axes rows should be allowed to shrink within the sidebar',
    );
    assert.match(
      a1Row.className,
      /\bw-full\b/,
      'principal axes rows should fill the available inline width without overflowing',
    );

    const densityLabel = Array.from(container.querySelectorAll('label')).find(
      (node) => node.textContent === translations.en.density,
    );
    assert.ok(densityLabel, 'density label should render');
    const densityField = densityLabel.parentElement?.querySelector('div.min-w-0.flex-1 > div');
    assert.ok(densityField, 'density field should render inside a shrinkable wrapper');
    assert.match(
      densityField.className,
      /\boverflow-hidden\b/,
      'density field should clip oversized values instead of overflowing',
    );
    assert.match(
      densityField.className,
      /\btruncate\b/,
      'density field should truncate oversized values inside the textbox',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('physics tab reuses collision-style rotation shortcuts for inertial origin', async () => {
  const { dom, container, root } = createComponentRoot();
  try {
    useUIStore.getState().setDetailLinkTab('physics');
    useUIStore.setState({ rotationDisplayMode: 'euler_deg' });

    const link = createLink();
    const robot = createRobot(link);
    const updates: UrdfLink[] = [];

    await act(async () => {
      root.render(
        React.createElement(LinkProperties, {
          data: link,
          robot,
          mode: 'editor',
          selection: robot.selection,
          onUpdate: (_type, _id, nextData) => {
            updates.push(nextData as UrdfLink);
          },
          motorLibrary: {},
          assets: {},
          onUploadAsset: () => {},
          t: translations.en,
          lang: 'en',
        }),
      );
    });

    const rollIncreaseButton = Array.from(
      container.querySelectorAll('button[aria-label="Roll increase 90°"]'),
    ).at(-1) as HTMLButtonElement | undefined;
    const yawDecreaseButton = Array.from(
      container.querySelectorAll('button[aria-label="Yaw decrease 90°"]'),
    ).at(-1) as HTMLButtonElement | undefined;
    assert.ok(rollIncreaseButton, 'physics tab should expose roll shortcut buttons');
    assert.ok(yawDecreaseButton, 'physics tab should expose yaw shortcut buttons');

    await act(async () => {
      rollIncreaseButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    const nextLink = updates.at(-1);
    assert.ok(nextLink, 'physics rotation shortcut should emit an updated link');
    assert.equal(nextLink.inertial?.origin?.rpy.r, Math.PI / 2);
    assert.equal(nextLink.inertial?.origin?.rpy.p, 0);
    assert.equal(nextLink.inertial?.origin?.rpy.y, 0);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('mass changes can remember and auto-apply uniform-density inertia re-estimation', async () => {
  const { dom, container, root } = createComponentRoot();
  const updates: UrdfLink[] = [];

  function ControlledHarness() {
    const [link, setLink] = React.useState(() => createLink());
    const robot = React.useMemo(() => createRobot(link), [link]);

    return React.createElement(LinkProperties, {
      data: link,
      robot,
      mode: 'editor',
      selection: robot.selection,
      onUpdate: (_type, _id, nextData) => {
        const nextLink = nextData as UrdfLink;
        updates.push(nextLink);
        setLink(nextLink);
      },
      motorLibrary: {},
      assets: {},
      onUploadAsset: () => {},
      t: translations.en,
      lang: 'en',
    });
  }

  try {
    useUIStore.getState().setDetailLinkTab('physics');
    useUIStore.getState().setMassInertiaChangeBehavior('ask');

    await act(async () => {
      root.render(React.createElement(ControlledHarness));
    });

    const massInput = findInlineNumberInputByLabel(container, translations.en.mass);

    await act(async () => {
      dispatchReactChange(massInput, '2');
      dispatchReactBlur(massInput);
    });

    assert.match(
      container.textContent ?? '',
      new RegExp(translations.en.massChangeInertiaDialogTitle),
      'mass changes should open a confirmation dialog before applying the new inertia behavior',
    );

    const rememberCheckbox = container.querySelector(
      'input[type="checkbox"]',
    ) as HTMLInputElement | null;
    assert.ok(rememberCheckbox, 'remember-choice checkbox should render');

    await act(async () => {
      dispatchReactCheckboxChange(rememberCheckbox, true);
    });

    const confirmButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === translations.en.confirm,
    ) as HTMLButtonElement | undefined;
    assert.ok(confirmButton, 'confirm button should render');

    await act(async () => {
      dispatchReactClick(confirmButton);
    });

    const firstUpdate = updates.at(-1);
    assert.ok(firstUpdate, 'confirming the dialog should emit an updated link');
    assert.equal(firstUpdate.inertial?.mass, 2);
    assert.equal(firstUpdate.inertial?.inertia.ixx, 2);
    assert.equal(firstUpdate.inertial?.inertia.iyy, 2);
    assert.equal(firstUpdate.inertial?.inertia.izz, 2);
    assert.equal(useUIStore.getState().massInertiaChangeBehavior, 'reestimate');
    assert.match(
      container.textContent ?? '',
      /ixx=2(?:\.0+)?/,
      'the floating notice should summarize the updated inertia tensor',
    );

    const nextMassInput = findInlineNumberInputByLabel(container, translations.en.mass);

    await act(async () => {
      dispatchReactChange(nextMassInput, '3');
      dispatchReactBlur(nextMassInput);
    });

    const secondUpdate = updates.at(-1);
    assert.ok(secondUpdate, 'remembered behavior should auto-apply the next mass change');
    assert.equal(secondUpdate.inertial?.mass, 3);
    assert.equal(secondUpdate.inertial?.inertia.ixx, 3);
    assert.equal(secondUpdate.inertial?.inertia.iyy, 3);
    assert.equal(secondUpdate.inertial?.inertia.izz, 3);
    assert.doesNotMatch(
      container.textContent ?? '',
      new RegExp(translations.en.massChangeInertiaDialogTitle),
      'remembered behavior should skip the confirmation dialog on later changes',
    );
  } finally {
    await destroyComponentRoot(dom, root);
    useUIStore.getState().setMassInertiaChangeBehavior('ask');
  }
});
