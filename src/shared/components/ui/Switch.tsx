import React from 'react';

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  labelClassName?: string;
}

export const Switch: React.FC<SwitchProps> = ({
  checked,
  onChange,
  label,
  ariaLabel,
  disabled = false,
  size = 'md',
  className = '',
  labelClassName = '',
}) => {
  const hasCommittedRef = React.useRef(false);
  const previousCheckedRef = React.useRef(checked);
  const handleToggle = () => {
    if (!disabled) {
      onChange(!checked);
    }
  };
  const shouldAnimateStateChange =
    hasCommittedRef.current && previousCheckedRef.current !== checked;

  React.useLayoutEffect(() => {
    hasCommittedRef.current = true;
    previousCheckedRef.current = checked;
  }, [checked]);

  // Desktop-friendly compact sizes with proper alignment
  const desktopSizes = {
    sm: {
      switch: 'h-4 w-8',
      dot: 'h-3 w-3',
      translate: 'translate-x-4',
    },
    md: {
      switch: 'h-6 w-11',
      dot: 'h-5 w-5',
      translate: 'translate-x-5',
    },
  };
  const resolvedAriaLabel =
    ariaLabel ??
    (typeof label === 'string' || typeof label === 'number' ? String(label) : undefined);

  return (
    <div className={`flex items-center justify-between ${className}`}>
      {label && (
        <button
          type="button"
          className={`border-0 bg-transparent p-0 text-left select-none cursor-pointer text-xs font-medium text-text-secondary disabled:cursor-not-allowed disabled:opacity-50 ${labelClassName}`}
          onClick={handleToggle}
          disabled={disabled}
        >
          {label}
        </button>
      )}
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={resolvedAriaLabel}
        onClick={handleToggle}
        disabled={disabled}
        className={`
          relative inline-flex items-center shrink-0 cursor-pointer rounded-full border border-transparent ${shouldAnimateStateChange ? 'transition-[background-color,border-color] duration-200 ease-in-out' : 'transition-none'} focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 p-0.5
          ${checked ? 'bg-system-blue-solid' : 'bg-switch-off'}
          ${checked ? 'border-system-blue-solid' : 'border-border-strong/70'}
          ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          ${desktopSizes[size].switch}
        `}
      >
        <span
          className={`
            pointer-events-none inline-block transform rounded-full border border-border-black/10 bg-switch-thumb shadow-sm ring-0
            ${shouldAnimateStateChange ? 'transition duration-200 ease-in-out' : 'transition-none'}
            ${checked ? desktopSizes[size].translate : 'translate-x-0'}
            ${desktopSizes[size].dot}
          `}
        />
      </button>
    </div>
  );
};
