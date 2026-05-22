import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Layers,
  Package,
  SlidersHorizontal,
  Sparkles,
  Target,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Language, TranslationKeys } from '@/shared/i18n';
import {
  getAllInspectionProfileItemCount,
  getInspectionProfileDefinition,
  getInspectionProfileItem,
  getInspectionProfileLayerName,
  getInspectionProfileName,
} from '../config/inspectionProfiles';
import type {
  NormalInspectionPlan,
  NormalInspectionPlanOverride,
  NormalInspectionPurpose,
} from '../utils/inspectionNormalPlan';
import type {
  InspectionRobotType,
  InspectionTargetPlatform,
} from '../utils/inspectionProfileRecommendation';

interface InspectionSetupNormalViewProps {
  lang: Language;
  t: TranslationKeys;
  plan: NormalInspectionPlan;
  override: NormalInspectionPlanOverride;
  onOverrideChange: (override: NormalInspectionPlanOverride) => void;
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

const getProfileIcon = (layer: string) => {
  if (layer === 'base') return Layers;
  if (layer === 'format') return FileText;
  if (layer === 'target') return Target;
  if (layer === 'workflow') return Package;
  return Sparkles;
};

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

function formatReasonLabel(reason: string, t: TranslationKeys) {
  if (reason.startsWith('source_format:')) {
    return `${t.inspectionRecommendationSourceFormat}: ${reason.slice('source_format:'.length).toUpperCase()}`;
  }
  if (reason.startsWith('target:')) {
    return `${t.inspectionRecommendationTarget}: ${formatTargetPlatformLabel(
      reason.slice('target:'.length) as InspectionTargetPlatform,
      t,
    )}`;
  }
  if (reason === 'workflow:assembly') {
    return t.inspectionReasonAssembly;
  }
  if (reason === 'workflow:hardware_config') {
    return t.inspectionReasonHardwareConfig;
  }
  if (reason === 'workflow:export_preflight') {
    return t.inspectionReasonExportPreflight;
  }
  if (reason === 'workflow:collision_authoring') {
    return t.inspectionReasonCollisionAuthoring;
  }
  if (reason === 'workflow:inertia_authoring') {
    return t.inspectionReasonInertiaAuthoring;
  }
  if (reason.startsWith('purpose:')) {
    return `${t.inspectionPlanPurpose}: ${formatPurposeLabel(
      reason.slice('purpose:'.length) as NormalInspectionPurpose,
      t,
    )}`;
  }

  return reason;
}

function OptionButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`h-8 rounded-lg border px-3 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        active
          ? 'border-system-blue/30 bg-system-blue/10 text-system-blue shadow-sm'
          : 'border-border-black bg-element-bg text-text-secondary hover:bg-element-hover hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  );
}

export function InspectionSetupNormalView({
  lang,
  t,
  plan,
  override,
  onOverrideChange,
}: InspectionSetupNormalViewProps) {
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [isScopeExpanded, setIsScopeExpanded] = useState(true);
  const [expandedProfileIds, setExpandedProfileIds] = useState<Set<string>>(() => new Set());

  const totalSelectedCount = useMemo(
    () =>
      Object.values(plan.selectedProfiles).reduce((sum, itemIds) => sum + itemIds.size, 0),
    [plan.selectedProfiles],
  );
  const totalItemCount = getAllInspectionProfileItemCount();
  const selectedSummary = t.inspectionSelectedChecksSummary
    .replace('{selected}', String(totalSelectedCount))
    .replace('{total}', String(totalItemCount));
  const includedProfiles = plan.includedProfileIds
    .map((profileId) => {
      const itemCount = plan.selectedProfiles[profileId]?.size ?? 0;
      const profileDefinition = getInspectionProfileDefinition(profileId);
      return {
        id: profileId,
        name: getInspectionProfileName(profileId, lang),
        layer: profileDefinition ? getInspectionProfileLayerName(profileDefinition.layer, lang) : profileId,
        itemCount,
      };
    })
    .filter((profile) => profile.itemCount > 0);

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

  return (
    <div className="space-y-5">
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
                <h2
                  data-inspection-normal-title
                  className="text-lg font-semibold leading-6 tracking-tight text-text-primary"
                >
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
            onClick={() => setIsAdjusting((current) => !current)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-black bg-element-bg px-3 text-[11px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t.inspectionRecommendationAdjustScope}
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: t.inspectionPlanPurpose,
              value: formatPurposeLabel(plan.purpose, t),
              auto: !override.purpose,
            },
            {
              label: t.inspectionRecommendationTarget,
              value: formatTargetPlatformLabel(plan.targetPlatform, t),
              auto: !override.targetPlatform,
            },
            {
              label: t.inspectionRecommendationRobotType,
              value: formatRobotTypeLabel(plan.recommendation.robotType, t),
              auto: true,
            },
            {
              label: t.inspectionRecommendationSourceFormat,
              value: plan.recommendation.sourceFormat.toUpperCase(),
              auto: true,
            },
          ].map((metric) => (
            <div
              key={metric.label}
              className="rounded-lg border border-border-black bg-element-bg px-3 py-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                  {metric.label}
                </div>
                {metric.auto && (
                  <span className="rounded-md border border-system-blue/15 bg-system-blue/5 px-1.5 py-0.5 text-[9px] font-medium text-system-blue">
                    {t.inspectionPlanAuto}
                  </span>
                )}
              </div>
              <div className="mt-1 text-[12px] font-semibold text-text-primary">
                {metric.value}
              </div>
            </div>
          ))}
        </div>

        {isAdjusting && (
          <div
            data-inspection-normal-adjustment
            className="mt-4 space-y-3 rounded-xl border border-border-black bg-panel-bg p-3"
          >
            <div>
              <div className="text-[11px] font-semibold text-text-secondary">
                {t.inspectionPlanPurpose}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {PURPOSE_OPTIONS.map((purpose) => (
                  <OptionButton
                    key={purpose}
                    active={plan.purpose === purpose}
                    onClick={() => onOverrideChange({ ...override, purpose })}
                  >
                    {formatPurposeLabel(purpose, t)}
                  </OptionButton>
                ))}
              </div>
            </div>

            <div>
              <div className="text-[11px] font-semibold text-text-secondary">
                {t.inspectionRecommendationTarget}
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {TARGET_PLATFORM_OPTIONS.map((targetPlatform) => (
                  <OptionButton
                    key={targetPlatform}
                    active={plan.targetPlatform === targetPlatform}
                    onClick={() => onOverrideChange({ ...override, targetPlatform })}
                  >
                    {formatTargetPlatformLabel(targetPlatform, t)}
                  </OptionButton>
                ))}
              </div>
            </div>

            {(override.purpose || override.targetPlatform) && (
              <button
                type="button"
                onClick={() => onOverrideChange({})}
                className="h-8 rounded-lg px-3 text-[11px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
              >
                {t.inspectionPlanResetAuto}
              </button>
            )}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border-black bg-panel-bg p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-text-primary">
              {t.inspectionPlanIncludedScope}
            </h2>
            <p className="mt-1 text-[12px] leading-5 text-text-tertiary">
              {t.inspectionPlanIncludedScopeDescription}
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

          <button
            type="button"
            onClick={() => setIsScopeExpanded((current) => !current)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border-black bg-element-bg px-3 text-[11px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
          >
            {isScopeExpanded ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            {isScopeExpanded ? t.inspectionPlanHideScope : t.inspectionPlanViewScope}
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {plan.reasons.map((reason) => (
            <span
              key={reason}
              className="rounded-md border border-border-black bg-element-bg px-2 py-1 text-[10px] font-medium text-text-secondary"
            >
              {formatReasonLabel(reason, t)}
            </span>
          ))}
        </div>

        {isScopeExpanded && (
          <div
            data-inspection-normal-scan-list
            className="mt-4 overflow-hidden rounded-xl border border-border-black bg-panel-bg shadow-sm divide-y divide-border-black"
          >
            {includedProfiles.map((profile) => {
              const Icon = getProfileIcon(profile.id.split('.')[0] ?? '');
              const isExpanded = expandedProfileIds.has(profile.id);
              const itemIds = Array.from(plan.selectedProfiles[profile.id] ?? []);

              return (
                <section
                  key={profile.id}
                  data-inspection-normal-profile
                  className="rounded-xl border-0 bg-system-blue/5"
                >
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    data-inspection-normal-profile-row
                    className="grid w-full min-w-0 grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-system-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                    onClick={() => toggleProfileExpansion(profile.id)}
                  >
                    <span
                      aria-hidden="true"
                      data-inspection-normal-profile-selection
                      className="rounded-md"
                    >
                      <span
                        data-inspection-normal-selection-mark
                        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-system-blue bg-system-blue/80 text-white shadow-sm"
                      >
                        <Check className="h-3 w-3" />
                      </span>
                    </span>

                    <div
                      data-inspection-normal-profile-icon
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-system-blue/20 bg-system-blue/10 text-system-blue"
                    >
                      <Icon className="h-[15px] w-[15px]" />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="truncate text-[13px] font-semibold text-text-primary">
                          {profile.name}
                        </div>
                        <span className="shrink-0 text-[11px] font-medium text-text-tertiary">
                          {profile.layer}
                        </span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-element-bg">
                        <div
                          data-inspection-normal-profile-progress
                          className="h-full rounded-full bg-slider-accent transition-[width,background-color]"
                          style={{ width: '100%' }}
                        />
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <div
                        data-inspection-normal-profile-count
                        className="rounded-md border border-system-blue/20 bg-panel-bg px-2 py-1 text-[10px] font-semibold tabular-nums text-system-blue shadow-sm"
                      >
                        {profile.itemCount}
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

                  {isExpanded && (
                    <div
                      data-inspection-normal-item-list
                      className="grid gap-1.5 border-t border-border-black/70 bg-panel-bg px-3.5 py-2.5 sm:grid-cols-2 lg:grid-cols-3"
                    >
                      {itemIds.map((itemId) => (
                        <div
                          data-inspection-normal-item
                          key={itemId}
                          className="flex w-full items-center gap-2 rounded-md border border-system-blue/15 bg-system-blue/5 px-2 py-1.5 text-left text-text-primary shadow-sm"
                        >
                          <span
                            aria-hidden="true"
                            data-inspection-normal-selection-mark
                            className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border border-system-blue-solid bg-system-blue-solid text-white shadow-sm"
                          >
                            <Check className="h-3 w-3" />
                          </span>
                          <span className="min-w-0 truncate text-[12px] font-medium">
                            {lang === 'zh'
                              ? (getInspectionProfileItem(profile.id, itemId)?.nameZh ?? itemId)
                              : (getInspectionProfileItem(profile.id, itemId)?.name ?? itemId)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default InspectionSetupNormalView;
