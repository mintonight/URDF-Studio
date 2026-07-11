import { Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Language, TranslationKeys } from '@/shared/i18n';
import type { RobotState } from '@/types';
import type {
  NormalInspectionPlan,
  NormalInspectionPlanOverride,
  NormalInspectionPurpose,
} from '../utils/inspectionNormalPlan';
import type {
  InspectionRobotType,
  InspectionTargetPlatform,
} from '../utils/inspectionProfileRecommendation';

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

function FieldShell({
  label,
  auto,
  autoLabel,
  children,
}: {
  label: string;
  auto: boolean;
  autoLabel: string;
  children: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-[132px] flex-col rounded-xl border border-border-black bg-element-bg px-4 py-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[13px] font-semibold uppercase tracking-[0.08em] text-text-tertiary">
          {label}
        </div>
        {auto && (
          <span className="rounded-md border border-system-blue/15 bg-system-blue/5 px-2 py-1 text-[11px] font-semibold text-system-blue">
            {autoLabel}
          </span>
        )}
      </div>
      <div className="mt-3.5 min-w-0 flex-1">{children}</div>
    </div>
  );
}

function PlanSelect({
  value,
  dataKey,
  ariaLabel,
  onChange,
  children,
}: {
  value: string;
  dataKey: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <select
      data-inspection-normal-select={dataKey}
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
      className="h-12 w-full appearance-none rounded-xl border border-border-black bg-panel-bg bg-[length:16px_16px] bg-[right_0.875rem_center] bg-no-repeat px-3.5 pr-10 text-[15px] font-semibold text-text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
      }}
    >
      {children}
    </select>
  );
}

export function InspectionSetupNormalView({
  lang: _lang,
  t,
  plan,
  override,
  onOverrideChange,
}: InspectionSetupNormalViewProps) {
  const hasManualOverride = Boolean(
    override.purpose || override.targetPlatform || override.robotType || override.sourceFormat,
  );

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <section
        data-inspection-profile-recommendation-card
        className="flex h-full min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-black bg-panel-bg p-5 shadow-sm sm:p-6"
      >
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-system-blue/20 bg-system-blue/10 text-system-blue">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2
              data-inspection-normal-title
              className="text-2xl font-semibold leading-8 tracking-tight text-text-primary"
            >
              {t.inspectionRecommendedPlan}
            </h2>
            <p className="mt-1.5 text-[15px] leading-6 text-text-secondary">
              {t.inspectionRecommendedPlanDescription}
            </p>
          </div>
        </div>

        <div className="mt-6 grid flex-1 content-start gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <FieldShell
            label={t.inspectionPlanPurpose}
            auto={!override.purpose}
            autoLabel={t.inspectionPlanAuto}
          >
            <PlanSelect
              dataKey="purpose"
              ariaLabel={t.inspectionPlanPurpose}
              value={plan.purpose}
              onChange={(value) =>
                onOverrideChange({
                  ...override,
                  purpose: value as NormalInspectionPurpose,
                })
              }
            >
              {PURPOSE_OPTIONS.map((purpose) => (
                <option key={purpose} value={purpose}>
                  {formatPurposeLabel(purpose, t)}
                </option>
              ))}
            </PlanSelect>
          </FieldShell>

          <FieldShell
            label={t.inspectionRecommendationTarget}
            auto={!override.targetPlatform}
            autoLabel={t.inspectionPlanAuto}
          >
            <PlanSelect
              dataKey="targetPlatform"
              ariaLabel={t.inspectionRecommendationTarget}
              value={plan.targetPlatform}
              onChange={(value) =>
                onOverrideChange({
                  ...override,
                  targetPlatform: value as InspectionTargetPlatform,
                })
              }
            >
              {TARGET_PLATFORM_OPTIONS.map((targetPlatform) => (
                <option key={targetPlatform} value={targetPlatform}>
                  {formatTargetPlatformLabel(targetPlatform, t)}
                </option>
              ))}
            </PlanSelect>
          </FieldShell>

          <FieldShell
            label={t.inspectionRecommendationRobotType}
            auto={!override.robotType}
            autoLabel={t.inspectionPlanAuto}
          >
            <PlanSelect
              dataKey="robotType"
              ariaLabel={t.inspectionRecommendationRobotType}
              value={plan.recommendation.robotType}
              onChange={(value) =>
                onOverrideChange({
                  ...override,
                  robotType: value as InspectionRobotType,
                })
              }
            >
              {ROBOT_TYPE_OPTIONS.map((robotType) => (
                <option key={robotType} value={robotType}>
                  {formatRobotTypeLabel(robotType, t)}
                </option>
              ))}
            </PlanSelect>
          </FieldShell>

          <FieldShell
            label={t.inspectionRecommendationSourceFormat}
            auto={!override.sourceFormat}
            autoLabel={t.inspectionPlanAuto}
          >
            <PlanSelect
              dataKey="sourceFormat"
              ariaLabel={t.inspectionRecommendationSourceFormat}
              value={plan.recommendation.sourceFormat}
              onChange={(value) =>
                onOverrideChange({
                  ...override,
                  sourceFormat: value as InspectionSourceFormat,
                })
              }
            >
              {SOURCE_FORMAT_OPTIONS.map((sourceFormat) => (
                <option key={sourceFormat} value={sourceFormat}>
                  {sourceFormat.toUpperCase()}
                </option>
              ))}
            </PlanSelect>
          </FieldShell>
        </div>

        {hasManualOverride && (
          <div className="mt-5 flex justify-end">
            <button
              type="button"
              data-inspection-normal-reset-auto
              onClick={() => onOverrideChange({})}
              className="h-10 rounded-lg px-4 text-[13px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              {t.inspectionPlanResetAuto}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default InspectionSetupNormalView;
