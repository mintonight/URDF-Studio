import React from 'react';

export interface SegmentedControlOption<T> {
  value: T;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
}

interface SegmentedControlProps<T> {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  disabled?: boolean;
  stretch?: boolean;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  size = 'sm',
  className = '',
  disabled = false,
  stretch = true,
}: SegmentedControlProps<T>) {
  const containerPadding = 'p-0.5';
  const itemPadding =
    size === 'xs'
      ? stretch
        ? 'py-0.5'
        : 'px-6 py-1.5'
      : size === 'sm'
        ? stretch
          ? 'py-1'
          : 'px-4 py-1'
        : stretch
          ? 'py-1.5'
          : 'px-4 py-1.5';
  const textSize = size === 'xs' ? 'text-[11px]' : size === 'sm' ? 'text-[13px]' : 'text-sm';
  const iconSize = size === 'xs' ? 'w-3 h-3' : size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <div
      className={`bg-segmented-bg rounded-lg ${containerPadding} ${
        stretch ? 'flex min-w-0' : 'inline-flex w-fit max-w-full'
      } ${className}`}
    >
      {options.map((option) => {
        const isSelected = value === option.value;
        return (
          <button
            key={String(option.value)}
            type="button"
            onClick={() => !disabled && !option.disabled && onChange(option.value)}
            disabled={disabled || option.disabled}
            title={option.label}
            className={`
              ${stretch ? 'min-w-0 flex-1' : 'flex-none'} relative flex min-w-0 items-center justify-center gap-1.5 overflow-hidden
              ${itemPadding} ${textSize} font-medium rounded-md
              transition-all duration-200
              disabled:opacity-50 disabled:cursor-not-allowed
              ${
                isSelected
                  ? 'bg-segmented-active text-text-primary shadow-sm'
                  : 'text-text-tertiary hover:text-text-primary'
              }
            `}
          >
            {option.icon && (
              <span
                className={`${isSelected ? 'text-current' : 'opacity-70'} ${iconSize} shrink-0 flex items-center justify-center`}
              >
                {option.icon}
              </span>
            )}
            <span className="min-w-0 truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
