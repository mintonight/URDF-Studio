import { Check, ChevronDown, ChevronRight, FileText, Layers, Minus, Package, SlidersHorizontal, Sparkles, Target } from 'lucide-react';
import { useState, type Dispatch, type SetStateAction } from 'react';
import type { Language, TranslationKeys } from '@/shared/i18n';
import {
  INSPECTION_PROFILE_DEFINITIONS,
  getAllInspectionProfileItemCount,
  getInspectionProfileLayerName,
  getInspectionProfileName,
} from '../config/inspectionProfiles';
import type {
  InspectionProfileRecommendation,
  InspectionRobotType,
  InspectionTargetPlatform,
} from '../utils/inspectionProfileRecommendation';
import type { SelectedInspectionProfiles } from '../utils/inspectionProfileSelection';

interface InspectionSetupNormalViewProps {
  lang: Language;
  t: TranslationKeys;
  selectedProfiles: SelectedInspectionProfiles;
  setSelectedProfiles: Dispatch<SetStateAction<SelectedInspectionProfiles>>;
  onFocusProfile: (profileId: string) => void;
  recommendation?: InspectionProfileRecommendation;
}

interface SelectionMarkProps {
  checked: boolean;
  indeterminate?: boolean;
  activeClassName?: string;
}

const defaultSelectionMarkActiveClassName =
  'border-system-blue-solid bg-system-blue-solid text-white';
const profileSelectionMarkActiveClassName = 'border-system-blue bg-system-blue/80 text-white';

const getProfileIcon = (layer: string) => {
  if (layer === 'base') return Layers;
  if (layer === 'format') return FileText;
  if (layer === 'target') return Target;
  if (layer === 'workflow') return Package;
  return Sparkles;
};

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

function formatRobotTypeLabel(robotType: InspectionRobotType, t: TranslationKeys) {
  const labels: Record<InspectionRobotType, string> = {
    generic: t.inspectionRobotTypeGeneric,
    humanoid: t.inspectionRobotTypeHumanoid,
    quadruped: t.inspectionRobotTypeQuadruped,
    manipulator: t.inspectionRobotTypeManipulator,
    mobile_base: t.inspectionRobotTypeMobileBase,
    gripper: t.inspectionRobotTypeGripper,
  };

  return labels[robotType];
}

function formatTargetPlatformLabel(targetPlatform: InspectionTargetPlatform, t: TranslationKeys) {
  if (targetPlatform === 'generic') {
    return t.inspectionTargetGeneric;
  }

  return targetPlatform;
}

function formatConfidenceLabel(
  confidence: InspectionProfileRecommendation['confidence'],
  t: TranslationKeys,
) {
  if (confidence === 'high') {
    return t.inspectionConfidenceHigh;
  }
  if (confidence === 'medium') {
    return t.inspectionConfidenceMedium;
  }
  return t.inspectionConfidenceLow;
}

