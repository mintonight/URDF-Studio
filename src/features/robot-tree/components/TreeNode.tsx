import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Eye,
  EyeOff,
  Plus,
  Shapes,
  Shield,
  Trash2,
} from 'lucide-react';

import {
  getCollisionGeometryEntries,
  getVisualGeometryEntries,
} from '@/core/robot';
import type { CollisionGeometryEntry } from '@/core/robot/collisionBodies';
import type { VisualGeometryEntry } from '@/core/robot/visualBodies';
import type { TranslationKeys } from '@/shared/i18n';
import {
  getMjcfJointDisplayName,
  getMjcfLinkDisplayName,
} from '@/shared/utils/robot/mjcfDisplayNames';
import { useSelectionStore } from '@/store/selectionStore';
import type { WorkspacePropertyPatch } from '@/store/workspace/types';
import { areEntityRefsEqual } from '@/types';
import type {
  AppMode,
  EntityRef,
  RobotData,
  UrdfJoint,
  WorkspaceSelection,
} from '@/types';
import {
  getGeometryVisibilityButtonClass,
  getJointTypeIcon,
  getJointTypeLabel,
  getTreeConnectorElbowClass,
  getTreeConnectorElbowStyle,
  getTreeConnectorRailClass,
  resolveTreeRowStateClass,
  TREE_JOINT_NAME_TEXT_CLASS,
  TREE_LINK_NAME_TEXT_CLASS,
  TREE_RENAME_INPUT_BASE_CLASS,
} from './tree-node/presentation';
import { stripTreeDisplayNamePrefix } from './tree-node/treeDisplayNames';

type LinkRef = Extract<EntityRef, { type: 'link' }>;
type JointRef = Extract<EntityRef, { type: 'joint' }>;
type GeometryEntry = VisualGeometryEntry | CollisionGeometryEntry;
const EMPTY_ANCESTOR_LINK_IDS = new Set<string>();

export interface TreeNodeProps {
  componentId: string;
  linkId: string;
  robot: RobotData;
  showGeometryDetailsByDefault?: boolean;
  childJointsByParent?: Record<string, UrdfJoint[]>;
  onSelect?: (selection: WorkspaceSelection) => void;
  onHover?: (selection: WorkspaceSelection) => void;
  onSelectGeometry?: (
    ref: LinkRef,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onFocus?: (ref: EntityRef) => void;
  onAddChild: (ref: LinkRef) => void;
  onAddCollisionBody: (ref: LinkRef) => void;
  onDelete: (ref: LinkRef | JointRef) => void;
  onUpdate: (ref: LinkRef | JointRef, patch: WorkspacePropertyPatch) => void;
  mode: AppMode;
  t: TranslationKeys;
  depth?: number;
  readOnly?: boolean;
  ancestorLinkIds?: ReadonlySet<string>;
  componentDisplayNamePrefix?: string;
}

function buildChildJointsByParent(robot: RobotData): Record<string, UrdfJoint[]> {
  const result: Record<string, UrdfJoint[]> = {};
  Object.values(robot.joints).forEach((joint) => {
    (result[joint.parentLinkId] ??= []).push(joint);
  });
  return result;
}

function selectionTargets(selection: WorkspaceSelection, ref: EntityRef): boolean {
  return selection !== null && areEntityRefsEqual(selection.entity, ref);
}

function runOnActivationKey(
  event: React.KeyboardEvent<HTMLElement>,
  action: () => void,
) {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) {
    return;
  }
  event.preventDefault();
  action();
}

function selectionTargetsGeometry(
  selection: WorkspaceSelection,
  ref: LinkRef,
  subType: 'visual' | 'collision',
  objectIndex: number,
): boolean {
  return selectionTargets(selection, ref)
    && selection?.subType === subType
    && (selection.objectIndex ?? 0) === objectIndex;
}

function getGeometryLabel(
  entry: GeometryEntry,
  subType: 'visual' | 'collision',
  t: TranslationKeys,
): string {
  const authoredName = entry.geometry.name?.trim();
  if (authoredName) return authoredName;
  const baseLabel = subType === 'visual' ? t.visualGeometry : t.collision;
  return entry.objectIndex === 0 ? baseLabel : `${baseLabel} ${entry.objectIndex + 1}`;
}

