import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { TranslationKeys } from '@/shared/i18n';
import { getCollisionGeometryByObjectIndex, isTransparentDisplayLink } from '@/core/robot';
import { useRobotStore } from '@/store';
import { type Selection, useSelectionStore } from '@/store/selectionStore';
import { GeometryType, type AppMode, type RobotState } from '@/types';
import { resolveTreeSelectionIdentity } from '@/features/robot-tree/utils/treeSelectionScope';
import { getMjcfLinkDisplayName } from '@/shared/utils/robot/mjcfDisplayNames';
import { TreeNodeContextMenu } from './tree-node/TreeNodeContextMenu';
import { TreeNodeGeometrySection } from './tree-node/TreeNodeGeometrySection';
import { TreeNodeJointBranchList } from './tree-node/TreeNodeJointBranchList';
import { TreeNodeLinkRow } from './tree-node/TreeNodeLinkRow';
import { getTreeConnectorRailClass, scrollElementIntoView } from './tree-node/presentation';
import { stripTreeDisplayNamePrefix } from './tree-node/treeDisplayNames';
import { shouldAutoExpandTreeGeometryDetails } from './tree-node/treeGeometryDisclosure';
import type {
  TreeNodeContextMenuState,
  TreeNodeEditingTarget,
  VisibleCollisionBody,
} from './tree-node/types';
import { useTreeNodeActions } from './tree-node/useTreeNodeActions';

