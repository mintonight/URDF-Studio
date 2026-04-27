import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { DEFAULT_LINK } from '@/types/constants';
import type { RobotFile, RobotState } from '@/types';
import { GeometryType, JointType } from '@/types';
import { useSelectionStore, useUIStore } from '@/store';

import { TreeEditor } from './TreeEditor.tsx';

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
  (globalThis as { SVGElement?: typeof SVGElement }).SVGElement = dom.window.SVGElement;
  (globalThis as { Node?: typeof Node }).Node = dom.window.Node;
  (globalThis as { Event?: typeof Event }).Event = dom.window.Event;
  (globalThis as { MouseEvent?: typeof MouseEvent }).MouseEvent = dom.window.MouseEvent;
  (globalThis as { requestAnimationFrame?: typeof requestAnimationFrame }).requestAnimationFrame =
    dom.window.requestAnimationFrame.bind(dom.window);
  (globalThis as { cancelAnimationFrame?: typeof cancelAnimationFrame }).cancelAnimationFrame =
    dom.window.cancelAnimationFrame.bind(dom.window);
  (globalThis as { getComputedStyle?: typeof getComputedStyle }).getComputedStyle =
    dom.window.getComputedStyle.bind(dom.window);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  return dom;
}

function createRobotState(): RobotState {
  return {
    name: 'demo',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
    },
    joints: {},
    rootLinkId: 'base_link',
    selection: { type: null, id: null },
  };
}

function createRobotStateWithJoint(): RobotState {
  return {
    name: 'demo',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
      },
      child_link: {
        ...DEFAULT_LINK,
        id: 'child_link',
        name: 'child_link',
        visual: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
        collision: {
          type: GeometryType.BOX,
          dimensions: { x: 0.2, y: 0.2, z: 0.2 },
          color: '#00ff00',
          origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        },
      },
    },
    joints: {
      joint_1: {
        id: 'joint_1',
        name: 'joint_1',
        type: JointType.REVOLUTE,
        parentLinkId: 'base_link',
        childLinkId: 'child_link',
        origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
        axis: { x: 0, y: 0, z: 1 },
        limit: { lower: -1, upper: 1, effort: 10, velocity: 5 },
        dynamics: { damping: 0, friction: 0 },
        hardware: {
          armature: 0,
          motorType: '',
          motorId: '',
          motorDirection: 1,
        },
      },
    },
    rootLinkId: 'base_link',
    selection: { type: 'link', id: 'base_link' },
  };
}

function createRobotFile(name: string): RobotFile {
  return {
    name,
    format: 'urdf',
    content: '<robot name="demo"><link name="base_link" /></robot>',
  };
}

