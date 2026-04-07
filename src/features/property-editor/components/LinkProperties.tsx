/**
 * LinkProperties - Property editing panel for Link elements.
 * Renders the link-only editing layout shared by all editor modes:
 * - Name input
 * - Visual/Collision/Physics tabs
 */
import React, { useMemo } from 'react';
import { Eye, Box, Waypoints } from 'lucide-react';
import type { DetailLinkTab, RobotState, AppMode, MotorSpec, UrdfLink } from '@/types';
import { translations } from '@/shared/i18n';
import { useUIStore, type Language, type MassInertiaChangeBehavior } from '@/store';
import { MAX_PROPERTY_DECIMALS, formatNumberWithMaxDecimals } from '@/core/utils/numberPrecision';
import {
  composeInertiaTensorFromDerivedValues,
  computeInertialDerivedValues,
  computeLinkDensity,
  scaleInertiaTensorForMassChange,
  type InertiaTensorComponents,
} from '@/shared/utils/inertialDerived';
import { Button, Checkbox, Dialog, SegmentedControl } from '@/shared/components/ui';
import {
  CollapsibleSection,
  InlineInputGroup,
  NumberInput,
  PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS,
  PROPERTY_EDITOR_INPUT_CLASS,
  ReadonlyVectorStatHeader,
  ReadonlyVectorStatRow,
  ReadonlyValueField,
} from './FormControls';
import { GeometryEditor } from './GeometryEditor';
import { TransformFields } from './TransformFields';

const DEFAULT_INERTIAL = {
  mass: 0,
  origin: { xyz: { x: 0, y: 0, z: 0 }, rpy: { r: 0, p: 0, y: 0 } },
  inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
};

const DEFAULT_PRINCIPAL_AXES = [
  { x: 1, y: 0, z: 0 },
  { x: 0, y: 1, z: 0 },
  { x: 0, y: 0, z: 1 },
] as const;

type ResolvedMassInertiaBehavior = Exclude<MassInertiaChangeBehavior, 'ask'>;

interface PendingMassInertiaDecision {
  linkSnapshot: UrdfLink;
  nextMass: number;
  scaledEstimate: ReturnType<typeof scaleInertiaTensorForMassChange>;
}

interface FloatingMassInertiaNotice {
  message: string;
  tone: 'info' | 'success';
}

const formatReadonlyNumber = (value: number | null | undefined): string => {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 'N/A';
  }

  return formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);
};

const fillTemplate = (template: string, replacements: Record<string, string>): string =>
  Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, value),
    template,
  );

const formatMassValue = (value: number): string =>
  formatNumberWithMaxDecimals(value, MAX_PROPERTY_DECIMALS);

const formatInertiaTensorSummary = (inertia: InertiaTensorComponents): string => {
  const diagonalSummary = `ixx=${formatReadonlyNumber(inertia.ixx)}, iyy=${formatReadonlyNumber(
    inertia.iyy,
  )}, izz=${formatReadonlyNumber(inertia.izz)}`;
  const hasOffDiagonalTerms = [inertia.ixy, inertia.ixz, inertia.iyz].some(
    (value) => Math.abs(value) > 1e-9,
  );

  if (!hasOffDiagonalTerms) {
    return diagonalSummary;
  }

  return `${diagonalSummary}; ixy=${formatReadonlyNumber(inertia.ixy)}, ixz=${formatReadonlyNumber(
    inertia.ixz,
  )}, iyz=${formatReadonlyNumber(inertia.iyz)}`;
};

const buildMassInertiaNotice = (
  t: (typeof translations)['en'],
  linkName: string,
  nextMass: number,
  behavior: ResolvedMassInertiaBehavior,
  scaledEstimate: ReturnType<typeof scaleInertiaTensorForMassChange>,
): FloatingMassInertiaNotice => {
  if (behavior === 'reestimate' && scaledEstimate) {
    return {
      message: fillTemplate(t.massChangeInertiaReestimatedNotice, {
        name: linkName,
        tensor: formatInertiaTensorSummary(scaledEstimate.inertia),
      }),
      tone: 'success',
    };
  }

  if (behavior === 'reestimate') {
    return {
      message: fillTemplate(t.massChangeInertiaFallbackNotice, {
        name: linkName,
      }),
      tone: 'info',
    };
  }

  return {
    message: fillTemplate(t.massChangeInertiaPreservedNotice, {
      name: linkName,
      mass: formatMassValue(nextMass),
    }),
    tone: 'info',
  };
};

