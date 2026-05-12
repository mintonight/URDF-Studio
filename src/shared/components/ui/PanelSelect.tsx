import React from 'react';

import { Select, type SelectOption } from './Select';

export type PanelSelectVariant = 'panel' | 'compact' | 'snapshot' | 'property' | 'dense';

interface PanelSelectProps extends Omit<React.ComponentProps<typeof Select>, 'options'> {
  options: readonly SelectOption[];
  variant?: PanelSelectVariant;
}

const COMPACT_PANEL_SELECT_CLASSNAME =
  'h-[25px] rounded-md border-border-black bg-input-bg !px-2 !py-0 !pr-7 !text-[11px] font-medium leading-none shadow-sm';
const COMPACT_PANEL_SELECT_OPTION_CLASSNAME = 'text-[11px] leading-none';
const DENSE_PANEL_SELECT_CLASSNAME =
  'h-[21px] rounded-md border-border-black/70 bg-input-bg !px-1.5 !py-0 !pr-6 text-[10px] font-medium leading-none shadow-none';
const DENSE_PANEL_SELECT_OPTION_CLASSNAME = 'text-[10px] leading-none';

const PANEL_SELECT_CLASSNAME_BY_VARIANT: Record<PanelSelectVariant, string> = {
  panel:
    'h-8 rounded-[6px] border-border-black bg-panel-bg px-2.5 py-0 pr-8 text-[12px] font-medium shadow-sm',
  compact: COMPACT_PANEL_SELECT_CLASSNAME,
  snapshot: COMPACT_PANEL_SELECT_CLASSNAME,
  dense: DENSE_PANEL_SELECT_CLASSNAME,
  property:
    'h-[22px] w-full rounded-md border-border-strong bg-input-bg px-1.5 py-0 pr-7 text-[10px] leading-4 text-text-primary [padding-top:0] [padding-bottom:0]',
};

const PANEL_SELECT_OPTION_CLASSNAME_BY_VARIANT: Record<PanelSelectVariant, string> = {
  panel: 'text-[12px]',
  compact: COMPACT_PANEL_SELECT_OPTION_CLASSNAME,
  snapshot: COMPACT_PANEL_SELECT_OPTION_CLASSNAME,
  dense: DENSE_PANEL_SELECT_OPTION_CLASSNAME,
  property: 'text-[10px] leading-4',
};

const PANEL_SELECT_MENU_CLASSNAME_BY_VARIANT: Record<PanelSelectVariant, string> = {
  panel: '',
  compact: '',
  snapshot: '',
  dense: 'rounded-md border-border-strong bg-panel-bg p-0.5 shadow-lg',
  property: 'rounded-md border-border-strong bg-panel-bg p-0.5 shadow-lg',
};

const PANEL_SELECT_OPTION_BUTTON_CLASSNAME_BY_VARIANT: Record<PanelSelectVariant, string> = {
  panel: 'rounded-lg px-2.5 py-1.5',
  compact: 'rounded-lg px-2 py-1.5',
  snapshot: 'rounded-lg px-2 py-1.5',
  dense: 'rounded-[5px] px-1.5 py-1',
  property: 'rounded-[5px] px-1.5 py-1',
};

export function PanelSelect({
  options,
  variant = 'panel',
  className = '',
  ...props
}: PanelSelectProps) {
  return (
    <Select
      options={options}
      className={`${PANEL_SELECT_CLASSNAME_BY_VARIANT[variant]} ${className}`.trim()}
      menuClassName={PANEL_SELECT_MENU_CLASSNAME_BY_VARIANT[variant]}
      optionClassName={PANEL_SELECT_OPTION_CLASSNAME_BY_VARIANT[variant]}
      optionButtonClassName={PANEL_SELECT_OPTION_BUTTON_CLASSNAME_BY_VARIANT[variant]}
      {...props}
    />
  );
}
