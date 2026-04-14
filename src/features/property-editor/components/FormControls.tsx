/**
 * Reusable form controls for the PropertyEditor feature.
 * InputGroup, CollapsibleSection, NumberInput, Vec3Input
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { PanelSelect, type SelectOption } from '@/shared/components/ui';
import {
  MAX_PROPERTY_DECIMALS,
  formatNumberWithMaxDecimals,
  roundToMaxDecimals,
} from '@/core/utils/numberPrecision';
import { CollapsibleSection as SharedCollapsibleSection } from '@/shared/components/Panel/OptionsPanel';
import {
  PROPERTY_EDITOR_STEPPER_REPEAT_DELAY_MS,
  PROPERTY_EDITOR_STEPPER_REPEAT_INTERVAL_MS,
} from '../constants';

export const PROPERTY_EDITOR_PANEL_EYEBROW_CLASS =
  'ui-static-copy-guard text-[9px] font-semibold tracking-[0.02em] text-text-tertiary';
export const PROPERTY_EDITOR_PANEL_TITLE_CLASS =
  'ui-static-copy-guard text-[11px] font-semibold leading-4 text-text-primary';
export const PROPERTY_EDITOR_SECTION_TITLE_CLASS =
  'ui-static-copy-guard text-[10px] font-semibold leading-4 text-text-primary';
export const PROPERTY_EDITOR_FIELD_LABEL_CLASS =
  'ui-static-copy-guard block text-[9px] font-semibold tracking-[0.02em] leading-4 text-text-tertiary';
export const PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS =
  'ui-static-copy-guard shrink-0 flex items-center h-[22px] text-[9px] font-semibold leading-none text-text-tertiary';
export const PROPERTY_EDITOR_SUBLABEL_CLASS =
  'ui-static-copy-guard text-[9px] font-semibold leading-4 text-text-tertiary';
export const PROPERTY_EDITOR_HELPER_TEXT_CLASS = 'text-[9px] leading-4 text-text-tertiary';
export const PROPERTY_EDITOR_INPUT_CLASS =
  'h-[22px] w-full rounded-md border border-border-strong bg-input-bg px-1.5 text-[10px] leading-4 text-text-primary focus:outline-none focus:border-system-blue focus:ring-2 focus:ring-system-blue/25';
export const PROPERTY_EDITOR_READONLY_VALUE_CLASS = `${PROPERTY_EDITOR_INPUT_CLASS} flex items-center bg-element-bg/60`;
export const PROPERTY_EDITOR_COMPACT_INPUT_CLASS =
  'h-[22px] w-full rounded-md border border-border-strong bg-input-bg px-1.5 text-[10px] leading-4 text-text-primary focus:outline-none focus:border-system-blue focus:ring-2 focus:ring-system-blue/25';
export const PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS =
  'ui-static-copy-guard inline-flex h-[22px] shrink-0 items-center justify-center text-[9px] font-semibold leading-none text-text-tertiary';
export const PROPERTY_EDITOR_NUMBER_FIELD_SHELL_CLASS =
  'flex h-[22px] w-full items-stretch overflow-hidden rounded-md border border-border-strong bg-input-bg text-text-primary transition-colors focus-within:border-system-blue focus-within:ring-2 focus-within:ring-system-blue/25';
export const PROPERTY_EDITOR_COMPACT_NUMBER_FIELD_SHELL_CLASS =
  'flex h-[22px] w-full items-stretch overflow-hidden rounded-md border border-border-strong bg-input-bg text-text-primary transition-colors focus-within:border-system-blue focus-within:ring-2 focus-within:ring-system-blue/25';
export const PROPERTY_EDITOR_STEPPER_RAIL_CLASS =
  'flex w-4 shrink-0 flex-col border-l border-border-black/60 bg-element-bg/70';
export const PROPERTY_EDITOR_STEPPER_BUTTON_CLASS =
  'flex flex-1 min-h-0 items-center justify-center px-1 text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary focus:outline-none focus-visible:bg-element-hover focus-visible:text-text-primary';
export const PROPERTY_EDITOR_SECTION_TRIGGER_CLASS =
  'w-full flex items-center justify-between px-2 py-1 bg-element-bg hover:bg-element-hover transition-colors text-[9px] font-semibold tracking-[0.02em] text-text-secondary';
export const PROPERTY_EDITOR_SECTION_HEADER_CLASS =
  'ui-static-copy-guard px-2 py-1 bg-element-bg text-[9px] font-semibold tracking-[0.02em] text-text-secondary';
export const PROPERTY_EDITOR_LINK_CLASS =
  'inline-flex items-center gap-1 text-[10px] font-medium text-system-blue hover:text-system-blue-hover transition-colors';
export const PROPERTY_EDITOR_PRIMARY_BUTTON_CLASS =
  'inline-flex h-[22px] items-center justify-center gap-1 rounded-md bg-system-blue-solid px-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-system-blue-hover';
export const PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS =
  'inline-flex h-[22px] items-center justify-center gap-1 rounded-md border border-border-strong bg-panel-bg px-1.5 text-[10px] font-medium text-text-secondary shadow-sm transition-colors cursor-pointer hover:border-border-black hover:bg-element-hover hover:text-text-primary active:bg-element-active focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/25 disabled:cursor-not-allowed disabled:opacity-50';
export const PROPERTY_EDITOR_ICON_SEGMENTED_GROUP_CLASS =
  'grid gap-0.5 rounded-md border border-border-strong bg-element-bg/70 p-0.5';
export const PROPERTY_EDITOR_ICON_SEGMENTED_BUTTON_CLASS =
  'inline-flex h-[22px] w-full items-center justify-center rounded-md text-text-secondary transition-all duration-150 hover:bg-element-hover hover:text-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30';

interface IconSegmentedOption<T extends string> {
  value: T;
  label: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
}

export const InputGroup = ({
  label,
  children,
  className = '',
}: {
  label: string;
  children?: React.ReactNode;
  className?: string;
}) => (
  <div className={`mb-1 ${className}`}>
    <label className={`${PROPERTY_EDITOR_FIELD_LABEL_CLASS} mb-0.5`}>{label}</label>
    {children}
  </div>
);

export const InlineInputGroup = ({
  label,
  children,
  className = '',
  labelWidthClassName = 'w-12',
  align = 'center',
}: {
  label: string;
  children?: React.ReactNode;
  className?: string;
  labelWidthClassName?: string;
  align?: 'start' | 'center';
}) => (
  <div className={`mb-1 ${className}`}>
    <div
      className={`flex min-w-0 flex-nowrap gap-2 ${align === 'start' ? 'items-start' : 'items-center'}`}
    >
      <label
        className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} ${labelWidthClassName}`}
        style={{ width: 'fit-content' }}
      >
        {label}
      </label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  </div>
);

export const ReadonlyValueField = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={`${PROPERTY_EDITOR_READONLY_VALUE_CLASS} ${className}`}>{children}</div>;

interface PropertyEditorSelectProps extends Omit<
  React.ComponentProps<typeof PanelSelect>,
  'options' | 'variant'
> {
  options: readonly SelectOption[];
}

export function PropertyEditorSelect({
  options,
  className = '',
  ...props
}: PropertyEditorSelectProps) {
  return <PanelSelect options={options} variant="property" className={className} {...props} />;
}

export const ReadonlyStatField = ({
  label,
  value,
  align = 'start',
}: {
  label: string;
  value: string;
  align?: 'start' | 'center';
}) => (
  <div className="grid gap-0.5">
    <div className={`${PROPERTY_EDITOR_SUBLABEL_CLASS} ${align === 'center' ? 'text-center' : ''}`}>
      {label}
    </div>
    <ReadonlyValueField className={align === 'center' ? 'justify-center text-center' : ''}>
      {value}
    </ReadonlyValueField>
  </div>
);

export const ReadonlyVectorStatRow = ({
  axisLabels = ['X', 'Y', 'Z'],
  label,
  values,
}: {
  axisLabels?: [string, string, string];
  label: string;
  values: [string, string, string];
}) => (
  <div className="grid min-w-0 w-full grid-cols-[28px_repeat(3,minmax(0,1fr))] items-center gap-x-1.5 gap-y-0.5">
    <div className="flex h-[22px] items-center text-[8px] font-semibold leading-4 text-text-tertiary">
      {label}
    </div>
    {axisLabels.map((axisLabel, index) => (
      <ReadonlyValueField key={axisLabel} className="justify-center text-center">
        {values[index]}
      </ReadonlyValueField>
    ))}
  </div>
);

export const ReadonlyVectorStatHeader = ({
  axisLabels = ['X', 'Y', 'Z'],
}: {
  axisLabels?: [string, string, string];
}) => (
  <div className="grid min-w-0 w-full grid-cols-[28px_repeat(3,minmax(0,1fr))] items-center gap-x-1.5 gap-y-0.5">
    <div aria-hidden="true" />
    {axisLabels.map((axisLabel) => (
      <span key={axisLabel} className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} text-center`}>
        {axisLabel}
      </span>
    ))}
  </div>
);

export const CollapsibleSection = ({
  title,
  children,
  defaultOpen = true,
  className = '',
  storageKey,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
  storageKey?: string;
}) => {
  return (
    <SharedCollapsibleSection
      title={title}
      defaultOpen={defaultOpen}
      storageKey={storageKey}
      className={`rounded-md border border-border-black overflow-hidden ${className}`}
      useDividerStyle={false}
      triggerClassName={PROPERTY_EDITOR_SECTION_TRIGGER_CLASS}
      iconClassName="opacity-60"
      contentInnerClassName="border-t border-border-black bg-panel-bg px-1.5 py-1"
      expandedMaxHeightClassName="max-h-[1200px]"
    >
      {children}
    </SharedCollapsibleSection>
  );
};

export const StaticSection = ({
  title,
  children,
  className = '',
  contentClassName = 'border-t border-border-black bg-panel-bg p-1.5',
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) => (
  <div className={`overflow-hidden rounded-md border border-border-black ${className}`}>
    <div className={PROPERTY_EDITOR_SECTION_HEADER_CLASS}>{title}</div>
    <div className={contentClassName}>{children}</div>
  </div>
);

export const IconSegmentedControl = <T extends string>({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: T;
  onChange: (value: T) => void;
  options: IconSegmentedOption<T>[];
  ariaLabel: string;
}) => (
  <div
    className={PROPERTY_EDITOR_ICON_SEGMENTED_GROUP_CLASS}
    style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    role="radiogroup"
    aria-label={ariaLabel}
  >
    {options.map((option) => {
      const Icon = option.icon;
      const isSelected = option.value === value;

      return (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={isSelected}
          aria-label={option.label}
          title={option.label}
          onClick={() => onChange(option.value)}
          className={`${PROPERTY_EDITOR_ICON_SEGMENTED_BUTTON_CLASS} ${
            isSelected
              ? 'bg-panel-bg text-system-blue shadow-sm ring-1 ring-border-black/60 dark:bg-segmented-active dark:text-white'
              : ''
          }`}
        >
          <Icon size={15} strokeWidth={isSelected ? 2.2 : 1.9} />
          <span className="sr-only">{option.label}</span>
        </button>
      );
    })}
  </div>
);

const usePressAndHoldStepper = (
  onStep: (direction: 1 | -1) => void,
  repeatIntervalMs: number = PROPERTY_EDITOR_STEPPER_REPEAT_INTERVAL_MS,
) => {
  const holdTimeoutRef = useRef<number | null>(null);
  const holdIntervalRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

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

  const stopPressAndHold = useCallback(() => {
    clearTimers();
  }, [clearTimers]);

  useEffect(() => clearTimers, [clearTimers]);

  const startPressAndHold = useCallback(
    (direction: 1 | -1) => {
      clearTimers();
      suppressClickRef.current = true;
      onStep(direction);
      holdTimeoutRef.current = window.setTimeout(() => {
        holdIntervalRef.current = window.setInterval(() => {
          onStep(direction);
        }, repeatIntervalMs);
      }, PROPERTY_EDITOR_STEPPER_REPEAT_DELAY_MS);
    },
    [clearTimers, onStep, repeatIntervalMs],
  );

  const stepperButtonProps = useCallback(
    (direction: 1 | -1, label: string) => ({
      type: 'button' as const,
      'aria-label': label,
      onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        startPressAndHold(direction);
      },
      onPointerUp: (e: React.PointerEvent<HTMLButtonElement>) => {
        if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
          e.currentTarget.releasePointerCapture?.(e.pointerId);
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
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        if (suppressClickRef.current) {
          suppressClickRef.current = false;
          e.preventDefault();
          return;
        }
        onStep(direction);
      },
    }),
    [onStep, startPressAndHold, stopPressAndHold],
  );

  return { stepperButtonProps };
};

const useInputSelectionBehavior = () => {
  const inputRef = useRef<HTMLInputElement>(null);
  const pointerFocusIntentRef = useRef(false);

  const clearPointerFocusIntent = useCallback(() => {
    pointerFocusIntentRef.current = false;
  }, []);

  const handleInputPointerDown = useCallback(() => {
    pointerFocusIntentRef.current = true;
  }, []);

  const handleInputFocus = useCallback(
    (event: React.FocusEvent<HTMLInputElement>) => {
      if (!pointerFocusIntentRef.current) {
        event.target.select();
      }
      clearPointerFocusIntent();
    },
    [clearPointerFocusIntent],
  );

  const collapseInputSelection = useCallback(() => {
    clearPointerFocusIntent();
    const input = inputRef.current;
    if (!input || document.activeElement !== input) {
      return;
    }

    const caretPosition = input.value.length;
    input.setSelectionRange(caretPosition, caretPosition);
  }, [clearPointerFocusIntent]);

  return {
    inputRef,
    handleInputFocus,
    handleInputPointerDown,
    clearPointerFocusIntent,
    collapseInputSelection,
  };
};

const clampNumberToBounds = (value: number, min?: number, max?: number): number => {
  let nextValue = value;

  if (min !== undefined) {
    nextValue = Math.max(min, nextValue);
  }

  if (max !== undefined) {
    nextValue = Math.min(max, nextValue);
  }

  return nextValue;
};

type NumberInputDisplayFormatter = (value: number) => string;
type NumberInputDisplayParser = (value: string) => number | null;

const useNumberInputController = ({
  value,
  onChange,
  step,
  precision,
  commitPrecision = precision,
  trimTrailingZeros,
  minimumIntegerDigits = 1,
  formatDisplayValue,
  parseDisplayValue,
  min,
  max,
  commitOnBlurOnly = false,
  inputRef,
  collapseInputSelection,
}: {
  value: number;
  onChange: (val: number) => void;
  step: number;
  precision: number;
  commitPrecision?: number;
  trimTrailingZeros: boolean;
  minimumIntegerDigits?: number;
  formatDisplayValue?: NumberInputDisplayFormatter;
  parseDisplayValue?: NumberInputDisplayParser;
  min?: number;
  max?: number;
  commitOnBlurOnly?: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  collapseInputSelection: () => void;
}) => {
  const [isFocused, setIsFocused] = useState(false);

  const formatValue = useCallback(
    (nextValue: number, activeFocus = isFocused) => {
      if (!Number.isFinite(nextValue)) {
        return '';
      }

      if (formatDisplayValue) {
        return formatDisplayValue(nextValue ?? 0);
      }

      const activePrecision = activeFocus ? MAX_PROPERTY_DECIMALS : precision;

      const roundedValue = roundToMaxDecimals(nextValue ?? 0, activePrecision);

      if (trimTrailingZeros) {
        return formatNumberWithMaxDecimals(roundedValue, activePrecision) || '0';
      }

      const fixedValue = roundedValue.toFixed(activePrecision);
      const isNegative = fixedValue.startsWith('-');
      const unsignedValue = isNegative ? fixedValue.slice(1) : fixedValue;
      const [integerPart, decimalPart] = unsignedValue.split('.');
      const paddedIntegerPart = integerPart.padStart(minimumIntegerDigits, '0');
      return `${isNegative ? '-' : ''}${paddedIntegerPart}${decimalPart !== undefined ? `.${decimalPart}` : ''}`;
    },
    [formatDisplayValue, minimumIntegerDigits, precision, trimTrailingZeros, isFocused],
  );
  const parseValue = useCallback(
    (nextDraftValue: string) => {
      const parsedValue = parseDisplayValue
        ? parseDisplayValue(nextDraftValue)
        : Number.parseFloat(nextDraftValue);

      return Number.isFinite(parsedValue) ? parsedValue : null;
    },
    [parseDisplayValue],
  );
  const [localValue, setLocalValue] = useState<string>(() => formatValue(value ?? 0, false));
  const valueRef = useRef<number>(value ?? 0);
  const latestCommittedValueRef = useRef<number>(value ?? 0);
  const draftValueRef = useRef<string>(formatValue(value ?? 0, false));

  useEffect(() => {
    const boundedValue = clampNumberToBounds(value ?? 0, min, max);
    const formattedValue = formatValue(boundedValue, isFocused);

    valueRef.current = boundedValue;
    latestCommittedValueRef.current = boundedValue;

    if (document.activeElement !== inputRef.current) {
      draftValueRef.current = formattedValue;
      setLocalValue(formattedValue);
    }
  }, [formatValue, inputRef, max, min, value, isFocused]);

  const commitValue = useCallback(
    (nextValue: number, options?: { preserveDraftDisplay?: boolean }) => {
      const roundedInput = roundToMaxDecimals(nextValue, commitPrecision);
      const normalizedValue = roundToMaxDecimals(
        clampNumberToBounds(roundedInput, min, max),
        commitPrecision,
      );
      const formattedValue = formatValue(normalizedValue);

      latestCommittedValueRef.current = normalizedValue;
      draftValueRef.current = formattedValue;

      if (normalizedValue !== valueRef.current) {
        valueRef.current = normalizedValue;
        onChange(normalizedValue);
      }

      if (!options?.preserveDraftDisplay) {
        setLocalValue(formattedValue);
      }

      return {
        formattedValue,
        normalizedValue,
        wasClamped: normalizedValue !== roundedInput,
      };
    },
    [commitPrecision, formatValue, max, min, onChange],
  );

  const revertToCommittedValue = useCallback(
    (activeFocus = isFocused) => {
      const formattedValue = formatValue(valueRef.current, activeFocus);
      draftValueRef.current = formattedValue;
      setLocalValue(formattedValue);
    },
    [formatValue, isFocused],
  );

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    const formattedValue = formatValue(valueRef.current, true);
    draftValueRef.current = formattedValue;
    setLocalValue(formattedValue);
  }, [formatValue]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);

    if (
      draftValueRef.current === formatValue(valueRef.current, true) ||
      draftValueRef.current === formatValue(valueRef.current, false)
    ) {
      revertToCommittedValue(false);
      return;
    }

    const parsed = parseValue(draftValueRef.current);
    if (parsed !== null) {
      commitValue(parsed);
      return;
    }

    revertToCommittedValue(false);
  }, [commitValue, parseValue, revertToCommittedValue, formatValue]);

  const applyStep = useCallback(
    (direction: 1 | -1) => {
      collapseInputSelection();
      const parsed = parseValue(draftValueRef.current);
      const baseValue =
        parsed !== null ? clampNumberToBounds(parsed, min, max) : latestCommittedValueRef.current;
      commitValue(baseValue + direction * step);
    },
    [collapseInputSelection, commitValue, max, min, parseValue, step],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
        return;
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        applyStep(1);
        return;
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        applyStep(-1);
      }
    },
    [applyStep],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const nextDraftValue = e.target.value;
      draftValueRef.current = nextDraftValue;
      setLocalValue(nextDraftValue);

      const parsed = parseValue(nextDraftValue);
      if (parsed === null) {
        return;
      }

      if (commitOnBlurOnly) {
        return;
      }

      const { formattedValue, wasClamped } = commitValue(parsed, {
        preserveDraftDisplay: true,
      });

      if (wasClamped) {
        draftValueRef.current = formattedValue;
        setLocalValue(formattedValue);
      }
    },
    [commitOnBlurOnly, commitValue, parseValue],
  );

  return {
    applyStep,
    handleBlur,
    handleFocus,
    handleChange,
    handleKeyDown,
    localValue,
  };
};

export const NumberInput = ({
  value,
  onChange,
  label,
  suffix,
  step = 0.1,
  compact = false,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
  trimTrailingZeros = true,
  minimumIntegerDigits,
  formatDisplayValue,
  parseDisplayValue,
  min,
  max,
  commitOnBlurOnly = false,
  repeatIntervalMs,
}: {
  value: number;
  onChange: (val: number) => void;
  label?: string;
  suffix?: string;
  step?: number;
  compact?: boolean;
  precision?: number;
  commitPrecision?: number;
  trimTrailingZeros?: boolean;
  minimumIntegerDigits?: number;
  formatDisplayValue?: NumberInputDisplayFormatter;
  parseDisplayValue?: NumberInputDisplayParser;
  min?: number;
  max?: number;
  commitOnBlurOnly?: boolean;
  repeatIntervalMs?: number;
}) => {
  const {
    inputRef,
    handleInputFocus,
    handleInputPointerDown,
    clearPointerFocusIntent,
    collapseInputSelection,
  } = useInputSelectionBehavior();
  const { applyStep, handleBlur, handleFocus, handleChange, handleKeyDown, localValue } =
    useNumberInputController({
      value,
      onChange,
      step,
      precision,
      commitPrecision,
      trimTrailingZeros,
      minimumIntegerDigits,
      formatDisplayValue,
      parseDisplayValue,
      min,
      max,
      commitOnBlurOnly,
      inputRef,
      collapseInputSelection,
    });

  const { stepperButtonProps } = usePressAndHoldStepper(applyStep, repeatIntervalMs);

  return (
    <div className="flex flex-col">
      {label && <span className={`${PROPERTY_EDITOR_SUBLABEL_CLASS} mb-0.5`}>{label}</span>}
      <div
        className={
          compact
            ? PROPERTY_EDITOR_COMPACT_NUMBER_FIELD_SHELL_CLASS
            : PROPERTY_EDITOR_NUMBER_FIELD_SHELL_CLASS
        }
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={localValue}
          onChange={handleChange}
          onBlur={() => {
            clearPointerFocusIntent();
            handleBlur();
          }}
          onFocus={(e) => {
            handleFocus();
            handleInputFocus(e);
          }}
          onKeyDown={handleKeyDown}
          onPointerDown={handleInputPointerDown}
          onPointerUp={clearPointerFocusIntent}
          onPointerCancel={clearPointerFocusIntent}
          className={`min-w-0 flex-1 bg-transparent leading-4 text-text-primary tabular-nums outline-none ${
            compact ? 'px-1.5 text-[10px]' : 'px-1.5 text-[10px]'
          }`}
        />
        {suffix ? (
          <span className="shrink-0 border-l border-border-black/60 px-1 text-[8px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
            {suffix}
          </span>
        ) : null}
        <div className={PROPERTY_EDITOR_STEPPER_RAIL_CLASS}>
          <button
            {...stepperButtonProps(1, label ? `Increase ${label}` : 'Increase value')}
            className={PROPERTY_EDITOR_STEPPER_BUTTON_CLASS}
          >
            <Plus className="h-[7px] w-[7px]" />
          </button>
          <button
            {...stepperButtonProps(-1, label ? `Decrease ${label}` : 'Decrease value')}
            className={`${PROPERTY_EDITOR_STEPPER_BUTTON_CLASS} border-t border-border-black/60`}
          >
            <Minus className="h-[7px] w-[7px]" />
          </button>
        </div>
      </div>
    </div>
  );
};

export interface Vec3Value {
  x?: number;
  y?: number;
  z?: number;
  r?: number;
  p?: number;
}

export const InlineNumberInput = ({
  value,
  onChange,
  label,
  step = 0.1,
  compact = false,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
  trimTrailingZeros = true,
  minimumIntegerDigits,
  formatDisplayValue,
  parseDisplayValue,
  min,
  max,
  repeatIntervalMs,
}: {
  value: number;
  onChange: (val: number) => void;
  label: string;
  step?: number;
  compact?: boolean;
  precision?: number;
  commitPrecision?: number;
  trimTrailingZeros?: boolean;
  minimumIntegerDigits?: number;
  formatDisplayValue?: NumberInputDisplayFormatter;
  parseDisplayValue?: NumberInputDisplayParser;
  min?: number;
  max?: number;
  repeatIntervalMs?: number;
}) => {
  const {
    inputRef,
    handleInputFocus,
    handleInputPointerDown,
    clearPointerFocusIntent,
    collapseInputSelection,
  } = useInputSelectionBehavior();
  const { applyStep, handleBlur, handleFocus, handleChange, handleKeyDown, localValue } =
    useNumberInputController({
      value,
      onChange,
      step,
      precision,
      commitPrecision,
      trimTrailingZeros,
      minimumIntegerDigits,
      formatDisplayValue,
      parseDisplayValue,
      min,
      max,
      inputRef,
      collapseInputSelection,
    });

  const { stepperButtonProps } = usePressAndHoldStepper(applyStep, repeatIntervalMs);

  return (
    <div className="min-w-0">
      <div
        className={
          compact
            ? PROPERTY_EDITOR_COMPACT_NUMBER_FIELD_SHELL_CLASS
            : PROPERTY_EDITOR_NUMBER_FIELD_SHELL_CLASS
        }
      >
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={localValue}
          onChange={handleChange}
          onBlur={() => {
            clearPointerFocusIntent();
            handleBlur();
          }}
          onFocus={(e) => {
            handleFocus();
            handleInputFocus(e);
          }}
          onKeyDown={handleKeyDown}
          onPointerDown={handleInputPointerDown}
          onPointerUp={clearPointerFocusIntent}
          onPointerCancel={clearPointerFocusIntent}
          aria-label={label}
          className={`min-w-0 flex-1 bg-transparent leading-4 text-text-primary tabular-nums outline-none ${
            compact ? 'px-1.5 text-[10px]' : 'px-1.5 text-[10px]'
          }`}
        />
        <div className={PROPERTY_EDITOR_STEPPER_RAIL_CLASS}>
          <button
            {...stepperButtonProps(1, `Increase ${label}`)}
            className={PROPERTY_EDITOR_STEPPER_BUTTON_CLASS}
          >
            <Plus className="h-[7px] w-[7px]" />
          </button>
          <button
            {...stepperButtonProps(-1, `Decrease ${label}`)}
            className={`${PROPERTY_EDITOR_STEPPER_BUTTON_CLASS} border-t border-border-black/60`}
          >
            <Minus className="h-[7px] w-[7px]" />
          </button>
        </div>
      </div>
    </div>
  );
};

export const AxisNumberGridInput = <T extends string>({
  value,
  onChange,
  labels,
  keys,
  compact = false,
  labelPlacement = 'stacked',
  step,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
  trimTrailingZeros = true,
  minimumIntegerDigits,
  formatDisplayValue,
  parseDisplayValue,
  repeatIntervalMs,
}: {
  value: Partial<Record<T, number>>;
  onChange: (v: Partial<Record<T, number>>) => void;
  labels: string[];
  keys: readonly T[];
  compact?: boolean;
  labelPlacement?: 'stacked' | 'inline';
  step?: number;
  precision?: number;
  commitPrecision?: number;
  trimTrailingZeros?: boolean;
  minimumIntegerDigits?: number;
  formatDisplayValue?: NumberInputDisplayFormatter;
  parseDisplayValue?: NumberInputDisplayParser;
  repeatIntervalMs?: number;
}) => {
  if (labelPlacement === 'inline') {
    return (
      <div
        className="grid min-w-0 gap-1.5"
        style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
      >
        {keys.map((key, index) => (
          <div key={String(key)} className="flex min-w-0 items-center gap-1.5">
            <span
              className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} min-w-0 shrink truncate text-right`}
              title={labels[index] ?? String(key)}
            >
              {labels[index] ?? String(key)}
            </span>
            <div className="min-w-0 flex-1">
              <InlineNumberInput
                label={labels[index] ?? String(key)}
                value={value[key] ?? 0}
                onChange={(nextValue) => onChange({ ...value, [key]: nextValue })}
                compact={compact}
                step={step}
                precision={precision}
                commitPrecision={commitPrecision}
                trimTrailingZeros={trimTrailingZeros}
                minimumIntegerDigits={minimumIntegerDigits}
                formatDisplayValue={formatDisplayValue}
                parseDisplayValue={parseDisplayValue}
                repeatIntervalMs={repeatIntervalMs}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
      >
        {labels.map((label) => (
          <span key={label} className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} text-center`}>
            {label}
          </span>
        ))}
      </div>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))` }}
      >
        {keys.map((key, index) => (
          <InlineNumberInput
            key={String(key)}
            label={labels[index] ?? String(key)}
            value={value[key] ?? 0}
            onChange={(nextValue) => onChange({ ...value, [key]: nextValue })}
            compact={compact}
            step={step}
            precision={precision}
            commitPrecision={commitPrecision}
            trimTrailingZeros={trimTrailingZeros}
            minimumIntegerDigits={minimumIntegerDigits}
            formatDisplayValue={formatDisplayValue}
            parseDisplayValue={parseDisplayValue}
            repeatIntervalMs={repeatIntervalMs}
          />
        ))}
      </div>
    </div>
  );
};

export const Vec3Input = ({
  value,
  onChange,
  labels,
  keys = ['x', 'y', 'z'],
  compact = false,
  step,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
}: {
  value: Vec3Value;
  onChange: (v: Vec3Value) => void;
  labels: string[];
  keys?: string[];
  compact?: boolean;
  step?: number;
  precision?: number;
  commitPrecision?: number;
}) => (
  <div className="grid grid-cols-3 gap-1.5">
    <NumberInput
      label={labels[0]}
      value={(value as Record<string, number>)[keys[0]] ?? 0}
      onChange={(v: number) => onChange({ ...value, [keys[0]]: v })}
      compact={compact}
      step={step}
      precision={precision}
      commitPrecision={commitPrecision}
    />
    <NumberInput
      label={labels[1]}
      value={(value as Record<string, number>)[keys[1]] ?? 0}
      onChange={(v: number) => onChange({ ...value, [keys[1]]: v })}
      compact={compact}
      step={step}
      precision={precision}
      commitPrecision={commitPrecision}
    />
    <NumberInput
      label={labels[2]}
      value={(value as Record<string, number>)[keys[2]] ?? 0}
      onChange={(v: number) => onChange({ ...value, [keys[2]]: v })}
      compact={compact}
      step={step}
      precision={precision}
      commitPrecision={commitPrecision}
    />
  </div>
);

export const Vec3InlineInput = ({
  value,
  onChange,
  labels,
  keys = ['x', 'y', 'z'],
  compact = false,
  labelPlacement = 'inline',
  step,
  precision = MAX_PROPERTY_DECIMALS,
  commitPrecision,
  repeatIntervalMs,
}: {
  value: Vec3Value;
  onChange: (v: Vec3Value) => void;
  labels: string[];
  keys?: readonly string[];
  compact?: boolean;
  labelPlacement?: 'stacked' | 'inline';
  step?: number;
  precision?: number;
  commitPrecision?: number;
  repeatIntervalMs?: number;
}) => (
  <AxisNumberGridInput
    value={value as Record<string, number>}
    onChange={(nextValue) => onChange(nextValue as Vec3Value)}
    labels={labels}
    keys={keys}
    compact={compact}
    labelPlacement={labelPlacement}
    step={step}
    precision={precision}
    commitPrecision={commitPrecision}
    repeatIntervalMs={repeatIntervalMs}
  />
);
