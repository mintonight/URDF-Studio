import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Settings } from 'lucide-react';
import { OptionsPanel } from './OptionsPanel';
import { JointControlItem } from './JointControlItem';
import { isSingleDofJoint } from '@/shared/utils/jointTypes';
import { resolveViewerJointAngleValue } from '@/shared/utils/jointPanelState';
import {
  getMjcfJointDisplayName,
  getMjcfLinkDisplayName,
} from '@/shared/utils/robot/mjcfDisplayNames';
import type { JointPanelStore } from '@/shared/utils/jointPanelStore';

interface JointsPanelProps {
  showJointPanel: boolean;
  robot: any;
  jointPanelRef: React.RefObject<HTMLDivElement>;
  jointPanelPos: { x: number; y: number } | null;
  defaultPosition?: {
    top?: string;
    right?: string;
    left?: string;
    bottom?: string;
    transform?: string;
  };
  maxHeight?: number;
  onMouseDown: (e: React.MouseEvent) => void;
  t: any;
  handleResetJoints: () => void;
  angleUnit: 'rad' | 'deg';
  setAngleUnit: (unit: 'rad' | 'deg') => void;
  isJointsCollapsed: boolean;
  toggleJointsCollapsed: () => void;
  setShowJointPanel?: (show: boolean) => void;
  jointPanelStore: JointPanelStore;
  setActiveJoint: (name: string | null) => void;
  handleJointAngleChange: (name: string, angle: number) => void;
  handleJointChangeCommit: (name: string, angle: number) => void;
  onSelect?: (type: 'link' | 'joint', id: string) => void;
  onHover?: (
    type: 'link' | 'joint' | null,
    id: string | null,
    subType?: 'visual' | 'collision',
  ) => void;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
}

interface JointPanelItemBindingProps {
  name: string;
  joint: any;
  displayName?: string;
  angleUnit: 'rad' | 'deg';
  jointPanelStore: JointPanelStore;
  setActiveJoint: (name: string | null) => void;
  handleJointAngleChange: (name: string, angle: number) => void;
  handleJointChangeCommit: (name: string, angle: number) => void;
  onSelect?: (type: 'link' | 'joint', id: string) => void;
  isAdvanced?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
}

interface JointPanelItemSnapshot {
  value: number;
  isActive: boolean;
}

function areJointPanelItemSnapshotsEqual(a: JointPanelItemSnapshot, b: JointPanelItemSnapshot) {
  return a.value === b.value && a.isActive === b.isActive;
}

function resolveJointPanelItemSnapshot(
  jointPanelStore: JointPanelStore,
  name: string,
  joint: any,
): JointPanelItemSnapshot {
  const snapshot = jointPanelStore.getSnapshot();

  return {
    value: resolveViewerJointAngleValue(snapshot.jointAngles, name, joint, 0),
    isActive: snapshot.activeJoint === name,
  };
}

function useJointPanelItemSnapshot(jointPanelStore: JointPanelStore, name: string, joint: any) {
  const getSnapshot = useCallback(
    () => resolveJointPanelItemSnapshot(jointPanelStore, name, joint),
    [jointPanelStore, joint, name],
  );

  const [itemSnapshot, setItemSnapshot] = useState<JointPanelItemSnapshot>(() => getSnapshot());

  useEffect(() => {
    const syncSnapshot = () => {
      setItemSnapshot((previousSnapshot) => {
        const nextSnapshot = getSnapshot();
        return areJointPanelItemSnapshotsEqual(previousSnapshot, nextSnapshot)
          ? previousSnapshot
          : nextSnapshot;
      });
    };

    syncSnapshot();
    return jointPanelStore.subscribe(syncSnapshot);
  }, [getSnapshot, jointPanelStore]);

  return itemSnapshot;
}

const JointPanelItemBinding = React.memo(function JointPanelItemBinding({
  name,
  joint,
  displayName,
  angleUnit,
  jointPanelStore,
  setActiveJoint,
  handleJointAngleChange,
  handleJointChangeCommit,
  onSelect,
  isAdvanced = false,
  onUpdate,
}: JointPanelItemBindingProps) {
  const { value, isActive } = useJointPanelItemSnapshot(jointPanelStore, name, joint);

  return (
    <JointControlItem
      name={name}
      joint={joint}
      displayName={displayName}
      value={value}
      angleUnit={angleUnit}
      isActive={isActive}
      setActiveJoint={setActiveJoint}
      handleJointAngleChange={handleJointAngleChange}
      handleJointChangeCommit={handleJointChangeCommit}
      onSelect={onSelect}
      isAdvanced={isAdvanced}
      onUpdate={onUpdate}
    />
  );
});

