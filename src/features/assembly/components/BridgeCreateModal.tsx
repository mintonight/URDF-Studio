/**
 * BridgeCreateModal - Dialog to create a bridge joint between two components
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link2, Minus, Plus } from 'lucide-react';
import { DraggableWindow } from '@/shared/components';
import { SegmentedControl } from '@/shared/components/ui';
import { useDraggableWindow } from '@/shared/hooks';
import { getMjcfLinkDisplayName } from '@/shared/utils/robot/mjcfDisplayNames';
import { useSelectionStore } from '@/store/selectionStore';
import { useAssemblySelectionStore } from '@/store/assemblySelectionStore';
import type { Language } from '@/store';
import { resolveSuggestedBridgeOriginForVisualContact } from '@/core/robot/assemblyBridgeAlignment';
import { wouldBridgeCreateUnsupportedAssemblyCycle } from '@/core/robot/assemblyBridgeTopology';
import { degToRad, radToDeg } from '@/core/robot/transforms';
import { formatNumberWithMaxDecimals, roundToMaxDecimals } from '@/core/utils/numberPrecision';
import {
  DEFAULT_JOINT,
  JointType,
  type AssemblyState,
  type BridgeJoint,
  type JointHardwareInterface,
  type UrdfOrigin,
  type UrdfJoint,
} from '@/types';
import { translations } from '@/shared/i18n';
import {
  filterSelectableBridgeComponents,
  isAssemblySelectionAllowedForBridge,
  resolveAssemblySelection,
  resolveBlockedBridgeComponentId,
  type BridgePickTarget,
} from '../utils/bridgeSelection';
import {
  bridgeEulerDegreesToQuaternion,
  bridgeQuaternionToEulerDegrees,
  buildBridgeJointFromDraft,
  buildBridgePreview,
  normalizeBridgeQuaternion,
} from '../utils/bridgePreview';

const BRIDGE_ROTATION_SHORTCUT_DEGREES = 90;
const BRIDGE_HALF_ROTATION_DEGREES = 180;
const BRIDGE_STEPPER_REPEAT_DELAY_MS = 300;
const BRIDGE_STEPPER_REPEAT_INTERVAL_MS = 60;
const BRIDGE_FIELD_LABEL_CLASS =
  'mb-0.5 block text-[9px] font-semibold uppercase tracking-[0.1em] leading-4 text-text-tertiary';
const BRIDGE_FIELD_GROUP_CLASS = 'min-w-0';
const BRIDGE_INSPECTOR_FIELD_ROW_CLASS = 'flex items-center gap-1.5';
const BRIDGE_INLINE_FIELD_ROW_CLASS = 'grid grid-cols-[auto_minmax(0,1fr)] items-center gap-1.5';
const BRIDGE_INLINE_FIELD_LABEL_CLASS =
  'inline-flex h-[22px] min-w-0 shrink-0 items-center justify-end text-right text-[9px] font-semibold uppercase tracking-[0.08em] leading-4 text-text-tertiary';
const BRIDGE_INLINE_FIELD_LABEL_WIDTH_CLASS = 'w-[88px]';
const BRIDGE_SELECT_CLASS =
  'h-[22px] w-full rounded-md border border-border-strong bg-input-bg px-1.5 pr-6 text-[10px] leading-4 text-text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-border-black)_18%,transparent)] outline-none transition-colors focus:border-system-blue focus:ring-2 focus:ring-system-blue/25';
const BRIDGE_NUMBER_FIELD_SHELL_CLASS =
  'flex h-[22px] w-full items-stretch overflow-hidden rounded-md border border-border-strong bg-input-bg text-text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-border-black)_18%,transparent)] transition-colors focus-within:border-system-blue focus-within:ring-2 focus-within:ring-system-blue/25';
const BRIDGE_NUMBER_INPUT_CLASS =
  'min-w-0 flex-1 bg-transparent px-1.5 text-[10px] leading-4 font-mono tracking-[-0.01em] text-text-primary tabular-nums outline-none';
const BRIDGE_STEPPER_RAIL_CLASS =
  'flex w-4 shrink-0 flex-col border-l border-border-black/60 bg-element-bg/70';
const BRIDGE_STEPPER_BUTTON_CLASS =
  'flex flex-1 min-h-0 items-center justify-center text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary focus:outline-none';
const BRIDGE_QUICK_ROTATE_BUTTON_GROUP_CLASS =
  'grid h-5 shrink-0 grid-cols-2 overflow-hidden rounded-md border border-border-black/60 bg-element-bg/70';
const BRIDGE_QUICK_ROTATE_BUTTON_CLASS =
  'inline-flex min-w-0 items-center justify-center px-0.5 text-[8px] font-semibold leading-none whitespace-nowrap text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/20';
const BRIDGE_PICK_BUTTON_CLASS =
  'ml-auto shrink-0 rounded-md px-1.5 py-0.5 text-[8px] font-semibold transition-colors';
const BRIDGE_FOOTER_BUTTON_CLASS =
  'inline-flex h-6 items-center justify-center rounded-md px-2 text-[10px] font-medium transition-colors';
const BRIDGE_SIDE_CARD_HEADER_ROW_CLASS = 'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2';
const BRIDGE_SIDE_CARD_ACTIONS_CLASS = 'flex shrink-0 items-center gap-1.5 justify-self-end';
const BRIDGE_RELATION_GRID_CLASS =
  'grid grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] items-stretch gap-1.5';
const BRIDGE_RELATION_CONNECTOR_LINE_CLASS =
  'w-px flex-1 bg-gradient-to-b from-border-black/0 via-border-black to-border-black/0';
const BRIDGE_SECTION_CLASS =
  'rounded-lg border border-border-black bg-panel-bg/70 p-1.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-border-black)_22%,transparent)]';
const BRIDGE_SECTION_TITLE_CLASS =
  'shrink-0 text-[8px] font-semibold uppercase tracking-[0.14em] leading-4 text-text-tertiary';

type BridgeRotationDisplayMode = 'euler_deg' | 'euler_rad' | 'quaternion';
type BridgeEulerAxisKey = 'r' | 'p' | 'y';
type BridgeAxisTone = 'x' | 'y' | 'z';

const BRIDGE_AXIS_TONE_STYLES: Record<
  BridgeAxisTone,
  { badgeClassName: string; barClassName: string }
> = {
  x: {
    badgeClassName: 'border-danger-border bg-danger-soft text-danger',
    barClassName: 'bg-danger',
  },
  y: {
    badgeClassName: 'border-success-border bg-success-soft text-success',
    barClassName: 'bg-success',
  },
  z: {
    badgeClassName: 'border-system-blue/25 bg-system-blue/10 text-system-blue',
    barClassName: 'bg-system-blue',
  },
};

function resolveBridgeComponentDefaultLinkId(
  assemblyState: AssemblyState,
  componentId: string,
): string {
  if (!componentId) {
    return '';
  }

  return assemblyState.components[componentId]?.robot.rootLinkId ?? '';
}

function getBridgeLinkDisplayName(
  robot: AssemblyState['components'][string]['robot'] | null | undefined,
  linkId: string | null | undefined,
): string {
  if (!robot || !linkId) {
    return '--';
  }

  const link = robot.links[linkId];
  if (!link) {
    return linkId;
  }

  return robot.inspectionContext?.sourceFormat === 'mjcf'
    ? getMjcfLinkDisplayName(link)
    : link.name;
}

function hasIncomingStructuralBridge(assemblyState: AssemblyState, componentId: string): boolean {
  if (!componentId) {
    return false;
  }

  return Object.values(assemblyState.bridges).some(
    (bridge) => bridge.childComponentId === componentId,
  );
}

interface BridgeInlineFieldRowProps {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  fieldKey?: string;
  className?: string;
  labelClassName?: string;
  layout?: 'row' | 'contents';
}

function BridgeInlineFieldRow({
  label,
  children,
  htmlFor,
  fieldKey,
  className = '',
  labelClassName = '',
  layout = 'row',
}: BridgeInlineFieldRowProps) {
  const resolvedLabelClassName = labelClassName || BRIDGE_INLINE_FIELD_LABEL_WIDTH_CLASS;
  const fieldLabel = (
    <label
      htmlFor={htmlFor}
      className={`${BRIDGE_INLINE_FIELD_LABEL_CLASS} ${resolvedLabelClassName}`.trim()}
    >
      {label}
    </label>
  );
  const fieldControl = <div className="min-w-0 flex-1">{children}</div>;

  if (layout === 'contents') {
    return (
      <div data-bridge-inline-field={fieldKey} className={`contents ${className}`.trim()}>
        {fieldLabel}
        {fieldControl}
      </div>
    );
  }

  return (
    <div
      data-bridge-inline-field={fieldKey}
      className={`${BRIDGE_INLINE_FIELD_ROW_CLASS} ${className}`.trim()}
    >
      {fieldLabel}
      {fieldControl}
    </div>
  );
}

function useBridgePressAndHoldAction(
  onAction: () => void,
  repeatIntervalMs: number = BRIDGE_STEPPER_REPEAT_INTERVAL_MS,
) {
  const holdTimeoutRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const onActionRef = useRef(onAction);

  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);

  const clearTimers = useCallback(() => {
    if (holdTimeoutRef.current !== null) {
      window.clearTimeout(holdTimeoutRef.current);
      holdTimeoutRef.current = null;
    }
    if (holdIntervalRef.current !== null) {
      window.clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  }, []);

  const invokeAction = useCallback(() => {
    onActionRef.current();
  }, []);

  const stopPressAndHold = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  const startPressAndHold = useCallback(() => {
    clearTimers();
    suppressClickRef.current = true;
    invokeAction();
    holdTimeoutRef.current = window.setTimeout(() => {
      holdIntervalRef.current = window.setInterval(() => {
        invokeAction();
      }, repeatIntervalMs);
    }, BRIDGE_STEPPER_REPEAT_DELAY_MS);
  }, [clearTimers, invokeAction, repeatIntervalMs]);

  const buttonProps = useCallback(
    (label: string) => ({
      type: 'button' as const,
      'aria-label': label,
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        startPressAndHold();
      },
      onPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => {
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture?.(event.pointerId);
        }
        stopPressAndHold();
      },
      onPointerCancel: () => {
        stopPressAndHold();
        suppressClickRef.current = false;
      },
      onLostPointerCapture: () => {
        stopPressAndHold();
      },
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          event.preventDefault();
          return;
        }
        invokeAction();
      },
    }),
    [invokeAction, startPressAndHold, stopPressAndHold],
  );

  return { buttonProps };
}

interface BridgeFieldGroupProps {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  fieldKey?: string;
  className?: string;
  labelClassName?: string;
  layout?: 'stack' | 'inspector';
}

function BridgeFieldGroup({
  label,
  children,
  htmlFor,
  fieldKey,
  className = '',
  labelClassName = '',
  layout = 'stack',
}: BridgeFieldGroupProps) {
  if (layout === 'inspector') {
    return (
      <div
        data-bridge-field={fieldKey}
        className={`${BRIDGE_FIELD_GROUP_CLASS} ${className}`.trim()}
      >
        <div className={BRIDGE_INSPECTOR_FIELD_ROW_CLASS}>
          <label
            htmlFor={htmlFor}
            className={`${BRIDGE_INLINE_FIELD_LABEL_CLASS} ${labelClassName || 'w-[42px]'}`.trim()}
          >
            {label}
          </label>
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </div>
    );
  }

  return (
    <div data-bridge-field={fieldKey} className={`${BRIDGE_FIELD_GROUP_CLASS} ${className}`.trim()}>
      <label htmlFor={htmlFor} className={`${BRIDGE_FIELD_LABEL_CLASS} ${labelClassName}`.trim()}>
        {label}
      </label>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function clampValue(value: number, min?: number, max?: number) {
  let nextValue = value;

  if (min !== undefined) {
    nextValue = Math.max(min, nextValue);
  }

  if (max !== undefined) {
    nextValue = Math.min(max, nextValue);
  }

  return nextValue;
}

function formatBridgeNumber(value: number, precision: number) {
  return formatNumberWithMaxDecimals(roundToMaxDecimals(value, precision), precision) || '0';
}

function normalizeBridgeDegreesAngle(value: number): number {
  let normalized = ((value % 360) + 360) % 360;
  if (normalized > BRIDGE_HALF_ROTATION_DEGREES) {
    normalized -= 360;
  }
  return Object.is(normalized, -0) ? 0 : normalized;
}

function sanitizeBridgeNamePart(value: string | null | undefined): string {
  const sanitized = String(value ?? '')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_./-]+|[_./-]+$/g, '');

  return sanitized || 'robot';
}

function buildSuggestedBridgeName({
  assemblyState,
  parentComponentId,
  childComponentId,
}: {
  assemblyState: AssemblyState;
  parentComponentId: string;
  childComponentId: string;
}): string {
  if (!parentComponentId || !childComponentId || parentComponentId === childComponentId) {
    return '';
  }

  const parentComponent = assemblyState.components[parentComponentId];
  const childComponent = assemblyState.components[childComponentId];
  if (!parentComponent || !childComponent) {
    return '';
  }

  const parentName = sanitizeBridgeNamePart(
    parentComponent.name || parentComponent.robot.name || parentComponent.id,
  );
  const childName = sanitizeBridgeNamePart(
    childComponent.name || childComponent.robot.name || childComponent.id,
  );
  const baseName = `${parentName}-${childName}`;
  const existingNames = new Set(
    Object.values(assemblyState.bridges)
      .map((bridge) => bridge.name.trim())
      .filter(Boolean),
  );

  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let duplicateIndex = 1;
  let nextName = `${baseName}-${duplicateIndex}`;
  while (existingNames.has(nextName)) {
    duplicateIndex += 1;
    nextName = `${baseName}-${duplicateIndex}`;
  }

  return nextName;
}

interface BridgeSpinnerFieldProps {
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
  precision?: number;
  min?: number;
  max?: number;
  className?: string;
  inline?: boolean;
  fieldKey?: string;
  labelClassName?: string;
}

interface BridgeQuickRotateButtonGroupProps {
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  decreaseText: string;
  increaseText: string;
  onDecrease: () => void;
  onIncrease: () => void;
}

function BridgeQuickRotateButtonGroup({
  label,
  decreaseLabel,
  increaseLabel,
  decreaseText,
  increaseText,
  onDecrease,
  onIncrease,
}: BridgeQuickRotateButtonGroupProps) {
  const { buttonProps: decreaseButtonProps } = useBridgePressAndHoldAction(onDecrease);
  const { buttonProps: increaseButtonProps } = useBridgePressAndHoldAction(onIncrease);

  return (
    <div className={BRIDGE_QUICK_ROTATE_BUTTON_GROUP_CLASS}>
      <button
        {...decreaseButtonProps(`${label} ${decreaseLabel}`)}
        title={`${label} ${decreaseLabel}`}
        className={BRIDGE_QUICK_ROTATE_BUTTON_CLASS}
      >
        {decreaseText}
      </button>
      <button
        {...increaseButtonProps(`${label} ${increaseLabel}`)}
        title={`${label} ${increaseLabel}`}
        className={`${BRIDGE_QUICK_ROTATE_BUTTON_CLASS} border-l border-border-black/60`}
      >
        {increaseText}
      </button>
    </div>
  );
}

function BridgeSpinnerField({
  label,
  value,
  step,
  onChange,
  precision = 4,
  min,
  max,
  className = '',
  inline = false,
  fieldKey,
  labelClassName = '',
}: BridgeSpinnerFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = React.useId();
  const currentValueRef = useRef(value);
  const [draftValue, setDraftValue] = useState(() => formatBridgeNumber(value, precision));

  useEffect(() => {
    currentValueRef.current = value;
    if (document.activeElement === inputRef.current) {
      return;
    }

    setDraftValue(formatBridgeNumber(value, precision));
  }, [precision, value]);

  const commitValue = useCallback(
    (nextValue: number) => {
      const normalizedValue = roundToMaxDecimals(clampValue(nextValue, min, max), precision);
      currentValueRef.current = normalizedValue;
      onChange(normalizedValue);
      setDraftValue(formatBridgeNumber(normalizedValue, precision));
    },
    [max, min, onChange, precision],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextDraftValue = event.target.value;
      setDraftValue(nextDraftValue);

      const parsedValue = Number.parseFloat(nextDraftValue);
      if (!Number.isFinite(parsedValue)) {
        return;
      }

      onChange(roundToMaxDecimals(clampValue(parsedValue, min, max), precision));
    },
    [max, min, onChange, precision],
  );

  const handleBlur = useCallback(() => {
    const parsedValue = Number.parseFloat(draftValue);
    if (!Number.isFinite(parsedValue)) {
      setDraftValue(formatBridgeNumber(value, precision));
      return;
    }

    commitValue(parsedValue);
  }, [commitValue, draftValue, precision, value]);

  const { buttonProps: increaseButtonProps } = useBridgePressAndHoldAction(() =>
    commitValue(currentValueRef.current + step),
  );
  const { buttonProps: decreaseButtonProps } = useBridgePressAndHoldAction(() =>
    commitValue(currentValueRef.current - step),
  );

  const inputControl = (
    <div className={BRIDGE_NUMBER_FIELD_SHELL_CLASS}>
      <input
        id={inputId}
        ref={inputRef}
        type="text"
        inputMode="decimal"
        value={draftValue}
        onChange={handleInputChange}
        onBlur={handleBlur}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.currentTarget.blur();
          }
          if (event.key === 'ArrowUp') {
            event.preventDefault();
            commitValue(currentValueRef.current + step);
          }
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            commitValue(currentValueRef.current - step);
          }
        }}
        aria-label={label}
        className={BRIDGE_NUMBER_INPUT_CLASS}
      />
      <div className={BRIDGE_STEPPER_RAIL_CLASS}>
        <button
          {...increaseButtonProps(`Increase ${label}`)}
          className={BRIDGE_STEPPER_BUTTON_CLASS}
        >
          <Plus className="h-[7px] w-[7px]" />
        </button>
        <button
          {...decreaseButtonProps(`Decrease ${label}`)}
          className={`${BRIDGE_STEPPER_BUTTON_CLASS} border-t border-border-black/60`}
        >
          <Minus className="h-[7px] w-[7px]" />
        </button>
      </div>
    </div>
  );

  if (inline) {
    return (
      <BridgeInlineFieldRow
        label={label}
        htmlFor={inputId}
        fieldKey={fieldKey}
        className={className}
        labelClassName={labelClassName}
      >
        {inputControl}
      </BridgeInlineFieldRow>
    );
  }

  return (
    <BridgeFieldGroup
      label={label}
      htmlFor={inputId}
      fieldKey={fieldKey}
      className={className}
      labelClassName={labelClassName}
    >
      {inputControl}
    </BridgeFieldGroup>
  );
}

interface BridgeAxisSpinnerFieldProps {
  axis: BridgeAxisTone;
  label: string;
  value: number;
  step: number;
  onChange: (value: number) => void;
  precision?: number;
  min?: number;
  max?: number;
  className?: string;
  fieldKey?: string;
}

function BridgeAxisSpinnerField({
  axis,
  label,
  value,
  step,
  onChange,
  precision = 4,
  min,
  max,
  className = '',
  fieldKey,
}: BridgeAxisSpinnerFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = React.useId();
  const currentValueRef = useRef(value);
  const [draftValue, setDraftValue] = useState(() => formatBridgeNumber(value, precision));
  const toneStyles = BRIDGE_AXIS_TONE_STYLES[axis];

  useEffect(() => {
    currentValueRef.current = value;
    if (document.activeElement === inputRef.current) {
      return;
    }

    setDraftValue(formatBridgeNumber(value, precision));
  }, [precision, value]);

  const commitValue = useCallback(
    (nextValue: number) => {
      const normalizedValue = roundToMaxDecimals(clampValue(nextValue, min, max), precision);
      currentValueRef.current = normalizedValue;
      onChange(normalizedValue);
      setDraftValue(formatBridgeNumber(normalizedValue, precision));
    },
    [max, min, onChange, precision],
  );

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const nextDraftValue = event.target.value;
      setDraftValue(nextDraftValue);

      const parsedValue = Number.parseFloat(nextDraftValue);
      if (!Number.isFinite(parsedValue)) {
        return;
      }

      onChange(roundToMaxDecimals(clampValue(parsedValue, min, max), precision));
    },
    [max, min, onChange, precision],
  );

  const handleBlur = useCallback(() => {
    const parsedValue = Number.parseFloat(draftValue);
    if (!Number.isFinite(parsedValue)) {
      setDraftValue(formatBridgeNumber(value, precision));
      return;
    }

    commitValue(parsedValue);
  }, [commitValue, draftValue, precision, value]);

  const { buttonProps: increaseButtonProps } = useBridgePressAndHoldAction(() =>
    commitValue(currentValueRef.current + step),
  );
  const { buttonProps: decreaseButtonProps } = useBridgePressAndHoldAction(() =>
    commitValue(currentValueRef.current - step),
  );

  return (
    <div
      data-bridge-inline-field={fieldKey}
      data-bridge-axis={axis}
      className={`min-w-0 space-y-1 ${className}`.trim()}
    >
      <div className="flex min-w-0 items-stretch gap-1.5">
        <label
          htmlFor={inputId}
          className={`inline-flex h-[22px] w-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-semibold uppercase tracking-[0.08em] ${toneStyles.badgeClassName}`.trim()}
        >
          {label}
        </label>
        <div className="min-w-0 flex-1">
          <div className={`${BRIDGE_NUMBER_FIELD_SHELL_CLASS} bg-panel-bg/80`.trim()}>
            <input
              id={inputId}
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={draftValue}
              onChange={handleInputChange}
              onBlur={handleBlur}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.currentTarget.blur();
                }
                if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  commitValue(currentValueRef.current + step);
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  commitValue(currentValueRef.current - step);
                }
              }}
              aria-label={label}
              className={BRIDGE_NUMBER_INPUT_CLASS}
            />
            <div className={BRIDGE_STEPPER_RAIL_CLASS}>
              <button
                {...increaseButtonProps(`Increase ${label}`)}
                className={BRIDGE_STEPPER_BUTTON_CLASS}
              >
                <Plus className="h-[7px] w-[7px]" />
              </button>
              <button
                {...decreaseButtonProps(`Decrease ${label}`)}
                className={`${BRIDGE_STEPPER_BUTTON_CLASS} border-t border-border-black/60`}
              >
                <Minus className="h-[7px] w-[7px]" />
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className={`h-1 rounded-full ${toneStyles.barClassName}`.trim()} />
    </div>
  );
}

interface BridgeSelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  children: React.ReactNode;
  inline?: boolean;
  fieldKey?: string;
  className?: string;
  labelClassName?: string;
  layout?: 'stack' | 'inspector';
}

function BridgeSelectField({
  label,
  value,
  onChange,
  onFocus,
  children,
  inline = false,
  fieldKey,
  className = '',
  labelClassName = '',
  layout = 'stack',
}: BridgeSelectFieldProps) {
  const selectId = React.useId();
  const selectControl = (
    <select
      id={selectId}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onFocus={onFocus}
      className={BRIDGE_SELECT_CLASS}
    >
      <option value="">--</option>
      {children}
    </select>
  );

  if (inline) {
    return (
      <BridgeInlineFieldRow
        label={label}
        htmlFor={selectId}
        fieldKey={fieldKey}
        className={className}
        labelClassName={labelClassName}
      >
        {selectControl}
      </BridgeInlineFieldRow>
    );
  }

  return (
    <BridgeFieldGroup
      label={label}
      htmlFor={selectId}
      fieldKey={fieldKey}
      className={className}
      labelClassName={labelClassName}
      layout={layout}
    >
      {selectControl}
    </BridgeFieldGroup>
  );
}

interface BridgeSideCardProps {
  side: BridgePickTarget;
  isActive: boolean;
  title: string;
  pickLabel: string;
  componentLabel: string;
  linkLabel: string;
  componentValue: string;
  linkValue: string;
  componentSummary: string;
  linkSummary: string;
  onActivate: () => void;
  onComponentChange: (value: string) => void;
  onLinkChange: (value: string) => void;
  componentOptions: Array<{ id: string; name: string }>;
  linkOptions: Array<{ id: string; name: string }>;
}

function BridgeRelationConnector() {
  return (
    <div
      data-bridge-connector="joint-link"
      aria-hidden="true"
      className="flex min-h-[176px] flex-col items-center justify-center gap-2"
    >
      <div className={BRIDGE_RELATION_CONNECTOR_LINE_CLASS} />
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-system-blue/25 bg-element-bg text-system-blue shadow-[0_10px_24px_rgba(0,0,0,0.12),inset_0_0_0_1px_color-mix(in_srgb,var(--color-system-blue)_12%,transparent)]">
        <Link2 className="h-4 w-4" />
      </div>
      <div className={BRIDGE_RELATION_CONNECTOR_LINE_CLASS} />
    </div>
  );
}

function BridgeSideCard({
  side,
  isActive,
  title,
  pickLabel,
  componentLabel,
  linkLabel,
  componentValue,
  linkValue,
  componentSummary,
  linkSummary,
  onActivate,
  onComponentChange,
  onLinkChange,
  componentOptions,
  linkOptions,
}: BridgeSideCardProps) {
  return (
    <div
      data-bridge-side={side}
      data-bridge-component-summary={componentSummary}
      data-bridge-link-summary={linkSummary}
      onFocusCapture={onActivate}
      className={`flex h-full flex-col rounded-xl border p-2 transition-[border-color,background-color,box-shadow] ${
        isActive
          ? 'border-system-blue/45 bg-system-blue/8 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-system-blue)_18%,transparent),0_12px_28px_rgba(0,0,0,0.12)] ring-1 ring-system-blue/20'
          : 'border-border-black bg-element-bg/55 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-border-black)_22%,transparent)]'
      }`}
    >
      <div data-bridge-side-header={side} className={BRIDGE_SIDE_CARD_HEADER_ROW_CLASS}>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-flex items-center rounded-md border px-1.5 py-px text-[8px] font-semibold uppercase tracking-[0.12em] ${
                isActive
                  ? 'border-system-blue/30 bg-system-blue/12 text-system-blue'
                  : 'border-border-black bg-panel-bg text-text-secondary'
              }`}
            >
              {title}
            </span>
            <div className="h-px flex-1 bg-border-black/80" />
          </div>
        </div>
        <div
          data-bridge-side-actions={side}
          className={`${BRIDGE_SIDE_CARD_ACTIONS_CLASS} self-start`}
        >
          <button
            type="button"
            aria-pressed={isActive}
            onClick={onActivate}
            className={`${BRIDGE_PICK_BUTTON_CLASS} border ${
              isActive
                ? 'border-system-blue/25 bg-system-blue/15 text-system-blue'
                : 'border-border-black bg-panel-bg text-text-tertiary hover:bg-element-hover hover:text-text-primary'
            }`}
          >
            {pickLabel}
          </button>
        </div>
      </div>

      <div data-bridge-side-fields={side} className="mt-2 grid gap-1.5">
        <div
          data-bridge-field={`${side}-component`}
          className="min-w-0 rounded-lg border border-border-black/80 bg-panel-bg/85 p-1.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-border-black)_18%,transparent)]"
        >
          <select
            aria-label={componentLabel}
            value={componentValue}
            onChange={(event) => onComponentChange(event.target.value)}
            onFocus={onActivate}
            className={BRIDGE_SELECT_CLASS}
          >
            <option value="">--</option>
            {componentOptions.map((component) => (
              <option key={component.id} value={component.id}>
                {component.name}
              </option>
            ))}
          </select>
        </div>

        <div
          data-bridge-field={`${side}-link`}
          className="min-w-0 rounded-lg border border-border-black/80 bg-panel-bg/85 p-1.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-border-black)_18%,transparent)]"
        >
          <select
            aria-label={linkLabel}
            value={linkValue}
            onChange={(event) => onLinkChange(event.target.value)}
            onFocus={onActivate}
            className={BRIDGE_SELECT_CLASS}
          >
            <option value="">--</option>
            {linkOptions.map((link) => (
              <option key={link.id} value={link.id}>
                {link.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

interface BridgeSectionProps {
  title: string;
  children: React.ReactNode;
  className?: string;
}

function BridgeSection({ title, children, className = '' }: BridgeSectionProps) {
  return (
    <div className={`${BRIDGE_SECTION_CLASS} ${className}`.trim()}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <div className={BRIDGE_SECTION_TITLE_CLASS}>{title}</div>
        <div className="h-px flex-1 bg-border-black" />
      </div>
      {children}
    </div>
  );
}

export interface BridgeCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPreviewChange?: (bridge: BridgeJoint | null) => void;
  onCreate: (params: {
    name: string;
    parentComponentId: string;
    parentLinkId: string;
    childComponentId: string;
    childLinkId: string;
    joint: {
      type: JointType;
      origin: UrdfOrigin;
      axis: { x: number; y: number; z: number };
      limit?: { lower: number; upper: number; effort: number; velocity: number };
      hardware?: UrdfJoint['hardware'];
    };
  }) => void;
  assemblyState: AssemblyState;
  lang: Language;
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
  const sideCardTitle =
    lang === 'zh' ? { parent: '父侧', child: '子侧' } : { parent: 'Parent', child: 'Child' };
  const relationSectionTitle = lang === 'zh' ? '拼接关系' : 'Joint Relation';
  const compactLabelWidthClassName = lang === 'zh' ? 'w-[30px]' : 'w-[44px]';
  const axisLabelWidthClassName = 'w-4 justify-center';
  const nameInputId = React.useId();
  const jointTypeSelectId = React.useId();
  const defaultWindowSize = useMemo(() => ({ width: 620, height: 344 }), []);
  const comps = Object.values(assemblyState.components);
  const selection = useSelectionStore((state) => state.selection);
  const setInteractionGuard = useSelectionStore((state) => state.setInteractionGuard);
  const clearInteractionSelection = useSelectionStore((state) => state.clearSelection);
  const clearHover = useSelectionStore((state) => state.clearHover);
  const clearAssemblySelection = useAssemblySelectionStore((state) => state.clearSelection);
  const lastAppliedSelectionRef = useRef<string | null>(null);
  const ignoredInitialSelectionSignatureRef = useRef<string | null>(null);
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
    minSize: { width: 520, height: 304 },
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
  const usesCadInspectorLayout = windowState.size.width >= 600;
  const topFieldGridClassName = usesInlineIdentityRow
    ? `grid items-center gap-x-1.5 gap-y-1 ${
        lang === 'zh'
          ? 'grid-cols-[30px_minmax(0,1fr)_30px_minmax(0,1fr)]'
          : 'grid-cols-[44px_minmax(0,1fr)_44px_minmax(0,1fr)]'
      }`
    : 'space-y-1.5';
  const originFieldGridClassName =
    windowState.size.width >= 360 ? 'grid grid-cols-3 gap-1.5' : 'grid grid-cols-3 gap-1';
  const inspectorGridClassName = usesCadInspectorLayout
    ? 'grid grid-cols-[minmax(0,1fr)_minmax(228px,0.9fr)] gap-1.5'
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

  const [name, setName] = useState('');
  const [parentCompId, setParentCompId] = useState('');
  const [parentLinkId, setParentLinkId] = useState('');
  const [childCompId, setChildCompId] = useState('');
  const [childLinkId, setChildLinkId] = useState('');
  const [jointType, setJointType] = useState<JointType>(JointType.FIXED);
  const [hardwareInterface, setHardwareInterface] = useState<JointHardwareInterface>('position');
  const [originX, setOriginX] = useState(0);
  const [originY, setOriginY] = useState(0);
  const [originZ, setOriginZ] = useState(0);
  const [rotationDisplayMode, setRotationDisplayMode] =
    useState<BridgeRotationDisplayMode>('euler_deg');
  const [rollDeg, setRollDeg] = useState(0);
  const [pitchDeg, setPitchDeg] = useState(0);
  const [yawDeg, setYawDeg] = useState(0);
  const [quatX, setQuatX] = useState(0);
  const [quatY, setQuatY] = useState(0);
  const [quatZ, setQuatZ] = useState(0);
  const [quatW, setQuatW] = useState(1);
  const [axisX, setAxisX] = useState(0);
  const [axisY, setAxisY] = useState(0);
  const [axisZ, setAxisZ] = useState(1);
  const eulerDegreesRef = useRef({ r: 0, p: 0, y: 0 });
  const [limitLower, setLimitLower] = useState(defaultLimitLower);
  const [limitUpper, setLimitUpper] = useState(defaultLimitUpper);
  const [limitEffort, setLimitEffort] = useState(defaultLimitEffort);
  const [limitVelocity, setLimitVelocity] = useState(defaultLimitVelocity);
  const [pickTarget, setPickTarget] = useState<BridgePickTarget>('parent');
  const originDirtyRef = useRef(false);
  const previousBridgeRelationSignatureRef = useRef('');

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
  const positionLowerLabel = lang === 'zh' ? '位置下限' : 'Position Lower Limit';
  const positionUpperLabel = lang === 'zh' ? '位置上限' : 'Position Upper Limit';
  const rollRad = useMemo(() => degToRad(rollDeg), [rollDeg]);
  const pitchRad = useMemo(() => degToRad(pitchDeg), [pitchDeg]);
  const yawRad = useMemo(() => degToRad(yawDeg), [yawDeg]);

  const applyEulerRotation = useCallback((nextEulerDeg: { r: number; p: number; y: number }) => {
    eulerDegreesRef.current = nextEulerDeg;
    setRollDeg(nextEulerDeg.r);
    setPitchDeg(nextEulerDeg.p);
    setYawDeg(nextEulerDeg.y);

    const nextQuaternion = bridgeEulerDegreesToQuaternion(nextEulerDeg);
    setQuatX(nextQuaternion.x);
    setQuatY(nextQuaternion.y);
    setQuatZ(nextQuaternion.z);
    setQuatW(nextQuaternion.w);
  }, []);

  const applyQuaternionRotation = useCallback(
    (nextQuaternionValue: { x: number; y: number; z: number; w: number }) => {
      const normalizedQuaternion = normalizeBridgeQuaternion(nextQuaternionValue);
      setQuatX(normalizedQuaternion.x);
      setQuatY(normalizedQuaternion.y);
      setQuatZ(normalizedQuaternion.z);
      setQuatW(normalizedQuaternion.w);

      const nextEulerDegrees = bridgeQuaternionToEulerDegrees(normalizedQuaternion);
      eulerDegreesRef.current = nextEulerDegrees;
      setRollDeg(nextEulerDegrees.r);
      setPitchDeg(nextEulerDegrees.p);
      setYawDeg(nextEulerDegrees.y);
    },
    [],
  );

  const handleQuickRotate = useCallback(
    (axis: BridgeEulerAxisKey, direction: 1 | -1) => {
      const currentEuler = eulerDegreesRef.current;
      const delta = BRIDGE_ROTATION_SHORTCUT_DEGREES * direction;
      applyEulerRotation({
        r: axis === 'r' ? normalizeBridgeDegreesAngle(currentEuler.r + delta) : currentEuler.r,
        p: axis === 'p' ? normalizeBridgeDegreesAngle(currentEuler.p + delta) : currentEuler.p,
        y: axis === 'y' ? normalizeBridgeDegreesAngle(currentEuler.y + delta) : currentEuler.y,
      });
    },
    [applyEulerRotation],
  );

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

  const applySuggestedOrigin = useCallback((nextOrigin: { x: number; y: number; z: number }) => {
    originDirtyRef.current = false;
    setOriginX(nextOrigin.x);
    setOriginY(nextOrigin.y);
    setOriginZ(nextOrigin.z);
  }, []);

  const handleOriginXChange = useCallback((value: number) => {
    originDirtyRef.current = true;
    setOriginX(value);
  }, []);

  const handleOriginYChange = useCallback((value: number) => {
    originDirtyRef.current = true;
    setOriginY(value);
  }, []);

  const handleOriginZChange = useCallback((value: number) => {
    originDirtyRef.current = true;
    setOriginZ(value);
  }, []);

  const resetForm = useCallback(() => {
    setName('');
    setParentCompId('');
    setParentLinkId('');
    setChildCompId('');
    setChildLinkId('');
    setJointType(JointType.FIXED);
    setHardwareInterface('position');
    setOriginX(0);
    setOriginY(0);
    setOriginZ(0);
    setRotationDisplayMode('euler_deg');
    eulerDegreesRef.current = { r: 0, p: 0, y: 0 };
    setRollDeg(0);
    setPitchDeg(0);
    setYawDeg(0);
    setQuatX(0);
    setQuatY(0);
    setQuatZ(0);
    setQuatW(1);
    setAxisX(0);
    setAxisY(0);
    setAxisZ(1);
    setLimitLower(defaultLimitLower);
    setLimitUpper(defaultLimitUpper);
    setLimitEffort(defaultLimitEffort);
    setLimitVelocity(defaultLimitVelocity);
    setPickTarget('parent');
    originDirtyRef.current = false;
    previousBridgeRelationSignatureRef.current = '';
    lastAppliedSelectionRef.current = null;
  }, [defaultLimitEffort, defaultLimitLower, defaultLimitUpper, defaultLimitVelocity]);

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

    onPreviewChange?.(null);
    onCreate({
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
    });
    resetForm();
    onClose();
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

  const namePlaceholder = suggestedBridgeName || t.bridgeJointNamePlaceholder;

  useEffect(() => {
    if (!isOpen) {
      lastAppliedSelectionRef.current = null;
      ignoredInitialSelectionSignatureRef.current = null;
      setInteractionGuard(null);
      onPreviewChange?.(null);
      return undefined;
    }

    // Bridge picking should always begin from a clean interaction state.
    // Reusing a stale pre-open link selection can silently auto-fill a side,
    // flip the active pick target, and make hover/selection appear broken.
    const currentSelection = useSelectionStore.getState().selection;
    ignoredInitialSelectionSignatureRef.current =
      currentSelection.type && currentSelection.id
        ? `${currentSelection.type}:${currentSelection.id}:${currentSelection.subType ?? ''}:${currentSelection.objectIndex ?? ''}`
        : null;
    clearAssemblySelection();
    clearInteractionSelection();
    clearHover();
    lastAppliedSelectionRef.current = null;
  }, [
    clearAssemblySelection,
    clearHover,
    clearInteractionSelection,
    isOpen,
    onPreviewChange,
    setInteractionGuard,
  ]);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    setInteractionGuard((nextSelection) =>
      isAssemblySelectionAllowedForBridge(assemblyState, nextSelection, blockedComponentId),
    );

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      setInteractionGuard(null);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [assemblyState, blockedComponentId, handleClose, isOpen, setInteractionGuard]);

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

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const resolvedSelection = resolveAssemblySelection(assemblyState, selection);
    if (!resolvedSelection) {
      return;
    }

    if (!isAssemblySelectionAllowedForBridge(assemblyState, selection, blockedComponentId)) {
      return;
    }

    const selectionSignature = `${pickTarget}:${selection.type}:${selection.id}:${selection.subType ?? ''}:${selection.objectIndex ?? ''}`;
    const initialSelectionSignature = ignoredInitialSelectionSignatureRef.current;
    if (
      initialSelectionSignature &&
      initialSelectionSignature ===
        `${selection.type}:${selection.id}:${selection.subType ?? ''}:${selection.objectIndex ?? ''}`
    ) {
      ignoredInitialSelectionSignatureRef.current = null;
      return;
    }

    if (lastAppliedSelectionRef.current === selectionSignature) {
      return;
    }

    lastAppliedSelectionRef.current = selectionSignature;

    if (pickTarget === 'parent') {
      setParentCompId(resolvedSelection.componentId);
      setParentLinkId(resolvedSelection.linkId);
      if (!childCompId || !childLinkId) {
        setPickTarget('child');
      }
      return;
    }

    setChildCompId(resolvedSelection.componentId);
    setChildLinkId(resolvedSelection.linkId);
  }, [assemblyState, blockedComponentId, childCompId, childLinkId, isOpen, pickTarget, selection]);

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
      headerDraggableClassName="cursor-grab"
      headerDraggingClassName="cursor-grabbing"
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
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
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
              <select
                id={jointTypeSelectId}
                value={jointType}
                onChange={(event) => setJointType(event.target.value as JointType)}
                className={BRIDGE_SELECT_CLASS}
              >
                <option value={JointType.FIXED}>{t.jointTypeFixed}</option>
                <option value={JointType.REVOLUTE}>{t.jointTypeRevolute}</option>
                <option value={JointType.CONTINUOUS}>{t.jointTypeContinuous}</option>
                <option value={JointType.PRISMATIC}>{t.jointTypePrismatic}</option>
              </select>
            </BridgeInlineFieldRow>
            {jointSupportsAxisAndLimits ? (
              <BridgeInlineFieldRow
                label={t.hardwareInterface}
                fieldKey="hardware-interface"
                className={`${usesInlineIdentityRow ? 'col-span-full ' : ''}min-w-0`.trim()}
                labelClassName={compactLabelWidthClassName}
              >
                <select
                  aria-label={t.hardwareInterface}
                  value={hardwareInterface}
                  onChange={(event) =>
                    setHardwareInterface(event.target.value as JointHardwareInterface)
                  }
                  className={BRIDGE_SELECT_CLASS}
                >
                  <option value="position">{t.hardwareInterfacePosition}</option>
                  <option value="effort">{t.hardwareInterfaceEffort}</option>
                  <option value="velocity">{t.hardwareInterfaceVelocity}</option>
                </select>
              </BridgeInlineFieldRow>
            ) : null}
          </div>

          <div className={inspectorGridClassName}>
            <div className="space-y-1.5">
              <BridgeSection title={relationSectionTitle}>
                <div className={BRIDGE_RELATION_GRID_CLASS}>
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
                    componentOptions={parentComponentOptions.map((component) => ({
                      id: component.id,
                      name: component.name,
                    }))}
                    linkOptions={parentLinks.map((link) => ({
                      id: link.id,
                      name: getBridgeLinkDisplayName(parentComp?.robot, link.id),
                    }))}
                  />

                  <BridgeRelationConnector />

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
                    componentOptions={childComponentOptions.map((component) => ({
                      id: component.id,
                      name: component.name,
                    }))}
                    linkOptions={childLinks.map((link) => ({
                      id: link.id,
                      name: getBridgeLinkDisplayName(childComp?.robot, link.id),
                    }))}
                  />
                </div>
              </BridgeSection>
            </div>

            <div className="space-y-1.5">
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

              {jointSupportsAxisAndLimits ? (
                <>
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
                    {limitRangeValidationMessage ? (
                      <p className="mt-1 text-[9px] font-medium text-red-500">
                        {limitRangeValidationMessage}
                      </p>
                    ) : null}
                    {nonFixedCycleValidationMessage ? (
                      <p className="mt-1 text-[9px] font-medium text-red-500">
                        {nonFixedCycleValidationMessage}
                      </p>
                    ) : null}
                  </BridgeSection>
                </>
              ) : null}
            </div>
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