async function clickByText(dom: JSDOM, container: HTMLElement, text: string) {
  const target = Array.from(dom.window.document.querySelectorAll('button, span')).find(
    (element) => element.textContent?.trim() === text,
  );
  assert.ok(target, `expected element with text "${text}"`);

  await act(async () => {
    target.dispatchEvent(
      new dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

async function clickButtonByTitle(dom: JSDOM, title: string) {
  const target = Array.from(dom.window.document.querySelectorAll('button')).find(
    (element) => element.getAttribute('title') === title,
  );
  assert.ok(target, `expected button with title "${title}"`);

  await act(async () => {
    target.dispatchEvent(
      new dom.window.MouseEvent('click', {
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

function findSectionRootByLabel(container: HTMLElement, label: string) {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
    (element) => element.textContent?.trim() === label,
  );
  assert.ok(labelElement, `expected section label "${label}"`);

  let current = labelElement.parentElement;
  while (current) {
    if (
      typeof current.className === 'string' &&
      current.className.includes('flex-col') &&
      current.className.includes('border-b')
    ) {
      return current;
    }
    current = current.parentElement;
  }

  assert.fail(`expected section root for label "${label}"`);
}

function findFlexSectionRootByLabel(container: HTMLElement, label: string) {
  const labelElement = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
    (element) => element.textContent?.trim() === label,
  );
  assert.ok(labelElement, `expected section label "${label}"`);

  let current = labelElement.parentElement;
  while (current) {
    if (current.style.flex) {
      return current;
    }
    current = current.parentElement;
  }

  assert.fail(`expected flex section root for label "${label}"`);
}

function renderTreeEditor(options: {
  root: Root;
  availableFiles: RobotFile[];
  onRequestLoadRobot: (
    file: RobotFile,
    intent: 'direct' | 'save-draft' | 'discard',
  ) =>
    | Promise<'loaded' | 'needs-draft-confirm' | 'blocked'>
    | 'loaded'
    | 'needs-draft-confirm'
    | 'blocked';
}) {
  return act(async () => {
    options.root.render(
      <TreeEditor
        robot={createRobotState()}
        onSelect={() => {}}
        onAddChild={() => {}}
        onAddCollisionBody={() => {}}
        onDelete={() => {}}
        onNameChange={() => {}}
        onUpdate={() => {}}
        showVisual
        setShowVisual={() => {}}
        mode="editor"
        lang="en"
        theme="light"
        collapsed={false}
        onToggle={() => {}}
        availableFiles={options.availableFiles}
        onRequestLoadRobot={options.onRequestLoadRobot}
      />,
    );
  });
}

test('TreeEditor asks whether to save a draft before opening another library model', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({ sidebarTab: 'structure' });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/arm_b.urdf');
  const requests: Array<{ fileName: string; intent: 'direct' | 'save-draft' | 'discard' }> = [];

  try {
    await renderTreeEditor({
      root,
      availableFiles: [targetFile],
      onRequestLoadRobot: async (file, intent) => {
        requests.push({ fileName: file.name, intent });
        return intent === 'direct' ? 'needs-draft-confirm' : 'loaded';
      },
    });

    await clickByText(dom, container, 'arm_b.urdf');

    const dialog = dom.window.document.querySelector('[role="dialog"][aria-modal="true"]');
    assert.ok(dialog, 'expected unsaved draft dialog to open');
    assert.equal(
      dialog.textContent?.includes('Save current edits before opening another model?'),
      true,
    );

    await clickByText(dom, container, 'Discard and open');

    assert.deepEqual(requests, [
      { fileName: 'robots/arm_b.urdf', intent: 'direct' },
      { fileName: 'robots/arm_b.urdf', intent: 'discard' },
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor forwards the save-draft decision for pending library switches', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({ sidebarTab: 'structure' });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/arm_c.urdf');
  const requests: Array<{ fileName: string; intent: 'direct' | 'save-draft' | 'discard' }> = [];

  try {
    await renderTreeEditor({
      root,
      availableFiles: [targetFile],
      onRequestLoadRobot: async (file, intent) => {
        requests.push({ fileName: file.name, intent });
        return intent === 'direct' ? 'needs-draft-confirm' : 'loaded';
      },
    });

    await clickByText(dom, container, 'arm_c.urdf');
    await clickByText(dom, container, 'Save draft and open');

    assert.deepEqual(requests, [
      { fileName: 'robots/arm_c.urdf', intent: 'direct' },
      { fileName: 'robots/arm_c.urdf', intent: 'save-draft' },
    ]);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor keeps file-row clicks in workspace mode as preview and reserves add button for insertion', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({ sidebarTab: 'workspace' });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/arm_preview.urdf');
  const previewRequests: string[] = [];
  const loadRequests: Array<{ fileName: string; intent: 'direct' | 'save-draft' | 'discard' }> = [];
  const addRequests: string[] = [];

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onNameChange={() => {}}
          onUpdate={() => {}}
          showVisual
          setShowVisual={() => {}}
          mode="editor"
          lang="en"
          theme="light"
          collapsed={false}
          onToggle={() => {}}
          availableFiles={[targetFile]}
          onLoadRobot={(file) => {
            previewRequests.push(file.name);
          }}
          onRequestLoadRobot={async (file, intent) => {
            loadRequests.push({ fileName: file.name, intent });
            return 'loaded' as const;
          }}
          onAddComponent={(file) => {
            addRequests.push(file.name);
          }}
        />,
      );
    });

    await clickByText(dom, container, 'arm_preview.urdf');

    assert.deepEqual(previewRequests, ['robots/arm_preview.urdf']);
    assert.deepEqual(loadRequests, []);
    assert.deepEqual(addRequests, []);

    await clickButtonByTitle(dom, 'Load to Workspace');

    assert.deepEqual(addRequests, ['robots/arm_preview.urdf']);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor uses an invisible edge hit area for the file browser resize handle', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    sidebarTab: 'structure',
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeFileBrowserHeight: 216,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await renderTreeEditor({
      root,
      availableFiles: [],
      onRequestLoadRobot: () => 'loaded',
    });

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-file-browser-resize-handle"]',
    );
    assert.ok(resizeHandle, 'file browser resize handle should render');
    assert.match(resizeHandle.className, /\bbg-transparent\b/);
    assert.ok(!/\bbg-border-black\b/.test(resizeHandle.className));

    await act(async () => {
      resizeHandle.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          clientY: 200,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mousemove', {
          bubbles: true,
          clientY: 20,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', {
          bubbles: true,
        }),
      );
    });

    assert.equal(useUIStore.getState().panelLayout.treeFileBrowserHeight, 40);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor lets the joint section grow by dragging the boundary downward', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    sidebarTab: 'structure',
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 132,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onNameChange={() => {}}
          onUpdate={() => {}}
          showVisual
          setShowVisual={() => {}}
          mode="editor"
          lang="en"
          theme="light"
          collapsed={false}
          onToggle={() => {}}
          showJointPanel
          onJointAngleChange={() => {}}
        />,
      );
    });

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-resize-handle"]',
    );
    assert.ok(resizeHandle, 'joint section resize handle should render');
    assert.match(resizeHandle.className, /\bbg-transparent\b/);

    await act(async () => {
      resizeHandle.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          clientY: 200,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mousemove', {
          bubbles: true,
          clientY: 260,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', {
          bubbles: true,
        }),
      );
    });

    assert.equal(useUIStore.getState().panelLayout.treeJointPanelHeight, 192);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor restores file browser and structure disclosure state after remounting', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);
  let remountedRoot: Root | null = null;

  useUIStore.setState({
    sidebarTab: 'structure',
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeFileBrowserHeight: 216,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/persisted_sidebar.urdf');

  try {
    await renderTreeEditor({
      root,
      availableFiles: [targetFile],
      onRequestLoadRobot: () => 'loaded',
    });

    assert.match(container.textContent ?? '', /persisted_sidebar\.urdf/);
    assert.match(container.textContent ?? '', /base_link/);

    await clickByText(dom, container, 'Asset Library');
    await clickByText(dom, container, 'Structure Tree');

    assert.equal(useUIStore.getState().panelSections.tree_editor_file_browser, true);
    assert.equal(useUIStore.getState().panelSections.tree_editor_structure, true);

    await act(async () => {
      root.unmount();
    });

    remountedRoot = createRoot(container);

    await renderTreeEditor({
      root: remountedRoot,
      availableFiles: [targetFile],
      onRequestLoadRobot: () => 'loaded',
    });

    assert.doesNotMatch(container.textContent ?? '', /persisted_sidebar\.urdf/);
    assert.doesNotMatch(container.textContent ?? '', /base_link/);
  } finally {
    await act(async () => {
      remountedRoot?.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor keeps the file browser at its fixed height when the structure tree is collapsed', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    sidebarTab: 'structure',
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeFileBrowserHeight: 216,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  const targetFile = createRobotFile('robots/sidebar-height-lock.urdf');

  try {
    await renderTreeEditor({
      root,
      availableFiles: [targetFile],
      onRequestLoadRobot: () => 'loaded',
    });

    await clickByText(dom, container, 'Structure Tree');

    const fileBrowserRoot = findSectionRootByLabel(container, 'Asset Library');
    assert.doesNotMatch(
      fileBrowserRoot.className,
      /\bflex-1\b/,
      'file browser should not absorb the freed space when the structure tree collapses',
    );
    assert.match(
      fileBrowserRoot.className,
      /\bshrink-0\b/,
      'file browser should keep its fixed-height layout when the structure tree collapses',
    );
    assert.equal(
      fileBrowserRoot.style.height,
      '216px',
      'file browser should keep its stored height so the structure tree collapses upward',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor structure section avoids animating its full flex layout when toggled', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({ sidebarTab: 'structure' });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await renderTreeEditor({
      root,
      availableFiles: [],
      onRequestLoadRobot: () => 'loaded',
    });

    const structureRoot = findFlexSectionRootByLabel(container, 'Structure Tree');
    assert.doesNotMatch(
      structureRoot.className,
      /\btransition-all\b/,
      'structure section should not animate full layout properties because that makes the sidebar jitter on collapse/expand',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor keeps the structure header height and chevron size stable when a source file is shown', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({ sidebarTab: 'structure' });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onNameChange={() => {}}
          onUpdate={() => {}}
          showVisual
          setShowVisual={() => {}}
          mode="editor"
          lang="en"
          theme="light"
          collapsed={false}
          onToggle={() => {}}
          currentFileName="robots/imports/very_long_robot_filename_that_should_truncate_cleanly.urdf"
        />,
      );
    });

    const structureLabel = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
      (element) => element.textContent?.trim() === 'Structure Tree',
    );
    assert.ok(structureLabel, 'structure section label should render');

    const structureHeaderLeft = structureLabel.parentElement;
    assert.ok(structureHeaderLeft, 'structure header left section should render');
    assert.match(
      structureHeaderLeft.className,
      /\bflex-1\b/,
      'structure header left section should absorb the remaining width',
    );
    assert.match(
      structureHeaderLeft.className,
      /\boverflow-hidden\b/,
      'structure header left section should truncate long source file names instead of shrinking icons',
    );

    const structureHeader = structureHeaderLeft.parentElement as HTMLElement | null;
    assert.ok(structureHeader, 'structure header should render');
    assert.match(
      structureHeader.className,
      /\bh-8\b/,
      'structure header should keep a fixed height when the source file chip appears',
    );

    const chevron = structureHeaderLeft.querySelector('svg');
    assert.ok(chevron, 'structure header chevron should render');
    assert.match(
      chevron.getAttribute('class') ?? '',
      /\bshrink-0\b/,
      'structure header chevron should not shrink when the source file chip is visible',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor joint section can grow past the old compact cap when dragged downward', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    sidebarTab: 'structure',
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 240,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onNameChange={() => {}}
          onUpdate={() => {}}
          showVisual
          setShowVisual={() => {}}
          mode="editor"
          lang="en"
          theme="light"
          collapsed={false}
          onToggle={() => {}}
          showJointPanel
          onJointAngleChange={() => {}}
        />,
      );
    });

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-resize-handle"]',
    );
    assert.ok(resizeHandle, 'joint section resize handle should render');

    await act(async () => {
      resizeHandle.dispatchEvent(
        new dom.window.MouseEvent('mousedown', {
          bubbles: true,
          clientY: 140,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mousemove', {
          bubbles: true,
          clientY: 320,
        }),
      );
      dom.window.document.dispatchEvent(
        new dom.window.MouseEvent('mouseup', {
          bubbles: true,
        }),
      );
    });

    assert.equal(useUIStore.getState().panelLayout.treeJointPanelHeight, 420);
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor still renders the joint section when the robot has no joints', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    sidebarTab: 'structure',
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 132,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotState()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onNameChange={() => {}}
          onUpdate={() => {}}
          showVisual
          setShowVisual={() => {}}
          mode="editor"
          lang="en"
          theme="light"
          collapsed={false}
          onToggle={() => {}}
          showJointPanel
          onJointAngleChange={() => {}}
        />,
      );
    });

    const jointToggle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-toggle"]',
    );
    assert.ok(jointToggle, 'joint section should render even without joints');

    const resizeHandle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-resize-handle"]',
    );
    assert.ok(resizeHandle, 'joint section boundary handle should still render');
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});