export interface TreeNodeProps {
  linkId: string;
  robot?: RobotState;
  showGeometryDetailsByDefault?: boolean;
  childJointsByParent?: Record<string, RobotState['joints'][string][]>;
  selectionBranchLinkIds?: Set<string>;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onSelectGeometry?: (
    linkId: string,
    subType: 'visual' | 'collision',
    objectIndex?: number,
    suppressPulse?: boolean,
    suppressAutoReveal?: boolean,
  ) => void;
  onFocus?: (id: string) => void;
  onAddChild: (parentId: string) => void;
  onAddCollisionBody: (parentId: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  mode: AppMode;
  t: TranslationKeys;
  depth?: number;
  readOnly?: boolean;
  storeDriven?: boolean;
  componentDisplayNamePrefix?: string;
}

const EMPTY_TREE_SELECTION: Selection = { type: null, id: null };
const EMPTY_CHILD_JOINTS: RobotState['joints'][string][] = [];
const EMPTY_LINKS: RobotState['links'] = {};

export const TreeNode = memo(
  ({
    linkId,
    robot,
    showGeometryDetailsByDefault = false,
    childJointsByParent,
    selectionBranchLinkIds,
    onSelect,
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
    storeDriven = false,
    componentDisplayNamePrefix,
  }: TreeNodeProps) => {
    const [isExpanded, setIsExpanded] = useState(true);
    const [isGeometryExpanded, setIsGeometryExpanded] = useState(showGeometryDetailsByDefault);
    const [editingTarget, setEditingTarget] = useState<TreeNodeEditingTarget | null>(null);
    const [contextMenu, setContextMenu] = useState<TreeNodeContextMenuState | null>(null);

    const renameInputRef = useRef<HTMLInputElement>(null);
    const linkRowRef = useRef<HTMLDivElement>(null);
    const visualRowRef = useRef<HTMLDivElement>(null);
    const primaryCollisionRowRef = useRef<HTMLDivElement>(null);
    const collisionBodyRowRefs = useRef<Record<number, HTMLDivElement | null>>({});
    const jointRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const storeLink = useRobotStore((state) => (storeDriven ? state.links[linkId] : undefined));
    const storeInspectionContext = useRobotStore((state) =>
      storeDriven ? state.inspectionContext : undefined,
    );
    const storeChildJoints = useRobotStore(
      useShallow((state) =>
        storeDriven
          ? Object.values(state.joints).filter((joint) => joint.parentLinkId === linkId)
          : EMPTY_CHILD_JOINTS,
      ),
    );
    const storeChildLinks = useRobotStore(
      useShallow((state) => {
        if (!storeDriven) {
          return EMPTY_LINKS;
        }

        const links: RobotState['links'] = {};
        Object.values(state.joints).forEach((joint) => {
          if (joint.parentLinkId !== linkId) {
            return;
          }

          const childLink = state.links[joint.childLinkId];
          if (childLink) {
            links[joint.childLinkId] = childLink;
          }
        });
        return links;
      }),
    );
    // Merge selection-store subscriptions into a single useShallow read so each
    // TreeNode only re-renders when the underlying selection primitives change.
    // Filtering ("is this node hovered/attended?") happens downstream in useMemo
    // to keep the selector itself referentially stable.
    const {
      storeSelection,
      rawHoveredSelection,
      rawAttentionSelection,
      setHoveredSelection,
      clearHover,
      setSelection,
    } = useSelectionStore(
      useShallow((state) => ({
        storeSelection: state.selection,
        rawHoveredSelection: state.hoveredSelection,
        rawAttentionSelection: state.attentionSelection,
        setHoveredSelection: state.setHoveredSelection,
        clearHover: state.clearHover,
        setSelection: state.setSelection,
      })),
    );
    const link = storeDriven ? storeLink : robot?.links[linkId];
    const childJoints = storeDriven
      ? storeChildJoints
      : (childJointsByParent?.[linkId] ?? EMPTY_CHILD_JOINTS);
    const childJointsById = useMemo(
      () =>
        Object.fromEntries(childJoints.map((joint) => [joint.id, joint])) as Record<
          string,
          RobotState['joints'][string]
        >,
      [childJoints],
    );
    const childJointIds = useMemo(
      () => new Set(childJoints.map((joint) => joint.id)),
      [childJoints],
    );
    const childBranchKey = useMemo(
      () => childJoints.map((joint) => `${joint.id}:${joint.childLinkId}`).join('\u0000'),
      [childJoints],
    );
    const selectionRobotContext = useMemo(
      () => {
        if (!storeDriven) {
          return {
            links: robot?.links ?? {},
            joints: robot?.joints ?? {},
          };
        }

        return {
          links: {
            ...(link ? { [linkId]: link } : {}),
            ...storeChildLinks,
          },
          joints: childJointsById,
        };
      },
      [childJointsById, link, linkId, robot?.joints, robot?.links, storeChildLinks, storeDriven],
    );
    const effectiveSelection = useMemo(
      () => resolveTreeSelectionIdentity(storeSelection, selectionRobotContext),
      [selectionRobotContext, storeSelection],
    );
    // Filter the raw hovered/attention selections down to this node. Reuses the
    // shared `EMPTY_TREE_SELECTION` singleton so non-matching nodes return a
    // stable reference and skip downstream re-renders.
    const hoveredSelection = useMemo<Selection>(() => {
      if (readOnly) {
        return EMPTY_TREE_SELECTION;
      }
      if (rawHoveredSelection.type === 'link' && rawHoveredSelection.id === linkId) {
        return rawHoveredSelection;
      }
      if (
        rawHoveredSelection.type === 'joint' &&
        rawHoveredSelection.id &&
        childJointIds.has(rawHoveredSelection.id)
      ) {
        return rawHoveredSelection;
      }
      return EMPTY_TREE_SELECTION;
    }, [childJointIds, linkId, rawHoveredSelection, readOnly]);
    const attentionSelection = useMemo<Selection>(() => {
      if (readOnly) {
        return EMPTY_TREE_SELECTION;
      }
      if (rawAttentionSelection.type === 'link' && rawAttentionSelection.id === linkId) {
        return rawAttentionSelection;
      }
      if (
        rawAttentionSelection.type === 'joint' &&
        rawAttentionSelection.id &&
        childJointIds.has(rawAttentionSelection.id)
      ) {
        return rawAttentionSelection;
      }
      return EMPTY_TREE_SELECTION;
    }, [childJointIds, linkId, rawAttentionSelection, readOnly]);
    const effectiveHoveredSelection = useMemo(
      () => resolveTreeSelectionIdentity(hoveredSelection, selectionRobotContext),
      [hoveredSelection, selectionRobotContext],
    );
    const effectiveAttentionSelection = useMemo(
      () => resolveTreeSelectionIdentity(attentionSelection, selectionRobotContext),
      [attentionSelection, selectionRobotContext],
    );
    // Derive joint-attention flag from the already-subscribed raw attention
    // selection instead of re-subscribing to the store.
    const hasJointAttentionSelection =
      !readOnly &&
      rawAttentionSelection.type === 'joint' &&
      Boolean(rawAttentionSelection.id);
    const storeIsTransparentLink = useRobotStore((state) =>
      storeDriven ? isTransparentDisplayLink(state as unknown as RobotState, linkId) : false,
    );

    useEffect(() => {
      if (!editingTarget) return;
      const id = window.requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(id);
    }, [editingTarget]);

    useEffect(() => {
      if (!contextMenu) return;

      const closeMenu = () => setContextMenu(null);
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
          closeMenu();
        }
      };

      window.addEventListener('click', closeMenu);
      window.addEventListener('resize', closeMenu);
      window.addEventListener('contextmenu', closeMenu);
      window.addEventListener('keydown', onKeyDown);

      return () => {
        window.removeEventListener('click', closeMenu);
        window.removeEventListener('resize', closeMenu);
        window.removeEventListener('contextmenu', closeMenu);
        window.removeEventListener('keydown', onKeyDown);
      };
    }, [contextMenu]);

