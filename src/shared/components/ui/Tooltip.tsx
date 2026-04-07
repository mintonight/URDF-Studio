import React from 'react';

type TooltipSide = 'top' | 'bottom';
type TooltipAlign = 'start' | 'center' | 'end';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: TooltipSide;
  align?: TooltipAlign;
  className?: string;
}

function getTooltipPlacementClasses(side: TooltipSide, align: TooltipAlign): string {
  if (side === 'top') {
    if (align === 'start') {
      return 'left-0 bottom-full mb-1.5 -translate-y-0.5 group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0';
    }
    if (align === 'end') {
      return 'right-0 bottom-full mb-1.5 -translate-y-0.5 group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0';
    }
    return 'left-1/2 bottom-full mb-1.5 -translate-x-1/2 -translate-y-0.5 group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0';
  }

  if (align === 'start') {
    return 'left-0 top-full mt-1.5 translate-y-0.5 group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0';
  }
  if (align === 'end') {
    return 'right-0 top-full mt-1.5 translate-y-0.5 group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0';
  }
  return 'left-1/2 top-full mt-1.5 -translate-x-1/2 translate-y-0.5 group-hover/tooltip:translate-y-0 group-focus-within/tooltip:translate-y-0';
}

export function Tooltip({
  content,
  children,
  side = 'bottom',
  align = 'center',
  className = '',
}: TooltipProps) {
  if (content == null || content === false || content === '') {
    return children;
  }

  return (
    <span className="group/tooltip relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute z-[260] w-max max-w-[18rem] rounded-md border border-border-black bg-element-active px-2 py-1.5 text-[9px] font-medium leading-4 whitespace-pre-line text-text-primary shadow-md opacity-0 transition-[opacity,transform] duration-100 ease-out group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${getTooltipPlacementClasses(
          side,
          align,
        )} ${className}`.trim()}
      >
        {content}
      </span>
    </span>
  );
}
