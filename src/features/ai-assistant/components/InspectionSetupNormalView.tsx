import {
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';
import type { Language, TranslationKeys } from '@/shared/i18n';
import {

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
  lang: _lang,
  t,
  plan,
  override,
  onOverrideChange,
}: InspectionSetupNormalViewProps) {
  const [isAdjusting, setIsAdjusting] = useState(false);

  return (
    <div className="space-y-5">
      <section
        data-inspection-profile-recommendation-card
        className="overflow-hidden rounded-xl border border-border-black bg-panel-bg p-4 shadow-sm"
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
    </div>
  );
}

export default InspectionSetupNormalView;
