import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { UnifiedVisualizerOptionsPanel } from './UnifiedVisualizerOptionsPanel';

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

function renderPanel(
  root: Root,
  overrides: Partial<React.ComponentProps<typeof UnifiedVisualizerOptionsPanel>> = {},
) {
  return act(async () => {
    root.render(
      React.createElement(UnifiedVisualizerOptionsPanel, {
        lang: 'zh',
        showGeometry: true,
        setShowGeometry: () => {},
        showOrigin: false,
        setShowOrigin: () => {},
        frameSize: 0.15,
        setFrameSize: () => {},
        showLabels: false,
        setShowLabels: () => {},
        labelScale: 1,
        setLabelScale: () => {},
        showJointAxes: false,
        setShowJointAxes: () => {},
        jointAxisSize: 0.35,
        setJointAxisSize: () => {},
        showCollision: false,
        setShowCollision: () => {},
        showIkHandles: false,
        setShowIkHandles: () => {},
        showInertia: false,
        setShowInertia: () => {},
        showCenterOfMass: false,
        setShowCenterOfMass: () => {},
        modelOpacity: 0.42,
        setModelOpacity: () => {},
        isCollapsed: false,
        toggleCollapsed: () => {},
        onMouseDown: () => {},
        onResetPosition: () => {},
        optionsPanelPos: null,
        groundPlaneOffset: 0,
        setGroundPlaneOffset: () => {},
        ...overrides,
      }),
    );
  });
}

test('visualizer options panel exposes the shared model opacity control', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  assert.match(container.textContent ?? '', /模型不透明度/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer options panel allows typing model opacity directly', async () => {
  const { dom, container, root } = createComponentRoot();
  const modelOpacityUpdates: number[] = [];

  await renderPanel(root, {
    setModelOpacity: (nextValue) => {
      modelOpacityUpdates.push(nextValue);
    },
  });

  const valueInputs = Array.from(
    container.querySelectorAll<HTMLInputElement>('[data-testid="ui-slider-value-input"]'),
  );
  const modelOpacityInput = valueInputs.find((input) => input.value === '42%');
  assert.ok(modelOpacityInput, 'model opacity input should render as an editable textbox');
  const setNativeInputValue = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    'value',
  )?.set;
  assert.ok(setNativeInputValue, 'native input value setter should exist');

  await act(async () => {
    modelOpacityInput.focus();
    setNativeInputValue.call(modelOpacityInput, '35');
    modelOpacityInput.dispatchEvent(new Event('input', { bubbles: true }));
    modelOpacityInput.dispatchEvent(new Event('change', { bubbles: true }));
    modelOpacityInput.blur();
  });

  assert.equal(modelOpacityUpdates.at(-1), 0.35);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer size sliders keep the same horizontal width as the other view sliders', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, {
    showOrigin: true,
    showJointAxes: true,
  });

  const sliderTracks = Array.from(
    container.querySelectorAll<HTMLDivElement>('[data-testid="ui-slider-track"]'),
  );
  assert.ok(
    sliderTracks.length >= 4,
    'panel should render size, opacity, and ground offset sliders',
  );

  const coordinateFrameWrapper = sliderTracks[0].parentElement?.parentElement
    ?.parentElement as HTMLDivElement | null;
  const jointAxisWrapper = sliderTracks[1].parentElement?.parentElement
    ?.parentElement as HTMLDivElement | null;

  assert.ok(coordinateFrameWrapper, 'coordinate frame size slider wrapper should render');
  assert.ok(jointAxisWrapper, 'joint axis size slider wrapper should render');
  assert.equal(/\bpl-(2\.5|4)\b/.test(coordinateFrameWrapper.className), false);
  assert.equal(/\bpl-(2\.5|4)\b/.test(jointAxisWrapper.className), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('visualizer view options keep corner resize without a right-edge resize hot zone', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  assert.equal(
    container.querySelector('[data-testid="ui-options-panel-resize-right"]'),
    null,
    'visualizer view options should not render a right-edge resize handle',
  );
  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-bottom"]'),
    'visualizer view options should keep the bottom resize handle',
  );
  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-corner"]'),
    'visualizer view options should keep the bottom-right resize handle',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
