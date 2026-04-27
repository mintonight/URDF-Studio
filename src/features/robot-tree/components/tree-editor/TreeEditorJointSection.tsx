import React from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { resolveJointKey } from '@/core/robot';
import { translations } from '@/shared/i18n';
import { JointPanelControls, JointPanelList } from '@/shared/components/Panel/JointPanelContent';
import { createJointPanelStore } from '@/shared/utils/jointPanelStore';
import { normalizeViewerJointAngleState } from '@/shared/utils/jointPanelState';
import { getSingleDofJointEntries, isSingleDofJoint } from '@/shared/utils/jointTypes';
import type { Language } from '@/store';
import { useUIStore } from '@/store';

const TREE_EDITOR_JOINT_SECTION_KEY = 'tree_editor_joint_panel';
interface TreeEditorJointSectionProps {
  robot: {
    name?: string;
    rootLinkId?: string | null;
    selection: { id: string | null; type: string | null };
    joints: Record<string, any>;
    links: Record<string, any>;
    inspectionContext?: { sourceFormat?: string | null };
  };
  lang: Language;
  onSelect: (type: 'link' | 'joint', id: string, subType?: 'visual' | 'collision') => void;
  onUpdate: (type: 'link' | 'joint', id: string, data: unknown) => void;
  onJointAngleChange?: (jointName: string, angle: number) => void;
  show: boolean;
  sourceFilePath?: string;
  height: number;
  isDragging?: boolean;
}

function buildJointAngleSnapshot(joints: Record<string, any>) {
  const nextAngles: Record<string, number> = {};
  Object.entries(joints).forEach(([jointId, joint]) => {
    if (typeof joint?.angle !== 'number' || !Number.isFinite(joint.angle)) {
      return;
    }

    nextAngles[jointId] = joint.angle;
    if (typeof joint.name === 'string' && joint.name.length > 0) {
      nextAngles[joint.name] = joint.angle;
    }
  });

  return normalizeViewerJointAngleState(joints, nextAngles);
}

export function TreeEditorJointSection({
  robot,
  lang,
  onSelect,
  onUpdate,
  onJointAngleChange,
  show,
  sourceFilePath,
  height,
  isDragging = false,
}: TreeEditorJointSectionProps) {
  const t = translations[lang];
  const jointEntries = React.useMemo(
    () => getSingleDofJointEntries(robot?.joints),
    [robot?.joints],
  );
  const hasJointEntries = jointEntries.length > 0;
  const panelSections = useUIStore((state) => state.panelSections);
  const setPanelSection = useUIStore((state) => state.setPanelSection);
  const isCollapsed = panelSections[TREE_EDITOR_JOINT_SECTION_KEY] ?? false;
  const [angleUnit, setAngleUnit] = React.useState<'rad' | 'deg'>('rad');
  const [isAdvanced, setIsAdvanced] = React.useState(false);
  const jointPanelStoreRef = React.useRef(createJointPanelStore());
  const initialJointAnglesRef = React.useRef<Record<string, number>>({});
  const resetScopeRef = React.useRef<string | null>(null);
  const previousActiveJointRef = React.useRef<string | null>(null);
  const shouldShow = show;
  const jointAngleSnapshot = React.useMemo(
    () => buildJointAngleSnapshot(robot.joints),
    [robot.joints],
  );
  const resetScopeKey = sourceFilePath ?? `${robot.name ?? 'robot'}:${robot.rootLinkId ?? 'root'}`;

  React.useEffect(() => {
    jointPanelStoreRef.current.replaceJointAngles(jointAngleSnapshot);
  }, [jointAngleSnapshot]);

  React.useEffect(() => {
    if (resetScopeRef.current === resetScopeKey) {
      return;
    }

    resetScopeRef.current = resetScopeKey;
    initialJointAnglesRef.current = jointAngleSnapshot;
  }, [jointAngleSnapshot, resetScopeKey]);

  React.useEffect(() => {
    const selectedJointId =
      robot.selection.type === 'joint' && robot.selection.id
        ? resolveJointKey(robot.joints, robot.selection.id)
        : null;
    const selectedJoint =
      selectedJointId && isSingleDofJoint(robot.joints[selectedJointId]) ? selectedJointId : null;
    const autoScroll = selectedJoint !== null && previousActiveJointRef.current !== selectedJoint;

    jointPanelStoreRef.current.setActiveJoint(selectedJoint, { autoScroll });
    previousActiveJointRef.current = selectedJoint;
  }, [robot.joints, robot.selection.id, robot.selection.type]);

  const handleResetJoints = React.useCallback(() => {
    jointEntries.forEach(([jointId, joint]) => {
      const nextAngle =
        initialJointAnglesRef.current[jointId] ??
        (typeof joint?.angle === 'number' && Number.isFinite(joint.angle) ? joint.angle : 0);
      onJointAngleChange?.(jointId, nextAngle);
    });
  }, [jointEntries, onJointAngleChange]);

  if (!shouldShow) {
    return null;
  }

  return (
    <div
      className={`relative flex min-h-0 shrink-0 flex-col overflow-hidden border-t border-border-black/60 bg-element-bg dark:bg-element-bg ${isDragging ? '' : 'transition-[height] duration-200 ease-out'}`}
      style={{ height: isCollapsed ? 'auto' : `${height}px` }}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 py-1 transition-colors hover:bg-element-hover">
        <button
          type="button"
          data-testid="tree-editor-joint-section-toggle"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setPanelSection(TREE_EDITOR_JOINT_SECTION_KEY, !isCollapsed)}
        >
          {isCollapsed ? (
            <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5 text-text-tertiary" />
          )}
          <span className="truncate text-[11px] font-semibold leading-none tracking-[0.02em] text-text-secondary">
            {t.joints || 'Joints'}
          </span>
        </button>
        {hasJointEntries ? (
          <div className="flex min-w-fit shrink-0 items-center gap-1">
            <JointPanelControls
              t={t}
              angleUnit={angleUnit}
              setAngleUnit={setAngleUnit}
              isAdvanced={isAdvanced}
              setIsAdvanced={setIsAdvanced}
              onReset={handleResetJoints}
              compact
            />
            <span aria-hidden="true" className="sr-only">
              {isCollapsed ? t.expand : t.collapse}
            </span>
          </div>
        ) : null}
      </div>
      <div
        data-testid="tree-editor-joint-section-content"
        className={`overflow-hidden transition-all duration-200 ease-in-out ${
          isCollapsed ? 'max-h-0 opacity-0' : 'flex min-h-0 flex-1 flex-col opacity-100'
        }`}
      >
        <div className="flex min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden border-t border-border-black/40 bg-white py-1 dark:bg-panel-bg custom-scrollbar">
          {hasJointEntries ? (
            <JointPanelList
              robot={robot}
              angleUnit={angleUnit}
              jointPanelStore={jointPanelStoreRef.current}
              setActiveJoint={jointPanelStoreRef.current.setActiveJoint}
              handleJointAngleChange={(jointName, angle) => onJointAngleChange?.(jointName, angle)}
              handleJointChangeCommit={(jointName, angle) => onJointAngleChange?.(jointName, angle)}
              onSelect={onSelect}
              isAdvanced={isAdvanced}
              onUpdate={onUpdate}
              className="space-y-0.5 px-1 py-1"
            />
          ) : (
            <div className="flex min-h-0 flex-1 items-center justify-center px-3 py-4 text-center text-[11px] text-text-tertiary">
              {t.noJointsYet || 'No joints yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
