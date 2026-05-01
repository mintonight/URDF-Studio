import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link2, Minus, Plus } from 'lucide-react';
import { PanelSelect, type SelectOption } from '@/shared/components/ui';
import { usePressAndHoldRepeat } from '@/shared/hooks';
import { roundToMaxDecimals } from '@/core/utils/numberPrecision';
import type { BridgePickTarget } from '../../utils/bridgeSelection';
import {
  BRIDGE_AXIS_TONE_STYLES,
  BRIDGE_FIELD_GROUP_CLASS,
  BRIDGE_FIELD_LABEL_CLASS,
  BRIDGE_INLINE_FIELD_LABEL_CLASS,
  BRIDGE_INLINE_FIELD_LABEL_WIDTH_CLASS,
  BRIDGE_INLINE_FIELD_ROW_CLASS,
  BRIDGE_INSPECTOR_FIELD_ROW_CLASS,
  BRIDGE_NUMBER_FIELD_SHELL_CLASS,
  BRIDGE_NUMBER_INPUT_CLASS,
  BRIDGE_PICK_BUTTON_CLASS,
  BRIDGE_QUICK_ROTATE_BUTTON_CLASS,
  BRIDGE_QUICK_ROTATE_BUTTON_GROUP_CLASS,
  BRIDGE_RELATION_CONNECTOR_LINE_CLASS,
  BRIDGE_SECTION_CLASS,
  BRIDGE_SECTION_TITLE_CLASS,
  BRIDGE_SELECT_CLASS,
  BRIDGE_SIDE_CARD_ACTIONS_CLASS,
  BRIDGE_SIDE_CARD_HEADER_ROW_CLASS,
  BRIDGE_STEPPER_BUTTON_CLASS,
  BRIDGE_STEPPER_RAIL_CLASS,
  BRIDGE_STEPPER_REPEAT_DELAY_MS,
  BRIDGE_STEPPER_REPEAT_INTERVAL_MS,
  type BridgeAxisTone,
} from './bridgeCreateModalStyles';
import { clampValue, formatBridgeNumber } from './bridgeCreateModalUtils';

interface BridgeInlineFieldRowProps {
  label: string;
  children: React.ReactNode;
  htmlFor?: string;
  fieldKey?: string;
  className?: string;
  labelClassName?: string;
  layout?: 'row' | 'contents';
}

export function BridgeInlineFieldRow({
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
  const fieldControl = <div className="flex min-w-0 items-center">{children}</div>;

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
  const { repeatButtonProps } = usePressAndHoldRepeat<void>(onAction, {
    repeatDelayMs: BRIDGE_STEPPER_REPEAT_DELAY_MS,
    repeatIntervalMs,
  });

  const buttonProps = useCallback(
    (label: string) => repeatButtonProps(undefined, label),
    [repeatButtonProps],
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

interface BridgeQuickRotateButtonGroupProps {
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  decreaseText: string;
  increaseText: string;
  onDecrease: () => void;
  onIncrease: () => void;
}

export function BridgeQuickRotateButtonGroup({
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

export function BridgeSpinnerField({
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

export function BridgeAxisSpinnerField({
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
  componentOptions: SelectOption[];
  linkOptions: SelectOption[];
}

export function BridgeRelationConnector() {
  return (
    <div
      data-bridge-connector="joint-link"
      aria-hidden="true"
      className="flex min-h-[152px] flex-col items-center justify-center gap-1.5"
    >
      <div className={BRIDGE_RELATION_CONNECTOR_LINE_CLASS} />
      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-system-blue/25 bg-element-bg text-system-blue shadow-[0_8px_18px_rgba(0,0,0,0.12),inset_0_0_0_1px_color-mix(in_srgb,var(--color-system-blue)_12%,transparent)]">
        <Link2 className="h-3.5 w-3.5" />
      </div>
      <div className={BRIDGE_RELATION_CONNECTOR_LINE_CLASS} />
    </div>
  );
}

export function BridgeSideCard({
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
          <PanelSelect
            variant="property"
            aria-label={componentLabel}
            options={componentOptions}
            value={componentValue}
            onChange={(event) => onComponentChange(event.target.value)}
            onFocus={onActivate}
            className={BRIDGE_SELECT_CLASS}
          />
        </div>

        <div
          data-bridge-field={`${side}-link`}
          className="min-w-0 rounded-lg border border-border-black/80 bg-panel-bg/85 p-1.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-border-black)_18%,transparent)]"
        >
          <PanelSelect
            variant="property"
            aria-label={linkLabel}
            options={linkOptions}
            value={linkValue}
            onChange={(event) => onLinkChange(event.target.value)}
            onFocus={onActivate}
            className={BRIDGE_SELECT_CLASS}
          />
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

export function BridgeSection({ title, children, className = '' }: BridgeSectionProps) {
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
