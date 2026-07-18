import { Check, ChevronDown, RotateCcw, Sparkles } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { Language, TranslationKeys } from '@/shared/i18n';
import type { RobotState } from '@/types';
import {
  INSPECTION_PROFILE_DEFINITIONS,
  getInspectionProfileName,
} from '../config/inspectionProfiles';
import { buildInspectionSelectionDeviation } from '../utils/inspectionAdvancedScopeViewModel';
import type {
  NormalInspectionPlan,
  NormalInspectionPlanOverride,
  NormalInspectionPurpose,
} from '../utils/inspectionNormalPlan';
import {
  countSelectedInspectionProfileItems,
  type SelectedInspectionProfiles,
} from '../utils/inspectionProfileSelection';
import type {
  InspectionRobotType,
  InspectionTargetPlatform,
} from '../utils/inspectionProfileRecommendation';

interface InspectionSetupNormalViewProps {
  lang: Language;
  t: TranslationKeys;
  automaticPlan: NormalInspectionPlan;
  override: NormalInspectionPlanOverride;
  selectedProfiles: SelectedInspectionProfiles;
  recommendedProfiles: SelectedInspectionProfiles;
  onOverrideChange: (override: NormalInspectionPlanOverride) => void;
  onToggleProfile: (profileId: string) => void;
  onToggleItem: (profileId: string, itemId: string) => void;
  onRestoreRecommendation: () => void;
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

const SOURCE_FORMAT_OPTIONS: InspectionSourceFormat[] = [
  'urdf',
  'mjcf',
  'usd',
  'xacro',
  'sdf',
  'mesh',
];

const ROBOT_TYPE_OPTIONS: InspectionRobotType[] = [
  'generic',
  'humanoid',
  'quadruped',
  'manipulator',
  'mobile_base',
  'gripper',
];

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

function clearOverrideField(
  override: NormalInspectionPlanOverride,
  field: keyof NormalInspectionPlanOverride,
) {
  const nextOverride = { ...override };
  delete nextOverride[field];
  return nextOverride;
}

function RecognitionSelect({
  label,
  value,
  autoLabel,
  dataKey,
  children,
  onChange,
}: {
  label: string;
  value: string;
  autoLabel: string;
  dataKey: string;
  children: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label className="rounded-xl border border-border-black bg-element-bg p-3">
      <span className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          {label}
        </span>
        {!value && (
          <span
            data-inspection-recognition-auto={dataKey}
            className="rounded-md border border-system-blue/20 bg-system-blue/5 px-2 py-0.5 text-[10px] font-semibold text-system-blue"
          >
            {autoLabel}
          </span>
        )}
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

interface NormalInspectionCheckEditorProps {
  lang: Language;
  t: TranslationKeys;
  automaticPlan: NormalInspectionPlan;
  selectedProfiles: SelectedInspectionProfiles;
  recommendedProfiles: SelectedInspectionProfiles;
  onToggleProfile: (profileId: string) => void;
  onToggleItem: (profileId: string, itemId: string) => void;
  onRestoreRecommendation: () => void;
}

function NormalInspectionCheckEditor({
  lang,
  t,
  automaticPlan,
  selectedProfiles,
  recommendedProfiles,
  onToggleProfile,
  onToggleItem,
  onRestoreRecommendation,
}: NormalInspectionCheckEditorProps) {
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(
    () => automaticPlan.includedProfileIds[0] ?? null,
  );
  const selectedItemCount = countSelectedInspectionProfileItems(selectedProfiles);
  const totalItemCount = INSPECTION_PROFILE_DEFINITIONS.reduce(
    (sum, profile) => sum + profile.items.length,
    0,
  );
  const selectionDeviation = buildInspectionSelectionDeviation(
    selectedProfiles,
    recommendedProfiles,
  );
  const visibleProfiles = INSPECTION_PROFILE_DEFINITIONS.filter(
    (profile) =>
      (selectedProfiles[profile.id]?.size ?? 0) > 0 ||
      (recommendedProfiles[profile.id]?.size ?? 0) > 0,
  );
  const visibleProfileIdsKey = visibleProfiles.map((profile) => profile.id).join('\u0000');
  const selectedSummary = t.inspectionSelectedChecksSummary
    .replace('{selected}', String(selectedItemCount))
    .replace('{total}', String(totalItemCount));

  useEffect(() => {
    const visibleProfileIds = visibleProfileIdsKey ? visibleProfileIdsKey.split('\u0000') : [];
    setExpandedProfileId((currentProfileId) => {
      if (currentProfileId === null || visibleProfileIds.includes(currentProfileId)) {
        return currentProfileId;
      }

      return visibleProfileIds[0] ?? null;
    });
  }, [visibleProfileIdsKey]);

  return (
    <section
      data-inspection-normal-check-editor="true"
      className="border-t border-border-black bg-panel-bg p-4"
    >
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text-primary">
            {t.inspectionConfigureChecks}
          </h3>
          <p className="mt-1 text-[11px] leading-4 text-text-secondary">
            {t.inspectionConfigureChecksDescription}
          </p>
          <p
            data-inspection-normal-selection-summary
            className="mt-2 text-[11px] font-semibold text-system-blue"
          >
            {selectedSummary}
          </p>
        </div>
        <button
          type="button"
          data-inspection-normal-restore-recommendation
          disabled={selectionDeviation.totalChangedItemCount === 0}
          onClick={onRestoreRecommendation}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-system-blue/25 bg-element-bg px-3 text-[11px] font-semibold text-system-blue transition-colors hover:bg-system-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {t.inspectionRestoreRecommendation}
        </button>
      </div>

      <div className="grid items-start gap-2 lg:grid-cols-2">
        {visibleProfiles.map((profile) => {
          const selectedItems = selectedProfiles[profile.id] ?? new Set<string>();
          const isExpanded = expandedProfileId === profile.id;
          const isIncluded = selectedItems.size > 0;

          return (
            <section
              key={profile.id}
              data-inspection-normal-profile-row={profile.id}
              className={`overflow-hidden rounded-xl border transition-colors ${
                isExpanded
                  ? 'border-system-blue/35 bg-system-blue/5'
                  : 'border-border-black bg-element-bg'
              }`}
            >
              <div className="flex items-center gap-2 p-2">
                <button
                  type="button"
                  data-inspection-normal-profile-expand={profile.id}
                  aria-expanded={isExpanded}
                  onClick={() => setExpandedProfileId(isExpanded ? null : profile.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                >
                  <ChevronDown
                    aria-hidden="true"
                    className={`h-3.5 w-3.5 shrink-0 text-text-tertiary transition-transform ${
                      isExpanded ? 'rotate-180 text-system-blue' : ''
                    }`}
                  />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-text-primary">
                    {getInspectionProfileName(profile.id, lang)}
                  </span>
                  <span className="shrink-0 text-[10px] font-medium tabular-nums text-text-tertiary">
                    {selectedItems.size}/{profile.items.length}
                  </span>
                </button>
                <button
                  type="button"
                  data-inspection-normal-profile-toggle={profile.id}
                  aria-pressed={isIncluded}
                  onClick={() => onToggleProfile(profile.id)}
                  className={`shrink-0 rounded-lg border px-2 py-1 text-[10px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                    isIncluded
                      ? 'border-system-blue/30 bg-system-blue/10 text-system-blue'
                      : 'border-border-black bg-panel-bg text-text-tertiary hover:border-system-blue/30 hover:text-system-blue'
                  }`}
                >
                  {isIncluded ? t.inspectionIncluded : t.inspectionSkipped}
                </button>
              </div>

              {isExpanded && (
                <div
                  data-inspection-normal-profile-items={profile.id}
                  className="grid gap-1.5 border-t border-border-black p-2"
                >
                  {profile.items.map((item) => {
                    const isSelected = selectedItems.has(item.id);

                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-inspection-normal-item={`${profile.id}:${item.id}`}
                        aria-pressed={isSelected}
                        onClick={() => onToggleItem(profile.id, item.id)}
                        className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                          isSelected
                            ? 'border-system-blue/25 bg-panel-bg text-text-primary'
                            : 'border-border-black bg-element-bg text-text-secondary hover:border-system-blue/30'
                        }`}
                      >
                        <span
                          aria-hidden="true"
                          className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                            isSelected
                              ? 'border-system-blue bg-system-blue text-white'
                              : 'border-border-black bg-panel-bg'
                          }`}
                        >
                          {isSelected && <Check className="h-2.5 w-2.5" />}
                        </span>
                        <span className="min-w-0 flex-1 truncate">
                          {lang === 'zh' ? item.nameZh : item.name}
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
    </section>
  );
}

export function InspectionSetupNormalView({
  lang,
  t,
  automaticPlan,
  override,
  selectedProfiles,
  recommendedProfiles,
  onOverrideChange,
  onToggleProfile,
  onToggleItem,
  onRestoreRecommendation,
}: InspectionSetupNormalViewProps) {
  return (
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

      <div
        data-inspection-recognition-grid="true"
        className="grid gap-3 p-4"
        style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 22rem), 1fr))' }}
      >
        <RecognitionSelect
          label={t.inspectionPlanPurpose}
          value={override.purpose ?? ''}
          autoLabel={t.inspectionPlanAuto}
          dataKey="purpose"
          onChange={(value) => {
            onOverrideChange(
              value
                ? { ...override, purpose: value as NormalInspectionPurpose }
                : clearOverrideField(override, 'purpose'),
            );
          }}
        >
          <option value="">{formatPurposeLabel(automaticPlan.purpose, t)}</option>
          {PURPOSE_OPTIONS.map((purpose) => (
            <option key={purpose} value={purpose}>
              {formatPurposeLabel(purpose, t)}
            </option>
          ))}
        </RecognitionSelect>
        <RecognitionSelect
          label={t.inspectionRecommendationTarget}
          value={override.targetPlatform ?? ''}
          autoLabel={t.inspectionPlanAuto}
          dataKey="targetPlatform"
          onChange={(value) => {
            onOverrideChange(
              value
                ? { ...override, targetPlatform: value as InspectionTargetPlatform }
                : clearOverrideField(override, 'targetPlatform'),
            );
          }}
        >
          <option value="">{formatTargetPlatformLabel(automaticPlan.targetPlatform, t)}</option>
          {TARGET_PLATFORM_OPTIONS.map((targetPlatform) => (
            <option key={targetPlatform} value={targetPlatform}>
              {formatTargetPlatformLabel(targetPlatform, t)}
            </option>
          ))}
        </RecognitionSelect>
        <RecognitionSelect
          label={t.inspectionRecommendationSourceFormat}
          value={override.sourceFormat ?? ''}
          autoLabel={t.inspectionPlanAuto}
          dataKey="sourceFormat"
          onChange={(value) => {
            onOverrideChange(
              value
                ? { ...override, sourceFormat: value as InspectionSourceFormat }
                : clearOverrideField(override, 'sourceFormat'),
            );
          }}
        >
          <option value="">{automaticPlan.recommendation.sourceFormat.toUpperCase()}</option>
          {SOURCE_FORMAT_OPTIONS.map((sourceFormat) => (
            <option key={sourceFormat} value={sourceFormat}>
              {sourceFormat.toUpperCase()}
            </option>
          ))}
        </RecognitionSelect>
        <RecognitionSelect
          label={t.inspectionRecommendationRobotType}
          value={override.robotType ?? ''}
          autoLabel={t.inspectionPlanAuto}
          dataKey="robotType"
          onChange={(value) => {
            onOverrideChange(
              value
                ? { ...override, robotType: value as InspectionRobotType }
                : clearOverrideField(override, 'robotType'),
            );
          }}
        >
          <option value="">
            {formatRobotTypeLabel(automaticPlan.recommendation.robotType, t)}
          </option>
          {ROBOT_TYPE_OPTIONS.map((robotType) => (
            <option key={robotType} value={robotType}>
              {formatRobotTypeLabel(robotType, t)}
            </option>
          ))}
        </RecognitionSelect>
      </div>

      <NormalInspectionCheckEditor
        lang={lang}
        t={t}
        automaticPlan={automaticPlan}
        selectedProfiles={selectedProfiles}
        recommendedProfiles={recommendedProfiles}
        onToggleProfile={onToggleProfile}
        onToggleItem={onToggleItem}
        onRestoreRecommendation={onRestoreRecommendation}
      />
    </section>
  );
}

export default InspectionSetupNormalView;
