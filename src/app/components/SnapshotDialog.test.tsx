import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { SnapshotDialog } from './SnapshotDialog';

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
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

test('SnapshotDialog reuses the segmented surface tone for AA choices', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
        }),
      );
    });

    const twoXButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '2x',
    ) as HTMLButtonElement | undefined;
    assert.ok(twoXButton, 'AA segmented control should render the default 2x option');
    assert.match(
      twoXButton.className,
      /\bbg-segmented-active\b/,
      'selected AA option should use the same segmented active tone as settings controls',
    );
    assert.match(
      twoXButton.className,
      /\bring-1\b/,
      'selected AA option should keep the shared selected outline treatment',
    );

    const oneXButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === '1x',
    ) as HTMLButtonElement | undefined;
    assert.ok(oneXButton, 'AA segmented control should render the 1x option');
    assert.match(
      oneXButton.className,
      /\btext-text-secondary\b/,
      'unselected AA option should keep the shared secondary text tone',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog renders the live preview state and frozen-view hint', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'refreshing',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const previewImage = container.querySelector('img[alt="Snapshot live preview"]');
    assert.ok(previewImage, 'snapshot dialog should render the latest preview image');
    assert.equal(previewImage?.getAttribute('src'), 'blob:preview');

    const textContent = container.textContent ?? '';
    assert.match(textContent, /Live Preview/);
    assert.match(textContent, /Based on the view when this dialog opened/);
    assert.match(textContent, /Updating preview/);
    assert.match(textContent, /Final export quality still follows the selected resolution/);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog keeps the live preview inside the scrollable content area', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const scrollableContent = container.querySelector('.overflow-y-auto');
    assert.ok(scrollableContent, 'snapshot dialog should keep a scrollable content region');
    assert.match(
      scrollableContent.textContent ?? '',
      /Live Preview/,
      'preview content should stay inside the scrollable body instead of competing with the footer',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog keeps the preview in natural document flow instead of stretching it with filler spacing', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const scrollableContent = container.querySelector('.overflow-y-auto') as HTMLElement | null;
    assert.ok(scrollableContent, 'snapshot dialog should render the scrollable body');
    assert.doesNotMatch(
      scrollableContent.className,
      /\bflex-col\b/,
      'scrollable body should rely on the dialog size instead of stretching content with a flex column',
    );
    assert.doesNotMatch(
      scrollableContent.lastElementChild?.className ?? '',
      /\bmt-auto\b/,
      'preview card should keep its natural position directly after the scene section',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog auto-fits its default height to the rendered content when the viewport allows it', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(dom.window, 'innerHeight');
  const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    'scrollHeight',
  );
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    'offsetHeight',
  );

  Object.defineProperty(dom.window, 'innerHeight', {
    value: 900,
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.className.includes('overflow-y-auto') ? 596 : 0;
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.className.includes('h-10')) {
        return 40;
      }
      if (this.className.includes('border-t')) {
        return 46;
      }
      return 0;
    },
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const windowRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(windowRoot, 'snapshot dialog should render a draggable window root');
    assert.equal(
      windowRoot.style.height,
      '682px',
      'snapshot dialog should shrink to the content-fitted desktop height instead of keeping a fixed tall shell',
    );
  } finally {
    if (originalInnerHeightDescriptor) {
      Object.defineProperty(dom.window, 'innerHeight', originalInnerHeightDescriptor);
    }
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeightDescriptor,
      );
    } else {
      delete (dom.window.HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
    if (originalOffsetHeightDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeightDescriptor,
      );
    } else {
      delete (dom.window.HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('SnapshotDialog caps its auto-fitted height to the available viewport when the content is taller', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  const originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(dom.window, 'innerHeight');
  const originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    'scrollHeight',
  );
  const originalOffsetHeightDescriptor = Object.getOwnPropertyDescriptor(
    dom.window.HTMLElement.prototype,
    'offsetHeight',
  );

  Object.defineProperty(dom.window, 'innerHeight', {
    value: 680,
    configurable: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', {
    configurable: true,
    get() {
      return this.className.includes('overflow-y-auto') ? 700 : 0;
    },
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.className.includes('h-10')) {
        return 40;
      }
      if (this.className.includes('border-t')) {
        return 46;
      }
      return 0;
    },
  });

  try {
    await act(async () => {
      root.render(
        React.createElement(SnapshotDialog, {
          isOpen: true,
          isCapturing: false,
          lang: 'en',
          onClose: () => {},
          onCapture: () => {},
          previewState: {
            status: 'ready',
            imageUrl: 'blob:preview',
            aspectRatio: 16 / 9,
          },
        }),
      );
    });

    const windowRoot = container.firstElementChild as HTMLElement | null;
    assert.ok(windowRoot, 'snapshot dialog should render a draggable window root');
    assert.equal(
      windowRoot.style.height,
      '656px',
      'snapshot dialog should clamp the fitted height to the current viewport limit',
    );
  } finally {
    if (originalInnerHeightDescriptor) {
      Object.defineProperty(dom.window, 'innerHeight', originalInnerHeightDescriptor);
    }
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'scrollHeight',
        originalScrollHeightDescriptor,
      );
    } else {
      delete (dom.window.HTMLElement.prototype as { scrollHeight?: number }).scrollHeight;
    }
    if (originalOffsetHeightDescriptor) {
      Object.defineProperty(
        dom.window.HTMLElement.prototype,
        'offsetHeight',
        originalOffsetHeightDescriptor,
      );
    } else {
      delete (dom.window.HTMLElement.prototype as { offsetHeight?: number }).offsetHeight;
    }
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