    if (!link) {
      return null;
    }

    const sourceFormat = (storeDriven ? storeInspectionContext : robot?.inspectionContext)
      ?.sourceFormat;
    const rawLinkDisplayName = sourceFormat === 'mjcf' ? getMjcfLinkDisplayName(link) : link.name;
    const linkDisplayName = stripTreeDisplayNamePrefix(
      rawLinkDisplayName,
      componentDisplayNamePrefix,
    );
    const linkLookup = storeDriven ? storeChildLinks : robot?.links;
    const childLinkDisplayNames = childJoints.reduce<Record<string, string>>((acc, joint) => {
      const childLink = linkLookup?.[joint.childLinkId];
      if (!childLink) {
        return acc;
      }

      const rawChildLinkDisplayName =
        sourceFormat === 'mjcf' ? getMjcfLinkDisplayName(childLink) : childLink.name;
      acc[joint.childLinkId] = stripTreeDisplayNamePrefix(
        rawChildLinkDisplayName,
        componentDisplayNamePrefix,
      );
      return acc;
    }, {});

    const robotSelection = effectiveSelection;

    const linkRowIndentPx = 3;
    const jointRowIndentPx = 5;
    const geometryRowIndentPx = 12;
    const hasChildren = childJoints.length > 0;
    const hasExpandableContent = hasChildren;
    const isTransparentLink = storeDriven
      ? storeIsTransparentLink
      : robot
        ? isTransparentDisplayLink(robot, linkId)
        : false;
    const isVisible = link.visible !== false;
    const isVisualVisible = link.visual.visible !== false;
    const isPrimaryCollisionVisible = link.collision.visible !== false;
    const hasPrimaryCollision = Boolean(
      link.collision?.type && link.collision.type !== GeometryType.NONE,
    );
    const hasVisual = Boolean(link.visual?.type && link.visual.type !== GeometryType.NONE);
    const selectedObjectIndex = robotSelection.objectIndex ?? 0;
    const collisionBodyCount =
      (hasPrimaryCollision ? 1 : 0) +
      (link.collisionBodies || []).filter((body) => body.type !== GeometryType.NONE).length;
    const visibleCollisionBodies: VisibleCollisionBody[] = (link.collisionBodies || [])
      .map((body, bodyIndex) => ({ body, bodyIndex }))
      .filter(({ body }) => body.type !== GeometryType.NONE)
      .map((entry, visibleIndex) => ({
        ...entry,
        objectIndex: (hasPrimaryCollision ? 1 : 0) + visibleIndex,
      }));
    const hasCollision = collisionBodyCount > 0;
    const hasGeometry = hasVisual || hasCollision;
    const isLinkSelected = robotSelection.type === 'link' && robotSelection.id === linkId;
    const isEditingLink = editingTarget?.type === 'link' && editingTarget.id === linkId;
    const isLinkHovered =
      effectiveHoveredSelection.type === 'link' && effectiveHoveredSelection.id === linkId;
    const isLinkAttentionHighlighted =
      effectiveAttentionSelection.type === 'link' && effectiveAttentionSelection.id === linkId;
    const isVisualSelected =
      isLinkSelected &&
      robotSelection.subType === 'visual' &&
      (robotSelection.objectIndex === undefined || selectedObjectIndex === 0);
    const isPrimaryCollisionSelected =
      isLinkSelected && robotSelection.subType === 'collision' && selectedObjectIndex === 0;
    const hasSelectedExtraCollision = visibleCollisionBodies.some(
      ({ objectIndex }) => objectIndex === selectedObjectIndex,
    );
    const shouldAutoExpandGeometryDetails =
      !hasJointAttentionSelection &&
      shouldAutoExpandTreeGeometryDetails({
        showGeometryDetailsByDefault,
        selectionSubType: isLinkSelected ? robotSelection.subType : undefined,
        hasSelectedExtraCollision:
          isLinkSelected && robotSelection.subType === 'collision' && hasSelectedExtraCollision,
      });
    // Selection-branch membership is computed once at the TreeEditor level and
    // threaded down via prop. This used to be a per-node store subscription
    // that rebuilt the full parent map per render (O(N) per node, O(N^2)
    // overall) — the prop-driven path keeps the cost linear.
    const selectionInBranch = selectionBranchLinkIds?.has(linkId) ?? false;
    const contextMenuLink =
      contextMenu?.target.type === 'link' && contextMenu.target.id === linkId ? link : null;
    const contextMenuHasVisual = Boolean(
      contextMenuLink?.visual?.type && contextMenuLink.visual.type !== GeometryType.NONE,
    );
    const contextMenuHasCollision = Boolean(
      (contextMenuLink?.collision?.type && contextMenuLink.collision.type !== GeometryType.NONE) ||
      (contextMenuLink?.collisionBodies || []).some((body) => body.type !== GeometryType.NONE),
    );
    const contextMenuGeometryType =
      contextMenu?.target.type === 'geometry'
        ? (() => {
            const targetLink = contextMenu.target.linkId === linkId ? link : null;
            if (!targetLink) return null;
            return contextMenu.target.subType === 'visual'
              ? (targetLink.visual?.type ?? null)
              : (getCollisionGeometryByObjectIndex(targetLink, contextMenu.target.objectIndex)
                  ?.geometry?.type ?? null);
          })()
        : null;
    const isLinkConnectorHighlighted =
      isLinkSelected || isLinkHovered || isLinkAttentionHighlighted || selectionInBranch;

