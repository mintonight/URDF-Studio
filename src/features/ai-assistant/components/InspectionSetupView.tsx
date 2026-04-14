import { Sparkles } from 'lucide-react';
import type { RobotState } from '@/types';
import type { Language, TranslationKeys } from '@/shared/i18n';
import { INSPECTION_CRITERIA } from '../utils/inspectionCriteria';
import { estimateInspectionDuration } from '../utils/inspectionRunContext';
import type { SelectedInspectionItems } from './InspectionSidebar';

interface InspectionSetupViewProps {
  robot: RobotState;
  lang: Language;
  t: TranslationKeys;
  selectedItems: SelectedInspectionItems;
  focusedCategoryId: string;
  onToggleItem: (categoryId: string, itemId: string) => void;
}

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
}

function resolveCategoryImpactLabel(weight: number, t: TranslationKeys): string {
  if (weight >= 0.2) {
    return t.inspectionCategoryImpactHigh;
  }
  if (weight >= 0.15) {
    return t.inspectionCategoryImpactMedium;
  }
  return t.inspectionCategoryImpactBaseline;
}

function MetricCard({ label, value, hint }: MetricCardProps) {
  return (
    <div className="rounded-xl border border-border-black bg-element-bg px-3 py-2.5">
      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-text-primary break-all">{value}</div>
      {hint && <div className="mt-1 text-[11px] leading-4 text-text-secondary">{hint}</div>}
    </div>
  );
}

export function InspectionSetupView({
  robot,
  lang,
  t,
  selectedItems,
  focusedCategoryId,
  onToggleItem,
}: InspectionSetupViewProps) {
  const defaultCategory = INSPECTION_CRITERIA[0];
  if (!defaultCategory) {
    return null;
  }

  const totalItemCount = INSPECTION_CRITERIA.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );

  let totalSelectedCount = 0;
  let selectedWeight = 0;
  const selectedCategoryIds: string[] = [];

  INSPECTION_CRITERIA.forEach((category) => {
    const itemIds = selectedItems[category.id] ?? new Set<string>();
    const selectedCount = itemIds.size;
    totalSelectedCount += selectedCount;

    if (selectedCount > 0) {
      selectedCategoryIds.push(category.id);
      selectedWeight += category.weight;
    }
  });

  const selectedWeightPercentage = Math.round(selectedWeight * 100);
  const focusedCategory =
    INSPECTION_CRITERIA.find((category) => category.id === focusedCategoryId) ?? defaultCategory;
  const focusedSelectedItems = selectedItems[focusedCategory.id] ?? new Set<string>();
  const focusedCategoryName = lang === 'zh' ? focusedCategory.nameZh : focusedCategory.name;
  const selectedCategoryNames = INSPECTION_CRITERIA.filter((category) =>
    selectedCategoryIds.includes(category.id),
  ).map((category) => (lang === 'zh' ? category.nameZh : category.name));
  const estimatedDuration = estimateInspectionDuration(robot, totalSelectedCount);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border-black bg-panel-bg p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-border-black bg-element-bg p-2 text-system-blue">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">{t.inspectionRunSummary}</h2>
            <p className="mt-1 text-[12px] leading-5 text-text-secondary">
              {t.inspectionRunSummaryDescription}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <MetricCard
            label={t.inspectionSelectedCategories}
            value={`${selectedCategoryIds.length}/${INSPECTION_CRITERIA.length}`}
          />
          <MetricCard
            label={t.inspectionMaxPossibleScore}
            value={String(totalSelectedCount * 10)}
          />
          <MetricCard label={t.inspectionWeightedCoverage} value={`${selectedWeightPercentage}%`} />
          <MetricCard label={t.inspectionEstimatedDuration} value={estimatedDuration.label} />
        </div>

        <div className="mt-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            {t.inspectionItems}
          </div>
          {selectedCategoryNames.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedCategoryNames.map((name) => (
                <span
                  key={name}
                  className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary"
                >
                  {name}
                </span>
              ))}
            </div>
          ) : (
            <div className="mt-2 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {t.inspectionNoChecksSelected}
            </div>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border-black bg-panel-bg shadow-sm">
        <div className="border-b border-border-black px-4 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-text-primary">
              {t.inspectionCurrentCategory}
            </h2>
            <span className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
              {focusedCategoryName}
            </span>
            <span className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
              {t.weight}: {Math.round(focusedCategory.weight * 100)}%
            </span>
            <span className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
              {focusedSelectedItems.size}/{focusedCategory.items.length}
            </span>
            <span className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
              {resolveCategoryImpactLabel(focusedCategory.weight, t)}
            </span>
          </div>
          <p className="mt-2 text-[12px] leading-5 text-text-secondary">
            {t.inspectionCurrentCategoryDescription}
          </p>
          {focusedSelectedItems.size === 0 && (
            <div className="mt-3 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
              {t.inspectionCategoryExcluded}
            </div>
          )}
        </div>

        <div className="grid gap-3 p-4 lg:grid-cols-2">
          {focusedCategory.items.map((item) => {
            const isSelected = focusedSelectedItems.has(item.id);
            const itemName = lang === 'zh' ? item.nameZh : item.name;
            const itemDescription = lang === 'zh' ? item.descriptionZh : item.description;
            const itemScoringReference =
              lang === 'zh' ? item.scoringReferenceZh : item.scoringReference;

            return (
              <div
                key={item.id}
                className={`rounded-xl border p-3 transition-colors ${
                  isSelected
                    ? 'border-border-black bg-panel-bg shadow-sm'
                    : 'border-border-black bg-element-bg/80'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                      {item.id}
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-text-primary">{itemName}</h3>
                  </div>
                  <button
                    type="button"
                    data-inspection-setup-item-badge={`${focusedCategory.id}:${item.id}`}
                    aria-pressed={isSelected}
                    onClick={() => onToggleItem(focusedCategory.id, item.id)}
                    className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                      isSelected
                        ? 'border-system-blue/30 bg-system-blue/10 text-system-blue hover:bg-system-blue/15'
                        : 'border-border-black bg-panel-bg text-text-tertiary hover:border-system-blue/30 hover:text-text-secondary'
                    }`}
                  >
                    {isSelected ? t.inspectionIncluded : t.inspectionSkipped}
                  </button>
                </div>

                <p className="mt-2 text-[12px] leading-5 text-text-secondary">{itemDescription}</p>

                {itemScoringReference && (
                  <div className="mt-3 rounded-xl border border-border-black bg-element-bg px-3 py-2">
                    <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                      {t.inspectionScoringReference}
                    </div>
                    <div className="mt-1 text-[11px] leading-5 text-text-secondary">
                      {itemScoringReference}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default InspectionSetupView;
