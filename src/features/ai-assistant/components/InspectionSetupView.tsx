import { Sparkles } from 'lucide-react';
import type { RobotState } from '@/types';
import type { Language, TranslationKeys } from '@/shared/i18n';
import {
  INSPECTION_PROFILE_DEFINITIONS,
  getInspectionProfileLayerName,
} from '../config/inspectionProfiles';
import { estimateInspectionDuration } from '../utils/inspectionRunContext';
import type { SelectedInspectionProfiles } from '../utils/inspectionProfileSelection';

interface InspectionSetupViewProps {
  robot: RobotState;
  lang: Language;
  t: TranslationKeys;
  selectedProfiles: SelectedInspectionProfiles;
  focusedProfileId: string;
  onToggleItem: (profileId: string, itemId: string) => void;
}

interface MetricCardProps {
  label: string;
  value: string;
  hint?: string;
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
  selectedProfiles,
  focusedProfileId,
  onToggleItem,
}: InspectionSetupViewProps) {
  const defaultProfile = INSPECTION_PROFILE_DEFINITIONS[0];
  if (!defaultProfile) {
    return null;
  }

  const totalItemCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + profile.items.length,
    0,
  );

  let totalSelectedCount = 0;
  const selectedProfileIds: string[] = [];

  INSPECTION_PROFILE_DEFINITIONS.forEach((profile) => {
    const itemIds = selectedProfiles[profile.id] ?? new Set<string>();
    const selectedCount = itemIds.size;
    totalSelectedCount += selectedCount;

    if (selectedCount > 0) {
      selectedProfileIds.push(profile.id);
    }
  });

  const focusedProfile =
    INSPECTION_PROFILE_DEFINITIONS.find((profile) => profile.id === focusedProfileId) ?? defaultProfile;
  const focusedSelectedItems = selectedProfiles[focusedProfile.id] ?? new Set<string>();
  const focusedProfileName = lang === 'zh' ? focusedProfile.nameZh : focusedProfile.name;
  const focusedLayerName = getInspectionProfileLayerName(focusedProfile.layer, lang);
  const selectedProfileNames = INSPECTION_PROFILE_DEFINITIONS.filter((profile) =>
    selectedProfileIds.includes(profile.id),
  ).map((profile) => (lang === 'zh' ? profile.nameZh : profile.name));
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
            value={`${selectedProfileIds.length}/${INSPECTION_PROFILE_DEFINITIONS.length}`}
          />
          <MetricCard
            label={t.inspectionSelectedChecksLabel}
            value={`${totalSelectedCount}/${totalItemCount}`}
          />
          <MetricCard
            label={t.inspectionMaxPossibleScore}
            value={String(totalSelectedCount * 10)}
          />
          <MetricCard label={t.inspectionEstimatedDuration} value={estimatedDuration.label} />
        </div>

        <div className="mt-4">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            {t.inspectionItems}
          </div>
          {selectedProfileNames.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {selectedProfileNames.map((name) => (
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
              {focusedProfileName}
            </span>
            <span className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
              {focusedLayerName}
            </span>
            <span className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
              {focusedSelectedItems.size}/{focusedProfile.items.length}
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
          {focusedProfile.items.map((item) => {
            const isSelected = focusedSelectedItems.has(item.id);
            const itemName = lang === 'zh' ? item.nameZh : item.name;
            const itemDescription = lang === 'zh' ? item.descriptionZh : item.description;
            const severityLabel =
              lang === 'zh'
                ? item.severityOnFailure === 'error'
                  ? '错误'
                  : item.severityOnFailure === 'warning'
                    ? '警告'
                    : '建议'
                : item.severityOnFailure;

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
                    <div className="break-all text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                      {item.id}
                    </div>
                    <h3 className="mt-1 text-sm font-semibold text-text-primary">{itemName}</h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className="rounded-md border border-system-blue/20 bg-system-blue/10 px-2 py-0.5 text-[10px] font-medium text-system-blue">
                        {focusedProfile.id}
                      </span>
                      <span className="rounded-md border border-border-black bg-element-bg px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                        {severityLabel}
                      </span>
                      {item.evidenceLevelRequired && (
                        <span className="rounded-md border border-border-black bg-element-bg px-2 py-0.5 text-[10px] font-medium text-text-secondary">
                          {item.evidenceLevelRequired}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    type="button"
                    data-inspection-setup-item-badge={`${focusedProfile.id}:${item.id}`}
                    aria-pressed={isSelected}
                    onClick={() => onToggleItem(focusedProfile.id, item.id)}
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default InspectionSetupView;
