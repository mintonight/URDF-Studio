import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ViewerOptionsPanel } from './ViewerOptionsPanel';

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
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
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

  return dom;
}

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

async function renderPanel(
  root: Root,
  readOnly: boolean,
  overrides: Partial<React.ComponentProps<typeof ViewerOptionsPanel>> = {},
) {
  await act(async () => {
    root.render(
      React.createElement(ViewerOptionsPanel, {
        showOptionsPanel: true,
        optionsPanelRef: { current: null },
        optionsPanelPos: null,
        onMouseDown: () => {},
        t: {
          resize: 'Resize',
          viewOptions: 'View Options',
          showVisual: 'Show Visual',
          showCollision: 'Show Collision',
          showIkHandles: 'Show IK Handles',
          alwaysOnTop: 'Always on top',
          showOrigin: 'Show Origin',
          showMjcfSites: 'Show MJCF Sites',
          size: 'Size',
          showJointAxes: 'Show Joint Axes',
          showCenterOfMass: 'Show Center Of Mass',
          showInertia: 'Show Inertia',
          modelOpacity: 'Model Opacity',
          autoFitGround: 'Auto Fit Ground',
          groundPlaneOffset: 'Ground Offset',
          reset: 'Reset',
        },
        isOptionsCollapsed: false,
        toggleOptionsCollapsed: () => {},
        showVisual: true,
        setShowVisual: () => {},
        showCollision: false,
        setShowCollision: () => {},
        showIkHandles: false,
        setShowIkHandles: () => {},
        showIkHandlesAlwaysOnTop: true,
        setShowIkHandlesAlwaysOnTop: () => {},
        showCollisionAlwaysOnTop: false,
        setShowCollisionAlwaysOnTop: () => {},
        modelOpacity: 0.5,
        setModelOpacity: () => {},
        showOrigins: false,
        setShowOrigins: () => {},
        showOriginsOverlay: false,
        setShowOriginsOverlay: () => {},
        originSize: 0.1,
        setOriginSize: () => {},
        showMjcfSiteToggle: false,
        showMjcfSites: false,
        setShowMjcfSites: () => {},
        showJointAxes: false,
        setShowJointAxes: () => {},
        showJointAxesOverlay: false,
        setShowJointAxesOverlay: () => {},
        jointAxisSize: 0.1,
        setJointAxisSize: () => {},
        showCenterOfMass: false,
        setShowCenterOfMass: () => {},
        showCoMOverlay: false,
        setShowCoMOverlay: () => {},
        centerOfMassSize: 0.01,
        setCenterOfMassSize: () => {},
        showInertia: false,
        setShowInertia: () => {},
        showInertiaOverlay: false,
        setShowInertiaOverlay: () => {},
        onAutoFitGround: () => {},
        groundPlaneOffset: 0.25,
        groundPlaneOffsetReadOnly: readOnly,
        setGroundPlaneOffset: () => {},
        ...overrides,
      }),
    );
  });
}

test('ViewerOptionsPanel disables ground plane controls when the offset is externally controlled', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, true);

  const sliders = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[data-testid="ui-slider-input"]'),
  );
  assert.ok(
    sliders.length >= 2,
    'panel should render both model opacity and ground offset sliders',
  );
  assert.equal(
    sliders.some((slider) => slider.disabled),
    true,
  );

  const disabledButtons = Array.from(
    container.querySelectorAll<HTMLButtonElement>('button[disabled]'),
  );
  assert.equal(
    disabledButtons.some((button) => button.textContent?.includes('Auto Fit Ground')),
    true,
  );
  assert.equal(
    disabledButtons.some((button) => button.textContent?.includes('Reset')),
    true,
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('viewer size sliders use the same full-width layout as opacity and ground offset', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false, {
    showOrigins: true,
    showJointAxes: true,
  });

  const sliderTracks = Array.from(
    container.querySelectorAll<HTMLDivElement>('[data-testid="ui-slider-track"]'),
  );
  assert.ok(
    sliderTracks.length >= 4,
    'viewer panel should render size, opacity, and ground offset sliders',
  );

  const originWrapper = sliderTracks[0].parentElement?.parentElement
    ?.parentElement as HTMLDivElement | null;
  const jointAxisWrapper = sliderTracks[1].parentElement?.parentElement
    ?.parentElement as HTMLDivElement | null;

  assert.ok(originWrapper, 'origin size slider wrapper should render');
  assert.ok(jointAxisWrapper, 'joint axis size slider wrapper should render');
  assert.equal(/\bpl-(2\.5|4)\b/.test(originWrapper.className), false);
  assert.equal(/\bpl-(2\.5|4)\b/.test(jointAxisWrapper.className), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel keeps bottom-right resize affordances without a right-edge resize hot zone', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  assert.equal(
    container.querySelector('[data-testid="ui-options-panel-resize-right"]'),
    null,
    'view options panel should not render a right-edge resize handle',
  );
  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-bottom"]'),
    'view options panel should keep the bottom resize handle',
  );
  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-corner"]'),
    'view options panel should keep the bottom-right resize handle',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel only shows the MJCF site toggle when the source is MJCF', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false, {
    showMjcfSiteToggle: false,
  });
  assert.equal(container.textContent?.includes('Show MJCF Sites'), false);

  await renderPanel(root, false, {
    showMjcfSiteToggle: true,
  });
  assert.equal(container.textContent?.includes('Show MJCF Sites'), true);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel exposes the IK always-on-top toggle when IK handles are visible', async () => {
  const { dom, container, root } = createComponentRoot();
  let nextAlwaysOnTopValue: boolean | null = null;

  await renderPanel(root, false, {
    showIkHandles: true,
    showIkHandlesAlwaysOnTop: false,
    setShowIkHandlesAlwaysOnTop: (nextValue) => {
      nextAlwaysOnTopValue = nextValue;
    },
  });

  const alwaysOnTopButton = container.querySelector<HTMLButtonElement>(
    'button[title="Always on top"]',
  );
  assert.ok(alwaysOnTopButton, 'IK row should render an always-on-top button');

  await act(async () => {
    alwaysOnTopButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  });

  assert.equal(nextAlwaysOnTopValue, true);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
