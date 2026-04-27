import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import type { DocumentLoadState } from '@/store/assetsStore';
import type { RobotFile } from '@/types';

import { FilePreviewWindow } from './FilePreviewWindow.tsx';

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
  (globalThis as { SVGElement?: typeof SVGElement }).SVGElement = dom.window.SVGElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { KeyboardEvent?: typeof KeyboardEvent }).KeyboardEvent = dom.window.KeyboardEvent;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createImageFile(name: string): RobotFile {
  return {
    name,
    format: 'mesh',
    content: '',
  };
}

function createRobotFile(name: string): RobotFile {
  return {
    name,
    format: 'urdf',
    content: '<robot name="demo"><link name="base_link" /></robot>',
  };
}

function renderWindow(options: {
  root: Root;
  file: RobotFile | null;
  assets?: Record<string, string>;
  documentLoadState?: DocumentLoadState;
  onClose?: () => void;
}) {
  const documentLoadState: DocumentLoadState = options.documentLoadState ?? {
    status: 'ready',
    fileName: options.file?.name ?? null,
    format: options.file?.format ?? null,
    error: null,
  };

  return act(async () => {
    options.root.render(
      <FilePreviewWindow
        file={options.file}
        previewRobot={null}
        previewState={undefined}
        assets={options.assets ?? {}}
        allFileContents={{}}
        availableFiles={options.file ? [options.file] : []}
        documentLoadState={documentLoadState}
        lang="en"
        theme="light"
        onClose={options.onClose ?? (() => {})}
      />,
    );
  });
}

test('FilePreviewWindow renders image previews in a floating window and closes from the header control', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  const imageFile = createImageFile('textures/poster.png');
  let closeCount = 0;

  try {
    await renderWindow({
      root,
      file: imageFile,
      assets: {
        'textures/poster.png': 'blob:image-preview',
      },
      onClose: () => {
        closeCount += 1;
      },
    });

    assert.equal(container.textContent?.includes('File Preview: poster.png'), true);

    const image = container.querySelector('img');
    assert.ok(image, 'expected the preview window to render an image preview');
    assert.equal(image.getAttribute('src'), 'blob:image-preview');

    const closeButton = container.querySelector('button[aria-label="Close Preview"]');
    assert.ok(closeButton, 'expected a close button in the preview window header');

    await act(async () => {
      closeButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.equal(closeCount, 1);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('FilePreviewWindow shows a loading state while preview content is still resolving', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  const robotFile = createRobotFile('robots/demo.urdf');

  try {
    await renderWindow({
      root,
      file: robotFile,
      documentLoadState: {
        status: 'loading',
        fileName: robotFile.name,
        format: robotFile.format,
        error: null,
      },
    });

    assert.equal(container.textContent?.includes('Loading robot...'), true);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('FilePreviewWindow exposes an add action for addable preview files', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  const robotFile = createRobotFile('robots/demo.urdf');
  const addedFiles: string[] = [];

  try {
    await act(async () => {
      root.render(
        <FilePreviewWindow
          file={robotFile}
          previewRobot={null}
          previewState={undefined}
          assets={{}}
          allFileContents={{}}
          availableFiles={[robotFile]}
          documentLoadState={{
            status: 'ready',
            fileName: robotFile.name,
            format: robotFile.format,
            error: null,
          }}
          lang="en"
          theme="light"
          onClose={() => {}}
          onAddComponent={(file) => {
            addedFiles.push(file.name);
          }}
        />,
      );
    });

    const addButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Add'),
    );
    assert.ok(addButton, 'expected an add button in the preview window header');

    await act(async () => {
      addButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(addedFiles, [robotFile.name]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
