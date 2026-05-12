import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getSourceCodeEditorTabBadgeClassName,
  getSourceCodeEditorTabClassName,
  shouldCollapseSourceCodeEditorTabs,
  SOURCE_CODE_EDITOR_INLINE_TAB_LIMIT,
  SOURCE_CODE_EDITOR_TABS_CLASS,
} from './sourceCodeEditorTabClasses.ts';

test('source code editor tabs use a segmented host surface with explicit tab separation', () => {
  assert.match(SOURCE_CODE_EDITOR_TABS_CLASS, /\bbg-segmented-bg\b/);
  assert.match(SOURCE_CODE_EDITOR_TABS_CLASS, /\bborder-border-black\/60\b/);
  assert.match(SOURCE_CODE_EDITOR_TABS_CLASS, /rounded-\[10px\]/);
});

test('active source code editor tab exposes the selected blue state', () => {
  const className = getSourceCodeEditorTabClassName(true);

  assert.match(className, /\bbg-segmented-active\b/);
  assert.match(className, /\btext-system-blue\b/);
  assert.match(className, /\bring-system-blue\/15\b/);
});

test('inactive source code editor tab exposes a visible hover state', () => {
  const className = getSourceCodeEditorTabClassName(false);

  assert.match(className, /\bhover:bg-segmented-active\/80\b/);
  assert.match(className, /\bhover:border-border-black\/60\b/);
  assert.match(className, /\bhover:text-text-primary\b/);
});

test('generated badge follows the tab selection state', () => {
  assert.match(getSourceCodeEditorTabBadgeClassName(true), /\bbg-system-blue\/10\b/);
  assert.match(getSourceCodeEditorTabBadgeClassName(false), /\bgroup-hover:bg-system-blue\/10\b/);
});

test('source code editor collapses many document tabs into a selector', () => {
  assert.equal(shouldCollapseSourceCodeEditorTabs(SOURCE_CODE_EDITOR_INLINE_TAB_LIMIT), false);
  assert.equal(shouldCollapseSourceCodeEditorTabs(SOURCE_CODE_EDITOR_INLINE_TAB_LIMIT + 1), true);
});
