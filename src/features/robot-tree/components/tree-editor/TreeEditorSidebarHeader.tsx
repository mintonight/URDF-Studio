import type { RefObject } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid, Trees } from 'lucide-react';

interface TreeEditorSidebarHeaderProps {
  collapsed?: boolean;
  onToggle?: () => void;
  isProMode: boolean;
  simpleModeLabel: string;
  proModeLabel: string;
  collapseTitle: string;
  expandTitle: string;
  nameLabel: string;
  currentName: string;
  namePlaceholder: string;
  isEditingName: boolean;
  nameDraft: string;
  nameInputRef: RefObject<HTMLInputElement | null>;
  onSwitchToStructure: () => void;
  onSwitchToWorkspace: () => void;
  onNameDraftChange: (value: string) => void;
  onStartNameEditing: () => void;
  onCommitNameEditing: () => void;
  onCancelNameEditing: () => void;
}

export function TreeEditorSidebarHeader({
  collapsed,
  onToggle,
  isProMode,
  simpleModeLabel,
  proModeLabel,
  collapseTitle,
  expandTitle,
  nameLabel,
  currentName,
  namePlaceholder,
  isEditingName,
  nameDraft,
  nameInputRef,
  onSwitchToStructure,
  onSwitchToWorkspace,
  onNameDraftChange,
  onStartNameEditing,
  onCommitNameEditing,
  onCancelNameEditing,
}: TreeEditorSidebarHeaderProps) {
  return (
    <>
      <button
        onClick={onToggle}
        className="absolute -right-4 top-1/2 -translate-y-1/2 w-4 h-16 bg-panel-bg hover:bg-system-blue-solid hover:text-white border border-border-strong rounded-r-lg shadow-md flex flex-col items-center justify-center z-50 cursor-pointer text-text-tertiary transition-all group"
        title={collapsed ? expandTitle : collapseTitle}
      >
        <div className="flex flex-col gap-0.5 items-center">
          <div className="w-1 h-1 rounded-full bg-text-tertiary/40 group-hover:bg-white/80" />
          {collapsed ? (
            <ChevronRight className="w-3.5 h-3.5" />
          ) : (
            <ChevronLeft className="w-3.5 h-3.5" />
          )}
          <div className="w-1 h-1 rounded-full bg-text-tertiary/40 group-hover:bg-white/80" />
        </div>
      </button>

      <div className="px-2.5 py-1.5 bg-white dark:bg-panel-bg border-b border-border-black dark:border-border-black shrink-0">
        <div className="flex w-full rounded-lg bg-segmented-bg p-0.5">
          <button
            onClick={onSwitchToStructure}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-semibold tracking-[0.02em] transition-all
            ${
              !isProMode
                ? 'bg-segmented-active text-system-blue shadow-sm'
                : 'text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary'
            }`}
          >
            <Trees size={13} />
            {simpleModeLabel}
          </button>
          <button
            onClick={onSwitchToWorkspace}
            className={`flex-1 min-w-0 flex items-center justify-center gap-1.5 px-3 py-1 rounded-md text-[10px] font-semibold tracking-[0.02em] transition-all
            ${
              isProMode
                ? 'bg-segmented-active text-system-blue shadow-sm'
                : 'text-text-tertiary hover:text-text-primary dark:text-text-tertiary dark:hover:text-text-secondary'
            }`}
          >
            <LayoutGrid size={13} />
            {proModeLabel}
          </button>
        </div>
      </div>

      <div className="px-2.5 py-1.5 bg-white dark:bg-panel-bg border-b border-border-black dark:border-border-black shrink-0">
        <div className="flex items-center gap-2">
          <label className="shrink-0 text-[10px] text-text-tertiary font-semibold tracking-[0.02em]">
            {nameLabel}
          </label>
          {isEditingName ? (
            <input
              ref={nameInputRef}
              type="text"
              value={nameDraft}
              onChange={(event) => onNameDraftChange(event.target.value)}
              onBlur={onCommitNameEditing}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCommitNameEditing();
                } else if (event.key === 'Escape') {
                  onCancelNameEditing();
                }
              }}
              className="flex-1 min-w-0 bg-input-bg focus:bg-panel-bg text-[11px] font-medium text-text-primary px-1.5 py-0.5 rounded-md border border-border-strong focus:border-system-blue outline-none transition-colors"
              placeholder={namePlaceholder}
            />
          ) : (
            <button
              type="button"
              onClick={onStartNameEditing}
              className="flex-1 min-w-0 text-left text-[11px] font-medium text-text-primary hover:text-system-blue transition-colors truncate"
              title={currentName || namePlaceholder}
            >
              {currentName || namePlaceholder}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
