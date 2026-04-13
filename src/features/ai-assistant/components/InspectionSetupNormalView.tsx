import { Check, Minus } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';
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
}

function SelectionMark({ checked, indeterminate = false }: SelectionMarkProps) {
  const isActive = checked || indeterminate;

  return (
    <span
      aria-hidden="true"
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
        isActive
          ? 'border-system-blue-solid bg-system-blue-solid text-white'
          : 'border-border-strong bg-panel-bg text-transparent'
      }`}
    >
      {checked ? (
        <Check className="h-3.5 w-3.5" />
      ) : indeterminate ? (
        <Minus className="h-3.5 w-3.5" />
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
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-text-primary">
          {t.inspectionConfigureChecks}
        </h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-text-tertiary">
          {t.inspectionConfigureChecksDescription}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {INSPECTION_CRITERIA.map((category) => {
          const Icon = getInspectionCategoryIcon(category.id);
          const categoryName = lang === 'zh' ? category.nameZh : category.name;
          const selectedCount = selectedItems[category.id]?.size ?? 0;
          const allSelected = selectedCount === category.items.length;
          const someSelected = selectedCount > 0 && !allSelected;

          return (
            <section
              key={category.id}
              className="overflow-hidden rounded-2xl border border-border-black bg-panel-bg shadow-sm"
            >
              <button
                type="button"
                aria-pressed={allSelected}
                className="flex w-full items-center gap-3 border-b border-border-black px-4 py-3 text-left transition-colors hover:bg-element-hover"
                onClick={() => {
                  onFocusCategory(category.id);
                  toggleCategorySelection(category.id);
                }}
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-system-blue/10 text-system-blue">
                  <Icon className="h-4 w-4" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-text-primary">
                    {categoryName}
                  </div>
                  <div className="mt-1 text-[11px] font-medium text-text-tertiary">
                    {selectedCount}/{category.items.length}
                  </div>
                </div>

                <SelectionMark checked={allSelected} indeterminate={someSelected} />
              </button>

              <div className="space-y-1.5 p-3">
                {category.items.map((item) => {
                  const itemName = lang === 'zh' ? item.nameZh : item.name;
                  const isSelected = selectedItems[category.id]?.has(item.id) ?? false;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-pressed={isSelected}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                        isSelected ? 'bg-element-bg text-text-primary' : 'hover:bg-element-hover'
                      }`}
                      onClick={() => {
                        onFocusCategory(category.id);
                        toggleItemSelection(category.id, item.id);
                      }}
                    >
                      <SelectionMark checked={isSelected} />
                      <span
                        className={`min-w-0 truncate text-sm ${
                          isSelected ? 'text-text-primary' : 'text-text-secondary'
                        }`}
                      >
                        {itemName}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export default InspectionSetupNormalView;
