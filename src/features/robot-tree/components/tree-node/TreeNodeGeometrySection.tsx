import { memo, type MouseEvent, type RefObject } from 'react';
import { Eye, EyeOff, Shapes, Shield } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n';
import { matchesSelection, type Selection } from '@/store/selectionStore';
import { GeometryType, type RobotState } from '@/types';
import type {
  TreeNodeContextMenuTarget,
  TreeNodeEditingTarget,
  VisibleCollisionBody,
  VisibleVisualBody,
} from './types';
import {
  getGeometryVisibilityButtonClass,
  getTreeConnectorElbowClass,
  getTreeConnectorElbowStyle,
  resolveTreeRowStateClass,
  TREE_LINK_NAME_TEXT_CLASS,
  TREE_RENAME_INPUT_BASE_CLASS,
} from './presentation';

interface TreeNodeGeometrySectionProps {
  linkId: string;
  link: RobotState['links'][string];
  robotSelection: RobotState['selection'];
  hoveredSelection: Selection;
  attentionSelection: Selection;
  editingTarget: TreeNodeEditingTarget | null;
  renameInputRef: RefObject<HTMLInputElement | null>;
  visualRowRef: RefObject<HTMLDivElement | null>;
  visualBodyRowRefs: RefObject<Record<number, HTMLDivElement | null>>;
  primaryCollisionRowRef: RefObject<HTMLDivElement | null>;
  collisionBodyRowRefs: RefObject<Record<number, HTMLDivElement | null>>;
  geometryRowIndentPx: number;
  hasPrimaryVisual: boolean;
  visibleVisualBodies: VisibleVisualBody[];
  hasPrimaryCollision: boolean;
  visibleCollisionBodies: VisibleCollisionBody[];
  isLinkSelected: boolean;
  selectedObjectIndex: number;
  t: TranslationKeys;
  onUpdateRenameDraft: (value: string) => void;
  onCommitRenaming: () => void;
  onCancelRenaming: () => void;
  onSetHoveredSelection: (selection: Selection) => void;
  onClearHover: () => void;
  onOpenContextMenu: (event: MouseEvent<HTMLDivElement>, target: TreeNodeContextMenuTarget) => void;
  onSelectVisual: () => void;
  onSelectVisualBody: (objectIndex: number) => void;
  onSelectPrimaryCollision: () => void;
  onSelectCollisionBody: (objectIndex: number) => void;
  onToggleVisualVisibility: (event: MouseEvent) => void;
  onToggleVisualBodyVisibility: (event: MouseEvent, bodyIndex: number) => void;
  onTogglePrimaryCollisionVisibility: (event: MouseEvent) => void;
  onToggleCollisionBodyVisibility: (event: MouseEvent, bodyIndex: number) => void;
  readOnly: boolean;
}

