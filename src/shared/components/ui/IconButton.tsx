import React from 'react';
import { Tooltip } from './Tooltip';

type IconButtonVariant = 'ghost' | 'close' | 'toolbar' | 'solid';
type IconButtonTone = 'neutral' | 'danger' | 'success';
type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: IconButtonVariant;
  tone?: IconButtonTone;
  size?: IconButtonSize;
  isActive?: boolean;
}

const SIZE_CLASSES: Record<IconButtonSize, string> = {
  sm: 'p-1',
  md: 'p-1.5',
};

const SOLID_TONE_CLASSES: Record<IconButtonTone, string> = {
  neutral:
    'bg-element-bg hover:bg-element-hover active:bg-element-active text-text-primary shadow-sm',
  danger: 'bg-danger hover:bg-danger-hover active:bg-danger-active text-white shadow-sm',
  success: 'bg-success hover:bg-success-hover active:bg-success-active text-white shadow-sm',
};

export const IconButton: React.FC<IconButtonProps> = ({
  variant = 'ghost',
  tone = 'neutral',
  size = 'md',
  isActive = false,
  className = '',
  type = 'button',
  title,
  'aria-label': ariaLabel,
  ...props
}) => {
  const baseClasses =
    'inline-flex items-center justify-center rounded-md transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 disabled:opacity-50 disabled:cursor-not-allowed';

  let variantClasses = '';
  if (variant === 'close') {
    variantClasses = 'text-text-tertiary hover:bg-danger hover:text-white active:bg-danger-hover';
  } else if (variant === 'toolbar') {
    variantClasses = isActive
      ? 'bg-system-blue/10 text-system-blue ring-1 ring-system-blue/20 dark:bg-system-blue/15 dark:text-slate-100 dark:ring-system-blue/30'
      : 'text-text-tertiary hover:bg-slate-100/70 hover:text-text-primary dark:hover:bg-element-bg dark:hover:text-slate-100';
  } else if (variant === 'solid') {
    variantClasses = SOLID_TONE_CLASSES[tone];
  } else {
    variantClasses = 'text-text-tertiary hover:bg-element-hover hover:text-text-primary';
  }

  const button = (
    <button
      type={type}
      aria-label={
        ariaLabel ?? (typeof title === 'string' && title.trim().length > 0 ? title : undefined)
      }
      className={`${baseClasses} ${SIZE_CLASSES[size]} ${variantClasses} ${className}`.trim()}
      {...props}
    />
  );

  if (typeof title === 'string' && title.trim().length > 0) {
    return <Tooltip content={title}>{button}</Tooltip>;
  }

  return button;
};
