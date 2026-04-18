import type { CSSProperties } from 'react';
import { ArrowRightLeft, Lock, Move3D, Plane, RefreshCw, RotateCw } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n';
import { JointType } from '@/types';

export const TREE_LINK_NAME_TEXT_CLASS = 'text-[11px] leading-none font-medium';
export const TREE_JOINT_NAME_TEXT_CLASS = 'text-[11px] leading-none font-medium';
export const TREE_RENAME_INPUT_BASE_CLASS =
  'select-text flex-1 min-w-0 px-1 py-0.5 rounded border outline-none transition-colors';

export function getJointTypeLabel(type: JointType, t: TranslationKeys): string {
  switch (type) {
    case JointType.FIXED:
      return t.jointTypeFixed;
    case JointType.REVOLUTE:
      return t.jointTypeRevolute;
    case JointType.CONTINUOUS:
      return t.jointTypeContinuous;
    case JointType.BALL:
      return 'Ball';
    case JointType.PRISMATIC:
      return t.jointTypePrismatic;
    case JointType.PLANAR:
      return t.jointTypePlanar;
    case JointType.FLOATING:
      return t.jointTypeFloating;
    default:
      return type;
  }
}

export function getJointTypeIcon(type: JointType) {
  switch (type) {
    case JointType.FIXED:
      return Lock;
    case JointType.REVOLUTE:
      return RotateCw;
    case JointType.CONTINUOUS:
      return RefreshCw;
    case JointType.BALL:
      return Move3D;
    case JointType.PRISMATIC:
      return ArrowRightLeft;
    case JointType.PLANAR:
      return Plane;
    case JointType.FLOATING:
      return Move3D;
    default:
      return ArrowRightLeft;
  }
}

export function scrollElementIntoView(element: HTMLElement | null) {
  if (!element) return;
  window.requestAnimationFrame(() => {
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

const treeRowHoverClass =
  'hover:bg-system-blue/10 hover:text-text-primary hover:ring-1 hover:ring-inset hover:ring-system-blue/15 dark:hover:bg-system-blue/20 dark:hover:ring-system-blue/25';
const treeRowHoveredClass =
  'bg-system-blue/10 text-text-primary ring-1 ring-inset ring-system-blue/15 dark:bg-system-blue/18 dark:ring-system-blue/25';
const treeRowSelectedClass =
  'bg-system-blue/10 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue/20 dark:bg-system-blue/20 dark:ring-system-blue/30';
const treeRowAttentionClass =
  'bg-system-blue/15 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue/30 dark:bg-system-blue/25 dark:ring-system-blue/40';

export function resolveTreeRowStateClass(
  baseClassName: string,
  state: {
    isHovered: boolean;
    isSelected: boolean;
    isAttentionHighlighted: boolean;
  },
) {
  if (state.isAttentionHighlighted) {
    return `${treeRowAttentionClass} ${baseClassName}`;
  }
  if (state.isSelected) {
    return `${treeRowSelectedClass} ${baseClassName}`;
  }
  if (state.isHovered) {
    return `${treeRowHoveredClass} ${baseClassName}`;
  }
  return `${treeRowHoverClass} ${baseClassName}`;
}

export function getTreeConnectorRailClass(emphasized: boolean): string {
  return emphasized
    ? 'bg-system-blue/20 dark:bg-system-blue/28'
    : 'bg-border-black/45 dark:bg-border-strong/45';
}

export function getTreeConnectorElbowClass(emphasized: boolean): string {
  return emphasized
    ? 'absolute rounded-bl-md border-b border-l border-system-blue/50 dark:border-system-blue/60'
    : 'absolute rounded-bl-md border-b border-l border-border-strong/70 dark:border-border-strong/60';
}

export function getTreeConnectorElbowStyle(indentPx: number): CSSProperties {
  return {
    left: `${indentPx * -1}px`,
    top: 'calc(50% - 8px)',
    width: `${indentPx}px`,
    height: '8px',
  };
}

export function getGeometryVisibilityButtonClass(
  active: boolean,
  options?: { inheritedHidden?: boolean },
): string {
  const inheritedHidden = options?.inheritedHidden === true;

  return `p-1 rounded transition-colors ${
    inheritedHidden
      ? 'text-text-tertiary/70 hover:text-text-secondary hover:bg-element-hover ring-1 ring-inset ring-border-black/40'
      : active
        ? 'text-text-tertiary hover:text-text-primary hover:bg-element-hover'
        : 'text-text-secondary hover:text-text-primary hover:bg-element-hover'
  }`;
}
