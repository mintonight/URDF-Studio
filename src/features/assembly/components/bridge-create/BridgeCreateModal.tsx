/**
 * BridgeCreateModal - Dialog to create a bridge joint between two components
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link2, Move3D, SlidersHorizontal } from 'lucide-react';
import { DraggableWindow } from '@/shared/components/DraggableWindow';
import { PanelSelect, SegmentedControl, type SelectOption } from '@/shared/components/ui';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { resolveSuggestedBridgeOriginForVisualContact } from '@/core/robot/assemblyBridgeAlignment';
import { wouldBridgeCreateUnsupportedAssemblyCycle } from '@/core/robot/assemblyBridgeTopology';
import { degToRad, radToDeg } from '@/core/robot/transforms';
import { DEFAULT_JOINT, JointType, type JointHardwareInterface } from '@/types';
import { translations } from '@/shared/i18n';
import {
  filterSelectableBridgeComponents,
  resolveBlockedBridgeComponentId,
} from '../../utils/bridgeSelection';
import { buildBridgeJointFromDraft, buildBridgePreview } from '../../utils/bridgePreview';
import {
  BridgeAxisSpinnerField,
  BridgeInlineFieldRow,
  BridgeQuickRotateButtonGroup,
  BridgeRelationConnector,
  BridgeSection,
  BridgeSideCard,
  BridgeSpinnerField,
} from './BridgeCreateFields';
import {
  BRIDGE_EMPTY_SELECT_OPTION,
  BRIDGE_FOOTER_BUTTON_CLASS,
  BRIDGE_RELATION_GRID_CLASS,
  BRIDGE_ROTATION_SHORTCUT_DEGREES,
  BRIDGE_SELECT_CLASS,
} from './bridgeCreateModalStyles';
import type { BridgeCreateModalProps, BridgeEulerAxisKey } from './bridgeCreateModalTypes';
import {
  buildSuggestedBridgeName,
  getBridgeLinkDisplayName,
  hasIncomingStructuralBridge,
  resolveBridgeComponentDefaultLinkId,
} from './bridgeCreateModalUtils';
import { useBridgeCreateDraft } from './useBridgeCreateDraft';
import { useBridgeCreateSelectionSync } from './useBridgeCreateSelectionSync';

export type { BridgeCreateModalProps } from './bridgeCreateModalTypes';

type BridgeCreateTabId = 'relation' | 'transform' | 'joint';

interface BridgeCreateTabConfig {
  id: BridgeCreateTabId;
  label: string;
  icon: React.ReactNode;
}

interface BridgeCreateTabButtonProps {
  tab: BridgeCreateTabConfig;
  isActive: boolean;
  onClick: (tabId: BridgeCreateTabId) => void;
}

function resolveBridgeRotationShortcutAxis(key: string): BridgeEulerAxisKey | null {
  switch (key.toLowerCase()) {
    case 'x':
      return 'r';
    case 'y':
      return 'p';
    case 'z':
      return 'y';
    default:
      return null;
  }
}

function isBridgeRotationShortcutEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"], [role="combobox"]'),
  );
}

function BridgeCreateTabButton({ tab, isActive, onClick }: BridgeCreateTabButtonProps) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      data-bridge-tab={tab.id}
      onClick={() => onClick(tab.id)}
      className={`inline-flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-[10px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        isActive
          ? 'bg-panel-bg text-text-primary shadow-sm ring-1 ring-inset ring-border-black'
          : 'text-text-tertiary hover:bg-element-hover hover:text-text-primary'
      }`}
    >
      <span className={isActive ? 'text-system-blue' : 'text-text-tertiary'}>{tab.icon}</span>
      <span className="truncate">{tab.label}</span>
    </button>
  );
}

export const BridgeCreateModal: React.FC<BridgeCreateModalProps> = ({
  isOpen,
  onClose,
  onPreviewChange,
  onCreate,
  assemblyState,
  lang,
}) => {
  const t = translations[lang];
  const [activeTab, setActiveTab] = useState<BridgeCreateTabId>('relation');
  const wasOpenRef = useRef(isOpen);
  const sideCardTitle =
    lang === 'zh' ? { parent: '父侧', child: '子侧' } : { parent: 'Parent', child: 'Child' };
  const relationSectionTitle = lang === 'zh' ? '拼接关系' : 'Joint Relation';
  const compactLabelWidthClassName = lang === 'zh' ? 'w-[30px]' : 'w-[44px]';
  const fullRowLabelClassName = 'w-auto whitespace-nowrap';
  const axisLabelWidthClassName = 'w-4 justify-center';
  const nameInputId = React.useId();
  const jointTypeSelectId = React.useId();
  const defaultWindowSize = useMemo(() => ({ width: 600, height: 330 }), []);
  const comps = Object.values(assemblyState.components);
  const defaultPosition = useMemo(() => {
    if (typeof window === 'undefined') {
      return { x: 72, y: 92 };
    }

    return {
      x: Math.max(16, window.innerWidth - defaultWindowSize.width - 24),
      y: 92,
    };
  }, [defaultWindowSize.width]);
  const windowState = useDraggableWindow({
    isOpen,
    defaultPosition,
    defaultSize: defaultWindowSize,
    minSize: { width: 480, height: 300 },
    centerOnMount: false,
    enableMinimize: false,
    enableMaximize: false,
    dragBounds: {
      allowNegativeX: false,
      minVisibleWidth: 120,
      topMargin: 64,
      bottomMargin: 56,
    },
  });
  const usesInlineIdentityRow = windowState.size.width >= 320;
  const usesCadInspectorLayout = windowState.size.width >= 580;
  const topFieldGridClassName = usesInlineIdentityRow
    ? `grid items-center gap-x-1.5 gap-y-1 ${
        lang === 'zh'
          ? 'grid-cols-[30px_minmax(0,1fr)_30px_minmax(0,1fr)]'
          : 'grid-cols-[44px_minmax(0,1fr)_44px_minmax(0,1fr)]'
      }`
    : 'space-y-1.5';
  const originFieldGridClassName =
    windowState.size.width >= 360 ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-3 gap-1';
  const relationGridClassName = usesCadInspectorLayout
    ? BRIDGE_RELATION_GRID_CLASS
    : 'grid grid-cols-1 gap-1.5';
  const transformPanelClassName = usesCadInspectorLayout
    ? 'grid grid-cols-[minmax(0,0.68fr)_minmax(0,1fr)] gap-1.5'
    : 'space-y-1.5';
  const jointPanelClassName = usesCadInspectorLayout
    ? 'grid grid-cols-[minmax(0,0.72fr)_minmax(0,1fr)] gap-1.5'
    : 'space-y-1.5';
  const quaternionFieldGridClassName = usesCadInspectorLayout
    ? 'grid grid-cols-4 gap-1.5'
    : 'grid grid-cols-2 gap-1.5';
  const eulerFieldGridClassName = usesCadInspectorLayout ? 'grid grid-cols-3 gap-1.5' : 'space-y-1';
  const limitsGridClassName = usesCadInspectorLayout ? 'grid grid-cols-2 gap-1.5' : 'space-y-1';
  const defaultJointLimit = DEFAULT_JOINT.limit;
  const defaultLimitLower = defaultJointLimit?.lower ?? -1.57;
  const defaultLimitUpper = defaultJointLimit?.upper ?? 1.57;
  const defaultLimitEffort = defaultJointLimit?.effort ?? 100;
  const defaultLimitVelocity = defaultJointLimit?.velocity ?? 10;

  const {
    applyEulerRotation,
    applyQuaternionRotation,
    applySuggestedOrigin,
    axisX,
    axisY,
    axisZ,
    childCompId,
    childLinkId,
    handleOriginXChange,
    handleOriginYChange,
    handleOriginZChange,
    handleQuickRotate,
    hardwareInterface,
    jointType,
    limitEffort,
    limitLower,
    limitUpper,
    limitVelocity,
    name,
    originDirtyRef,
    originX,
    originY,
    originZ,
    parentCompId,
    parentLinkId,
    pickTarget,
    pitchDeg,
    previousBridgeRelationSignatureRef,
    quatW,
    quatX,
    quatY,
    quatZ,
    resetForm,
    rollDeg,
    rotationDisplayMode,
    setAxisX,
    setAxisY,
    setAxisZ,
    setChildCompId,
    setChildLinkId,
    setHardwareInterface,
    setJointType,
    setLimitEffort,
    setLimitLower,
    setLimitUpper,
    setLimitVelocity,
    setName,
    setParentCompId,
    setParentLinkId,
    setPickTarget,
    setRotationDisplayMode,
    yawDeg,
  } = useBridgeCreateDraft({
    defaultLimitEffort,
    defaultLimitLower,
    defaultLimitUpper,
    defaultLimitVelocity,
  });

  const parentComp = parentCompId ? assemblyState.components[parentCompId] : null;
  const childComp = childCompId ? assemblyState.components[childCompId] : null;
  const blockedComponentId = useMemo(
    () =>
      resolveBlockedBridgeComponentId({
        pickTarget,
        parentComponentId: parentCompId,
        childComponentId: childCompId,
      }),
    [childCompId, parentCompId, pickTarget],
  );
  const parentComponentOptions = useMemo(
    () => filterSelectableBridgeComponents(comps, childCompId || null),
    [childCompId, comps],
  );
  const childComponentHasIncomingBridge = useMemo(
    () => hasIncomingStructuralBridge(assemblyState, childCompId),
    [assemblyState, childCompId],
  );
  const childComponentOptions = useMemo(
    () =>
      filterSelectableBridgeComponents(comps, parentCompId || null).filter(
        (component) => !hasIncomingStructuralBridge(assemblyState, component.id),
      ),
    [assemblyState, comps, parentCompId],
  );
  const parentLinks = parentComp ? Object.values(parentComp.robot.links) : [];
  const childLinks = childComp ? Object.values(childComp.robot.links) : [];
  const jointTypeSelectOptions = useMemo<SelectOption[]>(
    () => [
      { value: JointType.FIXED, label: t.jointTypeFixed },
      { value: JointType.REVOLUTE, label: t.jointTypeRevolute },
      { value: JointType.CONTINUOUS, label: t.jointTypeContinuous },
      { value: JointType.PRISMATIC, label: t.jointTypePrismatic },
    ],
    [t.jointTypeContinuous, t.jointTypeFixed, t.jointTypePrismatic, t.jointTypeRevolute],
  );
  const hardwareInterfaceSelectOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'position', label: t.hardwareInterfacePosition },
      { value: 'effort', label: t.hardwareInterfaceEffort },
      { value: 'velocity', label: t.hardwareInterfaceVelocity },
    ],
    [t.hardwareInterfaceEffort, t.hardwareInterfacePosition, t.hardwareInterfaceVelocity],
  );
  const parentComponentSelectOptions = useMemo<SelectOption[]>(
    () => [
      BRIDGE_EMPTY_SELECT_OPTION,
      ...parentComponentOptions.map((component) => ({
        value: component.id,
        label: component.name,
      })),
    ],
    [parentComponentOptions],
  );
  const childComponentSelectOptions = useMemo<SelectOption[]>(
    () => [
      BRIDGE_EMPTY_SELECT_OPTION,
      ...childComponentOptions.map((component) => ({
        value: component.id,
        label: component.name,
      })),
    ],
    [childComponentOptions],
  );
  const parentLinkSelectOptions = useMemo<SelectOption[]>(
    () => [
      BRIDGE_EMPTY_SELECT_OPTION,
      ...parentLinks.map((link) => ({
        value: link.id,
        label: getBridgeLinkDisplayName(parentComp?.robot, link.id),
      })),
    ],
    [parentComp?.robot, parentLinks],
  );
  const childLinkSelectOptions = useMemo<SelectOption[]>(
    () => [
      BRIDGE_EMPTY_SELECT_OPTION,
      ...childLinks.map((link) => ({
        value: link.id,
        label: getBridgeLinkDisplayName(childComp?.robot, link.id),
      })),
    ],
    [childComp?.robot, childLinks],
  );
  const suggestedBridgeName = useMemo(
    () =>
      buildSuggestedBridgeName({
        assemblyState,
        parentComponentId: parentCompId,
        childComponentId: childCompId,
      }),
    [assemblyState, childCompId, parentCompId],
  );
  const effectiveBridgeName = name.trim() || suggestedBridgeName;
  const parentSummary = parentComp?.name ?? '--';
  const childSummary = childComp?.name ?? '--';
  const parentLinkSummary = getBridgeLinkDisplayName(parentComp?.robot, parentLinkId);
  const childLinkSummary = getBridgeLinkDisplayName(childComp?.robot, childLinkId);
  const jointSupportsAxisAndLimits = jointType !== JointType.FIXED;
  const jointSupportsPositionLimits =
    jointType === JointType.REVOLUTE || jointType === JointType.PRISMATIC;
  const bridgeTabs = useMemo<BridgeCreateTabConfig[]>(
    () => [
      {
        id: 'relation',
        label: lang === 'zh' ? '关系' : 'Relation',
        icon: <Link2 className="h-3.5 w-3.5" />,
      },
      {
        id: 'transform',
        label: lang === 'zh' ? '变换' : 'Transform',
        icon: <Move3D className="h-3.5 w-3.5" />,
      },
      ...(jointSupportsAxisAndLimits
        ? [
            {
              id: 'joint' as const,
              label: lang === 'zh' ? '关节' : 'Joint',
              icon: <SlidersHorizontal className="h-3.5 w-3.5" />,
            },
          ]
        : []),
    ],
    [jointSupportsAxisAndLimits, lang],
  );
  const isLimitRangeInvalid = jointSupportsPositionLimits && limitLower > limitUpper;
  const limitRangeValidationMessage = isLimitRangeInvalid ? t.bridgeLimitRangeInvalid : null;
  const hasUnsupportedNonFixedCycle = useMemo(
    () =>
      Boolean(parentCompId) &&
      Boolean(childCompId) &&
      parentCompId !== childCompId &&
      wouldBridgeCreateUnsupportedAssemblyCycle(
        Object.values(assemblyState.bridges),
        {
          id: '__bridge_preview__',
          parentComponentId: parentCompId,
          childComponentId: childCompId,
        },
        jointType,
      ),
    [assemblyState.bridges, childCompId, jointType, parentCompId],
  );
  const nonFixedCycleValidationMessage = hasUnsupportedNonFixedCycle
    ? t.bridgeNonFixedCycleUnsupported
    : null;
  const validationMessages = [limitRangeValidationMessage, nonFixedCycleValidationMessage].filter(
    (message): message is string => Boolean(message),
  );
  const positionLowerLabel = lang === 'zh' ? '位置下限' : 'Position Lower Limit';
  const positionUpperLabel = lang === 'zh' ? '位置上限' : 'Position Upper Limit';
  const rollRad = useMemo(() => degToRad(rollDeg), [rollDeg]);
  const pitchRad = useMemo(() => degToRad(pitchDeg), [pitchDeg]);
  const yawRad = useMemo(() => degToRad(yawDeg), [yawDeg]);

  const quickRotateButtonText =
    rotationDisplayMode === 'euler_rad'
      ? { decrease: '-π/2', increase: '+π/2' }
      : { decrease: '-90', increase: '+90' };
  const quickRotateAriaLabelSuffix =
    rotationDisplayMode === 'euler_rad'
      ? {
          decrease: lang === 'zh' ? '减少 π/2' : 'decrease π/2',
          increase: lang === 'zh' ? '增加 π/2' : 'increase π/2',
        }
      : {
          decrease:
            lang === 'zh'
              ? `减少 ${BRIDGE_ROTATION_SHORTCUT_DEGREES}°`
              : `decrease ${BRIDGE_ROTATION_SHORTCUT_DEGREES}°`,
          increase:
            lang === 'zh'
              ? `增加 ${BRIDGE_ROTATION_SHORTCUT_DEGREES}°`
              : `increase ${BRIDGE_ROTATION_SHORTCUT_DEGREES}°`,
        };
  const rotationAxisFields = [
    {
      key: 'r' as const,
      label: t.roll,
      value: rotationDisplayMode === 'euler_rad' ? rollRad : rollDeg,
      onChange: (nextValue: number) =>
        applyEulerRotation({
          r: rotationDisplayMode === 'euler_rad' ? radToDeg(nextValue) : nextValue,
          p: pitchDeg,
          y: yawDeg,
        }),
    },
    {
      key: 'p' as const,
      label: t.pitch,
      value: rotationDisplayMode === 'euler_rad' ? pitchRad : pitchDeg,
      onChange: (nextValue: number) =>
        applyEulerRotation({
          r: rollDeg,
          p: rotationDisplayMode === 'euler_rad' ? radToDeg(nextValue) : nextValue,
          y: yawDeg,
        }),
    },
    {
      key: 'y' as const,
      label: t.yaw,
      value: rotationDisplayMode === 'euler_rad' ? yawRad : yawDeg,
      onChange: (nextValue: number) =>
        applyEulerRotation({
          r: rollDeg,
          p: pitchDeg,
          y: rotationDisplayMode === 'euler_rad' ? radToDeg(nextValue) : nextValue,
        }),
    },
  ];

  const previewBridge = useMemo(
    () =>
      buildBridgePreview({
        name: effectiveBridgeName,
        parentComponentId: parentCompId,
        parentLinkId,
        childComponentId: childCompId,
        childLinkId,
        jointType,
        hardwareInterface: jointSupportsAxisAndLimits ? hardwareInterface : undefined,
        originXyz: { x: originX, y: originY, z: originZ },
        axis: { x: axisX, y: axisY, z: axisZ },
        limitLower,
        limitUpper,
        limitEffort,
        limitVelocity,
        rotationMode: rotationDisplayMode === 'quaternion' ? 'quaternion' : 'euler_deg',
        rotationEulerDeg: { r: rollDeg, p: pitchDeg, y: yawDeg },
        rotationQuaternion: { x: quatX, y: quatY, z: quatZ, w: quatW },
      }),
    [
      axisX,
      axisY,
      axisZ,
      childCompId,
      childLinkId,
      hardwareInterface,
      jointSupportsAxisAndLimits,
      jointType,
      limitLower,
      limitUpper,
      limitEffort,
      limitVelocity,
      effectiveBridgeName,
      originX,
      originY,
      originZ,
      parentCompId,
      parentLinkId,
      pitchDeg,
      quatW,
      quatX,
      quatY,
      quatZ,
      rollDeg,
      rotationDisplayMode,
      yawDeg,
    ],
  );
  const submitJoint = useMemo(
    () =>
      buildBridgeJointFromDraft(
        {
          name: effectiveBridgeName,
          parentComponentId: parentCompId,
          parentLinkId,
          childComponentId: childCompId,
          childLinkId,
          jointType,
          hardwareInterface: jointSupportsAxisAndLimits ? hardwareInterface : undefined,
          originXyz: { x: originX, y: originY, z: originZ },
          axis: { x: axisX, y: axisY, z: axisZ },
          limitLower,
          limitUpper,
          limitEffort,
          limitVelocity,
          rotationMode: rotationDisplayMode === 'quaternion' ? 'quaternion' : 'euler_deg',
          rotationEulerDeg: { r: rollDeg, p: pitchDeg, y: yawDeg },
          rotationQuaternion: { x: quatX, y: quatY, z: quatZ, w: quatW },
        },
        effectiveBridgeName || 'bridge_joint',
      ),
    [
      axisX,
      axisY,
      axisZ,
      childCompId,
      childLinkId,
      hardwareInterface,
      jointSupportsAxisAndLimits,
      jointType,
      limitLower,
      limitUpper,
      limitEffort,
      limitVelocity,
      effectiveBridgeName,
      originX,
      originY,
      originZ,
      parentCompId,
      parentLinkId,
      pitchDeg,
      quatW,
      quatX,
      quatY,
      quatZ,
      rollDeg,
      rotationDisplayMode,
      yawDeg,
    ],
  );
  const isBridgeSelectionIncomplete =
    !parentCompId ||
    !parentLinkId ||
    !childCompId ||
    !childLinkId ||
    parentCompId === childCompId ||
    childComponentHasIncomingBridge;

  const isConfirmActuallyDisabled =
    isBridgeSelectionIncomplete ||
    !effectiveBridgeName ||
    !submitJoint ||
    isLimitRangeInvalid ||
    hasUnsupportedNonFixedCycle;

  const handleSubmit = useCallback(() => {
    if (!submitJoint || isConfirmActuallyDisabled) {
      return;
    }

    const createParams = {
      name: effectiveBridgeName,
      parentComponentId: parentCompId,
      parentLinkId,
      childComponentId: childCompId,
      childLinkId,
      joint: {
        type: submitJoint.type,
        origin: submitJoint.origin,
        axis: submitJoint.axis ?? { x: axisX, y: axisY, z: axisZ },
        limit: submitJoint.limit,
        hardware: submitJoint.hardware,
      },
    };

    onPreviewChange?.(null);
    resetForm();
    onClose();
    window.requestAnimationFrame(() => {
      onCreate(createParams);
    });
  }, [
    axisX,
    axisY,
    axisZ,
    childCompId,
    childLinkId,
    effectiveBridgeName,
    isConfirmActuallyDisabled,
    onClose,
    onCreate,
    onPreviewChange,
    parentCompId,
    parentLinkId,
    resetForm,
    submitJoint,
  ]);

  const handleClose = useCallback(() => {
    onPreviewChange?.(null);
    resetForm();
    onClose();
  }, [onClose, onPreviewChange, resetForm]);

  useBridgeCreateSelectionSync({
    assemblyState,
    blockedComponentId,
    childCompId,
    childLinkId,
    handleClose,
    isOpen,
    onPreviewChange,
    pickTarget,
    setChildCompId,
    setChildLinkId,
    setParentCompId,
    setParentLinkId,
    setPickTarget,
  });

  const namePlaceholder = suggestedBridgeName || t.bridgeJointNamePlaceholder;

  useEffect(() => {
    if (isOpen && !wasOpenRef.current) {
      setActiveTab('relation');
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        isBridgeRotationShortcutEditableTarget(event.target)
      ) {
        return;
      }

      const axis = resolveBridgeRotationShortcutAxis(event.key);
      if (!axis) {
        return;
      }

      event.preventDefault();
      handleQuickRotate(axis, event.shiftKey ? -1 : 1);
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleQuickRotate, isOpen]);

  useEffect(() => {
    if (bridgeTabs.some((tab) => tab.id === activeTab)) {
      return;
    }

    setActiveTab('transform');
  }, [activeTab, bridgeTabs]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const relationSignature = [parentCompId, parentLinkId, childCompId, childLinkId].join('|');
    if (relationSignature !== previousBridgeRelationSignatureRef.current) {
      previousBridgeRelationSignatureRef.current = relationSignature;
      originDirtyRef.current = false;
    }
  }, [childCompId, childLinkId, isOpen, parentCompId, parentLinkId]);

  useEffect(() => {
    if (
      !isOpen ||
      originDirtyRef.current ||
      !parentCompId ||
      !parentLinkId ||
      !childCompId ||
      !childLinkId ||
      parentCompId === childCompId
    ) {
      return;
    }

    const suggestedOrigin = resolveSuggestedBridgeOriginForVisualContact({
      assemblyState,
      parentComponentId: parentCompId,
      parentLinkId,
      childComponentId: childCompId,
      childLinkId,
      origin: {
        xyz: { x: 0, y: 0, z: 0 },
        rpy: {
          r: degToRad(rollDeg),
          p: degToRad(pitchDeg),
          y: degToRad(yawDeg),
        },
      },
    });
    if (!suggestedOrigin) {
      return;
    }

    if (
      suggestedOrigin.x === originX &&
      suggestedOrigin.y === originY &&
      suggestedOrigin.z === originZ
    ) {
      return;
    }

    applySuggestedOrigin(suggestedOrigin);
  }, [
    applySuggestedOrigin,
    assemblyState,
    childCompId,
    childLinkId,
    isOpen,
    originX,
    originY,
    originZ,
    parentCompId,
    parentLinkId,
    pitchDeg,
    rollDeg,
    yawDeg,
  ]);

  useEffect(() => {
    if (!isOpen) {
      originDirtyRef.current = false;
      previousBridgeRelationSignatureRef.current = '';
      return;
    }

    onPreviewChange?.(previewBridge);
  }, [isOpen, onPreviewChange, previewBridge]);

  if (!isOpen) return null;

  return (
    <DraggableWindow
      window={windowState}
      onClose={handleClose}
      title={
        <div className="flex min-w-0 items-center gap-2">
          <div className="rounded-md border border-border-black bg-element-bg p-1 text-system-blue">
            <Link2 className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-semibold text-text-primary">
              {t.createBridge}
            </div>
          </div>
        </div>
      }
      className="fixed z-[300] flex flex-col overflow-hidden rounded-xl border border-border-black bg-panel-bg text-text-primary shadow-2xl"
      headerClassName="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-border-black bg-element-bg px-2.5"
      headerLeftClassName="flex min-w-0 flex-1 items-center gap-2"
      headerRightClassName="flex shrink-0 items-center gap-1"
      interactionClassName="select-none"
      showMinimizeButton={false}
      showMaximizeButton={false}
      showResizeHandles
      leftResizeHandleClassName="pointer-events-none absolute left-0 top-0 bottom-0 w-0"
      rightResizeHandleClassName="absolute right-0 top-0 bottom-0 z-20 w-2 cursor-ew-resize transition-colors hover:bg-system-blue/15 active:bg-system-blue/25"
      bottomResizeHandleClassName="absolute bottom-0 left-0 right-0 z-20 h-2 cursor-ns-resize transition-colors hover:bg-system-blue/15 active:bg-system-blue/25"
      cornerResizeHandleClassName="absolute bottom-0 right-0 z-30 flex h-6 w-6 cursor-nwse-resize items-end justify-end transition-colors hover:bg-system-blue/20 active:bg-system-blue/30"
      cornerResizeHandle={
        <div className="mb-1 mr-1 h-2 w-2 border-b-2 border-r-2 border-border-strong" />
      }
      closeTitle={t.close}
      controlButtonClassName="rounded-md p-1 text-text-tertiary transition-colors hover:bg-element-hover"
      closeButtonClassName="rounded-md p-1 text-text-tertiary transition-colors hover:bg-red-500 hover:text-white"
    >
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 custom-scrollbar">
        <div className="space-y-1.5">
          <div data-bridge-row="identity" className={topFieldGridClassName}>
            <BridgeInlineFieldRow
              label={t.name}
              htmlFor={nameInputId}
              fieldKey="name"
              className="min-w-0"
              labelClassName={compactLabelWidthClassName}
              layout={usesInlineIdentityRow ? 'contents' : 'row'}
            >
              <input
                id={nameInputId}
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={namePlaceholder}
                className={BRIDGE_SELECT_CLASS}
              />
            </BridgeInlineFieldRow>

            <BridgeInlineFieldRow
              label={t.type}
              htmlFor={jointTypeSelectId}
              fieldKey="type"
              className="min-w-0"
              labelClassName={compactLabelWidthClassName}
              layout={usesInlineIdentityRow ? 'contents' : 'row'}
            >
              <PanelSelect
                variant="property"
                id={jointTypeSelectId}
                options={jointTypeSelectOptions}
                value={jointType}
                onChange={(event) => setJointType(event.target.value as JointType)}
                className={BRIDGE_SELECT_CLASS}
              />
            </BridgeInlineFieldRow>
            {jointSupportsAxisAndLimits ? (
              <BridgeInlineFieldRow
                label={t.hardwareInterface}
                fieldKey="hardware-interface"
                className={`${usesInlineIdentityRow ? 'col-span-full ' : ''}min-w-0`.trim()}
                labelClassName={fullRowLabelClassName}
              >
                <PanelSelect
                  variant="property"
                  aria-label={t.hardwareInterface}
                  options={hardwareInterfaceSelectOptions}
                  value={hardwareInterface}
                  onChange={(event) =>
                    setHardwareInterface(event.target.value as JointHardwareInterface)
                  }
                  className={BRIDGE_SELECT_CLASS}
                />
              </BridgeInlineFieldRow>
            ) : null}
          </div>

          <div
            role="tablist"
            aria-label={lang === 'zh' ? '桥接编辑分组' : 'Bridge editor sections'}
            data-bridge-tabs
            className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-1 rounded-lg border border-border-black bg-segmented-bg p-0.5"
          >
            {bridgeTabs.map((tab) => (
              <BridgeCreateTabButton
                key={tab.id}
                tab={tab}
                isActive={activeTab === tab.id}
                onClick={setActiveTab}
              />
            ))}
          </div>

          {validationMessages.length > 0 ? (
            <div
              data-bridge-validation
              className="space-y-1 rounded-lg border border-red-500/25 bg-red-500/8 px-2 py-1.5"
            >
              {validationMessages.map((message) => (
                <p key={message} className="text-[9px] font-medium leading-4 text-red-500">
                  {message}
                </p>
              ))}
            </div>
          ) : null}

          <div className="min-h-0" data-bridge-tab-content>
            {activeTab === 'relation' ? (
              <div data-bridge-tab-panel="relation" className="space-y-1.5">
                <BridgeSection title={relationSectionTitle}>
                  <div className={relationGridClassName}>
                    <BridgeSideCard
                      side="parent"
                      isActive={pickTarget === 'parent'}
                      title={sideCardTitle.parent}
                      pickLabel={t.bridgePickParent}
                      componentLabel={t.parentComponent}
                      linkLabel={t.parentLink}
                      componentValue={parentCompId}
                      linkValue={parentLinkId}
                      componentSummary={parentSummary}
                      linkSummary={parentLinkSummary}
                      onActivate={() => setPickTarget('parent')}
                      onComponentChange={(value) => {
                        setPickTarget('parent');
                        setParentCompId(value);
                        setParentLinkId(resolveBridgeComponentDefaultLinkId(assemblyState, value));
                      }}
                      onLinkChange={(value) => {
                        setPickTarget('parent');
                        setParentLinkId(value);
                      }}
                      componentOptions={parentComponentSelectOptions}
                      linkOptions={parentLinkSelectOptions}
                    />

                    <BridgeRelationConnector
                      orientation={usesCadInspectorLayout ? 'vertical' : 'horizontal'}
                    />

                    <BridgeSideCard
                      side="child"
                      isActive={pickTarget === 'child'}
                      title={sideCardTitle.child}
                      pickLabel={t.bridgePickChild}
                      componentLabel={t.childComponent}
                      linkLabel={t.childLink}
                      componentValue={childCompId}
                      linkValue={childLinkId}
                      componentSummary={childSummary}
                      linkSummary={childLinkSummary}
                      onActivate={() => setPickTarget('child')}
                      onComponentChange={(value) => {
                        setPickTarget('child');
                        setChildCompId(value);
                        setChildLinkId(resolveBridgeComponentDefaultLinkId(assemblyState, value));
                      }}
                      onLinkChange={(value) => {
                        setPickTarget('child');
                        setChildLinkId(value);
                      }}
                      componentOptions={childComponentSelectOptions}
                      linkOptions={childLinkSelectOptions}
                    />
                  </div>
                </BridgeSection>
              </div>
            ) : null}

            {activeTab === 'transform' ? (
              <div data-bridge-tab-panel="transform" className={transformPanelClassName}>
                <BridgeSection title={t.originRelativeParent}>
                  <div data-bridge-row="origin" className={originFieldGridClassName}>
                    <BridgeAxisSpinnerField
                      axis="x"
                      fieldKey="origin-x"
                      label="X"
                      value={originX}
                      step={0.01}
                      precision={4}
                      onChange={handleOriginXChange}
                      className="min-w-0"
                    />
                    <BridgeAxisSpinnerField
                      axis="y"
                      fieldKey="origin-y"
                      label="Y"
                      value={originY}
                      step={0.01}
                      precision={4}
                      onChange={handleOriginYChange}
                      className="min-w-0"
                    />
                    <BridgeAxisSpinnerField
                      axis="z"
                      fieldKey="origin-z"
                      label="Z"
                      value={originZ}
                      step={0.01}
                      precision={4}
                      onChange={handleOriginZChange}
                      className="min-w-0"
                    />
                  </div>
                </BridgeSection>

                <BridgeSection title={t.rotation}>
                  <SegmentedControl
                    options={[
                      { value: 'euler_deg', label: t.eulerDegrees },
                      { value: 'euler_rad', label: t.eulerRadians },
                      { value: 'quaternion', label: t.quaternion },
                    ]}
                    value={rotationDisplayMode}
                    onChange={(value) => setRotationDisplayMode(value)}
                    size="xs"
                    className="w-full [&>button]:min-h-6 [&>button]:flex-1 [&>button]:!gap-0.5 [&>button]:!px-1.5 [&>button]:!py-0 [&>button]:!text-[9px]"
                  />

                  {rotationDisplayMode === 'quaternion' ? (
                    <div className={`mt-1.5 ${quaternionFieldGridClassName}`}>
                      <BridgeSpinnerField
                        fieldKey="quat-x"
                        label="X"
                        value={quatX}
                        step={0.001}
                        precision={4}
                        onChange={(value) =>
                          applyQuaternionRotation({ x: value, y: quatY, z: quatZ, w: quatW })
                        }
                        className="min-w-0"
                      />
                      <BridgeSpinnerField
                        fieldKey="quat-y"
                        label="Y"
                        value={quatY}
                        step={0.001}
                        precision={4}
                        onChange={(value) =>
                          applyQuaternionRotation({ x: quatX, y: value, z: quatZ, w: quatW })
                        }
                        className="min-w-0"
                      />
                      <BridgeSpinnerField
                        fieldKey="quat-z"
                        label="Z"
                        value={quatZ}
                        step={0.001}
                        precision={4}
                        onChange={(value) =>
                          applyQuaternionRotation({ x: quatX, y: quatY, z: value, w: quatW })
                        }
                        className="min-w-0"
                      />
                      <BridgeSpinnerField
                        fieldKey="quat-w"
                        label="W"
                        value={quatW}
                        step={0.001}
                        precision={4}
                        onChange={(value) =>
                          applyQuaternionRotation({ x: quatX, y: quatY, z: quatZ, w: value })
                        }
                        className="min-w-0"
                      />
                    </div>
                  ) : usesCadInspectorLayout ? (
                    <div className={`mt-1.5 ${eulerFieldGridClassName}`}>
                      {rotationAxisFields.map((field) => (
                        <div key={field.key} className="min-w-0 space-y-1">
                          <BridgeSpinnerField
                            fieldKey={`rot-${field.key}`}
                            label={field.label}
                            value={field.value}
                            step={rotationDisplayMode === 'euler_rad' ? 0.1 : 1}
                            precision={rotationDisplayMode === 'euler_rad' ? 4 : 2}
                            onChange={field.onChange}
                            className="min-w-0"
                          />
                          <BridgeQuickRotateButtonGroup
                            label={field.label}
                            decreaseLabel={quickRotateAriaLabelSuffix.decrease}
                            increaseLabel={quickRotateAriaLabelSuffix.increase}
                            decreaseText={quickRotateButtonText.decrease}
                            increaseText={quickRotateButtonText.increase}
                            onDecrease={() => handleQuickRotate(field.key, -1)}
                            onIncrease={() => handleQuickRotate(field.key, 1)}
                          />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="mt-1.5 space-y-1">
                      {rotationAxisFields.map((field) => (
                        <div
                          key={field.key}
                          className="grid grid-cols-[minmax(0,1fr)_3.5rem] items-center gap-1"
                        >
                          <BridgeSpinnerField
                            inline
                            label={field.label}
                            value={field.value}
                            step={rotationDisplayMode === 'euler_rad' ? 0.1 : 1}
                            precision={rotationDisplayMode === 'euler_rad' ? 4 : 2}
                            onChange={field.onChange}
                            className="gap-1.5"
                            labelClassName="w-[34px]"
                          />
                          <BridgeQuickRotateButtonGroup
                            label={field.label}
                            decreaseLabel={quickRotateAriaLabelSuffix.decrease}
                            increaseLabel={quickRotateAriaLabelSuffix.increase}
                            decreaseText={quickRotateButtonText.decrease}
                            increaseText={quickRotateButtonText.increase}
                            onDecrease={() => handleQuickRotate(field.key, -1)}
                            onIncrease={() => handleQuickRotate(field.key, 1)}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </BridgeSection>
              </div>
            ) : null}

            {jointSupportsAxisAndLimits && activeTab === 'joint' ? (
              <div data-bridge-tab-panel="joint" className={jointPanelClassName}>
                <BridgeSection title={t.axisRotation}>
                  <div className={originFieldGridClassName}>
                    <BridgeSpinnerField
                      inline
                      fieldKey="axis-x"
                      label="X"
                      value={axisX}
                      step={0.01}
                      precision={4}
                      onChange={setAxisX}
                      className="min-w-0"
                      labelClassName={axisLabelWidthClassName}
                    />
                    <BridgeSpinnerField
                      inline
                      fieldKey="axis-y"
                      label="Y"
                      value={axisY}
                      step={0.01}
                      precision={4}
                      onChange={setAxisY}
                      className="min-w-0"
                      labelClassName={axisLabelWidthClassName}
                    />
                    <BridgeSpinnerField
                      inline
                      fieldKey="axis-z"
                      label="Z"
                      value={axisZ}
                      step={0.01}
                      precision={4}
                      onChange={setAxisZ}
                      className="min-w-0"
                      labelClassName={axisLabelWidthClassName}
                    />
                  </div>
                </BridgeSection>

                <BridgeSection title={t.limits}>
                  <div className={limitsGridClassName}>
                    {jointSupportsPositionLimits && usesCadInspectorLayout ? (
                      <>
                        <BridgeSpinnerField
                          fieldKey="limit-lower"
                          label={positionLowerLabel}
                          value={limitLower}
                          step={0.01}
                          precision={4}
                          onChange={setLimitLower}
                          className="min-w-0"
                        />
                        <BridgeSpinnerField
                          fieldKey="limit-upper"
                          label={positionUpperLabel}
                          value={limitUpper}
                          step={0.01}
                          precision={4}
                          onChange={setLimitUpper}
                          className="min-w-0"
                        />
                      </>
                    ) : jointSupportsPositionLimits ? (
                      <>
                        <BridgeSpinnerField
                          inline
                          label={positionLowerLabel}
                          value={limitLower}
                          step={0.01}
                          precision={4}
                          onChange={setLimitLower}
                          className="gap-1.5"
                          labelClassName="w-[34px]"
                        />
                        <BridgeSpinnerField
                          inline
                          label={positionUpperLabel}
                          value={limitUpper}
                          step={0.01}
                          precision={4}
                          onChange={setLimitUpper}
                          className="gap-1.5"
                          labelClassName="w-[34px]"
                        />
                      </>
                    ) : null}
                    {usesCadInspectorLayout ? (
                      <>
                        <BridgeSpinnerField
                          fieldKey="limit-effort"
                          label={t.effort}
                          value={limitEffort}
                          step={1}
                          precision={2}
                          min={0}
                          onChange={setLimitEffort}
                          className="min-w-0"
                        />
                        <BridgeSpinnerField
                          fieldKey="limit-velocity"
                          label={t.velocity}
                          value={limitVelocity}
                          step={0.1}
                          precision={3}
                          min={0}
                          onChange={setLimitVelocity}
                          className="min-w-0"
                        />
                      </>
                    ) : (
                      <>
                        <BridgeSpinnerField
                          inline
                          label={t.effort}
                          value={limitEffort}
                          step={1}
                          precision={2}
                          min={0}
                          onChange={setLimitEffort}
                          className="gap-1.5"
                          labelClassName="w-[34px]"
                        />
                        <BridgeSpinnerField
                          inline
                          label={t.velocity}
                          value={limitVelocity}
                          step={0.1}
                          precision={3}
                          min={0}
                          onChange={setLimitVelocity}
                          className="gap-1.5"
                          labelClassName="w-[34px]"
                        />
                      </>
                    )}
                  </div>
                </BridgeSection>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex shrink-0 justify-end gap-2 border-t border-border-black bg-element-bg px-2 py-2">
        <button
          onClick={handleClose}
          className={`${BRIDGE_FOOTER_BUTTON_CLASS} text-text-secondary hover:bg-element-hover`}
          type="button"
        >
          {t.cancel}
        </button>
        <button
          onClick={handleSubmit}
          disabled={isConfirmActuallyDisabled}
          className={`${BRIDGE_FOOTER_BUTTON_CLASS} bg-system-blue-solid text-white hover:bg-system-blue-hover disabled:cursor-not-allowed disabled:opacity-50`}
          type="button"
        >
          {t.confirm}
        </button>
      </div>
    </DraggableWindow>
  );
};
