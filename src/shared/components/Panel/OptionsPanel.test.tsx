import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { OptionsPanel } from './OptionsPanel';
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

  (globalThis as { HTMLElement?: typeof HTMLElement }).HTMLElement = dom.window.HTMLElement;
  (globalThis as { HTMLDivElement?: typeof HTMLDivElement }).HTMLDivElement =
    dom.window.HTMLDivElement;
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

test('OptionsPanel can transition from hidden to visible without changing hook order', async () => {
  resetSelectionStore();

  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const panelRef = createRef<HTMLDivElement>();

  try {
    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: false,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: true,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    assert.equal(container.textContent?.includes('content'), true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('OptionsPanel uses a slimmer shared header by default', async () => {
  resetSelectionStore();

  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const panelRef = createRef<HTMLDivElement>();

  try {
    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: true,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    const titleNode = Array.from(container.querySelectorAll<HTMLElement>('span,div')).find(
      (element) => element.textContent?.trim() === 'Options',
    );
    const header = titleNode?.closest<HTMLElement>('div.group');
    assert.ok(header, 'options panel header should render');
    assert.match(header.className, /\bpx-2\b/);
    assert.match(header.className, /\bpy-1\.5\b/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('OptionsPanel uses a slightly smaller shared corner radius by default', async () => {
  resetSelectionStore();

  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const panelRef = createRef<HTMLDivElement>();

  try {
    await act(async () => {
      root.render(
        React.createElement(OptionsPanel, {
          title: 'Options',
          show: true,
          isCollapsed: false,
          onToggleCollapse: () => {},
          panelRef,
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    const panelContainer = container.querySelector<HTMLElement>('.bg-panel-bg');
    assert.ok(panelContainer, 'options panel container should render');
    assert.match(panelContainer.className, /\brounded-lg\b/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
