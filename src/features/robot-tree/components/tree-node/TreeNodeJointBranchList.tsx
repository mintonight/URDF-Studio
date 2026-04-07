import { memo, type MouseEvent, type ReactNode, type RefObject } from 'react';
import { Trash2 } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n';
import { getMjcfJointDisplayName } from '@/shared/utils/robot/mjcfDisplayNames';
import { matchesSelection, type Selection } from '@/store/selectionStore';
import { JointType, type RobotState } from '@/types';
import type { TreeNodeContextMenuTarget, TreeNodeEditingTarget } from './types';
import {
  getJointTypeIcon,
  getJointTypeLabel,
  getTreeConnectorElbowClass,
  getTreeConnectorElbowStyle,
  getTreeConnectorRailClass,
  resolveTreeRowStateClass,
  TREE_JOINT_NAME_TEXT_CLASS,
  TREE_RENAME_INPUT_BASE_CLASS,
} from './presentation';

interface TreeNodeJointBranchListProps {
  childJoints: RobotState['joints'][string][];
  robotSelection: RobotState['selection'];
  hoveredSelection: Selection;
  attentionSelection: Selection;
  selectionBranchLinkIds?: Set<string>;
  editingTarget: TreeNodeEditingTarget | null;
  renameInputRef: RefObject<HTMLInputElement | null>;
  jointRowRefs: RefObject<Record<string, HTMLDivElement | null>>;
  jointRowIndentPx: number;
  sourceFormat?: NonNullable<RobotState['inspectionContext']>['sourceFormat'];
  parentLinkDisplayName: string;
  childLinkDisplayNames: Record<string, string>;
  t: TranslationKeys;
  readOnly: boolean;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onDelete: (id: string) => void;
  onSetHoveredSelection: (selection: Selection) => void;
  onClearHover: () => void;
  onOpenContextMenu: (event: MouseEvent<HTMLDivElement>, target: TreeNodeContextMenuTarget) => void;
  onUpdateRenameDraft: (value: string) => void;
  onCommitRenaming: () => void;
  onCancelRenaming: () => void;
  onNameDoubleClick: (
    event: MouseEvent,
    type: 'link' | 'joint',
    id: string,
    currentName: string,
  ) => void;
  renderChildNode: (childLinkId: string) => ReactNode;
}

