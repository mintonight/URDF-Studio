import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { MeasurePanel } from './MeasurePanel';
import { clearMeasureState } from '../utils/measurements';

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

async function renderPanel(root: Root) {
  await act(async () => {
    root.render(
      React.createElement(MeasurePanel, {
        toolMode: 'measure',
        measurePanelRef: { current: null },
        measurePanelPos: null,
        onMouseDown: () => {},
        onClose: () => {},
        measureState: clearMeasureState(),
        setMeasureState: () => {},
        measureAnchorMode: 'frame',
        setMeasureAnchorMode: () => {},
        showMeasureDecomposition: false,
        setShowMeasureDecomposition: () => {},
        lang: 'zh',
      }),
    );
  });
}

test('MeasurePanel keeps the snap selector compact and drops the verbose helper copy', async () => {
  const { dom, container, root } = createComponentRoot();

  await renderPanel(root);

  assert.equal(
    container.textContent?.includes(
      '可选择吸附到 link frame / TF 原点、质心，或几何中心来测量距离',
    ),
    false,
    'measure panel should not render the old explanatory sentence',
  );
  assert.equal(container.textContent?.includes('吸附'), true);

  const anchorButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).filter(
    (button) => ['原点', '质心', '几何中心'].includes(button.textContent?.trim() ?? ''),
  );

  assert.equal(anchorButtons.length, 3, 'measure panel should expose the three snap targets');
  anchorButtons.forEach((button) => {
    assert.match(
      button.className,
      /text-\[11px\]/,
      'compact snap buttons should use the xs segmented control sizing',
    );
  });

  const segmentedControl = anchorButtons[0]?.parentElement as HTMLDivElement | null;
  assert.ok(segmentedControl, 'segmented control wrapper should render');
  assert.match(
    segmentedControl.className,
    /\[&>button\]:min-h-5/,
    'snap control should apply the compact button-height override',
  );
  assert.match(
    segmentedControl.className,
    /\[&>button\]:!px-1\.5/,
    'snap control should use compact horizontal padding',
  );
  assert.match(
    segmentedControl.className,
    /\[&>button\]:whitespace-nowrap/,
    'snap labels should stay on one line',
  );

  await act(async () => {
    root.unmount();
  });
  dom.window.close();
});
