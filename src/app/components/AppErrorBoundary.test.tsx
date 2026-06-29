import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { AppErrorBoundary } from './AppErrorBoundary';

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
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function ThrowValue({ value }: { value: unknown }): React.ReactElement {
  throw value;
}

test('AppErrorBoundary shows its fallback for falsy thrown values', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    await act(async () => {
      root.render(
        <AppErrorBoundary>
          <ThrowValue value={null} />
        </AppErrorBoundary>,
      );
    });

    const text = container.textContent ?? '';
    assert.match(text, /Something went wrong/);
    assert.match(text, /null/);
  } finally {
    console.error = originalConsoleError;
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
