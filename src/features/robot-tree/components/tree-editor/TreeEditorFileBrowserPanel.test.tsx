import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import type { RobotFile } from '@/types';
import { buildFileTree } from '../../utils';
import { TreeEditorFileBrowserPanel } from './TreeEditorFileBrowserPanel.tsx';

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
  (globalThis as { HTMLInputElement?: typeof HTMLInputElement }).HTMLInputElement =
    dom.window.HTMLInputElement;
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

function createComponentRoot() {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');

  const root = createRoot(container);
  return { dom, container, root };
}

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function renderPanel({
  root,
  file,
  showAddAsComponent,
  onAddComponent,
  onLoadRobot,
  folderRenameInputRef = createRef<HTMLInputElement>(),
}: {
  root: Root;
  file: RobotFile;
  showAddAsComponent: boolean;
  onAddComponent?: (file: RobotFile) => void;
  onLoadRobot?: (file: RobotFile) => void;
  folderRenameInputRef?: RefObject<HTMLInputElement | null>;
}) {
  return act(async () => {
    root.render(
      <TreeEditorFileBrowserPanel
        isOpen
        isDragging={false}
        showAddAsComponent={showAddAsComponent}
        height={240}
        shouldFillSpace={false}
        availableFiles={[file]}
        fileTree={buildFileTree([file])}
        expandedFolders={new Set()}
        editingFolderPath={null}
        folderRenameDraft=""
        folderRenameInputRef={folderRenameInputRef}
        canDeleteAllLibraryFiles={false}
        t={translations.en}
        onToggleOpen={() => {}}
        onDeleteAll={() => {}}
        onFolderRenameDraftChange={() => {}}
        onCommitFolderRename={() => {}}
        onCancelFolderRename={() => {}}
        onLoadRobot={onLoadRobot}
        onAddComponent={onAddComponent}
        onFileContextMenu={() => {}}
        onFolderContextMenu={() => {}}
        toggleFolder={() => {}}
      />,
    );
  });
}

test('TreeEditorFileBrowserPanel opens files from row clicks and reserves the add button for components', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    const file: RobotFile = {
      name: 'arm.urdf',
      content: '<robot name="arm" />',
      format: 'urdf',
    };
    const addedFiles: string[] = [];
    const loadedFiles: string[] = [];

    await renderPanel({
      root,
      file,
      showAddAsComponent: true,
      onAddComponent: (nextFile) => {
        addedFiles.push(nextFile.name);
      },
      onLoadRobot: (nextFile) => {
        loadedFiles.push(nextFile.name);
      },
    });

    const fileLabel = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent === 'arm.urdf',
    );
    assert.ok(fileLabel, 'file label should render');

    await act(async () => {
      fileLabel.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(addedFiles, []);
    assert.deepEqual(loadedFiles, ['arm.urdf']);

    const addButton = Array.from(container.querySelectorAll('button')).find(
      (element) => element.getAttribute('title') === translations.en.addComponent,
    );
    assert.ok(addButton, 'add button should render for component-capable files');
    assert.match(
      addButton.className,
      /\bshrink-0\b/,
      'add button must remain visible when file names and format badges shrink',
    );
    const addButtonLabel = addButton.querySelector('span');
    assert.ok(addButtonLabel, 'add button should keep a text label for wider sidebars');
    assert.match(
      addButtonLabel.className,
      /\bhidden\b/,
      'narrow sidebars should keep the add icon visible by hiding the text label first',
    );
    assert.match(
      addButtonLabel.className,
      /@\[260px\]:inline/,
      'add button text should reappear when the sidebar has enough width',
    );

    await act(async () => {
      addButton.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(addedFiles, ['arm.urdf']);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeEditorFileBrowserPanel previews image assets instead of adding them', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    const file: RobotFile = {
      name: 'poster.png',
      content: '',
      format: 'mesh',
    };
    const addedFiles: string[] = [];
    const loadedFiles: string[] = [];

    await renderPanel({
      root,
      file,
      showAddAsComponent: true,
      onAddComponent: (nextFile) => {
        addedFiles.push(nextFile.name);
      },
      onLoadRobot: (nextFile) => {
        loadedFiles.push(nextFile.name);
      },
    });

    const fileLabel = Array.from(container.querySelectorAll('span')).find(
      (element) => element.textContent === 'poster.png',
    );
    assert.ok(fileLabel, 'image file label should render');

    await act(async () => {
      fileLabel.dispatchEvent(
        new dom.window.MouseEvent('click', {
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    assert.deepEqual(addedFiles, []);
    assert.deepEqual(loadedFiles, ['poster.png']);
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
