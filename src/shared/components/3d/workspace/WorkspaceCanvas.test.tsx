import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import {
  resolveWorkspaceCanvasResizeOptions,
  scheduleWorkspaceCanvasResizeEvent,
  WorkspaceCanvas,
} from './WorkspaceCanvas';

Object.defineProperty(import.meta, 'env', {
  value: {
    DEV: false,
  },
  configurable: true,
});

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
  (globalThis as { HTMLCanvasElement?: typeof HTMLCanvasElement }).HTMLCanvasElement =
    dom.window.HTMLCanvasElement;
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

test('WorkspaceCanvas logs unsupported WebGL failures without rendering in-canvas error UI', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalConsoleError = console.error;
  const consoleErrors: unknown[][] = [];
  console.error = (...args: unknown[]) => {
    consoleErrors.push(args);
  };

  try {
    await act(async () => {
      root.render(
        React.createElement(WorkspaceCanvas, {
          theme: 'light',
          lang: 'en',
          children: React.createElement('div', null, 'scene'),
        }),
      );
    });

    assert.equal(
      container.querySelector('[role="alert"]'),
      null,
      'unsupported WebGL should not render an in-canvas alert notice',
    );
    assert.equal(consoleErrors.length, 1, 'unsupported WebGL should still be reported to console');
    assert.match(
      String(consoleErrors[0]?.[0] ?? ''),
      /\[WorkspaceCanvas\] WebGL is unavailable; skipping 3D canvas rendering\./,
    );
    assert.match(String(consoleErrors[0]?.[1] ?? ''), /WebGL APIs are unavailable/);
  } finally {
    console.error = originalConsoleError;
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('WorkspaceCanvas keeps canvas resize responsive during sidebar drags', () => {
  const idleOptions = resolveWorkspaceCanvasResizeOptions(false);
  const dragOptions = resolveWorkspaceCanvasResizeOptions(true);

  assert.equal(idleOptions.debounce.resize, 120);
  assert.ok(
    dragOptions.debounce.resize <= idleOptions.debounce.resize,
    'active sidebar drag must not defer R3F resize long enough for WebGL to stretch',
  );
});

test('scheduleWorkspaceCanvasResizeEvent dispatches resize on the next animation frame', () => {
  let frameCallback: FrameRequestCallback | null = null;
  let dispatchedEventType: string | null = null;

  const frameId = scheduleWorkspaceCanvasResizeEvent({
    requestAnimationFrame: (callback) => {
      frameCallback = callback;
      return 12;
    },
    dispatchEvent: (event) => {
      dispatchedEventType = event.type;
      return true;
    },
  });

  assert.equal(frameId, 12);
  assert.equal(dispatchedEventType, null);
  assert.ok(frameCallback, 'resize should be scheduled after the current frame');

  frameCallback(100);

  assert.equal(dispatchedEventType, 'resize');
});