    useEffect(() => {
      setIsExpanded(true);
    }, [childBranchKey, linkId]);

    useEffect(() => {
      if (selectionInBranch && hasExpandableContent) {
        setIsExpanded(true);
      }
    }, [selectionInBranch, hasExpandableContent]);

    useEffect(() => {
      setIsGeometryExpanded(showGeometryDetailsByDefault);
    }, [showGeometryDetailsByDefault]);

    useEffect(() => {
      if (shouldAutoExpandGeometryDetails) {
        setIsGeometryExpanded(true);
      }
    }, [shouldAutoExpandGeometryDetails]);

    useEffect(() => {
      if (isLinkSelected && !robotSelection.subType && !hasJointAttentionSelection) {
        scrollElementIntoView(linkRowRef.current);
      }
    }, [hasJointAttentionSelection, isLinkSelected, robotSelection.subType]);

    useEffect(() => {
      if (isGeometryExpanded && isVisualSelected && !hasJointAttentionSelection) {
        scrollElementIntoView(visualRowRef.current);
      }
    }, [hasJointAttentionSelection, isGeometryExpanded, isVisualSelected]);

    useEffect(() => {
      if (isGeometryExpanded && isPrimaryCollisionSelected && !hasJointAttentionSelection) {
        scrollElementIntoView(primaryCollisionRowRef.current);
      }
    }, [hasJointAttentionSelection, isGeometryExpanded, isPrimaryCollisionSelected]);