export function InspectionSetupNormalView({
  lang,
  t,
  selectedProfiles,
  setSelectedProfiles,
  onFocusProfile,
  recommendation,
}: InspectionSetupNormalViewProps) {
  const [expandedProfileIds, setExpandedProfileIds] = useState<Set<string>>(() => new Set());
  const totalItemCount = getAllInspectionProfileItemCount();
  const totalSelectedCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + (selectedProfiles[profile.id]?.size ?? 0),
    0,
  );
  const allItemsSelected = totalSelectedCount === totalItemCount;
  const noItemsSelected = totalSelectedCount === 0;
  const selectedSummary = t.inspectionSelectedChecksSummary
    .replace('{selected}', String(totalSelectedCount))
    .replace('{total}', String(totalItemCount));

  const selectAllItems = () => {
    setSelectedProfiles(() =>
      INSPECTION_PROFILE_DEFINITIONS.reduce<SelectedInspectionProfiles>((next, profile) => {
        next[profile.id] = new Set(profile.items.map((item) => item.id));
        return next;
      }, {}),
    );
  };

  const clearAllItems = () => {
    setSelectedProfiles(() =>
      INSPECTION_PROFILE_DEFINITIONS.reduce<SelectedInspectionProfiles>((next, profile) => {
        next[profile.id] = new Set();
        return next;
      }, {}),
    );
  };

  const expandRecommendedProfiles = () => {
    setExpandedProfileIds(
      new Set(
        recommendation?.profileIds.length
          ? recommendation.profileIds
          : INSPECTION_PROFILE_DEFINITIONS.map((profile) => profile.id),
      ),
    );
  };

  const toggleProfileSelection = (profileId: string) => {
    setSelectedProfiles((prev) => {
      const next = { ...prev };
      const profile = INSPECTION_PROFILE_DEFINITIONS.find((entry) => entry.id === profileId);
      if (!profile) {
        return prev;
      }

      const allSelected = profile.items.every((item) => next[profileId]?.has(item.id));
      next[profileId] = allSelected ? new Set() : new Set(profile.items.map((item) => item.id));
      return next;
    });
  };

  const toggleProfileExpansion = (profileId: string) => {
    setExpandedProfileIds((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      return next;
    });
  };

  const toggleItemSelection = (profileId: string, itemId: string) => {
    setSelectedProfiles((prev) => {
      const next = { ...prev };
      const itemSet = new Set(next[profileId] ?? []);
      if (itemSet.has(itemId)) {
        itemSet.delete(itemId);
      } else {
        itemSet.add(itemId);
      }
      next[profileId] = itemSet;
      return next;
    });
  };

  return (
    <div className="space-y-5">
      {recommendation && (
        <section
          data-inspection-profile-recommendation-card
          className="rounded-xl border border-border-black bg-panel-bg p-4 shadow-sm"
        >
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-system-blue/20 bg-system-blue/10 text-system-blue">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 className="text-sm font-semibold text-text-primary">
                    {t.inspectionRecommendedPlan}
                  </h2>
                  <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                    {t.inspectionRecommendedPlanDescription}
                  </p>
                </div>
              </div>
            </div>

            <button
              type="button"
              data-inspection-profile-adjust-scope
              onClick={expandRecommendedProfiles}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-black bg-element-bg px-3 text-[11px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t.inspectionRecommendationAdjustScope}
            </button>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {[
              {
                label: t.inspectionRecommendationRobotType,
                value: formatRobotTypeLabel(recommendation.robotType, t),
              },
              {
                label: t.inspectionRecommendationSourceFormat,
                value: recommendation.sourceFormat.toUpperCase(),
              },
              {
                label: t.inspectionRecommendationTarget,
                value: formatTargetPlatformLabel(recommendation.targetPlatform, t),
              },
              {
                label: t.inspectionRecommendationConfidence,
                value: formatConfidenceLabel(recommendation.confidence, t),
              },
            ].map((metric) => (
              <div
                key={metric.label}
                className="rounded-lg border border-border-black bg-element-bg px-3 py-2"
              >
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                  {metric.label}
                </div>
                <div className="mt-1 text-[12px] font-semibold text-text-primary">
                  {metric.value}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
              {t.inspectionRecommendationProfiles}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {recommendation.profileIds.map((profileId) => (
                <span
                  key={profileId}
                  className="rounded-md border border-system-blue/20 bg-system-blue/10 px-2 py-1 text-[10px] font-medium text-system-blue"
                >
                  {getInspectionProfileName(profileId, lang)}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}

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
        {INSPECTION_PROFILE_DEFINITIONS.map((profile) => {
          const Icon = getProfileIcon(profile.layer);
          const profileName = lang === 'zh' ? profile.nameZh : profile.name;
          const selectedCount = selectedProfiles[profile.id]?.size ?? 0;
          const allSelected = selectedCount === profile.items.length;
          const someSelected = selectedCount > 0 && !allSelected;
          const hasSelection = allSelected || someSelected;
          const selectedPercentage =
            profile.items.length > 0
              ? Math.round((selectedCount / profile.items.length) * 100)
              : 0;
          const isExpanded = expandedProfileIds.has(profile.id);

          return (
            <section
              key={profile.id}
              data-inspection-normal-profile
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
                  data-inspection-normal-profile-selection
                  aria-pressed={allSelected}
                  className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                  onClick={() => {
                    onFocusProfile(profile.id);
                    toggleProfileSelection(profile.id);
                  }}
                >
                  <SelectionMark
                    checked={allSelected}
                    indeterminate={someSelected}
                    activeClassName={profileSelectionMarkActiveClassName}
                  />
                </button>

                <button
                  type="button"
                  aria-expanded={isExpanded}
                  data-inspection-normal-profile-row
                  className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                  onClick={() => {
                    onFocusProfile(profile.id);
                    toggleProfileExpansion(profile.id);
                  }}
                >
                  <div
                    data-inspection-normal-profile-icon
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
                        {profileName}
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
                        data-inspection-normal-profile-progress
                        className={`h-full rounded-full transition-[width,background-color] ${
                          hasSelection ? 'bg-slider-accent' : 'bg-border-strong'
                        }`}
                        style={{ width: `${selectedPercentage}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <div
                      data-inspection-normal-profile-count
                      className={`rounded-md border px-2 py-1 text-[10px] font-semibold tabular-nums ${
                        hasSelection
                          ? 'border-system-blue/20 bg-panel-bg text-system-blue shadow-sm'
                          : 'border-border-black bg-element-bg text-text-tertiary'
                      }`}
                    >
                      {selectedCount}/{profile.items.length}
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
                  {profile.items.map((item) => {
                    const itemName = lang === 'zh' ? item.nameZh : item.name;
                    const isSelected = selectedProfiles[profile.id]?.has(item.id) ?? false;

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
                          onFocusProfile(profile.id);
                          toggleItemSelection(profile.id, item.id);
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
