import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { ViewerOptionsPanel } from './ViewerOptionsPanel';
import { useSelectionStore } from '@/store/selectionStore';

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

function resetSelectionStore() {
  const state = useSelectionStore.getState();
  state.setInteractionGuard(null);
  state.setHoverFrozen(false);
  while (useSelectionStore.getState().hoverBlockCount > 0) {
    useSelectionStore.getState().endHoverBlock();
  }
  state.clearHover();
  state.setHoveredSelection({ type: null, id: null });
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

test('ViewerOptionsPanel hides model opacity and ground plane detail controls', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, true);

  assert.equal(container.textContent?.includes('Model Opacity'), false);
  assert.equal(container.textContent?.includes('Ground Offset'), false);
  assert.equal(container.textContent?.includes('Auto Fit Ground'), false);
  assert.equal(container.textContent?.includes('Reset'), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel shows geometry and collision icons for the top toggles', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  assert.ok(
    container.querySelector('svg.lucide-shapes'),
    'show visual toggle should render a geometry icon',
  );
  assert.ok(
    container.querySelector('svg.lucide-shield'),
    'show collision toggle should render a collision icon',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('viewer size sliders keep the full-width layout without indentation', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false, {
    showOrigins: true,
    showJointAxes: true,
  });

  const sliderTracks = Array.from(
    container.querySelectorAll<HTMLDivElement>('[data-testid="ui-slider-track"]'),
  );
  assert.ok(sliderTracks.length >= 2, 'viewer panel should render the enabled size sliders');

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

test('ViewerOptionsPanel uses a slightly narrower default width', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  const panelContainer = container.querySelector<HTMLElement>('.urdf-options-panel > div');
  assert.ok(panelContainer, 'viewer options panel container should render');
  assert.equal(panelContainer.style.width, '9.5rem');

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel uses a slightly smaller corner radius', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  const panelContainer = container.querySelector<HTMLElement>('.urdf-options-panel > div');
  assert.ok(panelContainer, 'viewer options panel container should render');
  assert.match(panelContainer.className, /\brounded-lg\b/);
  assert.doesNotMatch(panelContainer.className, /\brounded-xl\b/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel uses a shorter header bar', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  const header = container.querySelector<HTMLElement>(
    '.urdf-options-panel > div > div:first-child',
  );
  assert.ok(header, 'viewer options panel header should render');
  assert.match(header.className, /!py-1/);
  assert.match(header.className, /!px-1\.5/);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});

test('ViewerOptionsPanel keeps the same right-edge resize affordance as the joints panel', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  assert.ok(
    container.querySelector('[data-testid="ui-options-panel-resize-right"]'),
    'view options panel should render a right-edge resize handle',
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

test('ViewerOptionsPanel freezes shared hover while the pointer is over the panel surface', async () => {
  resetSelectionStore();

  const { dom, container, root } = createComponentRoot();
  useSelectionStore.getState().setHoveredSelection({ type: 'link', id: 'base_link' });

  await renderPanel(root, false);

  const panelRoot = container.querySelector('.urdf-options-panel') as HTMLDivElement | null;
  assert.ok(panelRoot, 'viewer options panel root should render');

  await act(async () => {
    panelRoot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });

  let nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, true);
  assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });

  await act(async () => {
    panelRoot.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
  });

  nextState = useSelectionStore.getState();
  assert.equal(nextState.hoverFrozen, false);
  assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });

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

test('ViewerOptionsPanel no longer renders the IK row', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root, false);

  assert.equal(container.textContent?.includes('Show IK Handles'), false);

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