    useEffect(() => {
      if (
        hasJointAttentionSelection ||
        !(
          isGeometryExpanded &&
          isLinkSelected &&
          robotSelection.subType === 'collision' &&
          hasSelectedExtraCollision
        )
      ) {
        return;
      }
      scrollElementIntoView(collisionBodyRowRefs.current[selectedObjectIndex]);
    }, [
      hasJointAttentionSelection,
      isGeometryExpanded,
      isLinkSelected,
      robotSelection.subType,
      selectedObjectIndex,
      hasSelectedExtraCollision,
    ]);

    useEffect(() => {
      if (
        effectiveAttentionSelection.type !== 'link' ||
        effectiveAttentionSelection.id !== linkId
      ) {
        return;
      }

      if (
        effectiveAttentionSelection.subType === 'visual' ||
        effectiveAttentionSelection.subType === 'collision'
      ) {
        setIsGeometryExpanded(false);
      }

      scrollElementIntoView(linkRowRef.current);
    }, [effectiveAttentionSelection, linkId]);

    useEffect(() => {
      if (!isExpanded || robotSelection.type !== 'joint' || !robotSelection.id) return;
      scrollElementIntoView(jointRowRefs.current[robotSelection.id] || null);
    }, [isExpanded, robotSelection.id, robotSelection.type]);

    useEffect(() => {
      if (
        !isExpanded ||
        effectiveAttentionSelection.type !== 'joint' ||
        !effectiveAttentionSelection.id
      ) {
        return;
      }

      scrollElementIntoView(jointRowRefs.current[effectiveAttentionSelection.id] || null);
    }, [effectiveAttentionSelection.id, effectiveAttentionSelection.type, isExpanded]);
    const {
      handleSelectVisual,
      handleSelectPrimaryCollision,
      handleSelectCollisionBody,
      toggleVisualVisibility,
      togglePrimaryCollisionVisibility,
      toggleCollisionBodyVisibility,
      commitRenaming,
      cancelRenaming,
      updateRenameDraft,
      handleNameDoubleClick,
      openContextMenu,
      handleRenameMenuAction,
      handleAddChildMenuAction,
      handleDeleteMenuAction,
      handleAddCollisionMenuAction,
      handleDeleteGeometryMenuAction,
      handleDeleteLinkGeometry,
    } = useTreeNodeActions({
      linkId,
      link,
      childJointsById,
      selection: effectiveSelection,
      isVisualVisible,
      isPrimaryCollisionVisible,
      editingTarget,
      contextMenu,
      onSelect,
      onSelectGeometry,
      onAddChild,
      onAddCollisionBody,
      onDelete,
      onUpdate,
      setSelection,
      setIsExpanded,
      setIsGeometryExpanded,
      setEditingTarget,
      setContextMenu,
    });