export const TreeNode = memo(function TreeNode({
  componentId,
  linkId,
  robot,
  showGeometryDetailsByDefault = false,
  childJointsByParent,
  onSelect,
  onHover,
  onSelectGeometry,
  onFocus,
  onAddChild,
  onAddCollisionBody,
  onDelete,
  onUpdate,
  mode,
  t,
  depth = 0,
  readOnly = false,
  ancestorLinkIds = EMPTY_ANCESTOR_LINK_IDS,
  componentDisplayNamePrefix,
}: TreeNodeProps) {
  const selection = useSelectionStore((state) => state.selection);
  const hoveredSelection = useSelectionStore((state) => state.hoveredSelection);
  const attentionSelection = useSelectionStore((state) => state.attentionSelection);
  const setSelection = useSelectionStore((state) => state.setSelection);
  const setHoveredSelection = useSelectionStore((state) => state.setHoveredSelection);
  const clearHover = useSelectionStore((state) => state.clearHover);
  const setFocusTarget = useSelectionStore((state) => state.setFocusTarget);
  const [expanded, setExpanded] = useState(true);
  const [geometryExpanded, setGeometryExpanded] = useState(showGeometryDetailsByDefault);
  const [editing, setEditing] = useState<LinkRef | JointRef | null>(null);
  const [draft, setDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const link = robot.links[linkId];
  const jointsByParent = useMemo(
    () => childJointsByParent ?? buildChildJointsByParent(robot),
    [childJointsByParent, robot],
  );
  const childJoints = jointsByParent[linkId] ?? [];
  const linkRef: LinkRef = { type: 'link', componentId, entityId: linkId };
  const visualEntries = useMemo(() => link ? getVisualGeometryEntries(link) : [], [link]);
  const collisionEntries = useMemo(
    () => link ? getCollisionGeometryEntries(link) : [],
    [link],
  );
  const nextAncestors = useMemo(
    () => new Set([...ancestorLinkIds, linkId]),
    [ancestorLinkIds, linkId],
  );

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

  useEffect(() => {
    setGeometryExpanded(showGeometryDetailsByDefault);
  }, [showGeometryDetailsByDefault]);

  if (!link || ancestorLinkIds.has(linkId)) return null;

  const dispatchSelection = (next: WorkspaceSelection) => {
    if (onSelect) onSelect(next);
    else setSelection(next);
  };
  const dispatchHover = (next: WorkspaceSelection) => {
    if (onHover) onHover(next);
    else setHoveredSelection(next);
  };
  const clearCanonicalHover = () => {
    if (onHover) onHover(null);
    else clearHover();
  };
  const beginRename = (ref: LinkRef | JointRef, currentName: string) => {
    if (readOnly) return;
    setDraft(currentName);
    setEditing(ref);
  };
  const commitRename = (ref: LinkRef | JointRef, currentName: string) => {
    const name = draft.trim();
    if (name && name !== currentName) onUpdate(ref, { name });
    setEditing(null);
  };
  const focus = (ref: EntityRef) => {
    if (onFocus) onFocus(ref);
    else setFocusTarget(ref);
  };
  const toggleGeometryVisibility = (
    event: React.MouseEvent,
    subType: 'visual' | 'collision',
    entry: GeometryEntry,
  ) => {
    event.stopPropagation();
    const visible = entry.geometry.visible !== false;
    if (subType === 'visual') {
      if (entry.bodyIndex === null) {
        onUpdate(linkRef, { visual: { visible: !visible } });
        return;
      }
      const visualBodies = [...(link.visualBodies ?? [])];
      visualBodies[entry.bodyIndex] = { ...visualBodies[entry.bodyIndex], visible: !visible };
      onUpdate(linkRef, { visualBodies });
      return;
    }
    if (entry.bodyIndex === null) {
      onUpdate(linkRef, { collision: { visible: !visible } });
      return;
    }
    const collisionBodies = [...(link.collisionBodies ?? [])];
    collisionBodies[entry.bodyIndex] = {
      ...collisionBodies[entry.bodyIndex],
      visible: !visible,
    };
    onUpdate(linkRef, { collisionBodies });
  };

  const sourceFormat = robot.inspectionContext?.sourceFormat;
  const rawLinkDisplayName = sourceFormat === 'mjcf'
    ? getMjcfLinkDisplayName(link)
    : link.name;
  const linkDisplayName = stripTreeDisplayNamePrefix(
    rawLinkDisplayName,
    componentDisplayNamePrefix,
  );
  const isLinkSelected = selectionTargets(selection, linkRef);
  const isLinkHovered = selectionTargets(hoveredSelection, linkRef);
  const isLinkAttentionHighlighted = selectionTargets(attentionSelection, linkRef);
  const hasChildren = childJoints.some((joint) => !nextAncestors.has(joint.childLinkId));
  const hasVisual = visualEntries.length > 0;
  const hasCollision = collisionEntries.length > 0;
  const hasGeometry = hasVisual || hasCollision;
  const isLinkVisible = link.visible !== false;
  const linkConnectorHighlighted =
    isLinkSelected || isLinkHovered || isLinkAttentionHighlighted;
  const selectedLinkActionClass =
    'text-system-blue hover:bg-system-blue/15 hover:text-system-blue-hover dark:hover:bg-system-blue/25';

  const renderGeometryRow = (
    subType: 'visual' | 'collision',
    entry: GeometryEntry,
  ) => {
    const target: WorkspaceSelection = {
      entity: linkRef,
      subType,
      objectIndex: entry.objectIndex,
    };
    const selected = selectionTargetsGeometry(selection, linkRef, subType, entry.objectIndex);
    const hovered = selectionTargetsGeometry(
      hoveredSelection,
      linkRef,
      subType,
      entry.objectIndex,
    );
    const attention = selectionTargetsGeometry(
      attentionSelection,
      linkRef,
      subType,
      entry.objectIndex,
    );
    const locallyVisible = entry.geometry.visible !== false;
    const inheritedHidden = !isLinkVisible && locallyVisible;
    const effectivelyVisible = isLinkVisible && locallyVisible;
    const label = getGeometryLabel(entry, subType, t);
    const isVisual = subType === 'visual';

    return (
      <div
        key={`${subType}:${entry.objectIndex}`}
        data-testid={`tree-geometry-${componentId}-${linkId}-${subType}${
          entry.objectIndex === 0 ? '' : `-${entry.objectIndex}`
        }`}
        className={`relative mx-1 my-0.5 flex min-w-0 items-center rounded-md px-2 py-0.5 transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${resolveTreeRowStateClass(
          'text-text-secondary dark:text-text-tertiary',
          { isHovered: hovered, isSelected: selected, isAttentionHighlighted: attention },
        )}`}
        style={{ marginLeft: '12px' }}
        title={label}
        role={readOnly ? undefined : 'button'}
        aria-label={label}
        tabIndex={readOnly ? undefined : 0}
        onClick={readOnly
          ? undefined
          : () => {
              dispatchSelection(target);
              onSelectGeometry?.(linkRef, subType, entry.objectIndex);
            }}
        onKeyDown={readOnly
          ? undefined
          : (event) => runOnActivationKey(event, () => {
              dispatchSelection(target);
              onSelectGeometry?.(linkRef, subType, entry.objectIndex);
            })}
        onMouseEnter={readOnly ? undefined : () => dispatchHover(target)}
        onMouseLeave={readOnly ? undefined : clearCanonicalHover}
      >
        <div
          className={getTreeConnectorElbowClass(selected || hovered || attention)}
          style={getTreeConnectorElbowStyle(12)}
        />
        <div
          className={`mr-1 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors ${
            isVisual
              ? selected || hovered || attention
                ? 'border-emerald-500/20 bg-emerald-500/15 dark:border-emerald-400/20 dark:bg-emerald-400/15'
                : 'border-transparent bg-emerald-500/10 dark:bg-emerald-400/10'
              : selected || hovered || attention
                ? 'border-amber-500/20 bg-amber-500/15 dark:border-amber-400/20 dark:bg-amber-400/15'
                : 'border-transparent bg-amber-500/10 dark:bg-amber-400/10'
          }`}
        >
          {isVisual ? (
            <Shapes size={9} className="text-emerald-600 dark:text-emerald-300" />
          ) : (
            <Shield size={9} className="text-amber-600 dark:text-amber-300" />
          )}
        </div>
        <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{label}</span>
        {!readOnly ? (
          <button
            type="button"
            aria-label={`toggle-geometry-visibility-${componentId}-${linkId}-${subType}-${entry.objectIndex}`}
            className={getGeometryVisibilityButtonClass(effectivelyVisible, { inheritedHidden })}
            data-visibility-source={inheritedHidden ? 'inherited' : 'local'}
            title={locallyVisible ? t.hide : t.show}
            onClick={(event) => toggleGeometryVisibility(event, subType, entry)}
          >
            {effectivelyVisible ? <Eye size={10} /> : <EyeOff size={10} />}
          </button>
        ) : null}
      </div>
    );
  };

  const renderJointBranches = () => childJoints.map((joint) => {
    const jointRef: JointRef = { type: 'joint', componentId, entityId: joint.id };
    const selected = selectionTargets(selection, jointRef);
    const childLinkRef: LinkRef = {
      type: 'link',
      componentId,
      entityId: joint.childLinkId,
    };
    const hovered = selectionTargets(hoveredSelection, jointRef)
      || selectionTargets(hoveredSelection, childLinkRef);
    const attention = selectionTargets(attentionSelection, jointRef)
      || selectionTargets(attentionSelection, childLinkRef);
    const childLink = robot.links[joint.childLinkId];
    const childDisplayName = childLink
      ? stripTreeDisplayNamePrefix(
          sourceFormat === 'mjcf' ? getMjcfLinkDisplayName(childLink) : childLink.name,
          componentDisplayNamePrefix,
        )
      : joint.childLinkId;
    const rawJointDisplayName = sourceFormat === 'mjcf'
      ? getMjcfJointDisplayName(joint, linkDisplayName, childDisplayName)
      : joint.name || joint.id;
    const jointDisplayName = stripTreeDisplayNamePrefix(
      rawJointDisplayName,
      componentDisplayNamePrefix,
    );
    const JointTypeIcon = getJointTypeIcon(joint.type);
    const jointTypeLabel = getJointTypeLabel(joint.type, t);
    const branchHighlighted = selected || hovered || attention
      || selectionTargets(selection, childLinkRef);

    return (
      <div key={joint.id} className="relative">
        <div
          data-testid={`tree-joint-${componentId}-${joint.id}`}
          className={`group relative mx-1 my-0.5 flex min-w-0 items-center rounded-md px-2 py-0.5 transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${resolveTreeRowStateClass(
            'text-text-secondary dark:text-text-tertiary',
            { isHovered: hovered, isSelected: selected, isAttentionHighlighted: attention },
          )}`}
          style={{ marginLeft: '5px' }}
          title={`${jointDisplayName} · ${jointTypeLabel}`}
          role={readOnly ? undefined : 'button'}
          aria-label={jointDisplayName}
          tabIndex={readOnly ? undefined : 0}
          onClick={readOnly ? undefined : () => dispatchSelection({ entity: jointRef })}
          onKeyDown={readOnly
            ? undefined
            : (event) => runOnActivationKey(
                event,
                () => dispatchSelection({ entity: jointRef }),
              )}
          onDoubleClick={readOnly
            ? undefined
            : (event) => {
                event.preventDefault();
                event.stopPropagation();
                beginRename(jointRef, joint.name);
              }}
          onMouseEnter={readOnly ? undefined : () => dispatchHover({ entity: jointRef })}
          onMouseLeave={readOnly ? undefined : clearCanonicalHover}
        >
          <div
            className={getTreeConnectorElbowClass(selected || hovered || attention)}
            style={getTreeConnectorElbowStyle(5)}
          />
          <div
            className={`mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
              selected || hovered || attention
                ? 'border-orange-500/20 bg-orange-500/15 dark:border-orange-400/20 dark:bg-orange-400/15'
                : 'border-transparent bg-orange-500/10 dark:bg-orange-400/10'
            }`}
          >
            <JointTypeIcon
              size={joint.type === 'fixed' ? 7 : 8}
              className="text-orange-600 dark:text-orange-300"
            />
          </div>
          {editing && areEntityRefsEqual(editing, jointRef) ? (
            <input
              ref={renameInputRef}
              value={draft}
              aria-label={`rename-joint-${componentId}-${joint.id}`}
              className={`${TREE_JOINT_NAME_TEXT_CLASS} ${TREE_RENAME_INPUT_BASE_CLASS} bg-input-bg border-border-strong text-text-primary focus:border-system-blue`}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onBlur={() => commitRename(jointRef, joint.name)}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitRename(jointRef, joint.name);
                if (event.key === 'Escape') setEditing(null);
              }}
            />
          ) : (
            <span className={`${TREE_JOINT_NAME_TEXT_CLASS} min-w-0 flex-1 truncate`}>
              {jointDisplayName}
            </span>
          )}
          {!readOnly && mode === 'editor' ? (
            <button
              type="button"
              aria-label={`delete-joint-${componentId}-${joint.id}`}
              className={`ml-1 rounded p-0.5 text-red-500 transition-opacity ${
                selected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              title={t.deleteBranch}
              onClick={(event) => {
                event.stopPropagation();
                onDelete(jointRef);
              }}
            >
              <Trash2 size={12} />
            </button>
          ) : null}
        </div>
        {!nextAncestors.has(joint.childLinkId) ? (
          <div className="relative ml-px">
            <div
              className={`absolute left-0 top-0.5 bottom-1.5 w-px rounded-full ${getTreeConnectorRailClass(branchHighlighted)}`}
            />
            <TreeNode
              componentId={componentId}
              linkId={joint.childLinkId}
              robot={robot}
              showGeometryDetailsByDefault={showGeometryDetailsByDefault}
              childJointsByParent={jointsByParent}
              onSelect={onSelect}
              onHover={onHover}
              onSelectGeometry={onSelectGeometry}
              onFocus={onFocus}
              onAddChild={onAddChild}
              onAddCollisionBody={onAddCollisionBody}
              onDelete={onDelete}
              onUpdate={onUpdate}
              mode={mode}
              t={t}
              depth={depth + 1}
              readOnly={readOnly}
              ancestorLinkIds={nextAncestors}
              componentDisplayNamePrefix={componentDisplayNamePrefix}
            />
          </div>
        ) : null}
      </div>
    );
  });

  return (
    <div
      className="relative"
      data-testid={`tree-link-${componentId}-${linkId}`}
      data-depth={depth}
    >
      <div
        className={`group relative mx-1 my-0.5 flex min-w-0 items-center rounded-md px-2 py-0.5 transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${resolveTreeRowStateClass(
          'text-text-primary dark:text-text-secondary',
          {
            isHovered: isLinkHovered,
            isSelected: isLinkSelected,
            isAttentionHighlighted: isLinkAttentionHighlighted,
          },
        )}`}
        style={{ marginLeft: depth > 0 ? '3px' : '0' }}
        title={linkDisplayName || linkId}
        role={readOnly ? undefined : 'button'}
        aria-label={linkDisplayName || linkId}
        tabIndex={readOnly ? undefined : 0}
        onClick={readOnly ? undefined : () => dispatchSelection({ entity: linkRef })}
        onKeyDown={readOnly
          ? undefined
          : (event) => runOnActivationKey(
              event,
              () => dispatchSelection({ entity: linkRef }),
            )}
        onDoubleClick={readOnly ? undefined : () => focus(linkRef)}
        onMouseEnter={readOnly ? undefined : () => dispatchHover({ entity: linkRef })}
        onMouseLeave={readOnly ? undefined : clearCanonicalHover}
      >
        {depth > 0 ? (
          <div
            className={getTreeConnectorElbowClass(linkConnectorHighlighted)}
            style={getTreeConnectorElbowStyle(3)}
          />
        ) : null}
        <button
          type="button"
          className={`mr-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${
            hasChildren ? 'cursor-pointer transition-colors hover:bg-element-hover' : ''
          }`}
          aria-label={`${expanded ? t.hide : t.show} ${linkDisplayName || linkId}`}
          title={`${expanded ? t.hide : t.show} ${linkDisplayName || linkId}`}
          disabled={!hasChildren}
          onClick={(event) => {
            event.stopPropagation();
            if (hasChildren) setExpanded((value) => !value);
          }}
        >
          {hasChildren
            ? expanded
              ? <ChevronDown size={11} className="text-text-tertiary" />
              : <ChevronRight size={11} className="text-text-tertiary" />
            : null}
        </button>
        <div
          className={`mr-1 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            linkConnectorHighlighted
              ? 'border-system-blue/25 bg-system-blue/15 dark:border-system-blue/30 dark:bg-system-blue/20'
              : 'border-transparent bg-system-blue/10 dark:bg-system-blue/12'
          }`}
        >
          <Box size={10} className="text-system-blue" />
        </div>
        {editing && areEntityRefsEqual(editing, linkRef) ? (
          <input
            ref={renameInputRef}
            value={draft}
            aria-label={`rename-link-${componentId}-${linkId}`}
            className={`${TREE_LINK_NAME_TEXT_CLASS} ${TREE_RENAME_INPUT_BASE_CLASS} bg-input-bg border-border-strong text-text-primary focus:border-system-blue`}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={() => commitRename(linkRef, link.name)}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename(linkRef, link.name);
              if (event.key === 'Escape') setEditing(null);
            }}
          />
        ) : (
          <span
            className={`${TREE_LINK_NAME_TEXT_CLASS} min-w-0 flex-1 truncate whitespace-nowrap select-none`}
            title={linkDisplayName}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              beginRename(linkRef, link.name);
            }}
          >
            {linkDisplayName}
          </span>
        )}
        <div className="ml-1 flex shrink-0 items-center gap-0.5">
          {hasGeometry ? (
            <button
              type="button"
              className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1 transition-colors ${
                geometryExpanded
                  ? 'bg-element-hover text-text-primary ring-1 ring-inset ring-border-black/60'
                  : 'text-text-tertiary hover:bg-element-hover hover:text-text-primary'
              }`}
              title={`${geometryExpanded ? t.collapse : t.expand} ${t.visualGeometry} / ${t.collisionGeometry}`}
              aria-label={`${geometryExpanded ? t.collapse : t.expand} ${t.visualGeometry} / ${t.collisionGeometry}`}
              onClick={(event) => {
                event.stopPropagation();
                setGeometryExpanded((value) => !value);
              }}
            >
              {hasVisual ? <Shapes size={10} className="text-emerald-500 dark:text-emerald-400" /> : null}
              {hasCollision ? <Shield size={10} className="text-amber-500 dark:text-amber-400" /> : null}
              <span className="text-[9px] font-semibold tabular-nums text-text-secondary">
                {visualEntries.length + collisionEntries.length}
              </span>
              {geometryExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            </button>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              aria-label={`toggle-link-visibility-${componentId}-${linkId}`}
              className={`h-5 w-5 rounded p-1 transition-colors ${
                isLinkSelected
                  ? selectedLinkActionClass
                  : 'text-text-tertiary hover:bg-system-blue/10 hover:text-text-primary dark:hover:bg-system-blue/20'
              }`}
              title={isLinkVisible ? t.hide : t.show}
              onClick={(event) => {
                event.stopPropagation();
                onUpdate(linkRef, { visible: !isLinkVisible });
              }}
            >
              {isLinkVisible ? <Eye size={12} /> : <EyeOff size={12} />}
            </button>
          ) : null}
          {!readOnly ? (
            <button
              type="button"
              aria-label={`focus-link-${componentId}-${linkId}`}
              className="hidden rounded p-1 text-text-tertiary hover:bg-element-hover group-hover:block"
              onClick={(event) => {
                event.stopPropagation();
                focus(linkRef);
              }}
            >
              <Crosshair size={12} />
            </button>
          ) : null}
          {!readOnly && mode === 'editor' ? (
            <>
              <button
                type="button"
                aria-label={`add-child-${componentId}-${linkId}`}
                className="hidden rounded p-1 text-text-tertiary hover:bg-element-hover group-hover:block"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddChild(linkRef);
                }}
              >
                <Plus size={12} />
              </button>
              <button
                type="button"
                aria-label={`delete-link-${componentId}-${linkId}`}
                className="hidden rounded p-1 text-red-500 hover:bg-red-100 group-hover:block dark:hover:bg-red-900/30"
                onClick={(event) => {
                  event.stopPropagation();
                  onDelete(linkRef);
                }}
              >
                <Trash2 size={12} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      {(expanded && hasChildren) || (geometryExpanded && hasGeometry) ? (
        <div className="relative ml-1">
          <div
            data-testid={`tree-connector-rail-${componentId}-${linkId}`}
            className={`absolute left-0 top-0 bottom-2 w-[1.5px] rounded-full ${getTreeConnectorRailClass(linkConnectorHighlighted)}`}
          />
          {geometryExpanded && hasGeometry ? (
            <>
              {visualEntries.map((entry) => renderGeometryRow('visual', entry))}
              {collisionEntries.map((entry) => renderGeometryRow('collision', entry))}
              {!readOnly && mode === 'editor' ? (
                <button
                  type="button"
                  aria-label={`add-collision-${componentId}-${linkId}`}
                  className="ml-3 flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-text-tertiary transition-colors hover:bg-element-hover hover:text-text-primary"
                  onClick={() => onAddCollisionBody(linkRef)}
                >
                  <Plus size={9} />
                  {t.addCollisionBody}
                </button>
              ) : null}
            </>
          ) : null}
          {expanded ? renderJointBranches() : null}
        </div>
      ) : null}
    </div>
  );
});
