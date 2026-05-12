import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw, Settings } from 'lucide-react';
import { JointControlItem } from './JointControlItem';
import { getSingleDofJointEntries } from '@/shared/utils/jointTypes';
import { resolveViewerJointAngleValue } from '@/shared/utils/jointPanelState';
import {
  getMjcfJointDisplayName,
  getMjcfLinkDisplayName,
} from '@/shared/utils/robot/mjcfDisplayNames';
import type { JointPanelActiveJointOptions, JointPanelStore } from '@/shared/utils/jointPanelStore';

interface JointPanelItemBindingProps {
  name: string;
  joint: any;
  displayName?: string;
  angleUnit: 'rad' | 'deg';
  jointPanelStore: JointPanelStore;
  setActiveJoint: (name: string | null, options?: JointPanelActiveJointOptions) => void;
  handleJointAngleChange: (name: string, angle: number) => void;
  handleJointChangeCommit: (name: string, angle: number) => void;
  onSelect?: (type: 'link' | 'joint', id: string) => void;
  isAdvanced?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
}

interface JointPanelItemSnapshot {
  value: number;
  isActive: boolean;
  shouldAutoScroll: boolean;
}

export interface JointPanelControlsProps {
  t: any;
  angleUnit: 'rad' | 'deg';
  setAngleUnit: (unit: 'rad' | 'deg') => void;
  isAdvanced: boolean;
  setIsAdvanced: React.Dispatch<React.SetStateAction<boolean>>;
  onReset?: () => void;
  compact?: boolean;
}

export interface JointPanelListProps {
  robot: any;
  angleUnit: 'rad' | 'deg';
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
  isAdvanced?: boolean;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
  className?: string;
}

function areJointPanelItemSnapshotsEqual(a: JointPanelItemSnapshot, b: JointPanelItemSnapshot) {
  return (
    a.value === b.value && a.isActive === b.isActive && a.shouldAutoScroll === b.shouldAutoScroll
  );
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
    shouldAutoScroll: snapshot.activeJoint === name && snapshot.activeJointAutoScroll,
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
  const { value, isActive, shouldAutoScroll } = useJointPanelItemSnapshot(
    jointPanelStore,
    name,
    joint,
  );

  return (
    <JointControlItem
      name={name}
      joint={joint}
      displayName={displayName}
      value={value}
      angleUnit={angleUnit}
      isActive={isActive}
      shouldAutoScroll={shouldAutoScroll}
      setActiveJoint={setActiveJoint}
      handleJointAngleChange={handleJointAngleChange}
      handleJointChangeCommit={handleJointChangeCommit}
      onSelect={onSelect}
      isAdvanced={isAdvanced}
      onUpdate={onUpdate}
    />
  );
});

export function JointPanelControls({
  t,
  angleUnit,
  setAngleUnit,
  isAdvanced,
  setIsAdvanced,
  onReset,
  compact = false,
}: JointPanelControlsProps) {
  const buttonHeightClass = compact ? 'h-5' : 'h-6';
  const sidePaddingClass = compact ? 'px-1' : 'px-1 @[300px]:px-2';
  const textClass = compact ? 'hidden' : 'text-[10px] hidden @[300px]:inline whitespace-nowrap';
  const iconClass = compact ? 'h-2.5 w-2.5' : 'w-3 h-3';
  const unitMinWidthClass = compact ? 'min-w-[24px]' : 'min-w-[26px] @[300px]:min-w-[32px]';

  return (
    <div className="mr-1 flex shrink-0 items-center gap-0.5 @[320px]:gap-1">
      {onReset ? (
        <button
          onClick={(event) => {
            event.stopPropagation();
            onReset();
          }}
          className={`inline-flex ${buttonHeightClass} items-center justify-center gap-1 rounded border border-border-black/60 bg-panel-bg ${sidePaddingClass} text-text-secondary transition-colors hover:bg-system-blue/10 hover:text-system-blue`}
          title={t.resetJoints}
        >
          <RotateCcw className={iconClass} />
          <span className={textClass}>{t.reset || 'Reset'}</span>
        </button>
      ) : null}
      <button
        onClick={(event) => {
          event.stopPropagation();
          setIsAdvanced((previous) => !previous);
        }}
        className={`inline-flex ${buttonHeightClass} items-center justify-center gap-1 rounded border border-border-black/60 ${sidePaddingClass} transition-colors ${
          isAdvanced
            ? 'bg-system-blue-solid text-white border-system-blue-solid'
            : 'bg-panel-bg text-text-secondary hover:bg-system-blue/10 hover:text-system-blue'
        }`}
        title={t.advanced || 'Advanced'}
      >
        <Settings className={iconClass} />
        <span className={textClass}>{t.advanced || 'Advanced'}</span>
      </button>
      <button
        onClick={(event) => {
          event.stopPropagation();
          setAngleUnit(angleUnit === 'rad' ? 'deg' : 'rad');
        }}
        className={`inline-flex ${buttonHeightClass} ${unitMinWidthClass} items-center justify-center rounded bg-element-bg px-1 text-[10px] font-mono text-text-secondary transition-colors hover:bg-element-hover dark:text-text-secondary`}
        title={t.switchUnit}
      >
        {angleUnit.toUpperCase()}
      </button>
    </div>
  );
}

export function JointPanelList({
  robot,
  angleUnit,
  jointPanelStore,
  setActiveJoint,
  handleJointAngleChange,
  handleJointChangeCommit,
  onSelect,
  onHover,
  isAdvanced = false,
  onUpdate,
  className = 'px-1 py-1.5 space-y-1',
}: JointPanelListProps) {
  const onHoverRef = useRef(onHover);
  const jointEntries = useMemo(() => getSingleDofJointEntries(robot?.joints), [robot?.joints]);
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

  return (
    <div
      className={`w-full min-w-0 ${className}`}
      onMouseEnter={clearGlobalHover}
      onMouseLeave={clearGlobalHover}
    >
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
  );
}
