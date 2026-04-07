import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { JointType, type RobotState } from '@/types';
import { TREE_JOINT_NAME_TEXT_CLASS } from './presentation';
import { TreeNodeJointBranchList } from './TreeNodeJointBranchList.tsx';

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

async function destroyComponentRoot(dom: JSDOM, root: Root) {
  await act(async () => {
    root.unmount();
  });
  dom.window.close();
}

function createJoint(
  overrides: Partial<RobotState['joints'][string]> = {},
): RobotState['joints'][string] {
  return {
    id: 'elbow_joint',
    name: 'elbow_joint',
    type: JointType.REVOLUTE,
    parentLinkId: 'upper_arm',
    childLinkId: 'forearm',
    origin: {
      xyz: { x: 0, y: 0, z: 0 },
      rpy: { r: 0, p: 0, y: 0 },
    },
    axis: { x: 0, y: 0, z: 1 },
    limit: { lower: -1, upper: 1, effort: 1, velocity: 1 },
    dynamics: { damping: 0, friction: 0 },
    hardware: {
      armature: 0,
      motorType: '',
      motorId: '',
      motorDirection: 1,
    },
    ...overrides,
  };
}

test('TreeNodeJointBranchList does not highlight the joint row when only the child link is selected', async () => {
  const { dom, container, root } = createComponentRoot();

  try {
    const joint = createJoint();

    await act(async () => {
      root.render(
        <TreeNodeJointBranchList
          childJoints={[joint]}
          robotSelection={{ type: 'link', id: joint.childLinkId }}
          hoveredSelection={{ type: null, id: null }}
          attentionSelection={{ type: null, id: null }}
          selectionBranchLinkIds={new Set(['upper_arm', 'forearm'])}
          editingTarget={null}
          renameInputRef={createRef<HTMLInputElement>()}
          jointRowRefs={{ current: {} }}
          jointRowIndentPx={10}
          parentLinkDisplayName="upper_arm"
          childLinkDisplayNames={{ [joint.childLinkId]: 'forearm' }}
          t={translations.en}
          readOnly={false}
          onSelect={() => {}}
          onDelete={() => {}}
          onSetHoveredSelection={() => {}}
          onClearHover={() => {}}
          onOpenContextMenu={() => {}}
          onUpdateRenameDraft={() => {}}
          onCommitRenaming={() => {}}
          onCancelRenaming={() => {}}
          onNameDoubleClick={() => {}}
          renderChildNode={(childLinkId) => <div data-testid={`child-${childLinkId}`} />}
        />,
      );
    });

    const jointRow = container.querySelector(
      `[title="${joint.name} · Revolute"]`,
    ) as HTMLDivElement | null;
    assert.ok(jointRow, 'joint row should render');

    assert.ok(
      !jointRow.className.includes(
        'bg-system-blue/10 text-text-primary ring-1 ring-inset ring-system-blue/15',
      ),
      'child link selection should not promote the parent joint row into hovered highlight state',
    );
    assert.ok(
      !jointRow.className.includes(
        'bg-system-blue/10 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue/20',
      ),
      'child link selection should not promote the parent joint row into selected highlight state',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNodeJointBranchList keeps rename input typography aligned with the rendered label', async () => {
  const { dom, container, root } = createComponentRoot();
  const joint = createJoint();
  const renameInputRef = createRef<HTMLInputElement>();

  const renderBranchList = async (editing: boolean) => {
    await act(async () => {
      root.render(
        <TreeNodeJointBranchList
          childJoints={[joint]}
          robotSelection={{ type: null, id: null }}
          hoveredSelection={{ type: null, id: null }}
          attentionSelection={{ type: null, id: null }}
          selectionBranchLinkIds={new Set(['upper_arm', 'forearm'])}
          editingTarget={editing ? { type: 'joint', id: joint.id, draft: joint.name } : null}
          renameInputRef={renameInputRef}
          jointRowRefs={{ current: {} }}
          jointRowIndentPx={10}
          parentLinkDisplayName="upper_arm"
          childLinkDisplayNames={{ [joint.childLinkId]: 'forearm' }}
          t={translations.en}
          readOnly={false}
          onSelect={() => {}}
          onDelete={() => {}}
          onSetHoveredSelection={() => {}}
          onClearHover={() => {}}
          onOpenContextMenu={() => {}}
          onUpdateRenameDraft={() => {}}
          onCommitRenaming={() => {}}
          onCancelRenaming={() => {}}
          onNameDoubleClick={() => {}}
          renderChildNode={(childLinkId) => <div data-testid={`child-${childLinkId}`} />}
        />,
      );
    });
  };

  try {
    await renderBranchList(false);

    const label = container.querySelector('span[title="elbow_joint"]') as HTMLSpanElement | null;
    assert.ok(label, 'joint label should render');

    for (const token of TREE_JOINT_NAME_TEXT_CLASS.split(' ')) {
      assert.ok(label.className.includes(token), `label should include ${token}`);
    }

    await renderBranchList(true);

    const input = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(input, 'rename input should render');

    for (const token of TREE_JOINT_NAME_TEXT_CLASS.split(' ')) {
      assert.ok(input.className.includes(token), `rename input should include ${token}`);
    }
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
