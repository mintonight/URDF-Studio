import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { OptionsPanel } from './OptionsPanel';
import { getSingleDofJointEntries } from '@/shared/utils/jointTypes';
import type { JointPanelActiveJointOptions, JointPanelStore } from '@/shared/utils/jointPanelStore';
import { JointPanelControls, JointPanelList } from './JointPanelContent';

const JOINT_PANEL_HEADER_ESTIMATED_HEIGHT = 52;
const JOINT_PANEL_ITEM_ESTIMATED_HEIGHT = 74;

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
  setActiveJoint: (name: string | null, options?: JointPanelActiveJointOptions) => void;
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
  const [isAdvanced, setIsAdvanced] = useState(false);
  const onHoverRef = useRef(onHover);
  const jointEntries = useMemo(() => getSingleDofJointEntries(robot?.joints), [robot?.joints]);
  const shouldShow = showJointPanel && jointEntries.length > 0;

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

  const resolvedPanelHeight = useMemo(() => {
    if (typeof maxHeight !== 'number' || !Number.isFinite(maxHeight)) {
      return undefined;
    }

    const estimatedHeight =
      JOINT_PANEL_HEADER_ESTIMATED_HEIGHT + jointEntries.length * JOINT_PANEL_ITEM_ESTIMATED_HEIGHT;
    return Math.min(maxHeight, estimatedHeight);
  }, [jointEntries.length, maxHeight]);

  const additionalControls = (
    <JointPanelControls
      t={t}
      angleUnit={angleUnit}
      setAngleUnit={setAngleUnit}
      isAdvanced={isAdvanced}
      setIsAdvanced={setIsAdvanced}
      onReset={handleResetJoints}
    />
  );

  return (
    <OptionsPanel
      title={t.joints || 'Joints'}
      show={!!shouldShow}
      showDragGrip={false}
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
      height={resolvedPanelHeight}
      maxHeight={maxHeight}
      additionalControls={additionalControls}
      zIndex={40}
      resizeTitle={t.resize}
      panelClassName="urdf-joint-panel"
      onMouseEnter={clearGlobalHover}
      onMouseLeave={clearGlobalHover}
    >
      <JointPanelList
        robot={robot}
        angleUnit={angleUnit}
        jointPanelStore={jointPanelStore}
        setActiveJoint={setActiveJoint}
        handleJointAngleChange={handleJointAngleChange}
        handleJointChangeCommit={handleJointChangeCommit}
        onSelect={onSelect}
        onHover={onHover}
        isAdvanced={isAdvanced}
        onUpdate={onUpdate}
      />
    </OptionsPanel>
  );
};