    if (isTransparentLink) {
      if (!hasChildren) {
        return null;
      }

      return (
        <TreeNodeJointBranchList
          childJoints={childJoints}
          robotSelection={robotSelection}
          hoveredSelection={effectiveHoveredSelection}
          attentionSelection={effectiveAttentionSelection}
          selectionBranchLinkIds={selectionBranchLinkIds}
          editingTarget={editingTarget}
          renameInputRef={renameInputRef}
          jointRowRefs={jointRowRefs}
          jointRowIndentPx={jointRowIndentPx}
          sourceFormat={sourceFormat}
          parentLinkDisplayName={linkDisplayName}
          childLinkDisplayNames={childLinkDisplayNames}
          componentDisplayNamePrefix={componentDisplayNamePrefix}
          t={t}
          readOnly={readOnly}
          onSelect={onSelect}
          onDelete={onDelete}
          onSetHoveredSelection={setHoveredSelection}
          onClearHover={clearHover}
          onOpenContextMenu={openContextMenu}
          onUpdateRenameDraft={updateRenameDraft}
          onCommitRenaming={commitRenaming}
          onCancelRenaming={cancelRenaming}
          onNameDoubleClick={handleNameDoubleClick}
          renderChildNode={(childLinkId) => (
            <TreeNode
              linkId={childLinkId}
              robot={storeDriven ? undefined : robot}
              showGeometryDetailsByDefault={showGeometryDetailsByDefault}
              childJointsByParent={storeDriven ? undefined : childJointsByParent}
              selectionBranchLinkIds={selectionBranchLinkIds}
              onSelect={onSelect}
              onSelectGeometry={onSelectGeometry}
              onFocus={onFocus}
              onAddChild={onAddChild}
              onAddCollisionBody={onAddCollisionBody}
              onDelete={onDelete}
              onUpdate={onUpdate}
              mode={mode}
              t={t}
              depth={depth}
              readOnly={readOnly}
              storeDriven={storeDriven}
              componentDisplayNamePrefix={componentDisplayNamePrefix}
            />
          )}
        />
      );
    }

