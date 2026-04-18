import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DraggableWindow } from './DraggableWindow';
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
  (globalThis as { HTMLButtonElement?: typeof HTMLButtonElement }).HTMLButtonElement =
    dom.window.HTMLButtonElement;
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

test('DraggableWindow freezes shared hover while hovered and releases the block on unmount', async () => {
  resetSelectionStore();

  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const windowRef = createRef<HTMLDivElement>();

  useSelectionStore.getState().setHoveredSelection({ type: 'link', id: 'base_link' });

  try {
    await act(async () => {
      root.render(
        React.createElement(DraggableWindow, {
          window: {
            isMaximized: false,
            isMinimized: false,
            isDragging: false,
            isResizing: false,
            containerRef: windowRef,
            handleDragStart: () => {},
            handleResizeStart: () => {},
            toggleMaximize: () => {},
            toggleMinimize: () => {},
            windowStyle: {},
          },
          onClose: () => {},
          title: 'Export',
          children: React.createElement('div', null, 'content'),
        }),
      );
    });

    const windowRoot = container.firstElementChild as HTMLDivElement | null;
    assert.ok(windowRoot, 'draggable window should render');

    await act(async () => {
      windowRoot.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    let nextState = useSelectionStore.getState();
    assert.equal(nextState.hoverFrozen, true);
    assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });

    await act(async () => {
      root.unmount();
    });

    nextState = useSelectionStore.getState();
    assert.equal(nextState.hoverFrozen, false);
    assert.deepEqual(nextState.hoveredSelection, { type: null, id: null });
  } finally {
    dom.window.close();
  }
});