const DetailGeometryTabButton = ({
  icon: Icon,
  isActive,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  isActive: boolean;
  label: string;
  onClick: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    title={label}
    className={`relative flex min-w-0 flex-1 items-center justify-center gap-1 overflow-hidden rounded-t-lg border-x border-t px-1 py-1 text-[10px] font-semibold transition-all ${
      isActive
        ? 'z-10 -mb-px border-border-black bg-panel-bg pb-1.5 text-system-blue dark:bg-segmented-active'
        : 'border-transparent bg-transparent text-text-tertiary hover:bg-element-hover hover:text-text-secondary'
    }`}
  >
    <Icon className="h-3 w-3 shrink-0" />
    <span className="min-w-0 truncate leading-tight">{label}</span>
  </button>
);

const DetailGeometryTabPanel = ({
  activeTab,
  children,
  tab,
}: {
  activeTab: DetailLinkTab;
  children: React.ReactNode;
  tab: DetailLinkTab;
}) => (
  <div
    style={{ display: activeTab === tab ? undefined : 'none' }}
    className="mb-2.5 animate-in rounded-b-lg border-x border-b border-border-black bg-panel-bg p-1.5 shadow-sm fade-in slide-in-from-bottom-1 duration-200"
  >
    {children}
  </div>
);

interface LinkPropertiesProps {
  data: UrdfLink;
  robot: RobotState;
  mode: AppMode;
  selection: { id: string | null; type: string; subType?: 'visual' | 'collision' };
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  motorLibrary: Record<string, MotorSpec[]>;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  t: (typeof translations)['en'];
  lang: Language;
}

export const LinkProperties: React.FC<LinkPropertiesProps> = ({
  data,
  robot,
  selection,
  onUpdate,
  assets,
  onUploadAsset,
  t,
  lang,
}) => {
  const linkTab = useUIStore((state) => state.detailLinkTab);
  const setDetailLinkTab = useUIStore((state) => state.setDetailLinkTab);
  const massInertiaChangeBehavior = useUIStore((state) => state.massInertiaChangeBehavior);
  const setMassInertiaChangeBehavior = useUIStore((state) => state.setMassInertiaChangeBehavior);
  const inertial = data.inertial ?? DEFAULT_INERTIAL;
  const noticeTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingMassInertiaDecision, setPendingMassInertiaDecision] =
    React.useState<PendingMassInertiaDecision | null>(null);
  const [selectedMassInertiaBehavior, setSelectedMassInertiaBehavior] =
    React.useState<ResolvedMassInertiaBehavior>('reestimate');
  const [rememberMassInertiaBehavior, setRememberMassInertiaBehavior] = React.useState(false);
  const [floatingMassInertiaNotice, setFloatingMassInertiaNotice] =
    React.useState<FloatingMassInertiaNotice | null>(null);
  const densityResult = useMemo(() => computeLinkDensity(data), [data]);
  const derivedInertial = useMemo(
    () => computeInertialDerivedValues(data.inertial),
    [data.inertial],
  );
  const densityLabel = t.density;

  const handleTabChange = (tab: DetailLinkTab) => {
    setDetailLinkTab(tab);
  };
  const inertiaTensorFields = ['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'] as const;
  const diagonalInertiaLabels = ['I1', 'I2', 'I3'] as const;
  const principalAxisLabels = ['A1', 'A2', 'A3'] as const;
  const diagonalInertiaValues = derivedInertial?.diagonalInertia ?? [
    inertial.inertia.ixx,
    inertial.inertia.iyy,
    inertial.inertia.izz,
  ];
  const principalAxes =
    derivedInertial?.principalAxes ??
    (DEFAULT_PRINCIPAL_AXES as [
      { x: number; y: number; z: number },
      { x: number; y: number; z: number },
      { x: number; y: number; z: number },
    ]);

  const handleDiagonalInertiaChange = (index: 0 | 1 | 2, value: number) => {
    const nextDiagonalInertia = [...diagonalInertiaValues] as [number, number, number];
    nextDiagonalInertia[index] = value;

    onUpdate('link', selection.id!, {
      ...data,
      inertial: {
        ...inertial,
        inertia: composeInertiaTensorFromDerivedValues(nextDiagonalInertia, principalAxes),
      },
    });
  };

  const showFloatingMassInertiaNotice = React.useCallback((notice: FloatingMassInertiaNotice) => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }

    setFloatingMassInertiaNotice(notice);
    noticeTimerRef.current = setTimeout(() => {
      setFloatingMassInertiaNotice(null);
      noticeTimerRef.current = null;
    }, 5000);
  }, []);

  React.useEffect(() => {
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  React.useEffect(() => {
    setPendingMassInertiaDecision(null);
    setRememberMassInertiaBehavior(false);
    setSelectedMassInertiaBehavior('reestimate');
  }, [data.id]);

  const applyMassChange = React.useCallback(
    (
      linkSnapshot: UrdfLink,
      nextMass: number,
      behavior: ResolvedMassInertiaBehavior,
      scaledEstimate: ReturnType<typeof scaleInertiaTensorForMassChange>,
      options?: { remember?: boolean },
    ) => {
      const nextInertial = {
        ...(linkSnapshot.inertial ?? DEFAULT_INERTIAL),
        mass: nextMass,
        ...(behavior === 'reestimate' && scaledEstimate ? { inertia: scaledEstimate.inertia } : {}),
      };

      onUpdate('link', linkSnapshot.id, {
        ...linkSnapshot,
        inertial: nextInertial,
      });

      if (options?.remember) {
        setMassInertiaChangeBehavior(behavior);
      }

      showFloatingMassInertiaNotice(
        buildMassInertiaNotice(t, linkSnapshot.name, nextMass, behavior, scaledEstimate),
      );
    },
    [onUpdate, setMassInertiaChangeBehavior, showFloatingMassInertiaNotice, t],
  );

  const handleMassChange = React.useCallback(
    (nextMass: number) => {
      if (Math.abs(nextMass - inertial.mass) <= 1e-12) {
        return;
      }

      const preferredBehavior = massInertiaChangeBehavior;
      const scaledEstimate = scaleInertiaTensorForMassChange(inertial, nextMass);

      if (preferredBehavior === 'ask') {
        setPendingMassInertiaDecision({
          linkSnapshot: data,
          nextMass,
          scaledEstimate,
        });
        setSelectedMassInertiaBehavior(scaledEstimate ? 'reestimate' : 'preserve');
        setRememberMassInertiaBehavior(false);
        return;
      }

      applyMassChange(data, nextMass, preferredBehavior, scaledEstimate);
    },
    [applyMassChange, data, inertial, massInertiaChangeBehavior],
  );

  const handleConfirmMassInertiaDecision = React.useCallback(() => {
    if (!pendingMassInertiaDecision) {
      return;
    }

    applyMassChange(
      pendingMassInertiaDecision.linkSnapshot,
      pendingMassInertiaDecision.nextMass,
      selectedMassInertiaBehavior,
      pendingMassInertiaDecision.scaledEstimate,
      {
        remember: rememberMassInertiaBehavior,
      },
    );
    setPendingMassInertiaDecision(null);
    setRememberMassInertiaBehavior(false);
  }, [
    applyMassChange,
    pendingMassInertiaDecision,
    rememberMassInertiaBehavior,
    selectedMassInertiaBehavior,
  ]);

  const nameField = (
    <InlineInputGroup label={t.name} labelWidthClassName="w-11">
      <input
        type="text"
        value={data.name}
        onChange={(e) => onUpdate('link', selection.id!, { ...data, name: e.target.value })}
        className={PROPERTY_EDITOR_INPUT_CLASS}
      />
    </InlineInputGroup>
  );

  const inertialParametersSection = (
    <CollapsibleSection
      title={t.inertial}
      className="mb-2.5"
      storageKey="property_editor_link_inertial"
    >
      <InlineInputGroup label={t.mass} labelWidthClassName="w-16">
        <NumberInput value={inertial.mass} min={0} commitOnBlurOnly onChange={handleMassChange} />
      </InlineInputGroup>

      <div className="mb-1 overflow-hidden rounded-md border border-border-black/60">
        <div className="bg-element-bg/70 px-2 py-1 text-[9px] font-semibold tracking-[0.02em] text-text-secondary">
          {t.centerOfMass || 'Center of Mass'}
        </div>
        <div className="border-t border-border-black/60 bg-panel-bg px-1.5 py-1">
          <TransformFields
            lang={lang}
            positionValue={inertial.origin?.xyz || { x: 0, y: 0, z: 0 }}
            rotationValue={inertial.origin?.rpy || { r: 0, p: 0, y: 0 }}
            compact={false}
            rotationQuickStepDegrees={90}
            onPositionChange={(xyz) =>
              onUpdate('link', selection.id!, {
                ...data,
                inertial: {
                  ...inertial,
                  origin: {
                    xyz: xyz as { x: number; y: number; z: number },
                    rpy: inertial.origin?.rpy || { r: 0, p: 0, y: 0 },
                  },
                },
              })
            }
            onRotationChange={(rpy) =>
              onUpdate('link', selection.id!, {
                ...data,
                inertial: {
                  ...inertial,
                  origin: {
                    xyz: inertial.origin?.xyz || { x: 0, y: 0, z: 0 },
                    rpy,
                  },
                },
              })
            }
          />
        </div>
      </div>

      <div className="mt-3 border-t border-border-black/60 pt-2">
        <h4 className="mb-2 text-[10px] font-semibold tracking-[0.02em] text-text-tertiary">
          {t.inertiaTensor}
        </h4>
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {inertiaTensorFields.map((field) => (
            <InlineInputGroup key={field} label={field} labelWidthClassName="w-7" className="mb-0">
              <NumberInput
                value={inertial.inertia[field]}
                onChange={(v) =>
                  onUpdate('link', selection.id!, {
                    ...data,
                    inertial: { ...inertial, inertia: { ...inertial.inertia, [field]: v } },
                  })
                }
              />
            </InlineInputGroup>
          ))}
        </div>
      </div>
    </CollapsibleSection>
  );

  const derivedValuesSection = (
    <CollapsibleSection
      title={t.derivedValues}
      className="mb-2.5"
      storageKey="property_editor_link_derived_values"
    >
      <InlineInputGroup label={densityLabel} labelWidthClassName="w-16" align="start">
        <ReadonlyValueField className="min-w-0 w-full overflow-hidden truncate">
          {formatReadonlyNumber(densityResult.value)}
        </ReadonlyValueField>
      </InlineInputGroup>

      <InlineInputGroup label={t.diagonalInertia} labelWidthClassName="w-16" align="start">
        <div className="grid min-w-0 w-full grid-cols-3 gap-1.5">
          {diagonalInertiaLabels.map((label, index) => (
            <div key={label} className="flex min-w-0 items-center gap-1.5">
              <span className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} w-4 justify-center`}>
                {label}
              </span>
              <div className="min-w-0 flex-1">
                <NumberInput
                  value={diagonalInertiaValues[index]}
                  min={0}
                  step={0.01}
                  precision={MAX_PROPERTY_DECIMALS}
                  compact
                  onChange={(value) => handleDiagonalInertiaChange(index as 0 | 1 | 2, value)}
                />
              </div>
            </div>
          ))}
        </div>
      </InlineInputGroup>

      <InlineInputGroup
        label={t.principalAxes}
        labelWidthClassName="w-16"
        align="start"
        className="mb-0"
      >
        <div className="min-w-0 w-full space-y-1.5">
          <ReadonlyVectorStatHeader />
          {principalAxisLabels.map((label, index) => {
            const axis = principalAxes[index];
            return (
              <ReadonlyVectorStatRow
                key={label}
                label={label}
                values={[
                  formatReadonlyNumber(axis?.x),
                  formatReadonlyNumber(axis?.y),
                  formatReadonlyNumber(axis?.z),
                ]}
              />
            );
          })}
        </div>
      </InlineInputGroup>
    </CollapsibleSection>
  );

  const inertialSection = (
    <>
      {inertialParametersSection}
      {derivedValuesSection}
    </>
  );

  return (
    <>
      {nameField}

      {/* Viewer-side visual / collision / physics tabs */}
      <div>
        {/* Tab Navigation - Folder Style */}
        <div className="mb-0 flex items-stretch gap-0.5 rounded-t-lg border border-border-black bg-element-bg px-0.5 pt-0.5">
          <div className="w-px"></div>
          <DetailGeometryTabButton
            icon={Eye}
            isActive={linkTab === 'visual'}
            label={t.visualGeometry}
            onClick={() => handleTabChange('visual')}
          />
          <DetailGeometryTabButton
            icon={Box}
            isActive={linkTab === 'collision'}
            label={t.collisionGeometry}
            onClick={() => handleTabChange('collision')}
          />
          <DetailGeometryTabButton
            icon={Waypoints}
            isActive={linkTab === 'physics'}
            label={t.physics}
            onClick={() => handleTabChange('physics')}
          />
        </div>

        {/* Visual Tab Content - always mounted to preserve snapshot cache */}
        <DetailGeometryTabPanel activeTab={linkTab} tab="visual">
          <GeometryEditor
            data={data}
            robot={robot}
            category="visual"
            onUpdate={(d) => onUpdate('link', selection.id!, d)}
            assets={assets}
            onUploadAsset={onUploadAsset}
            t={t}
            lang={lang}
            isTabbed={true}
          />
        </DetailGeometryTabPanel>

        {/* Collision Tab Content - always mounted to preserve snapshot cache */}
        <DetailGeometryTabPanel activeTab={linkTab} tab="collision">
          <GeometryEditor
            data={data}
            robot={robot}
            category="collision"
            onUpdate={(d) => onUpdate('link', selection.id!, d)}
            assets={assets}
            onUploadAsset={onUploadAsset}
            t={t}
            lang={lang}
            isTabbed={true}
          />
        </DetailGeometryTabPanel>

        <DetailGeometryTabPanel activeTab={linkTab} tab="physics">
          {inertialSection}
        </DetailGeometryTabPanel>
      </div>

      <Dialog
        isOpen={Boolean(pendingMassInertiaDecision)}
        onClose={() => {
          setPendingMassInertiaDecision(null);
          setRememberMassInertiaBehavior(false);
        }}
        title={t.massChangeInertiaDialogTitle}
        width="w-[520px]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setPendingMassInertiaDecision(null);
                setRememberMassInertiaBehavior(false);
              }}
            >
              {t.cancel}
            </Button>
            <Button type="button" onClick={handleConfirmMassInertiaDecision}>
              {t.confirm}
            </Button>
          </div>
        }
      >
        {pendingMassInertiaDecision ? (
          <div className="space-y-3">
            <p className="text-sm leading-6 text-text-secondary">
              {fillTemplate(t.massChangeInertiaDialogMessage, {
                name: pendingMassInertiaDecision.linkSnapshot.name,
                mass: formatMassValue(pendingMassInertiaDecision.nextMass),
              })}
            </p>

            <div className="space-y-2">
              <SegmentedControl<ResolvedMassInertiaBehavior>
                size="sm"
                value={selectedMassInertiaBehavior}
                onChange={setSelectedMassInertiaBehavior}
                options={[
                  {
                    value: 'preserve',
                    label: t.massChangeInertiaKeep,
                  },
                  {
                    value: 'reestimate',
                    label: t.massChangeInertiaReestimate,
                    disabled: !pendingMassInertiaDecision.scaledEstimate,
                  },
                ]}
              />
              <div className="rounded-xl border border-border-black bg-element-bg/60 px-3 py-2.5">
                <div className="text-xs font-semibold text-text-primary">
                  {selectedMassInertiaBehavior === 'preserve'
                    ? t.massChangeInertiaKeepDescription
                    : t.massChangeInertiaReestimateDescription}
                </div>
                {selectedMassInertiaBehavior === 'reestimate' &&
                !pendingMassInertiaDecision.scaledEstimate ? (
                  <div className="mt-1.5 text-[11px] leading-5 text-danger">
                    {t.massChangeInertiaReestimateUnavailable}
                  </div>
                ) : null}
              </div>
            </div>

            <Checkbox
              checked={rememberMassInertiaBehavior}
              onChange={setRememberMassInertiaBehavior}
              label={t.massChangeInertiaRememberChoice}
            />
          </div>
        ) : null}
      </Dialog>

      {floatingMassInertiaNotice ? (
        <div className="pointer-events-none fixed bottom-4 right-4 z-[140] max-w-[min(28rem,calc(100vw-2rem))] animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="flex items-start gap-2 rounded-2xl border border-border-black bg-panel-bg px-3 py-2.5 shadow-xl dark:shadow-black/40">
            <div
              className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
                floatingMassInertiaNotice.tone === 'success' ? 'bg-emerald-500' : 'bg-system-blue'
              }`}
            />
            <div className="text-xs font-semibold leading-5 text-text-primary">
              {floatingMassInertiaNotice.message}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
};