test('TreeEditor renders the joint section before the structure section so collapsing it does not move the joint header', async () => {
  const dom = installDom();
  const container = dom.window.document.getElementById('root');
  assert.ok(container, 'root container should exist');
  const root = createRoot(container);

  useUIStore.setState({
    sidebarTab: 'structure',
    panelSections: {},
    panelLayout: {
      ...useUIStore.getState().panelLayout,
      treeJointPanelHeight: 132,
    },
  });
  useSelectionStore.setState({ selection: { type: null, id: null } });

  try {
    await act(async () => {
      root.render(
        <TreeEditor
          robot={createRobotStateWithJoint()}
          onSelect={() => {}}
          onAddChild={() => {}}
          onAddCollisionBody={() => {}}
          onDelete={() => {}}
          onNameChange={() => {}}
          onUpdate={() => {}}
          showVisual
          setShowVisual={() => {}}
          mode="editor"
          lang="en"
          theme="light"
          collapsed={false}
          onToggle={() => {}}
          showJointPanel
          onJointAngleChange={() => {}}
        />,
      );
    });

    const structureLabel = Array.from(container.querySelectorAll<HTMLElement>('span')).find(
      (element) => element.textContent?.trim() === 'Structure Tree',
    );
    const jointToggle = container.querySelector<HTMLElement>(
      '[data-testid="tree-editor-joint-section-toggle"]',
    );
    assert.ok(structureLabel, 'structure section label should render');
    assert.ok(jointToggle, 'joint section toggle should render');

    const structureHeader = structureLabel.closest<HTMLElement>('div');
    const jointHeader = jointToggle.closest<HTMLElement>('div');
    assert.ok(structureHeader, 'structure section header should render');
    assert.ok(jointHeader, 'joint section header should render');
    assert.equal(
      Boolean(
        jointHeader.compareDocumentPosition(structureHeader) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
      true,
      'joint section should render before the structure section so the structure tree moves up when the joint content collapses',
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    dom.window.close();
  }
});
