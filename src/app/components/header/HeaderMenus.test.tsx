import test from 'node:test';
import assert from 'node:assert/strict';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';

import { translations } from '@/shared/i18n';

import { HeaderMenus } from './HeaderMenus.tsx';

const noopToolboxItems: import('./types').ToolboxItem[] = [];

function renderViewMenu({
  showJointPanel = true,
  jointPanelAvailable = true,
}: {
  showJointPanel?: boolean;
  jointPanelAvailable?: boolean;
}) {
  return renderToStaticMarkup(
    React.createElement(HeaderMenus, {
      activeMenu: 'view',
      setActiveMenu: () => {},
      showMenuLabels: true,
      showSourceInline: false,
      showSourceText: false,
      showUndoRedoInline: false,
      t: translations.en,
      viewConfig: {
        showOptionsPanel: true,
        showJointPanel,
      },
      viewAvailability: {
        jointPanel: jointPanelAvailable,
      },
      setViewConfig: () => {},
      onImportFile: () => {},
      onImportFolder: () => {},
      onOpenExport: () => {},
      onExportProject: () => {},
      toolboxItems: noopToolboxItems,
      onOpenCodeViewer: () => {},
      onPrefetchCodeViewer: () => {},
      undo: () => {},
      redo: () => {},
      canUndo: false,
      canRedo: false,
    }),
  );
}

function getJointsPanelMenuButton(markup: string) {
  const dom = new JSDOM(`<body>${markup}</body>`);
  const buttons = Array.from(dom.window.document.querySelectorAll('button'));
  const match = buttons.find((button) => button.textContent?.includes('Joints Panel'));
  assert.ok(match, 'expected the view menu to render a joints panel menu item');
  return match;
}

test('view menu no longer renders a toolbar visibility toggle', () => {
  const markup = renderViewMenu({
    showJointPanel: true,
    jointPanelAvailable: true,
  });
  const dom = new JSDOM(`<body>${markup}</body>`);
  const buttons = Array.from(dom.window.document.querySelectorAll('button'));
  const toolbarButton = buttons.find((button) => button.textContent?.includes('Toolbar'));

  assert.equal(toolbarButton, undefined);
});

test('view menu shows the joints panel item as checked when the panel is available and enabled', () => {
  const markup = renderViewMenu({
    showJointPanel: true,
    jointPanelAvailable: true,
  });
  const button = getJointsPanelMenuButton(markup);

  assert.equal(button.getAttribute('role'), 'menuitemcheckbox');
  assert.equal(button.getAttribute('aria-checked'), 'true');
  assert.equal(button.hasAttribute('disabled'), false);
});

test('view menu disables the joints panel item and clears its checkmark when no controllable joint exists', () => {
  const markup = renderViewMenu({
    showJointPanel: true,
    jointPanelAvailable: false,
  });
  const button = getJointsPanelMenuButton(markup);

  assert.equal(button.getAttribute('role'), 'menuitemcheckbox');
  assert.equal(button.getAttribute('aria-checked'), 'false');
  assert.equal(button.hasAttribute('disabled'), true);
});