export const JointsPanel: React.FC<JointsPanelProps> = ({
  showJointPanel,
  robot,
  jointPanelRef,
  jointPanelPos,
  defaultPosition,
  maxHeight,
  onMouseDown,
  t,
  handleResetJoints,
  angleUnit,
  setAngleUnit,
  isJointsCollapsed,
  toggleJointsCollapsed,
  setShowJointPanel,
  jointPanelStore,
  setActiveJoint,
  handleJointAngleChange,
  handleJointChangeCommit,
  onSelect,
  onHover,
  onUpdate,
}) => {
  // Condition to show
  const shouldShow = showJointPanel && robot?.joints && Object.keys(robot.joints).length > 0;
  const [isAdvanced, setIsAdvanced] = useState(false);
  const onHoverRef = useRef(onHover);
  const jointEntries = useMemo(
    () => Object.entries(robot?.joints ?? {}).filter(([_, joint]) => isSingleDofJoint(joint)),
    [robot?.joints],
  );
  const sourceFormat = robot?.inspectionContext?.sourceFormat;
  const linkDisplayNames = useMemo<Record<string, string>>(
    () =>
      Object.fromEntries(
        Object.values(robot?.links ?? {}).map((link: any) => [
          link.id,
          sourceFormat === 'mjcf' ? getMjcfLinkDisplayName(link) : link.name || link.id,
        ]),
      ),
    [robot?.links, sourceFormat],
  );

  useEffect(() => {
    onHoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    return () => {
      onHoverRef.current?.(null, null);
    };
  }, []);

  const clearGlobalHover = useCallback(() => {
    onHoverRef.current?.(null, null);
  }, []);

  const additionalControls = (
    <div className="mr-1 flex shrink-0 items-center gap-0.5 @[320px]:gap-1">
      <button
        onClick={(e) => {
          e.stopPropagation();
          handleResetJoints();
        }}
        className="inline-flex h-6 items-center justify-center gap-1 rounded border border-border-black/60 bg-panel-bg px-1 text-text-secondary transition-colors hover:bg-system-blue/10 hover:text-system-blue @[300px]:px-2"
        title={t.resetJoints}
      >
        <RotateCcw className="w-3 h-3" />
        <span className="text-[10px] hidden @[300px]:inline whitespace-nowrap">
          {t.reset || 'Reset'}
        </span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setIsAdvanced(!isAdvanced);
        }}
        className={`inline-flex h-6 items-center justify-center gap-1 rounded border border-border-black/60 px-1 transition-colors @[300px]:px-2 ${
          isAdvanced
            ? 'bg-system-blue-solid text-white border-system-blue-solid'
            : 'bg-panel-bg text-text-secondary hover:bg-system-blue/10 hover:text-system-blue'
        }`}
        title={t.advanced || 'Advanced'}
      >
        <Settings className="w-3 h-3" />
        <span className="text-[10px] hidden @[300px]:inline whitespace-nowrap">
          {t.advanced || 'Advanced'}
        </span>
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation();
          setAngleUnit(angleUnit === 'rad' ? 'deg' : 'rad');
        }}
        className="inline-flex h-6 min-w-[26px] items-center justify-center rounded bg-element-bg px-1 text-[10px] font-mono text-text-secondary transition-colors hover:bg-element-hover dark:text-text-secondary @[300px]:min-w-[32px]"
        title={t.switchUnit}
      >
        {angleUnit.toUpperCase()}
      </button>
    </div>
  );

  return (
    <OptionsPanel
      title={t.joints || 'Joints'}
      show={!!shouldShow}
      panelRef={jointPanelRef}
      position={jointPanelPos}
      defaultPosition={
        defaultPosition ?? { top: '50%', left: '16px', transform: 'translateY(-50%)' }
      }
      isCollapsed={isJointsCollapsed}
      onToggleCollapse={toggleJointsCollapsed}
      onClose={() => setShowJointPanel && setShowJointPanel(false)}
      onMouseDown={onMouseDown}
      resizable={true}
      maxHeight={maxHeight}
      additionalControls={additionalControls}
      zIndex={40}
      resizeTitle={t.resize}
      panelClassName="urdf-joint-panel"
      onMouseEnter={clearGlobalHover}
      onMouseLeave={clearGlobalHover}
    >
      <div className="px-1 py-1.5 space-y-1">
        {jointEntries.map(([name, joint]: [string, any]) => (
          <JointPanelItemBinding
            key={name}
            name={name}
            joint={joint}
            displayName={
              sourceFormat === 'mjcf'
                ? getMjcfJointDisplayName(
                    joint,
                    linkDisplayNames[joint.parentLinkId] || joint.parentLinkId,
                    linkDisplayNames[joint.childLinkId] || joint.childLinkId,
                  )
                : joint.name || name
            }
            angleUnit={angleUnit}
            jointPanelStore={jointPanelStore}
            setActiveJoint={setActiveJoint}
            handleJointAngleChange={handleJointAngleChange}
            handleJointChangeCommit={handleJointChangeCommit}
            onSelect={onSelect}
            isAdvanced={isAdvanced}
            onUpdate={onUpdate}
          />
        ))}
      </div>
    </OptionsPanel>
  );
};
