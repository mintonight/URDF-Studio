import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRightLeft,
  Box,
  ChevronDown,
  ChevronRight,
  Cuboid,
  Edit3,
  Eye,
  EyeOff,
  Link2,
  LockKeyhole,
  Plus,
  Trash2,
} from 'lucide-react';
import { isAssemblyComponentIndividuallyTransformable } from '@/core/robot/assemblyTransforms';
import { getTreeRenderRootLinkIds } from '@/core/robot';
import { ContextMenuFrame, ContextMenuItem } from '@/shared/components/ui';
import type { TranslationKeys } from '@/shared/i18n';
import { useAssemblySelectionStore } from '@/store/assemblySelectionStore';
import { matchesSelection, useSelectionStore } from '@/store/selectionStore';
import type { AppMode, AssemblyState, RobotData, RobotState } from '@/types';
import { useShallow } from 'zustand/react/shallow';
import { TreeNode } from './TreeNode';
import { EMPTY_TREE_SELECTION, buildChildJointsByParent } from '../utils/treeSelectionScope';

export interface AssemblyTreeViewProps {
  assemblyState: AssemblyState;
  robot?: RobotData | RobotState;
  showGeometryDetailsByDefault?: boolean;
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
  onRenameAssembly?: (name: string) => void;
  onRemoveComponent?: (id: string) => void;
  onRemoveBridge?: (id: string) => void;
  onRenameComponent?: (id: string, name: string) => void;
  onCreateBridge?: () => void;
  onToggleComponentVisibility?: (id: string) => void;
  showAssemblyRoot?: boolean;
  mode: AppMode;
  t: TranslationKeys;
}

type AssemblyRenameTarget =
  | { kind: 'assembly'; draft: string }
  | { kind: 'component'; id: string; draft: string }
  | { kind: 'bridge'; id: string; draft: string };

type AssemblyContextMenuTarget =
  | { kind: 'assembly'; x: number; y: number }
  | { kind: 'component'; id: string; x: number; y: number }
  | { kind: 'bridge'; id: string; x: number; y: number };

type AssemblyContextMenuSeed =
  | { kind: 'assembly' }
  | { kind: 'component'; id: string }
  | { kind: 'bridge'; id: string };

function componentContainsSelection(
  component: AssemblyState['components'][string],
  selection: ReturnType<typeof useSelectionStore.getState>['selection'],
): boolean {
  if (!selection.type || !selection.id) {
    return false;
  }

  if (selection.type === 'link') {
    return selection.id in component.robot.links;
  }

  if (selection.type === 'joint') {
    return selection.id in component.robot.joints;
  }

  return false;
}

function resolveComponentHoverLinkId(
  component: AssemblyState['components'][string],
  componentRootLinkIds: Record<string, string[]>,
): string | null {
  return component.robot.rootLinkId || componentRootLinkIds[component.id]?.[0] || null;
}