    return (
      <div className="relative">
        <div ref={linkRowRef}>
          <TreeNodeLinkRow
            linkId={linkId}
            linkName={linkDisplayName}
            depth={depth}
            linkRowIndentPx={linkRowIndentPx}
            hasExpandableContent={hasExpandableContent}
            isExpanded={isExpanded}
            isEditingLink={isEditingLink}
            editingTarget={editingTarget}
            renameInputRef={renameInputRef}
            hasGeometry={hasGeometry}
            hasVisual={hasVisual}
            hasCollision={hasCollision}
            geometryCount={Number(Boolean(hasVisual)) + collisionBodyCount}
            isGeometryExpanded={isGeometryExpanded}
            isVisible={isVisible}
            isSelected={isLinkSelected}
            isHovered={isLinkHovered}
            isAttentionHighlighted={isLinkAttentionHighlighted}
            isConnectorHighlighted={isLinkConnectorHighlighted}
            t={t}
            readOnly={readOnly}
            onSelect={() => onSelect('link', linkId)}
            onFocus={readOnly ? undefined : onFocus ? () => onFocus(linkId) : undefined}
            onToggleExpanded={() => setIsExpanded(!isExpanded)}
            onOpenContextMenu={(event) =>
              openContextMenu(event, { type: 'link', id: linkId, name: link.name })
            }
            onMouseEnter={() => setHoveredSelection({ type: 'link', id: linkId })}
            onMouseLeave={clearHover}
            onUpdateRenameDraft={updateRenameDraft}
            onCommitRenaming={commitRenaming}
            onCancelRenaming={cancelRenaming}
            onNameDoubleClick={(event) => handleNameDoubleClick(event, 'link', linkId, link.name)}
            onToggleGeometryExpanded={() => setIsGeometryExpanded((prev) => !prev)}
            onToggleVisibility={(event) => {
              event.stopPropagation();
              onUpdate('link', linkId, { ...link, visible: !isVisible });
            }}
          />
        </div>

        {(isExpanded || isGeometryExpanded) && (
          <div className="relative ml-1">
            <div
              className={`absolute left-0 top-0 bottom-2 w-[1.5px] rounded-full ${getTreeConnectorRailClass(isLinkConnectorHighlighted)}`}
            />

            {isGeometryExpanded && hasGeometry && (
              <TreeNodeGeometrySection
                linkId={linkId}
                link={link}
                robotSelection={robotSelection}
                hoveredSelection={effectiveHoveredSelection}
                attentionSelection={effectiveAttentionSelection}
                editingTarget={editingTarget}
                renameInputRef={renameInputRef}
                visualRowRef={visualRowRef}
                primaryCollisionRowRef={primaryCollisionRowRef}
                collisionBodyRowRefs={collisionBodyRowRefs}
                geometryRowIndentPx={geometryRowIndentPx}
                hasPrimaryCollision={hasPrimaryCollision}
                visibleCollisionBodies={visibleCollisionBodies}
                isLinkSelected={isLinkSelected}
                selectedObjectIndex={selectedObjectIndex}
                t={t}
                onUpdateRenameDraft={updateRenameDraft}
                onCommitRenaming={commitRenaming}
                onCancelRenaming={cancelRenaming}
                onSetHoveredSelection={setHoveredSelection}
                onClearHover={clearHover}
                onOpenContextMenu={openContextMenu}
                onSelectVisual={handleSelectVisual}
                onSelectPrimaryCollision={handleSelectPrimaryCollision}
                onSelectCollisionBody={handleSelectCollisionBody}
                onToggleVisualVisibility={toggleVisualVisibility}
                onTogglePrimaryCollisionVisibility={togglePrimaryCollisionVisibility}
                onToggleCollisionBodyVisibility={toggleCollisionBodyVisibility}
                readOnly={readOnly}
              />
            )}

            {isExpanded && hasChildren && (
              <TreeNodeJointBranchList
                childJoints={childJoints}
                robotSelection={robotSelection}
                hoveredSelection={effectiveHoveredSelection}
                attentionSelection={effectiveAttentionSelection}
                selectionBranchLinkIds={selectionBranchLinkIds}
                editingTarget={editingTarget}
                renameInputRef={renameInputRef}
                jointRowRefs={jointRowRefs}
                jointRowIndentPx={jointRowIndentPx}
                sourceFormat={sourceFormat}
                parentLinkDisplayName={linkDisplayName}
                childLinkDisplayNames={childLinkDisplayNames}
                componentDisplayNamePrefix={componentDisplayNamePrefix}
                t={t}
                onSelect={onSelect}
                onDelete={onDelete}
                onSetHoveredSelection={setHoveredSelection}
                onClearHover={clearHover}
                onOpenContextMenu={openContextMenu}
                onUpdateRenameDraft={updateRenameDraft}
                onCommitRenaming={commitRenaming}
                onCancelRenaming={cancelRenaming}
                onNameDoubleClick={handleNameDoubleClick}
                readOnly={readOnly}
                renderChildNode={(childLinkId) => (
                  <TreeNode
                    linkId={childLinkId}
                    robot={storeDriven ? undefined : robot}
                    showGeometryDetailsByDefault={showGeometryDetailsByDefault}
                    childJointsByParent={storeDriven ? undefined : childJointsByParent}
                    selectionBranchLinkIds={selectionBranchLinkIds}
                    onSelect={onSelect}
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
                    storeDriven={storeDriven}
                    componentDisplayNamePrefix={componentDisplayNamePrefix}
                  />
                )}
              />
            )}
          </div>
        )}

        <TreeNodeContextMenu
          contextMenu={contextMenu}
          contextMenuHasVisual={contextMenuHasVisual}
          contextMenuHasCollision={contextMenuHasCollision}
          contextMenuGeometryType={contextMenuGeometryType}
          t={t}
          readOnly={readOnly}
          onRenameMenuAction={handleRenameMenuAction}
          onAddChildMenuAction={handleAddChildMenuAction}
          onDeleteMenuAction={handleDeleteMenuAction}
          onAddCollisionMenuAction={handleAddCollisionMenuAction}
          onDeleteGeometryMenuAction={handleDeleteGeometryMenuAction}
          onDeleteLinkGeometry={handleDeleteLinkGeometry}
        />
      </div>
    );
  },
);

TreeNode.displayName = 'TreeNode';
