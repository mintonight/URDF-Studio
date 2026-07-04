import { Check, ChevronDown, Edit3, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { RobotState } from '@/types';
import type { Language, TranslationKeys } from '@/shared/i18n';
import { Dialog } from '@/shared/components/ui/Dialog';
import {
  INSPECTION_PROFILE_DEFINITIONS,
  getInspectionProfileLayerName,
  getInspectionProfileName,
  type InspectionProfileDefinition,
  type InspectionProfileLayer,
} from '../config/inspectionProfiles';
import { isInspectionItemApplicable } from '../utils/inspectionApplicability';
import {
  buildInspectionItemScopeSummaries,
  buildInspectionProfileScopeSummaries,
  buildInspectionSelectionDeviation,
  type InspectionItemScopeRelation,
  type InspectionProfileScopeSummary,
} from '../utils/inspectionAdvancedScopeViewModel';
import type {
  NormalInspectionPlan,
  NormalInspectionPlanOverride,
  NormalInspectionPurpose,
} from '../utils/inspectionNormalPlan';
import type {
  InspectionRobotType,
  InspectionTargetPlatform,
} from '../utils/inspectionProfileRecommendation';
import {
  cloneSelectedInspectionProfiles,
  countSelectedInspectionProfileItems,
  countSelectedInspectionProfiles,
  type SelectedInspectionProfiles,
} from '../utils/inspectionProfileSelection';

interface InspectionSetupViewProps {
  robot: RobotState;
  lang: Language;
  t: TranslationKeys;
  plan: NormalInspectionPlan;
  override: NormalInspectionPlanOverride;
  selectedProfiles: SelectedInspectionProfiles;
  recommendedProfiles: SelectedInspectionProfiles;
  focusedProfileId: string;
  onOverrideChange: (override: NormalInspectionPlanOverride) => void;
  onSelectedProfilesChange: (selectedProfiles: SelectedInspectionProfiles) => void;
  onToggleItem: (profileId: string, itemId: string) => void;
  onFocusProfile: (profileId: string) => void;
  onRestoreRecommendation: () => void;
  onRestoreProfileRecommendation: (profileId: string) => void;
}

const PURPOSE_OPTIONS: NormalInspectionPurpose[] = [
  'basic_health',
  'simulation_readiness',
  'export_preflight',
  'assembly_consistency',
  'hardware_config',
];

const TARGET_PLATFORM_OPTIONS: InspectionTargetPlatform[] = [
  'generic',
  'gazebo',
  'mujoco',
  'isaac_sim',
  'ros_control',
  'export_portability',
];

type InspectionSourceFormat = NonNullable<RobotState['inspectionContext']>['sourceFormat'];

const SOURCE_FORMAT_OPTIONS: InspectionSourceFormat[] = ['urdf', 'mjcf', 'usd', 'xacro', 'sdf', 'mesh'];

const ROBOT_TYPE_OPTIONS: InspectionRobotType[] = [
  'generic',
  'humanoid',
  'quadruped',
  'manipulator',
  'mobile_base',
  'gripper',
];

const PROFILE_LAYER_ORDER: InspectionProfileLayer[] = ['base', 'morph', 'format', 'target', 'workflow'];

function formatPurposeLabel(purpose: NormalInspectionPurpose, t: TranslationKeys) {
  const labels: Record<NormalInspectionPurpose, string> = {
    basic_health: t.inspectionPurposeBasicHealth,
    simulation_readiness: t.inspectionPurposeSimulationReadiness,
    export_preflight: t.inspectionPurposeExportPreflight,
    assembly_consistency: t.inspectionPurposeAssemblyConsistency,
    hardware_config: t.inspectionPurposeHardwareConfig,
  };

  return labels[purpose];
}

function formatTargetPlatformLabel(targetPlatform: InspectionTargetPlatform, t: TranslationKeys) {
  const labels: Record<InspectionTargetPlatform, string> = {
    generic: t.inspectionTargetGeneric,
    ros_control: 'ros_control',
    gazebo: 'Gazebo',
    mujoco: 'MuJoCo',
    isaac_sim: 'Isaac Sim',
    export_portability: t.inspectionTargetExportPortability,
  };

  return labels[targetPlatform];
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

function RecognitionSelect({
  label,
  value,
  dataKey,
  children,
  onChange,
}: {
  label: string;
  value: string;
  dataKey: string;
  children: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-xl border border-border-black bg-element-bg p-3">
      <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
        {label}
      </span>
      <select
        data-inspection-recognition-select={dataKey}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        className="mt-2 h-9 w-full rounded-lg border border-border-black bg-panel-bg px-2.5 text-[12px] font-semibold text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
      >
        {children}
      </select>
    </label>
  );
}

function getRelationLabel(relation: InspectionItemScopeRelation, t: TranslationKeys) {
  if (relation === 'recommended_included') return t.inspectionRecommendedIncluded;
  if (relation === 'user_added') return t.inspectionUserAddedToRecommendation;
  if (relation === 'user_removed') return t.inspectionUserRemovedFromRecommendation;
  if (relation === 'unavailable') return t.inspectionUnavailableForModel;
  return t.inspectionNotRecommended;
}

function getProfileStatusLabel(summary: InspectionProfileScopeSummary, t: TranslationKeys) {
  if (summary.relation === 'user_added') return t.inspectionUserAddedToRecommendation;
  if (summary.relation === 'user_removed') return t.inspectionUserRemovedFromRecommendation;
  if (summary.relation === 'partial') return t.inspectionAdjusted;
  return t.inspectionRecommendedIncluded;
}

function groupProfilesByLayer(profiles: InspectionProfileDefinition[]) {
  return PROFILE_LAYER_ORDER.map((layer) => ({
    layer,
    profiles: profiles.filter((profile) => profile.layer === layer),
  })).filter((group) => group.profiles.length > 0);
}

function ProfileScopeButton({
  lang,
  summary,
  variant,
  isFocused,
  isCustom,
  customText,
  onFocusProfile,
}: {
  lang: Language;
  summary: InspectionProfileScopeSummary;
  variant: 'baseline' | 'current';
  isFocused?: boolean;
  isCustom?: boolean;
  customText?: string;
  onFocusProfile?: (profileId: string) => void;
}) {
  const profileName = getInspectionProfileName(summary.profileId, lang);
  const layerName = getInspectionProfileLayerName(summary.layer, lang);
  const count =
    variant === 'baseline'
      ? `${summary.recommendedItemCount}/${summary.totalItemCount}`
      : `${summary.selectedItemCount}/${summary.totalItemCount}`;
  const dataAttribute =
    variant === 'baseline'
      ? { 'data-inspection-baseline-profile': summary.profileId }
      : { 'data-inspection-current-plan-profile': summary.profileId };

  return (
    <button
      type="button"
      {...dataAttribute}
      disabled={variant === 'baseline'}
      onClick={() => onFocusProfile?.(summary.profileId)}
      className={`min-w-0 rounded-xl border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        isFocused
          ? 'border-system-blue/40 bg-system-blue/10 text-system-blue shadow-sm'
          : isCustom
            ? 'border-warning-border bg-warning-soft text-warning'
            : variant === 'baseline'
              ? 'border-border-black bg-panel-bg text-text-secondary'
              : 'border-border-black bg-element-bg text-text-secondary hover:border-system-blue/30 hover:text-system-blue'
      }`}
    >
      <div className="truncate text-[12px] font-semibold">{profileName}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-text-tertiary">
        <span>{layerName}</span>
        <span aria-hidden="true">•</span>
        <span>{count}</span>
        {customText && (
          <>
            <span aria-hidden="true">•</span>
            <span>{customText}</span>
          </>
        )}
      </div>
    </button>
  );
}

function InspectionPlanEditorDialog({
  isOpen,
  robot,
  lang,
  t,
  selectedProfiles,
  recommendedProfiles,
  applicabilityOverride,
  onClose,
  onConfirm,
}: {
  isOpen: boolean;
  robot: RobotState;
  lang: Language;
  t: TranslationKeys;
  selectedProfiles: SelectedInspectionProfiles;
  recommendedProfiles: SelectedInspectionProfiles;
  applicabilityOverride: Parameters<typeof isInspectionItemApplicable>[3];
  onClose: () => void;
  onConfirm: (selectedProfiles: SelectedInspectionProfiles) => void;
}) {
  const [draftProfiles, setDraftProfiles] = useState<SelectedInspectionProfiles>(() =>
    cloneSelectedInspectionProfiles(selectedProfiles),
  );

  useEffect(() => {
    if (isOpen) {
      setDraftProfiles(cloneSelectedInspectionProfiles(selectedProfiles));
    }
  }, [isOpen, selectedProfiles]);

  const profileSummaries = useMemo(
    () =>
      buildInspectionProfileScopeSummaries(
        draftProfiles,
        recommendedProfiles,
        (profileId, itemId) =>
          isInspectionItemApplicable(robot, profileId, itemId, applicabilityOverride),
      ),
    [applicabilityOverride, draftProfiles, recommendedProfiles, robot],
  );
  const profileSummaryById = useMemo(
    () => new Map(profileSummaries.map((summary) => [summary.profileId, summary])),
    [profileSummaries],
  );
  const selectedItemCount = countSelectedInspectionProfileItems(draftProfiles);
  const selectedProfileCount = countSelectedInspectionProfiles(draftProfiles);

  const toggleProfile = (profile: InspectionProfileDefinition) => {
    setDraftProfiles((current) => {
      const next = cloneSelectedInspectionProfiles(current);
      const currentItems = next[profile.id] ?? new Set<string>();

      next[profile.id] =
        currentItems.size > 0 ? new Set<string>() : new Set(profile.items.map((item) => item.id));
      return next;
    });
  };

  const toggleItem = (profile: InspectionProfileDefinition, itemId: string) => {
    setDraftProfiles((current) => {
      const next = cloneSelectedInspectionProfiles(current);
      const currentItems = new Set(next[profile.id] ?? []);

      if (currentItems.has(itemId)) {
        currentItems.delete(itemId);
      } else {
        currentItems.add(itemId);
      }

      next[profile.id] = currentItems;
      return next;
    });
  };

  return (
    <Dialog
      isOpen={isOpen}
      onClose={onClose}
      title={t.inspectionPlanEditorTitle}
      width="w-[min(980px,calc(100vw-48px))]"
      zIndexClassName="z-[130]"
      closeLabel={t.close}
      className="max-h-[82vh]"
      footer={
        <div className="flex items-center justify-between gap-3">
          <div className="text-[12px] font-medium text-text-secondary">
            {t.inspectionSelectedChecks.replace('{count}', String(selectedItemCount))} ·{' '}
            {t.inspectionSelectedCategories}: {selectedProfileCount}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-inspection-plan-editor-cancel
              onClick={onClose}
              className="h-8 rounded-lg border border-border-black bg-panel-bg px-3 text-[12px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              {t.cancel}
            </button>
            <button
              type="button"
              data-inspection-plan-editor-confirm
              onClick={() => onConfirm(cloneSelectedInspectionProfiles(draftProfiles))}
              className="h-8 rounded-lg bg-system-blue-solid px-3 text-[12px] font-semibold text-white shadow-sm transition-colors hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              {t.confirm}
            </button>
          </div>
        </div>
      }
    >
      <div data-inspection-plan-editor="true" className="space-y-3">
        {groupProfilesByLayer(INSPECTION_PROFILE_DEFINITIONS).map(({ layer, profiles }) => {
          const selectedInLayer = profiles.filter(
            (profile) => (draftProfiles[profile.id]?.size ?? 0) > 0,
          ).length;

          return (
            <details
              key={layer}
              open
              data-inspection-plan-editor-layer={layer}
              className="rounded-xl border border-border-black bg-element-bg"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30">
                <div className="flex min-w-0 items-center gap-2">
                  <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
                  <span className="text-[13px] font-semibold text-text-primary">
                    {getInspectionProfileLayerName(layer, lang)}
                  </span>
                </div>
                <span className="rounded-md border border-border-black bg-panel-bg px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                  {selectedInLayer}/{profiles.length}
                </span>
              </summary>

              <div className="space-y-2 border-t border-border-black p-3">
                {profiles.map((profile) => {
                  const selectedItems = draftProfiles[profile.id] ?? new Set<string>();
                  const summary = profileSummaryById.get(profile.id);
                  const itemSummaries = buildInspectionItemScopeSummaries(
                    profile.id,
                    draftProfiles,
                    recommendedProfiles,
                    (profileId, itemId) =>
                      isInspectionItemApplicable(robot, profileId, itemId, applicabilityOverride),
                  );
                  const itemSummaryById = new Map(
                    itemSummaries.map((itemSummary) => [itemSummary.itemId, itemSummary]),
                  );

                  return (
                    <section
                      key={profile.id}
                      data-inspection-plan-editor-profile={profile.id}
                      className="rounded-xl border border-border-black bg-panel-bg p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="truncate text-[13px] font-semibold text-text-primary">
                            {getInspectionProfileName(profile.id, lang)}
                          </h3>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] font-medium text-text-tertiary">
                            <span>{profile.id}</span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {selectedItems.size}/{profile.items.length}
                            </span>
                            {summary && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span>{getProfileStatusLabel(summary, t)}</span>
                              </>
                            )}
                          </div>
                        </div>
                        <button
                          type="button"
                          data-inspection-plan-editor-profile-toggle={profile.id}
                          aria-pressed={selectedItems.size > 0}
                          onClick={() => toggleProfile(profile)}
                          className={`shrink-0 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                            selectedItems.size > 0
                              ? 'border-system-blue/30 bg-system-blue/10 text-system-blue hover:bg-system-blue/15'
                              : 'border-border-black bg-element-bg text-text-secondary hover:border-system-blue/30 hover:text-system-blue'
                          }`}
                        >
                          {selectedItems.size > 0 ? t.inspectionIncluded : t.inspectionSkipped}
                        </button>
                      </div>

                      <div className="mt-3 grid gap-2 lg:grid-cols-2">
                        {profile.items.map((item) => {
                          const isSelected = selectedItems.has(item.id);
                          const itemSummary = itemSummaryById.get(item.id);
                          const relationLabel = getRelationLabel(
                            itemSummary?.relation ?? 'not_recommended',
                            t,
                          );

                          return (
                            <button
                              key={item.id}
                              type="button"
                              data-inspection-plan-editor-item={`${profile.id}:${item.id}`}
                              aria-pressed={isSelected}
                              onClick={() => toggleItem(profile, item.id)}
                              className={`min-w-0 rounded-lg border p-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                                isSelected
                                  ? 'border-system-blue/25 bg-system-blue/10 text-text-primary'
                                  : 'border-border-black bg-element-bg text-text-secondary hover:border-system-blue/30'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="truncate text-[12px] font-semibold">
                                    {lang === 'zh' ? item.nameZh : item.name}
                                  </div>
                                  <div className="mt-1 text-[10px] font-medium text-text-tertiary">
                                    {relationLabel}
                                  </div>
                                </div>
                                {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-system-blue" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>
    </Dialog>
  );
}

export function InspectionSetupView({
  robot,
  lang,
  t,
  plan,
  override,
  selectedProfiles,
  recommendedProfiles,
  focusedProfileId,
  onOverrideChange,
  onSelectedProfilesChange,
  onToggleItem,
  onFocusProfile,
  onRestoreRecommendation,
  onRestoreProfileRecommendation,
}: InspectionSetupViewProps) {
  const [isPlanEditorOpen, setIsPlanEditorOpen] = useState(false);
  const defaultProfile = INSPECTION_PROFILE_DEFINITIONS[0];
  if (!defaultProfile) {
    return null;
  }

  const totalSelectedCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + (selectedProfiles[profile.id]?.size ?? 0),
    0,
  );
  const selectedProfileCount = INSPECTION_PROFILE_DEFINITIONS.filter(
    (profile) => (selectedProfiles[profile.id]?.size ?? 0) > 0,
  ).length;
  const focusedProfile =
    INSPECTION_PROFILE_DEFINITIONS.find((profile) => profile.id === focusedProfileId) ?? defaultProfile;
  const focusedSelectedItems = selectedProfiles[focusedProfile.id] ?? new Set<string>();
  const focusedProfileName = lang === 'zh' ? focusedProfile.nameZh : focusedProfile.name;
  const focusedLayerName = getInspectionProfileLayerName(focusedProfile.layer, lang);
  const profileSummaries = buildInspectionProfileScopeSummaries(
    selectedProfiles,
    recommendedProfiles,
  );
  const profileSummaryById = new Map(
    profileSummaries.map((summary) => [summary.profileId, summary]),
  );
  const deviation = buildInspectionSelectionDeviation(selectedProfiles, recommendedProfiles);
  const deviationSummary = t.inspectionRecommendationDeviationSummary.replace(
    '{count}',
    String(deviation.totalChangedItemCount),
  );
  const currentProfileSummaries = profileSummaries.filter(
    (summary) => summary.selectedItemCount > 0,
  );
  const currentProfileSummaryGroups = PROFILE_LAYER_ORDER.map((layer) => ({
    layer,
    summaries: currentProfileSummaries.filter((summary) => summary.layer === layer),
  })).filter((group) => group.summaries.length > 0);
  const focusedProfileSummary = profileSummaryById.get(focusedProfile.id);
  const focusedProfileIsCustom =
    focusedProfileSummary?.relation === 'partial' ||
    focusedProfileSummary?.relation === 'user_added' ||
    focusedProfileSummary?.relation === 'user_removed';
  const focusedProfileStatusLabel = focusedProfileSummary
    ? getProfileStatusLabel(focusedProfileSummary, t)
    : t.inspectionNotRecommended;
  const handleConfirmPlanEditor = (nextProfiles: SelectedInspectionProfiles) => {
    onSelectedProfilesChange(nextProfiles);
    onFocusProfile(
      INSPECTION_PROFILE_DEFINITIONS.find(
        (profile) => (nextProfiles[profile.id]?.size ?? 0) > 0,
      )?.id ?? defaultProfile.id,
    );
    setIsPlanEditorOpen(false);
  };
  const handleRestoreCurrentPlan = () => {
    onRestoreRecommendation();
    setIsPlanEditorOpen(false);
  };
  const selectedProfileSummaryText = `${selectedProfileCount}/${INSPECTION_PROFILE_DEFINITIONS.length}`;
  const hasCurrentProfiles = currentProfileSummaries.length > 0;
  const gridTemplateClass = hasCurrentProfiles ? 'xl:grid-cols-[minmax(280px,0.9fr)_minmax(0,1.35fr)]' : 'xl:grid-cols-1';
  const currentPlanLayerCount = currentProfileSummaryGroups.length;
  const currentPlanLayerSummary = currentPlanLayerCount > 0 ? `${currentPlanLayerCount}` : '0';
  const applicabilityOverride = {
    sourceFormat: override.sourceFormat,
    robotTypes: override.robotType ? [override.robotType] : undefined,
  };
  const focusedItemSummaries = buildInspectionItemScopeSummaries(
    focusedProfile.id,
    selectedProfiles,
    recommendedProfiles,
    (profileId, itemId) =>
      isInspectionItemApplicable(robot, profileId, itemId, applicabilityOverride),
  );
  const focusedItemSummaryById = new Map(
    focusedItemSummaries.map((summary) => [summary.itemId, summary]),
  );

  return (
    <section
      data-inspection-review-details="true"
      className="flex min-h-0 flex-1 flex-col gap-4"
    >
      <section
        data-inspection-recognition-panel="true"
        className="shrink-0 overflow-hidden rounded-2xl border border-border-black bg-panel-bg shadow-sm"
      >
        <div className="flex flex-col gap-3 border-b border-border-black bg-system-blue/5 px-4 py-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <div className="rounded-xl border border-system-blue/20 bg-panel-bg p-2 text-system-blue">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-semibold text-text-primary">
                  {t.inspectionRecommendedPlan}
                </h2>
                <span className="rounded-md border border-system-blue/15 bg-panel-bg px-2 py-0.5 text-[10px] font-semibold text-system-blue">
                  {t.inspectionEditable}
                </span>
              </div>
              <p className="mt-1 text-[12px] leading-5 text-text-secondary">
                {t.inspectionRecommendedPlanDescription}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {(override.purpose ||
              override.targetPlatform ||
              override.sourceFormat ||
              override.robotType) && (
              <button
                type="button"
                onClick={() => onOverrideChange({})}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-black bg-panel-bg px-3 text-[11px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                {t.inspectionPlanResetAuto}
              </button>
            )}
          </div>
        </div>

        <div className="grid gap-3 p-4 xl:grid-cols-4">
          <RecognitionSelect
            label={t.inspectionPlanPurpose}
            value={plan.purpose}
            dataKey="purpose"
            onChange={(value) =>
              onOverrideChange({ ...override, purpose: value as NormalInspectionPurpose })
            }
          >
            {PURPOSE_OPTIONS.map((purpose) => (
              <option key={purpose} value={purpose}>
                {formatPurposeLabel(purpose, t)}
              </option>
            ))}
          </RecognitionSelect>
          <RecognitionSelect
            label={t.inspectionRecommendationTarget}
            value={plan.targetPlatform}
            dataKey="targetPlatform"
            onChange={(value) =>
              onOverrideChange({ ...override, targetPlatform: value as InspectionTargetPlatform })
            }
          >
            {TARGET_PLATFORM_OPTIONS.map((targetPlatform) => (
              <option key={targetPlatform} value={targetPlatform}>
                {formatTargetPlatformLabel(targetPlatform, t)}
              </option>
            ))}
          </RecognitionSelect>
          <RecognitionSelect
            label={t.inspectionRecommendationSourceFormat}
            value={plan.recommendation.sourceFormat}
            dataKey="sourceFormat"
            onChange={(value) =>
              onOverrideChange({ ...override, sourceFormat: value as InspectionSourceFormat })
            }
          >
            {SOURCE_FORMAT_OPTIONS.map((sourceFormat) => (
              <option key={sourceFormat} value={sourceFormat}>
                {sourceFormat.toUpperCase()}
              </option>
            ))}
          </RecognitionSelect>
          <RecognitionSelect
            label={t.inspectionRecommendationRobotType}
            value={plan.recommendation.robotType}
            dataKey="robotType"
            onChange={(value) =>
              onOverrideChange({ ...override, robotType: value as InspectionRobotType })
            }
          >
            {ROBOT_TYPE_OPTIONS.map((robotType) => (
              <option key={robotType} value={robotType}>
                {formatRobotTypeLabel(robotType, t)}
              </option>
            ))}
          </RecognitionSelect>
        </div>
      </section>

      <section className="flex min-h-0 flex-1 flex-col rounded-2xl border border-border-black bg-panel-bg shadow-sm">
        <div className="flex flex-col gap-3 border-b border-border-black px-4 py-4 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-text-primary">
                {t.inspectionPlanOrchestration}
              </h2>
              {deviation.totalChangedItemCount > 0 && (
                <span
                  data-inspection-current-plan-custom-state="true"
                  className="rounded-md border border-warning-border bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning"
                >
                  {deviationSummary}
                </span>
              )}
            </div>
            <p className="mt-1 text-[12px] leading-5 text-text-secondary">
              {t.inspectionPlanOrchestrationDescription}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <button
              type="button"
              data-inspection-current-plan-edit
              onClick={() => setIsPlanEditorOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-black bg-element-bg px-3 text-[11px] font-semibold text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              <Edit3 className="h-3.5 w-3.5" />
              {t.edit}
            </button>
            <button
              type="button"
              onClick={handleRestoreCurrentPlan}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-system-blue/25 bg-element-bg px-3 text-[11px] font-semibold text-system-blue transition-colors hover:bg-system-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {t.inspectionRestoreBaseline}
            </button>
          </div>
        </div>

        <div className={`grid min-h-0 flex-1 gap-3 p-4 ${gridTemplateClass}`}>
          <section
            data-inspection-current-plan="true"
            className="flex min-h-0 flex-col rounded-xl border border-border-black bg-element-bg p-3"
          >
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-text-primary">
                  {t.inspectionCurrentPlan}
                </h3>
                <p className="mt-1 text-[11px] leading-4 text-text-tertiary">
                  {t.inspectionCurrentPlanDescription}
                </p>
              </div>
              <span className="rounded-md border border-system-blue/20 bg-system-blue/10 px-2 py-0.5 text-[10px] font-semibold text-system-blue">
                {selectedProfileSummaryText}
              </span>
            </div>
            <div className="mb-3 flex flex-wrap gap-2 text-[10px] font-medium text-text-tertiary">
              <span className="rounded-md border border-border-black bg-panel-bg px-2 py-0.5">
                {t.inspectionSelectedChecks.replace('{count}', String(totalSelectedCount))}
              </span>
              <span className="rounded-md border border-border-black bg-panel-bg px-2 py-0.5">
                {t.inspectionSelectedCategories}: {selectedProfileCount}
              </span>
              <span className="rounded-md border border-border-black bg-panel-bg px-2 py-0.5">
                {t.inspectionPlanLayers}: {currentPlanLayerSummary}
              </span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              {hasCurrentProfiles ? (
                <div className="space-y-3">
                  {currentProfileSummaryGroups.map(({ layer, summaries }) => (
                    <section
                      key={layer}
                      data-inspection-current-plan-layer={layer}
                      className="rounded-xl border border-border-black bg-panel-bg p-2"
                    >
                      <div className="mb-2 flex items-center justify-between gap-2 px-1">
                        <h4 className="truncate text-[12px] font-semibold text-text-primary">
                          {getInspectionProfileLayerName(layer, lang)}
                        </h4>
                        <span className="rounded-md border border-border-black bg-element-bg px-2 py-0.5 text-[10px] font-semibold text-text-secondary">
                          {summaries.length}
                        </span>
                      </div>
                      <div className="grid gap-2">
                        {summaries.map((summary) => {
                          const isCustom =
                            summary.relation === 'partial' ||
                            summary.relation === 'user_added' ||
                            summary.relation === 'user_removed';

                          return (
                            <ProfileScopeButton
                              key={summary.profileId}
                              lang={lang}
                              summary={summary}
                              variant="current"
                              isFocused={summary.profileId === focusedProfileId}
                              isCustom={isCustom}
                              customText={getProfileStatusLabel(summary, t)}
                              onFocusProfile={onFocusProfile}
                            />
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : (
                <div className="rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
                  {t.inspectionNoChecksSelected}
                </div>
              )}
            </div>
          </section>

          <section
            data-inspection-focused-profile-panel="true"
            className="flex min-h-0 flex-col rounded-xl border border-border-black bg-element-bg"
          >
            <div className="border-b border-border-black px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary">
                  {t.inspectionCurrentCategory}
                </h3>
                <span className="rounded-lg border border-border-black bg-panel-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
                  <span data-inspection-focused-profile-name>{focusedProfileName}</span>
                </span>
                <span className="rounded-lg border border-border-black bg-panel-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
                  {focusedLayerName}
                </span>
                <span className="rounded-lg border border-border-black bg-panel-bg px-2 py-1 text-[11px] font-medium text-text-secondary">
                  {focusedSelectedItems.size}/{focusedProfile.items.length}
                </span>
                <span
                  className={`rounded-lg border px-2 py-1 text-[11px] font-medium ${
                    focusedProfileIsCustom
                      ? 'border-warning-border bg-warning-soft text-warning'
                      : 'border-system-blue/20 bg-system-blue/10 text-system-blue'
                  }`}
                >
                  {focusedProfileStatusLabel}
                </span>
                <button
                  type="button"
                  onClick={() => onRestoreProfileRecommendation(focusedProfile.id)}
                  className="h-7 rounded-lg border border-system-blue/25 bg-panel-bg px-2 text-[11px] font-semibold text-system-blue transition-colors hover:bg-system-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                >
                  {t.inspectionRestoreProfileRecommendation}
                </button>
              </div>
              {focusedSelectedItems.size === 0 && (
                <div className="mt-3 rounded-xl border border-danger-border bg-danger-soft px-3 py-2 text-[12px] text-danger">
                  {t.inspectionCategoryExcluded}
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              <div className="grid gap-3 lg:grid-cols-2">
                {focusedProfile.items.map((item) => {
                  const isSelected = focusedSelectedItems.has(item.id);
                  const itemSummary = focusedItemSummaryById.get(item.id);
                  const relation = itemSummary?.relation ?? 'not_recommended';
                  const relationLabel = getRelationLabel(relation, t);
                  const itemName = lang === 'zh' ? item.nameZh : item.name;
                  const itemDescription = lang === 'zh' ? item.descriptionZh : item.description;

                  return (
                    <div
                      key={item.id}
                      data-inspection-setup-item-anchor={`${focusedProfile.id}:${item.id}`}
                      tabIndex={-1}
                      className={`rounded-xl border p-3 transition-colors ${
                        isSelected
                          ? 'border-border-black bg-panel-bg shadow-sm'
                          : 'border-border-black bg-panel-bg/70'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                            {item.id}
                          </div>
                          <h4 className="mt-1 text-sm font-semibold text-text-primary">{itemName}</h4>
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                                relation === 'user_removed'
                                  ? 'border-warning-border bg-warning-soft text-warning'
                                  : relation === 'recommended_included'
                                    ? 'border-system-blue/20 bg-system-blue/10 text-system-blue'
                                    : 'border-border-black bg-element-bg text-text-secondary'
                              }`}
                            >
                              {relationLabel}
                            </span>
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

                      <p className="mt-2 text-[12px] leading-5 text-text-secondary">
                        {itemDescription}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>
        </div>
      </section>

      <InspectionPlanEditorDialog
        isOpen={isPlanEditorOpen}
        robot={robot}
        lang={lang}
        t={t}
        selectedProfiles={selectedProfiles}
        recommendedProfiles={recommendedProfiles}
        applicabilityOverride={applicabilityOverride}
        onClose={() => setIsPlanEditorOpen(false)}
        onConfirm={handleConfirmPlanEditor}
      />
    </section>
  );
}

export default InspectionSetupView;