export const TreeNodeGeometrySection = memo(function TreeNodeGeometrySection({
  linkId,
  link,
  robotSelection,
  hoveredSelection,
  attentionSelection,
  editingTarget,
  renameInputRef,
  visualRowRef,
  visualBodyRowRefs,
  primaryCollisionRowRef,
  collisionBodyRowRefs,
  geometryRowIndentPx,
  hasPrimaryVisual,
  visibleVisualBodies,
  hasPrimaryCollision,
  visibleCollisionBodies,
  isLinkSelected,
  selectedObjectIndex,
  t,
  onUpdateRenameDraft,
  onCommitRenaming,
  onCancelRenaming,
  onSetHoveredSelection,
  onClearHover,
  onOpenContextMenu,
  onSelectVisual,
  onSelectVisualBody,
  onSelectPrimaryCollision,
  onSelectCollisionBody,
  onToggleVisualVisibility,
  onToggleVisualBodyVisibility,
  onTogglePrimaryCollisionVisibility,
  onToggleCollisionBodyVisibility,
  readOnly,
}: TreeNodeGeometrySectionProps) {
  const getGeometryDisplayName = (name: string | undefined, fallbackLabel: string) =>
    name?.trim() || fallbackLabel;
  const isVisualSelected =
    isLinkSelected &&
    robotSelection.subType === 'visual' &&
    (robotSelection.objectIndex === undefined || selectedObjectIndex === 0);
  const isVisualHovered = matchesSelection(hoveredSelection, {
    type: 'link',
    id: linkId,
    subType: 'visual',
    objectIndex: 0,
  });
  const isVisualAttentionHighlighted = matchesSelection(attentionSelection, {
    type: 'link',
    id: linkId,
    subType: 'visual',
    objectIndex: 0,
  });
  const isPrimaryCollisionSelected =
    isLinkSelected && robotSelection.subType === 'collision' && selectedObjectIndex === 0;
  const isPrimaryCollisionHovered = matchesSelection(hoveredSelection, {
    type: 'link',
    id: linkId,
    subType: 'collision',
    objectIndex: 0,
  });
  const isPrimaryCollisionAttentionHighlighted = matchesSelection(attentionSelection, {
    type: 'link',
    id: linkId,
    subType: 'collision',
    objectIndex: 0,
  });
  const isLinkVisible = link.visible !== false;
  const isVisualVisible = link.visual.visible !== false;
  const isPrimaryCollisionVisible = link.collision.visible !== false;
  const visualLabel = getGeometryDisplayName(link.visual.name, t.visualGeometry);
  const primaryCollisionLabel = getGeometryDisplayName(link.collision.name, t.collision);
  const isEditingVisual =
    editingTarget?.type === 'geometry' &&
    editingTarget.linkId === linkId &&
    editingTarget.subType === 'visual' &&
    editingTarget.objectIndex === 0;
  const isEditingPrimaryCollision =
    editingTarget?.type === 'geometry' &&
    editingTarget.linkId === linkId &&
    editingTarget.subType === 'collision' &&
    editingTarget.objectIndex === 0;
  const isVisualInheritedHidden = !isLinkVisible && isVisualVisible;
  const isVisualEffectivelyVisible = isLinkVisible && isVisualVisible;
  const isPrimaryCollisionInheritedHidden = !isLinkVisible && isPrimaryCollisionVisible;
  const isPrimaryCollisionEffectivelyVisible = isLinkVisible && isPrimaryCollisionVisible;

  return (
    <>
      {link.visual?.type && link.visual.type !== GeometryType.NONE && (
        <div
          ref={visualRowRef}
          className={`relative flex min-w-0 items-center py-0.5 px-2 mx-1 my-0.5 rounded-md transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${resolveTreeRowStateClass(
            'text-text-secondary dark:text-text-tertiary',
            {
              isHovered: isVisualHovered,
              isSelected: isVisualSelected,
              isAttentionHighlighted: isVisualAttentionHighlighted,
            },
          )}`}
          onClick={readOnly || isEditingVisual ? undefined : onSelectVisual}
          onContextMenu={
            readOnly
              ? undefined
              : (event) => {
                  onOpenContextMenu(event, {
                    type: 'geometry',
                    linkId,
                    subType: 'visual',
                    objectIndex: 0,
                    name: link.visual.name?.trim() || '',
                  });
                }
          }
          onMouseEnter={
            readOnly
              ? undefined
              : () =>
                  onSetHoveredSelection({
                    type: 'link',
                    id: linkId,
                    subType: 'visual',
                    objectIndex: 0,
                  })
          }
          onMouseLeave={readOnly ? undefined : onClearHover}
          style={{ marginLeft: `${geometryRowIndentPx}px` }}
          title={visualLabel}
        >
          <div
            className={getTreeConnectorElbowClass(
              isVisualSelected || isVisualHovered || isVisualAttentionHighlighted,
            )}
            style={getTreeConnectorElbowStyle(geometryRowIndentPx)}
          />
          <div
            className={`w-3.5 h-3.5 rounded flex items-center justify-center mr-1 shrink-0 border transition-colors ${isVisualSelected || isVisualHovered || isVisualAttentionHighlighted ? 'bg-emerald-500/15 dark:bg-emerald-400/15 border-emerald-500/20 dark:border-emerald-400/20' : 'bg-emerald-500/10 dark:bg-emerald-400/10 border-transparent'}`}
          >
            <Shapes
              size={9}
              className={
                isVisualSelected || isVisualHovered || isVisualAttentionHighlighted
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : 'text-emerald-500 dark:text-emerald-400'
              }
            />
          </div>
          {isEditingVisual ? (
            <input
              ref={renameInputRef}
              value={editingTarget.draft}
              onChange={(event) => onUpdateRenameDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onBlur={onCommitRenaming}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCommitRenaming();
                } else if (event.key === 'Escape') {
                  onCancelRenaming();
                }
              }}
              className={`${TREE_LINK_NAME_TEXT_CLASS} ${TREE_RENAME_INPUT_BASE_CLASS} flex-1 bg-input-bg border-border-strong text-text-primary focus:border-system-blue`}
            />
          ) : (
            <span className="text-[10px] font-medium truncate flex-1 min-w-0">{visualLabel}</span>
          )}
          {!readOnly && (
            <button
              type="button"
              className={getGeometryVisibilityButtonClass(isVisualEffectivelyVisible, {
                inheritedHidden: isVisualInheritedHidden,
              })}
              onClick={onToggleVisualVisibility}
              title={isVisualVisible ? t.hide : t.show}
              aria-label={isVisualVisible ? t.hide : t.show}
              data-visibility-source={isVisualInheritedHidden ? 'inherited' : 'local'}
            >
              {isVisualEffectivelyVisible ? <Eye size={10} /> : <EyeOff size={10} />}
            </button>
          )}
        </div>
      )}

      {visibleVisualBodies.map(({ body, bodyIndex, objectIndex }, index) => {
        const visualFallbackLabel = `${t.visualGeometry} ${index + (hasPrimaryVisual ? 2 : 1)}`;
        const visualBodyLabel = getGeometryDisplayName(body.name, visualFallbackLabel);
        const isVisualBodyHovered = matchesSelection(hoveredSelection, {
          type: 'link',
          id: linkId,
          subType: 'visual',
          objectIndex,
        });
        const isVisualBodyAttentionHighlighted = matchesSelection(attentionSelection, {
          type: 'link',
          id: linkId,
          subType: 'visual',
          objectIndex,
        });
        const isVisualBodySelected =
          isLinkSelected &&
          robotSelection.subType === 'visual' &&
          selectedObjectIndex === objectIndex;
        const isVisualBodyVisible = body.visible !== false;
        const isVisualBodyInheritedHidden = !isLinkVisible && isVisualBodyVisible;
        const isVisualBodyEffectivelyVisible = isLinkVisible && isVisualBodyVisible;
        const isEditingVisualBody =
          editingTarget?.type === 'geometry' &&
          editingTarget.linkId === linkId &&
          editingTarget.subType === 'visual' &&
          editingTarget.objectIndex === objectIndex;

        return (
          <div
            ref={(element) => {
              visualBodyRowRefs.current[objectIndex] = element;
            }}
            key={`visual-extra-${bodyIndex}`}
            className={`relative flex min-w-0 items-center py-0.5 px-2 mx-1 my-0.5 rounded-md transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${resolveTreeRowStateClass(
              'text-text-secondary dark:text-text-tertiary',
              {
                isHovered: isVisualBodyHovered,
                isSelected: isVisualBodySelected,
                isAttentionHighlighted: isVisualBodyAttentionHighlighted,
              },
            )}`}
            onClick={
              readOnly || isEditingVisualBody ? undefined : () => onSelectVisualBody(objectIndex)
            }
            onContextMenu={
              readOnly
                ? undefined
                : (event) => {
                    onOpenContextMenu(event, {
                      type: 'geometry',
                      linkId,
                      subType: 'visual',
                      objectIndex,
                      name: body.name?.trim() || '',
                    });
                  }
            }
            onMouseEnter={
              readOnly
                ? undefined
                : () =>
                    onSetHoveredSelection({
                      type: 'link',
                      id: linkId,
                      subType: 'visual',
                      objectIndex,
                    })
            }
            onMouseLeave={readOnly ? undefined : onClearHover}
            style={{ marginLeft: `${geometryRowIndentPx}px` }}
            title={visualBodyLabel}
          >
            <div
              className={getTreeConnectorElbowClass(
                isVisualBodySelected || isVisualBodyHovered || isVisualBodyAttentionHighlighted,
              )}
              style={getTreeConnectorElbowStyle(geometryRowIndentPx)}
            />
            <div
              className={`w-3.5 h-3.5 rounded flex items-center justify-center mr-1 shrink-0 border transition-colors ${
                isVisualBodySelected || isVisualBodyHovered || isVisualBodyAttentionHighlighted
                  ? 'bg-emerald-500/15 dark:bg-emerald-400/15 border-emerald-500/20 dark:border-emerald-400/20'
                  : 'bg-emerald-500/10 dark:bg-emerald-400/10 border-transparent'
              }`}
            >
              <Shapes
                size={9}
                className={
                  isVisualBodySelected || isVisualBodyHovered || isVisualBodyAttentionHighlighted
                    ? 'text-emerald-700 dark:text-emerald-300'
                    : 'text-emerald-500 dark:text-emerald-400'
                }
              />
            </div>
            {isEditingVisualBody ? (
              <input
                ref={renameInputRef}
                value={editingTarget.draft}
                onChange={(event) => onUpdateRenameDraft(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onBlur={onCommitRenaming}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onCommitRenaming();
                  } else if (event.key === 'Escape') {
                    onCancelRenaming();
                  }
                }}
                className={`${TREE_LINK_NAME_TEXT_CLASS} ${TREE_RENAME_INPUT_BASE_CLASS} flex-1 bg-input-bg border-border-strong text-text-primary focus:border-system-blue`}
              />
            ) : (
              <span className="text-[10px] font-medium truncate flex-1 min-w-0">
                {visualBodyLabel}
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                className={getGeometryVisibilityButtonClass(isVisualBodyEffectivelyVisible, {
                  inheritedHidden: isVisualBodyInheritedHidden,
                })}
                onClick={(event) => onToggleVisualBodyVisibility(event, bodyIndex)}
                title={isVisualBodyVisible ? t.hide : t.show}
                aria-label={isVisualBodyVisible ? t.hide : t.show}
                data-visibility-source={isVisualBodyInheritedHidden ? 'inherited' : 'local'}
              >
                {isVisualBodyEffectivelyVisible ? <Eye size={10} /> : <EyeOff size={10} />}
              </button>
            )}
          </div>
        );
      })}

      {link.collision?.type && link.collision.type !== GeometryType.NONE && (
        <div
          ref={primaryCollisionRowRef}
          className={`relative flex min-w-0 items-center py-0.5 px-2 mx-1 my-0.5 rounded-md transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${resolveTreeRowStateClass(
            'text-text-secondary dark:text-text-tertiary',
            {
              isHovered: isPrimaryCollisionHovered,
              isSelected: isPrimaryCollisionSelected,
              isAttentionHighlighted: isPrimaryCollisionAttentionHighlighted,
            },
          )}`}
          onClick={readOnly || isEditingPrimaryCollision ? undefined : onSelectPrimaryCollision}
          onContextMenu={
            readOnly
              ? undefined
              : (event) => {
                  onOpenContextMenu(event, {
                    type: 'geometry',
                    linkId,
                    subType: 'collision',
                    objectIndex: 0,
                    name: link.collision.name?.trim() || '',
                  });
                }
          }
          onMouseEnter={
            readOnly
              ? undefined
              : () =>
                  onSetHoveredSelection({
                    type: 'link',
                    id: linkId,
                    subType: 'collision',
                    objectIndex: 0,
                  })
          }
          onMouseLeave={readOnly ? undefined : onClearHover}
          style={{ marginLeft: `${geometryRowIndentPx}px` }}
          title={primaryCollisionLabel}
        >
          <div
            className={getTreeConnectorElbowClass(
              isPrimaryCollisionSelected ||
                isPrimaryCollisionHovered ||
                isPrimaryCollisionAttentionHighlighted,
            )}
            style={getTreeConnectorElbowStyle(geometryRowIndentPx)}
          />
          <div
            className={`w-3.5 h-3.5 rounded flex items-center justify-center mr-1 shrink-0 border transition-colors ${isPrimaryCollisionSelected || isPrimaryCollisionHovered || isPrimaryCollisionAttentionHighlighted ? 'bg-amber-500/15 dark:bg-amber-400/15 border-amber-500/20 dark:border-amber-400/20' : 'bg-amber-500/10 dark:bg-amber-400/10 border-transparent'}`}
          >
            <Shield
              size={9}
              className={
                isPrimaryCollisionSelected ||
                isPrimaryCollisionHovered ||
                isPrimaryCollisionAttentionHighlighted
                  ? 'text-amber-700 dark:text-amber-300'
                  : 'text-amber-500 dark:text-amber-400'
              }
            />
          </div>
          {isEditingPrimaryCollision ? (
            <input
              ref={renameInputRef}
              value={editingTarget.draft}
              onChange={(event) => onUpdateRenameDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onBlur={onCommitRenaming}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onCommitRenaming();
                } else if (event.key === 'Escape') {
                  onCancelRenaming();
                }
              }}
              className={`${TREE_LINK_NAME_TEXT_CLASS} ${TREE_RENAME_INPUT_BASE_CLASS} flex-1 bg-input-bg border-border-strong text-text-primary focus:border-system-blue`}
            />
          ) : (
            <span className="text-[10px] font-medium truncate flex-1 min-w-0">
              {primaryCollisionLabel}
            </span>
          )}
          {!readOnly && (
            <button
              type="button"
              className={getGeometryVisibilityButtonClass(isPrimaryCollisionEffectivelyVisible, {
                inheritedHidden: isPrimaryCollisionInheritedHidden,
              })}
              onClick={onTogglePrimaryCollisionVisibility}
              title={isPrimaryCollisionVisible ? t.hide : t.show}
              aria-label={isPrimaryCollisionVisible ? t.hide : t.show}
              data-visibility-source={isPrimaryCollisionInheritedHidden ? 'inherited' : 'local'}
            >
              {isPrimaryCollisionEffectivelyVisible ? <Eye size={10} /> : <EyeOff size={10} />}
            </button>
          )}
        </div>
      )}

      {visibleCollisionBodies.map(({ body, bodyIndex, objectIndex }, index) => {
        const collisionFallbackLabel = `${t.collision} ${index + (hasPrimaryCollision ? 2 : 1)}`;
        const collisionBodyLabel = getGeometryDisplayName(body.name, collisionFallbackLabel);
        const isCollisionBodyHovered = matchesSelection(hoveredSelection, {
          type: 'link',
          id: linkId,
          subType: 'collision',
          objectIndex,
        });
        const isCollisionBodyAttentionHighlighted = matchesSelection(attentionSelection, {
          type: 'link',
          id: linkId,
          subType: 'collision',
          objectIndex,
        });
        const isCollisionBodySelected =
          isLinkSelected &&
          robotSelection.subType === 'collision' &&
          selectedObjectIndex === objectIndex;
        const isCollisionBodyVisible = body.visible !== false;
        const isCollisionBodyInheritedHidden = !isLinkVisible && isCollisionBodyVisible;
        const isCollisionBodyEffectivelyVisible = isLinkVisible && isCollisionBodyVisible;
        const isEditingCollisionBody =
          editingTarget?.type === 'geometry' &&
          editingTarget.linkId === linkId &&
          editingTarget.subType === 'collision' &&
          editingTarget.objectIndex === objectIndex;

        return (
          <div
            ref={(element) => {
              collisionBodyRowRefs.current[objectIndex] = element;
            }}
            key={`collision-extra-${bodyIndex}`}
            className={`relative flex min-w-0 items-center py-0.5 px-2 mx-1 my-0.5 rounded-md transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer'} ${resolveTreeRowStateClass(
              'text-text-secondary dark:text-text-tertiary',
              {
                isHovered: isCollisionBodyHovered,
                isSelected: isCollisionBodySelected,
                isAttentionHighlighted: isCollisionBodyAttentionHighlighted,
              },
            )}`}
            onClick={
              readOnly || isEditingCollisionBody
                ? undefined
                : () => onSelectCollisionBody(objectIndex)
            }
            onContextMenu={
              readOnly
                ? undefined
                : (event) => {
                    onOpenContextMenu(event, {
                      type: 'geometry',
                      linkId,
                      subType: 'collision',
                      objectIndex,
                      name: body.name?.trim() || '',
                    });
                  }
            }
            onMouseEnter={
              readOnly
                ? undefined
                : () =>
                    onSetHoveredSelection({
                      type: 'link',
                      id: linkId,
                      subType: 'collision',
                      objectIndex,
                    })
            }
            onMouseLeave={readOnly ? undefined : onClearHover}
            style={{ marginLeft: `${geometryRowIndentPx}px` }}
            title={collisionBodyLabel}
          >
            <div
              className={getTreeConnectorElbowClass(
                isCollisionBodySelected ||
                  isCollisionBodyHovered ||
                  isCollisionBodyAttentionHighlighted,
              )}
              style={getTreeConnectorElbowStyle(geometryRowIndentPx)}
            />
            <div
              className={`w-3.5 h-3.5 rounded flex items-center justify-center mr-1 shrink-0 border transition-colors ${
                isCollisionBodySelected ||
                isCollisionBodyHovered ||
                isCollisionBodyAttentionHighlighted
                  ? 'bg-amber-500/15 dark:bg-amber-400/15 border-amber-500/20 dark:border-amber-400/20'
                  : 'bg-amber-500/10 dark:bg-amber-400/10 border-transparent'
              }`}
            >
              <Shield
                size={9}
                className={
                  isCollisionBodySelected ||
                  isCollisionBodyHovered ||
                  isCollisionBodyAttentionHighlighted
                    ? 'text-amber-700 dark:text-amber-300'
                    : 'text-amber-500 dark:text-amber-400'
                }
              />
            </div>
            {isEditingCollisionBody ? (
              <input
                ref={renameInputRef}
                value={editingTarget.draft}
                onChange={(event) => onUpdateRenameDraft(event.target.value)}
                onClick={(event) => event.stopPropagation()}
                onBlur={onCommitRenaming}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    onCommitRenaming();
                  } else if (event.key === 'Escape') {
                    onCancelRenaming();
                  }
                }}
                className={`${TREE_LINK_NAME_TEXT_CLASS} ${TREE_RENAME_INPUT_BASE_CLASS} flex-1 bg-input-bg border-border-strong text-text-primary focus:border-system-blue`}
              />
            ) : (
              <span className="text-[10px] font-medium truncate flex-1 min-w-0">
                {collisionBodyLabel}
              </span>
            )}
            {!readOnly && (
              <button
                type="button"
                className={getGeometryVisibilityButtonClass(isCollisionBodyEffectivelyVisible, {
                  inheritedHidden: isCollisionBodyInheritedHidden,
                })}
                onClick={(event) => onToggleCollisionBodyVisibility(event, bodyIndex)}
                title={isCollisionBodyVisible ? t.hide : t.show}
                aria-label={isCollisionBodyVisible ? t.hide : t.show}
                data-visibility-source={isCollisionBodyInheritedHidden ? 'inherited' : 'local'}
              >
                {isCollisionBodyEffectivelyVisible ? <Eye size={10} /> : <EyeOff size={10} />}
              </button>
            )}
          </div>
        );
      })}
    </>
  );
});
