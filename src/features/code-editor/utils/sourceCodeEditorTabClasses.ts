const SOURCE_CODE_EDITOR_TAB_BASE_CLASS =
  'group relative flex h-7 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[10px] font-semibold tracking-[0.015em] transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30';

export const SOURCE_CODE_EDITOR_INLINE_TAB_LIMIT = 4;

export const SOURCE_CODE_EDITOR_TABS_CLASS =
  'inline-flex min-w-0 flex-1 items-center gap-1 rounded-[10px] border border-border-black/60 bg-segmented-bg p-1';

export const shouldCollapseSourceCodeEditorTabs = (documentCount: number): boolean =>
  documentCount > SOURCE_CODE_EDITOR_INLINE_TAB_LIMIT;

export const getSourceCodeEditorTabClassName = (isActive: boolean): string =>
  `${SOURCE_CODE_EDITOR_TAB_BASE_CLASS} ${
    isActive
      ? 'border-system-blue/25 bg-segmented-active text-system-blue shadow-sm ring-1 ring-inset ring-system-blue/15'
      : 'border-transparent text-text-secondary hover:border-border-black/60 hover:bg-segmented-active/80 hover:text-text-primary'
  }`;

export const getSourceCodeEditorTabBadgeClassName = (isActive: boolean): string =>
  `ml-1 shrink-0 rounded px-1 py-0.5 text-[8px] font-semibold uppercase tracking-wide transition-colors ${
    isActive
      ? 'bg-system-blue/10 text-system-blue'
      : 'bg-element-hover text-text-secondary group-hover:bg-system-blue/10 group-hover:text-system-blue'
  }`;