export const AssemblyTreeView = memo(
  ({
    assemblyState,
    robot,
    showGeometryDetailsByDefault = false,
    onSelect,
    onSelectGeometry,
    onFocus,
    onAddChild,
    onAddCollisionBody,
    onDelete,
    onUpdate,
    onRenameAssembly,
    onRemoveComponent,
    onRemoveBridge,
    onRenameComponent,
    onCreateBridge,
    onToggleComponentVisibility,
    showAssemblyRoot = true,
    mode,
    t,
  }: AssemblyTreeViewProps) => {
    const {
      selection,
      hoveredSelection,
      attentionSelection,
      interactionGuard,
      setSelection,
      setHoveredSelection,
      clearHover,
    } = useSelectionStore(
      useShallow((state) => ({
        selection: state.selection,
        hoveredSelection: state.hoveredSelection,
        attentionSelection: state.attentionSelection,
        interactionGuard: state.interactionGuard,
        setSelection: state.setSelection,
        setHoveredSelection: state.setHoveredSelection,
        clearHover: state.clearHover,
      })),
    );
    const { assemblySelection, selectAssembly, selectComponent } = useAssemblySelectionStore(
      useShallow((state) => ({
        assemblySelection: state.selection,
        selectAssembly: state.selectAssembly,
        selectComponent: state.selectComponent,
      })),
    );
    const [isBridgesExpanded, setIsBridgesExpanded] = useState(true);
    const [expandedComponents, setExpandedComponents] = useState<Record<string, boolean>>({});
    const [editingTarget, setEditingTarget] = useState<AssemblyRenameTarget | null>(null);
    const [contextMenu, setContextMenu] = useState<AssemblyContextMenuTarget | null>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);
    const components = useMemo(
      () => Object.values(assemblyState.components),
      [assemblyState.components],
    );
    const bridges = useMemo(() => Object.values(assemblyState.bridges), [assemblyState.bridges]);
    const shouldShowBridgeControls = components.length > 1 || bridges.length > 0;
    const effectiveSelection =
      (robot && 'selection' in robot ? robot.selection : undefined) ??
      selection ??
      EMPTY_TREE_SELECTION;
    const editingTargetFocusKey = useMemo(() => {
      if (!editingTarget) {
        return null;
      }

      return editingTarget.kind === 'assembly'
        ? editingTarget.kind
        : `${editingTarget.kind}:${editingTarget.id}`;
    }, [editingTarget]);
    const componentRootLinkIds = useMemo<Record<string, string[]>>(() => {
      const rootLinkIdsByComponent: Record<string, string[]> = {};

      components.forEach((component) => {
        rootLinkIdsByComponent[component.id] = getTreeRenderRootLinkIds({
          ...component.robot,
          selection: EMPTY_TREE_SELECTION,
        });
      });

      return rootLinkIdsByComponent;
    }, [components]);
    const componentChildJointsByParent = useMemo<
      Record<string, Record<string, RobotState['joints'][string][]>>
    >(() => {
      const childJointsByParentByComponent: Record<
        string,
        Record<string, RobotState['joints'][string][]>
      > = {};

      components.forEach((component) => {
        childJointsByParentByComponent[component.id] = buildChildJointsByParent(
          component.robot.joints,
        );
      });

      return childJointsByParentByComponent;
    }, [components]);

    const toggleComponent = (id: string) => {
      setExpandedComponents((prev) => ({ ...prev, [id]: !prev[id] }));
    };

    useEffect(() => {
      if (!editingTargetFocusKey) return;
      const id = window.requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
      return () => window.cancelAnimationFrame(id);
    }, [editingTargetFocusKey]);

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

    const beginComponentRename = (componentId: string, currentName: string) => {
      setEditingTarget({ kind: 'component', id: componentId, draft: currentName });
    };

    const beginAssemblyRename = () => {
      setEditingTarget({ kind: 'assembly', draft: assemblyState.name });
    };

    const beginBridgeRename = (bridgeId: string, currentName: string) => {
      setEditingTarget({ kind: 'bridge', id: bridgeId, draft: currentName });
    };

    const commitRename = () => {
      if (!editingTarget) return;
      const nextName = editingTarget.draft.trim();
      if (nextName) {
        if (editingTarget.kind === 'assembly') {
          if (nextName !== assemblyState.name) {
            onRenameAssembly?.(nextName);
          }
        } else if (editingTarget.kind === 'component') {
          const component = assemblyState.components[editingTarget.id];
          if (component && nextName !== component.name) {
            onRenameComponent?.(editingTarget.id, nextName);
          }
        } else {
          const bridge = assemblyState.bridges[editingTarget.id];
          if (bridge && nextName !== bridge.name) {
            onUpdate('joint', bridge.id, {
              ...bridge.joint,
              name: nextName,
            });
          }
        }
      }
      setEditingTarget(null);
    };

    const cancelRename = () => {
      setEditingTarget(null);
    };

    const openContextMenu = (
      event: React.MouseEvent,
      target: AssemblyContextMenuSeed,
      actionCount = 2,
    ) => {
      event.preventDefault();
      event.stopPropagation();
      const menuWidth = 170;
      const menuHeight = actionCount * 32 + 8;
      const maxX = Math.max(8, window.innerWidth - menuWidth - 8);
      const maxY = Math.max(8, window.innerHeight - menuHeight - 8);
      setContextMenu({
        ...target,
        x: Math.min(event.clientX, maxX),
        y: Math.min(event.clientY, maxY),
      } as AssemblyContextMenuTarget);
    };

    const handleRenameFromMenu = () => {
      if (!contextMenu) return;
      if (contextMenu.kind === 'assembly') {
        beginAssemblyRename();
      } else if (contextMenu.kind === 'component') {
        const component = assemblyState.components[contextMenu.id];
        if (!component) return;
        beginComponentRename(component.id, component.name);
      } else {
        const bridge = assemblyState.bridges[contextMenu.id];
        if (!bridge) return;
        beginBridgeRename(bridge.id, bridge.name);
      }
      setContextMenu(null);
    };

    const handleDeleteFromMenu = () => {
      if (!contextMenu || contextMenu.kind === 'assembly') return;
      if (contextMenu.kind === 'component') {
        onRemoveComponent?.(contextMenu.id);
      } else {
        onRemoveBridge?.(contextMenu.id);
      }
      setContextMenu(null);
    };

    const sectionHoverClass =
      'hover:bg-system-blue/10 hover:ring-1 hover:ring-inset hover:ring-system-blue/15 dark:hover:bg-system-blue/20 dark:hover:ring-system-blue/25';
    const itemHoverClass =
      'hover:bg-system-blue/10 hover:text-text-primary hover:ring-1 hover:ring-inset hover:ring-system-blue/15 dark:hover:bg-system-blue/20 dark:hover:ring-system-blue/25';
    const itemHoveredClass =
      'bg-system-blue/10 text-text-primary ring-1 ring-inset ring-system-blue/15 dark:bg-system-blue/18 dark:ring-system-blue/25';
    const itemSelectedClass =
      'bg-system-blue/10 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue/20 dark:bg-system-blue/20 dark:ring-system-blue/30';
    const itemAttentionClass =
      'bg-system-blue/15 text-text-primary shadow-sm ring-1 ring-inset ring-system-blue/30 dark:bg-system-blue/25 dark:ring-system-blue/40';
    const renameInputClassName =
      'select-text text-[11px] font-medium leading-none flex-1 min-w-0 px-1 py-0.5 rounded border outline-none transition-colors bg-input-bg border-border-strong text-text-primary focus:border-system-blue';
    const isEditingAssembly = editingTarget?.kind === 'assembly';

    return (
      <div className="@container space-y-1 select-none">
        {showAssemblyRoot && (
          <div
            className={`flex items-center py-1 px-2 mx-1 my-0.5 rounded-md text-text-primary cursor-pointer transition-colors ${
              assemblySelection.type === 'assembly'
                ? itemSelectedClass
                : `bg-element-bg ${itemHoverClass}`
            }`}
            onClick={() => {
              // With a single imported model the assembly root *is* "the
              // whole robot" the user expects to move. Arm its lone component
              // (root joint drives the entire chain) instead of the
              // assembly-level target, which has no attachable Object3D for a
              // plain import. With multiple components keep assembly-level
              // selection.
              if (components.length === 1) {
                const only = components[0]!;
                const onlyRootLinkId = resolveComponentHoverLinkId(only, componentRootLinkIds);
                selectComponent(only.id);
                if (onlyRootLinkId) {
                  onSelect('link', onlyRootLinkId);
                } else {
                  setSelection({ type: null, id: null });
                }
                return;
              }

              setSelection({ type: null, id: null });
              selectAssembly();
            }}
            onContextMenu={(event) => openContextMenu(event, { kind: 'assembly' }, 1)}
          >
            <Cuboid size={14} className="mr-1.5 text-system-blue" />
            {isEditingAssembly ? (
              <input
                ref={renameInputRef}
                value={editingTarget?.draft ?? ''}
                onChange={(event) => {
                  setEditingTarget((prev) =>
                    prev?.kind === 'assembly' ? { ...prev, draft: event.target.value } : prev,
                  );
                }}
                onClick={(event) => event.stopPropagation()}
                onBlur={commitRename}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitRename();
                  } else if (event.key === 'Escape') {
                    cancelRename();
                  }
                }}
                className={renameInputClassName}
              />
            ) : (
              <span
                className="min-w-0 flex-1 text-[11px] font-medium leading-none truncate"
                title={assemblyState.name}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  beginAssemblyRename();
                }}
              >
                {assemblyState.name}
              </span>
            )}
          </div>
        )}

        <div className="mt-1 space-y-0.5">
          {components.length === 0 && (
            <div className="px-4 py-3 text-center text-[11px] italic text-text-tertiary">
              {t.emptyAssemblyHint}
            </div>
          )}

          {components.map((component) => {
            const isExpanded = expandedComponents[component.id] ?? false;
            const isVisible = component.visible !== false;
            const isEditingComponent =
              editingTarget?.kind === 'component' && editingTarget.id === component.id;
            const isComponentSelected =
              assemblySelection.type === 'component' && assemblySelection.id === component.id;
            const isComponentSelectionHighlighted = componentContainsSelection(
              component,
              effectiveSelection,
            );
            const isComponentHovered = componentContainsSelection(component, hoveredSelection);
            const isComponentAttentionHighlighted = componentContainsSelection(
              component,
              attentionSelection,
            );
            const isComponentTransformable = isAssemblyComponentIndividuallyTransformable(
              assemblyState,
              component.id,
            );
            const componentHoverLinkId = resolveComponentHoverLinkId(
              component,
              componentRootLinkIds,
            );
            const componentRobotState: RobotState = {
              ...component.robot,
              selection: effectiveSelection,
            };
            const componentRowStateClass = isComponentAttentionHighlighted
              ? itemAttentionClass
              : isComponentSelected || isComponentSelectionHighlighted
                ? itemSelectedClass
                : isComponentHovered
                  ? itemHoveredClass
                  : itemHoverClass;

            return (
              <div key={component.id}>
                <div
                  className={`mx-1 flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200 group ${componentRowStateClass}
                  ${!isVisible ? 'opacity-60' : ''}`}
                  onClick={() => {
                    if (interactionGuard && componentHoverLinkId) {
                      setExpandedComponents((prev) =>
                        prev[component.id] ? prev : { ...prev, [component.id]: true },
                      );
                      onSelect('link', componentHoverLinkId);
                      return;
                    }

                    // Selecting the robot/component name should arm the move
                    // gizmo for the whole component (its root joint drives the
                    // entire chain), so the user does not have to drill into
                    // the "base" link first. Mirror the link-selection path
                    // that already makes "base" transformable.
                    selectComponent(component.id);
                    if (componentHoverLinkId) {
                      onSelect('link', componentHoverLinkId);
                    } else {
                      setSelection({ type: null, id: null });
                    }
                  }}
                  onContextMenu={(event) =>
                    openContextMenu(event, { kind: 'component', id: component.id })
                  }
                  onMouseEnter={() => {
                    if (componentHoverLinkId) {
                      setHoveredSelection({ type: 'link', id: componentHoverLinkId });
                    }
                  }}
                  onMouseLeave={clearHover}
                >
                  <button
                    type="button"
                    className="flex items-center justify-center rounded p-0.5 text-text-tertiary hover:bg-element-hover"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleComponent(component.id);
                    }}
                    aria-label={
                      isExpanded
                        ? `${t.collapse} ${component.name}`
                        : `${t.expand} ${component.name}`
                    }
                  >
                    {isExpanded ? (
                      <ChevronDown size={12} className="text-text-tertiary" />
                    ) : (
                      <ChevronRight size={12} className="text-text-tertiary" />
                    )}
                  </button>
                  <Box size={12} className="text-system-blue" />

                  {isEditingComponent ? (
                    <input
                      ref={renameInputRef}
                      value={editingTarget?.draft ?? ''}
                      onChange={(event) => {
                        setEditingTarget((prev) =>
                          prev?.kind === 'component' && prev.id === component.id
                            ? { ...prev, draft: event.target.value }
                            : prev,
                        );
                      }}
                      onClick={(event) => event.stopPropagation()}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          commitRename();
                        } else if (event.key === 'Escape') {
                          cancelRename();
                        }
                      }}
                      className={renameInputClassName}
                    />
                  ) : (
                    <div
                      className="flex min-w-0 flex-1 items-center gap-2"
                      onDoubleClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        beginComponentRename(component.id, component.name);
                      }}
                    >
                      <span
                        className="flex-1 truncate text-[11px] font-medium text-text-primary"
                        title={component.name}
                      >
                        {component.name}
                      </span>
                      {!isComponentTransformable && (
                        <span
                          className="relative inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          title={t.bridgedComponentLockedHint}
                          role="img"
                          aria-label={t.bridgedComponentLockedHint}
                        >
                          <Link2 size={10} strokeWidth={2.5} aria-hidden="true" />
                          <span className="absolute -right-0.5 -bottom-0.5 flex h-2 w-2 items-center justify-center rounded-full border border-background-primary bg-background-primary text-amber-600 dark:text-amber-300">
                            <LockKeyhole size={5.5} strokeWidth={3} aria-hidden="true" />
                          </span>
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleComponentVisibility?.(component.id);
                      }}
                      className="rounded p-1 text-text-tertiary transition-colors hover:bg-element-hover"
                      title={isVisible ? t.hide : t.show}
                    >
                      {isVisible ? <Eye size={12} /> : <EyeOff size={12} />}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveComponent?.(component.id);
                      }}
                      className="rounded p-1 text-red-500 transition-colors hover:bg-red-100 dark:hover:bg-red-900/30"
                      title={t.deleteBranch}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>

                {isExpanded && (
                  <div
                    className="ml-4 border-l border-border-black/70"
                    style={{ containIntrinsicSize: '280px', contentVisibility: 'auto' }}
                  >
                    {componentRootLinkIds[component.id]?.map((treeRootLinkId) => (
                      <TreeNode
                        key={treeRootLinkId}
                        linkId={treeRootLinkId}
                        robot={componentRobotState}
                        showGeometryDetailsByDefault={showGeometryDetailsByDefault}
                        childJointsByParent={componentChildJointsByParent[component.id]}
                        onSelect={onSelect}
                        onSelectGeometry={onSelectGeometry}
                        onFocus={onFocus}
                        onAddChild={onAddChild}
                        onAddCollisionBody={onAddCollisionBody}
                        onDelete={onDelete}
                        onUpdate={onUpdate}
                        mode={mode}
                        t={t}
                        depth={0}
                        componentDisplayNamePrefix={component.name}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {shouldShowBridgeControls && (
          <div className="mt-2">
            <div
              className={`group flex min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 transition-all duration-200 ${sectionHoverClass}`}
              onClick={() => setIsBridgesExpanded(!isBridgesExpanded)}
            >
              {isBridgesExpanded ? (
                <ChevronDown size={12} className="shrink-0 text-text-tertiary" />
              ) : (
                <ChevronRight size={12} className="shrink-0 text-text-tertiary" />
              )}
              <Link2 size={12} className="shrink-0 text-green-500" />
              <span className="min-w-0 flex-1 truncate text-[11px] font-semibold tracking-[0.02em] text-text-tertiary dark:text-text-tertiary">
                {t.bridges}
              </span>
              <span className="mr-1 shrink-0 text-[10px] text-text-tertiary">{bridges.length}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCreateBridge?.();
                }}
                className="flex shrink-0 items-center gap-1 rounded border border-system-blue/25 bg-system-blue/10 px-1.5 py-0.5 text-system-blue transition-colors hover:bg-system-blue/15 dark:border-system-blue/35 dark:bg-system-blue/20 dark:hover:bg-system-blue/25 group/btn"
                title={t.createBridge}
              >
                <Plus
                  size={10}
                  strokeWidth={3}
                  className="group-hover/btn:scale-110 transition-transform"
                />
                <span className="hidden text-[9px] font-semibold tracking-[0.01em] @[260px]:inline">
                  {t.add}
                </span>
              </button>
            </div>

            {isBridgesExpanded && (
              <div className="ml-2 border-l border-border-black space-y-0.5 mt-0.5">
                {bridges.length === 0 ? (
                  <div className="px-4 py-2 text-[10px] italic text-text-tertiary">{t.none}</div>
                ) : (
                  bridges.map((bridge) => (
                    <div
                      key={bridge.id}
                      className={`flex items-center gap-1.5 py-1 px-2 mx-1 rounded-md cursor-pointer group transition-all duration-200 ${
                        matchesSelection(attentionSelection, { type: 'joint', id: bridge.id })
                          ? itemAttentionClass
                          : selection.type === 'joint' && selection.id === bridge.id
                            ? itemSelectedClass
                            : matchesSelection(hoveredSelection, { type: 'joint', id: bridge.id })
                              ? itemSelectedClass
                              : `text-text-secondary dark:text-text-secondary ${itemHoverClass}`
                      }`}
                      onClick={() => {
                        onSelect('joint', bridge.id);
                      }}
                      onContextMenu={(event) =>
                        openContextMenu(event, { kind: 'bridge', id: bridge.id })
                      }
                      onMouseEnter={() => setHoveredSelection({ type: 'joint', id: bridge.id })}
                      onMouseLeave={clearHover}
                    >
                      <ArrowRightLeft size={12} className="text-orange-500 dark:text-orange-300" />
                      {editingTarget?.kind === 'bridge' && editingTarget.id === bridge.id ? (
                        <input
                          ref={renameInputRef}
                          value={editingTarget?.draft ?? ''}
                          onChange={(event) => {
                            setEditingTarget((prev) =>
                              prev?.kind === 'bridge' && prev.id === bridge.id
                                ? { ...prev, draft: event.target.value }
                                : prev,
                            );
                          }}
                          onClick={(event) => event.stopPropagation()}
                          onBlur={commitRename}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') {
                              commitRename();
                            } else if (event.key === 'Escape') {
                              cancelRename();
                            }
                          }}
                          className={renameInputClassName}
                        />
                      ) : (
                        <div
                          className="min-w-0 flex flex-1 items-center"
                          onDoubleClick={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            beginBridgeRename(bridge.id, bridge.name);
                          }}
                        >
                          <span
                            className="text-[11px] font-medium truncate flex-1"
                            title={bridge.name}
                          >
                            {bridge.name}
                          </span>
                        </div>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveBridge?.(bridge.id);
                        }}
                        className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-red-100 dark:hover:bg-red-900/30 text-red-500 transition-opacity"
                        title={t.deleteBranch}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}

        <ContextMenuFrame position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}>
          <ContextMenuItem onClick={handleRenameFromMenu} icon={<Edit3 size={12} />}>
            {t.rename}
          </ContextMenuItem>
          {contextMenu?.kind !== 'assembly' && (
            <ContextMenuItem
              onClick={handleDeleteFromMenu}
              icon={<Trash2 size={12} />}
              tone="danger"
            >
              {t.deleteBranch}
            </ContextMenuItem>
          )}
        </ContextMenuFrame>
      </div>
    );
  },
);

AssemblyTreeView.displayName = 'AssemblyTreeView';