export const TreeNodeJointBranchList = memo(function TreeNodeJointBranchList({
  childJoints,
  robotSelection,
  hoveredSelection,
  attentionSelection,
  selectionBranchLinkIds,
  editingTarget,
  renameInputRef,
  jointRowRefs,
  jointRowIndentPx,
  sourceFormat,
  parentLinkDisplayName,
  childLinkDisplayNames,
  t,
  readOnly,
  onSelect,
  onDelete,
  onSetHoveredSelection,
  onClearHover,
  onOpenContextMenu,
  onUpdateRenameDraft,
  onCommitRenaming,
  onCancelRenaming,
  onNameDoubleClick,
  renderChildNode,
}: TreeNodeJointBranchListProps) {
  return (
    <>
      {childJoints.map((joint) => {
        const isLinkedChildHovered =
          hoveredSelection.type === 'link' && hoveredSelection.id === joint.childLinkId;
        const isLinkedChildAttention =
          attentionSelection.type === 'link' && attentionSelection.id === joint.childLinkId;
        const isJointSelected = robotSelection.type === 'joint' && robotSelection.id === joint.id;
        const isJointHovered =
          matchesSelection(hoveredSelection, { type: 'joint', id: joint.id }) ||
          isLinkedChildHovered;
        const isJointAttentionHighlighted =
          matchesSelection(attentionSelection, { type: 'joint', id: joint.id }) ||
          isLinkedChildAttention;
        const isEditingJoint = editingTarget?.type === 'joint' && editingTarget.id === joint.id;
        const jointTypeLabel = getJointTypeLabel(joint.type, t);
        const JointTypeIcon = getJointTypeIcon(joint.type);
        const jointIconSize = joint.type === JointType.FIXED ? 7 : 8;
        const childLinkDisplayName = childLinkDisplayNames[joint.childLinkId] || joint.childLinkId;
        const jointDisplayName =
          sourceFormat === 'mjcf'
            ? getMjcfJointDisplayName(joint, parentLinkDisplayName, childLinkDisplayName)
            : joint.name || joint.id;
        const isJointSubtreeHighlighted =
          isJointSelected ||
          isJointHovered ||
          isJointAttentionHighlighted ||
          (selectionBranchLinkIds?.has(joint.childLinkId) ?? false);

        return (
          <div key={joint.id} className="relative">
            <div
              ref={(element) => {
                jointRowRefs.current[joint.id] = element;
              }}
              className={`relative flex items-center py-0.5 px-2 mx-1 my-0.5 rounded-md transition-all duration-200 ${readOnly ? 'cursor-default' : 'cursor-pointer group'} ${resolveTreeRowStateClass(
                'text-text-secondary dark:text-text-tertiary',
                {
                  isHovered: isJointHovered,
                  isSelected: isJointSelected,
                  isAttentionHighlighted: isJointAttentionHighlighted,
                },
              )}`}
              onClick={readOnly ? undefined : () => onSelect('joint', joint.id)}
              onContextMenu={
                readOnly
                  ? undefined
                  : (event) =>
                      onOpenContextMenu(event, { type: 'joint', id: joint.id, name: joint.name })
              }
              onMouseEnter={
                readOnly ? undefined : () => onSetHoveredSelection({ type: 'joint', id: joint.id })
              }
              onMouseLeave={readOnly ? undefined : onClearHover}
              title={`${jointDisplayName} · ${jointTypeLabel}`}
              style={{ marginLeft: `${jointRowIndentPx}px` }}
            >
              <div
                className={getTreeConnectorElbowClass(
                  isJointSelected || isJointHovered || isJointAttentionHighlighted,
                )}
                style={getTreeConnectorElbowStyle(jointRowIndentPx)}
              />

              <div
                className={`w-4 h-4 rounded flex items-center justify-center mr-1 shrink-0 border transition-colors
                  ${isJointSelected || isJointHovered || isJointAttentionHighlighted ? 'bg-orange-500/15 dark:bg-orange-400/15 border-orange-500/20 dark:border-orange-400/20' : 'bg-orange-500/10 dark:bg-orange-400/10 border-transparent'}`}
              >
                <JointTypeIcon
                  size={jointIconSize}
                  className={
                    isJointSelected || isJointHovered || isJointAttentionHighlighted
                      ? 'text-orange-700 dark:text-orange-300'
                      : 'text-orange-600 dark:text-orange-300'
                  }
                />
              </div>

              {isEditingJoint ? (
                <input
                  ref={renameInputRef}
                  value={editingTarget?.draft ?? ''}
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
                  className={`${TREE_JOINT_NAME_TEXT_CLASS} ${TREE_RENAME_INPUT_BASE_CLASS} ${
                    isJointSelected
                      ? 'bg-panel-bg border-border-strong text-text-primary focus:border-system-blue'
                      : 'bg-input-bg border-border-strong text-text-primary focus:border-system-blue'
                  }`}
                />
              ) : (
                <div className="flex items-center gap-1 min-w-0 flex-1">
                  <span
                    className={`${TREE_JOINT_NAME_TEXT_CLASS} whitespace-nowrap select-none truncate`}
                    onDoubleClick={
                      readOnly
                        ? undefined
                        : (event) => onNameDoubleClick(event, 'joint', joint.id, joint.name)
                    }
                    onDragStart={(event) => event.preventDefault()}
                    title={jointDisplayName}
                  >
                    {jointDisplayName}
                  </span>
                </div>
              )}

              {!readOnly && (
                <div
                  className={`flex items-center gap-0.5 ml-1 ${
                    isJointSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                  }`}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onDelete(joint.childLinkId);
                    }}
                    className={`p-0.5 rounded transition-colors ${
                      isJointSelected ? 'hover:bg-panel-bg' : 'hover:bg-element-hover'
                    }`}
                    title={t.deleteBranch}
                    aria-label={t.deleteBranch}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </div>

            <div className="relative" style={{ marginLeft: `${jointRowIndentPx}px` }}>
              <div
                className={`absolute left-0 top-0.5 bottom-1.5 w-px rounded-full ${getTreeConnectorRailClass(isJointSubtreeHighlighted)}`}
              />
              {renderChildNode(joint.childLinkId)}
            </div>
          </div>
        );
      })}
    </>
  );
});
