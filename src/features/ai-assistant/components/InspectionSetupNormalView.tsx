import { Check, ChevronDown, ChevronRight, Minus } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Language, TranslationKeys } from '@/shared/i18n';
import { INSPECTION_CRITERIA } from '../utils/inspectionCriteria';
import type { SelectedInspectionItems } from './InspectionSidebar';
import { getInspectionCategoryIcon } from './inspectionCategoryIcon';

interface InspectionSetupNormalViewProps {
  lang: Language;
  t: TranslationKeys;
  selectedItems: SelectedInspectionItems;
  setSelectedItems: Dispatch<SetStateAction<SelectedInspectionItems>>;
  onFocusCategory: (categoryId: string) => void;
}

interface SelectionMarkProps {
  checked: boolean;
  indeterminate?: boolean;
  activeClassName?: string;
}

const defaultSelectionMarkActiveClassName =
  'border-system-blue-solid bg-system-blue-solid text-white';
const categorySelectionMarkActiveClassName = 'border-system-blue bg-system-blue/80 text-white';

function SelectionMark({
  checked,
  indeterminate = false,
  activeClassName = defaultSelectionMarkActiveClassName,
}: SelectionMarkProps) {
  const isActive = checked || indeterminate;

  return (
    <span
      aria-hidden="true"
      data-inspection-normal-selection-mark
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border shadow-sm transition-colors ${
        isActive ? activeClassName : 'border-border-strong bg-panel-bg text-transparent'
      }`}
    >
      {checked ? (
        <Check className="h-3 w-3" />
      ) : indeterminate ? (
        <Minus className="h-3 w-3" />
      ) : null}
    </span>
  );
}

export function InspectionSetupNormalView({
  lang,
  t,
  selectedItems,
  setSelectedItems,
  onFocusCategory,
}: InspectionSetupNormalViewProps) {
  const [expandedCategoryIds, setExpandedCategoryIds] = useState<Set<string>>(() => new Set());
  const totalItemCount = INSPECTION_CRITERIA.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );
  const totalSelectedCount = INSPECTION_CRITERIA.reduce(
    (sum, category) => sum + (selectedItems[category.id]?.size ?? 0),
    0,
  );
  const allItemsSelected = totalSelectedCount === totalItemCount;
  const noItemsSelected = totalSelectedCount === 0;
  const selectedSummary = t.inspectionSelectedChecksSummary
    .replace('{selected}', String(totalSelectedCount))
    .replace('{total}', String(totalItemCount));

  const selectAllItems = () => {
    setSelectedItems(() =>
      INSPECTION_CRITERIA.reduce<SelectedInspectionItems>((next, category) => {
        next[category.id] = new Set(category.items.map((item) => item.id));
        return next;
      }, {}),
    );
  };

  const clearAllItems = () => {
    setSelectedItems(() =>
      INSPECTION_CRITERIA.reduce<SelectedInspectionItems>((next, category) => {
        next[category.id] = new Set();
        return next;
      }, {}),
    );
  };

  const toggleCategorySelection = (categoryId: string) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      const category = INSPECTION_CRITERIA.find((entry) => entry.id === categoryId);
      if (!category) {
        return prev;
      }

      const allSelected = category.items.every((item) => next[categoryId]?.has(item.id));
      next[categoryId] = allSelected ? new Set() : new Set(category.items.map((item) => item.id));
      return next;
    });
  };

  const toggleCategoryExpansion = (categoryId: string) => {
    setExpandedCategoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const toggleItemSelection = (categoryId: string, itemId: string) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      const itemSet = new Set(next[categoryId] ?? []);
      if (itemSet.has(itemId)) {
        itemSet.delete(itemId);
      } else {
        itemSet.add(itemId);
      }
      next[categoryId] = itemSet;
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 flex-1">
          <h2
            data-inspection-normal-title
            className="text-lg font-semibold leading-6 tracking-tight text-text-primary"
          >
            {t.inspectionConfigureChecks}
          </h2>
          <p className="mt-1.5 max-w-3xl text-[13px] leading-5 text-text-tertiary">
            {t.inspectionConfigureChecksDescription}
          </p>

          <div
            data-inspection-normal-summary
            aria-live="polite"
            className="mt-2.5 inline-flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-full border border-system-blue/15 bg-system-blue/5 px-2.5 py-1 text-[11px] text-system-blue shadow-sm"
          >
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-system-blue" />
            <span className="font-medium">{selectedSummary}</span>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-1.5 xl:justify-end">
          <button
            data-inspection-normal-action="select-all"
            type="button"
            disabled={allItemsSelected}
            className="h-8 rounded-lg border border-system-blue/25 bg-system-blue/10 px-3 text-[11px] font-medium text-system-blue shadow-sm transition-colors hover:bg-system-blue/15 hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-system-blue/10 disabled:hover:text-system-blue"
            onClick={selectAllItems}
          >
            {t.inspectionSelectAll}
          </button>
          <button
            data-inspection-normal-action="clear-all"
            type="button"
            disabled={noItemsSelected}
            className="h-8 rounded-lg border border-danger-border bg-danger-soft px-3 text-[11px] font-medium text-danger shadow-sm transition-colors hover:border-danger hover:bg-danger-soft hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-danger-border disabled:hover:bg-danger-soft disabled:hover:text-danger"
            onClick={clearAllItems}
          >
            {t.inspectionClearAll}
          </button>
        </div>
      </div>

      <div
        data-inspection-normal-scan-list
        className="overflow-hidden rounded-xl border border-border-black bg-panel-bg shadow-sm divide-y divide-border-black"
      >
        {INSPECTION_CRITERIA.map((category) => {
          const Icon = getInspectionCategoryIcon(category.id);
          const categoryName = lang === 'zh' ? category.nameZh : category.name;
          const selectedCount = selectedItems[category.id]?.size ?? 0;
          const allSelected = selectedCount === category.items.length;
          const someSelected = selectedCount > 0 && !allSelected;
          const hasSelection = allSelected || someSelected;
          const selectedPercentage =
            category.items.length > 0
              ? Math.round((selectedCount / category.items.length) * 100)
              : 0;
          const isExpanded = expandedCategoryIds.has(category.id);

          return (
            <section
              key={category.id}
              data-inspection-normal-category
              className={`rounded-xl border-0 transition-colors ${
                allSelected ? 'bg-system-blue/5' : 'bg-panel-bg'
              }`}
            >
              <div
                className={`grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-3.5 py-3 transition-colors ${
                  hasSelection
                    ? 'bg-system-blue/5 hover:bg-system-blue/10'
                    : 'hover:bg-element-hover'
                }`}
              >
                <button
                  type="button"
                  data-inspection-normal-category-selection
                  aria-pressed={allSelected}
                  className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                  onClick={() => {
                    onFocusCategory(category.id);
                    toggleCategorySelection(category.id);
                  }}
                >
                  <SelectionMark
                    checked={allSelected}
                    indeterminate={someSelected}
                    activeClassName={categorySelectionMarkActiveClassName}
                  />
                </button>

                <button
                  type="button"
                  aria-expanded={isExpanded}
                  data-inspection-normal-category-row
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                  onClick={() => {
                    onFocusCategory(category.id);
                    toggleCategoryExpansion(category.id);
                  }}
                >
                  <div
                    data-inspection-normal-category-icon
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border text-system-blue ${
                      hasSelection
                        ? 'border-system-blue/20 bg-system-blue/10'
                        : 'border-border-black bg-element-bg'
                    }`}
                  >
                    <Icon className="h-[15px] w-[15px]" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="truncate text-[13px] font-semibold text-text-primary">
                        {categoryName}
                      </div>
                      <span
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          hasSelection ? 'bg-system-blue' : 'bg-border-strong'
                        }`}
                        aria-hidden="true"
                      />
                      <span className="shrink-0 text-[11px] font-medium text-text-tertiary">
                        {selectedPercentage}%
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-element-bg">
                      <div
                        data-inspection-normal-category-progress
                        className={`h-full rounded-full transition-[width,background-color] ${
                          hasSelection ? 'bg-slider-accent' : 'bg-border-strong'
                        }`}
                        style={{ width: `${selectedPercentage}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <div
                      data-inspection-normal-category-count
                      className={`rounded-md border px-2 py-1 text-[10px] font-semibold tabular-nums ${
                        hasSelection
                          ? 'border-system-blue/20 bg-panel-bg text-system-blue shadow-sm'
                          : 'border-border-black bg-element-bg text-text-tertiary'
                      }`}
                    >
                      {selectedCount}/{category.items.length}
                    </div>
                    <span
                      aria-hidden="true"
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-text-tertiary"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </span>
                  </div>
                </button>
              </div>

              {isExpanded && (
                <div
                  data-inspection-normal-item-list
                  className="grid gap-1.5 border-t border-border-black/70 bg-panel-bg px-3.5 py-2.5 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {category.items.map((item) => {
                    const itemName = lang === 'zh' ? item.nameZh : item.name;
                    const isSelected = selectedItems[category.id]?.has(item.id) ?? false;

                    return (
                      <button
                        data-inspection-normal-item
                        key={item.id}
                        type="button"
                        aria-pressed={isSelected}
                        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left transition-[border-color,background-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                          isSelected
                            ? 'border-system-blue/15 bg-system-blue/5 text-text-primary shadow-sm'
                            : 'border-border-black bg-panel-bg hover:border-system-blue/30 hover:bg-element-hover'
                        }`}
                        onClick={() => {
                          onFocusCategory(category.id);
                          toggleItemSelection(category.id, item.id);
                        }}
                      >
                        <SelectionMark checked={isSelected} />
                        <span
                          className={`min-w-0 truncate text-[12px] ${
                            isSelected ? 'font-medium text-text-primary' : 'text-text-secondary'
                          }`}
                        >
                          {itemName}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default InspectionSetupNormalView;
