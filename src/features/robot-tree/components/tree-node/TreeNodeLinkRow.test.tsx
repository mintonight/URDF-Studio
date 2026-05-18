import assert from 'node:assert/strict';
import test from 'node:test';

import React, { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';
import { TREE_LINK_NAME_TEXT_CLASS } from './presentation';
import { TreeNodeLinkRow } from './TreeNodeLinkRow.tsx';

const TREE_LINK_NAME_SIZE_TOKEN = 'text-[11px]';

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

test('TreeNodeLinkRow keeps rename input typography aligned with the rendered label', async () => {
  const { dom, container, root } = createComponentRoot();
  const renameInputRef = createRef<HTMLInputElement>();

  const renderRow = async (isEditingLink: boolean) => {
    await act(async () => {
      root.render(
        <TreeNodeLinkRow
          linkId="base_link"
          linkName="base_link"
          depth={0}
          linkRowIndentPx={8}
          hasExpandableContent={false}
          isExpanded
          isEditingLink={isEditingLink}
          editingTarget={
            isEditingLink ? { type: 'link', id: 'base_link', draft: 'base_link' } : null
          }
          renameInputRef={renameInputRef}
          hasGeometry={false}
          hasVisual={false}
          hasCollision={false}
          geometryCount={0}
          isGeometryExpanded={false}
          isVisible
          isSelected={false}
          isHovered={false}
          isAttentionHighlighted={false}
          isConnectorHighlighted={false}
          t={translations.en}
          readOnly={false}
          onSelect={() => {}}
          onFocus={() => {}}
          onToggleExpanded={() => {}}
          onOpenContextMenu={() => {}}
          onMouseEnter={() => {}}
          onMouseLeave={() => {}}
          onUpdateRenameDraft={() => {}}
          onCommitRenaming={() => {}}
          onCancelRenaming={() => {}}
          onNameDoubleClick={() => {}}
          onToggleGeometryExpanded={() => {}}
          onToggleVisibility={() => {}}
        />,
      );
    });
  };

  try {
    assert.ok(
      TREE_LINK_NAME_TEXT_CLASS.includes(TREE_LINK_NAME_SIZE_TOKEN),
      'link row typography should stay aligned with assembly component rows',
    );

    await renderRow(false);

    const label = container.querySelector('span[title="base_link"]') as HTMLSpanElement | null;
    assert.ok(label, 'link label should render');

    for (const token of TREE_LINK_NAME_TEXT_CLASS.split(' ')) {
      assert.ok(label.className.includes(token), `label should include ${token}`);
    }
    assert.ok(
      label.className.includes(TREE_LINK_NAME_SIZE_TOKEN),
      'label should keep the component-aligned font size token',
    );

    await renderRow(true);

    const input = container.querySelector('input') as HTMLInputElement | null;
    assert.ok(input, 'rename input should render');

    for (const token of TREE_LINK_NAME_TEXT_CLASS.split(' ')) {
      assert.ok(input.className.includes(token), `rename input should include ${token}`);
    }
    assert.ok(
      input.className.includes(TREE_LINK_NAME_SIZE_TOKEN),
      'rename input should keep the component-aligned font size token',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNodeLinkRow lets the link name use the remaining row width before trailing controls', async () => {
  const { dom, container, root } = createComponentRoot();
  const renameInputRef = createRef<HTMLInputElement>();

  try {
    await act(async () => {
      root.render(
        <TreeNodeLinkRow
          linkId="link_with_a_long_name"
          linkName="link_with_a_long_name"
          depth={4}
          linkRowIndentPx={4}
          hasExpandableContent
          isExpanded
          isEditingLink={false}
          editingTarget={null}
          renameInputRef={renameInputRef}
          hasGeometry
          hasVisual
          hasCollision
          geometryCount={2}
          isGeometryExpanded={false}
          isVisible
          isSelected={false}
          isHovered={false}
          isAttentionHighlighted={false}
          isConnectorHighlighted={false}
          t={translations.en}
          readOnly={false}
          onSelect={() => {}}
          onFocus={() => {}}
          onToggleExpanded={() => {}}
          onOpenContextMenu={() => {}}
          onMouseEnter={() => {}}
          onMouseLeave={() => {}}
          onUpdateRenameDraft={() => {}}
          onCommitRenaming={() => {}}
          onCancelRenaming={() => {}}
          onNameDoubleClick={() => {}}
          onToggleGeometryExpanded={() => {}}
          onToggleVisibility={() => {}}
        />,
      );
    });

    const label = container.querySelector(
      'span[title="link_with_a_long_name"]',
    ) as HTMLSpanElement | null;
    assert.ok(label, 'link label should render');

    const labelWrapper = label.parentElement;
    assert.ok(labelWrapper, 'link label should have a wrapper');
    assert.match(labelWrapper.className, /\bmin-w-0\b/);
    assert.match(
      labelWrapper.className,
      /\bflex-1\b/,
      'link label wrapper should flex so trailing controls do not cover or push out the text',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});

test('TreeNodeLinkRow omits per-link add controls and keeps visibility as an always-on trailing column', async () => {
  const { dom, container, root } = createComponentRoot();
  const renameInputRef = createRef<HTMLInputElement>();

  const renderRow = async (isHovered: boolean) => {
    await act(async () => {
      root.render(
        <TreeNodeLinkRow
          linkId="deep_link"
          linkName="deep_link"
          depth={5}
          linkRowIndentPx={4}
          hasExpandableContent={false}
          isExpanded
          isEditingLink={false}
          editingTarget={null}
          renameInputRef={renameInputRef}
          hasGeometry
          hasVisual
          hasCollision
          geometryCount={2}
          isGeometryExpanded={false}
          isVisible
          isSelected={false}
          isHovered={isHovered}
          isAttentionHighlighted={false}
          isConnectorHighlighted={false}
          t={translations.en}
          readOnly={false}
          onSelect={() => {}}
          onFocus={() => {}}
          onToggleExpanded={() => {}}
          onOpenContextMenu={() => {}}
          onMouseEnter={() => {}}
          onMouseLeave={() => {}}
          onUpdateRenameDraft={() => {}}
          onCommitRenaming={() => {}}
          onCancelRenaming={() => {}}
          onNameDoubleClick={() => {}}
          onToggleGeometryExpanded={() => {}}
          onToggleVisibility={() => {}}
        />,
      );
    });
  };

  try {
    await renderRow(false);

    assert.ok(
      container.querySelector('button[aria-label="Hide"]'),
      'deep inactive rows should keep visibility controls available',
    );
    assert.equal(
      Boolean(container.querySelector(`button[aria-label="${translations.en.addChildJoint}"]`)),
      false,
      'deep inactive rows should not reserve width for add controls',
    );

    await renderRow(true);

    assert.ok(
      container.querySelector('button[aria-label="Hide"]'),
      'deep active rows should still expose visibility controls',
    );
    assert.equal(
      Boolean(container.querySelector(`button[aria-label="${translations.en.addChildJoint}"]`)),
      false,
      'deep active rows should not expose per-link add controls',
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    assert.equal(
      buttons.at(-1)?.getAttribute('aria-label'),
      'Hide',
      'visibility should remain the final aligned action column',
    );
  } finally {
    await destroyComponentRoot(dom, root);
  }
});
