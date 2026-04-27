import React from 'react';

import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { JointsPanel } from '@/shared/components/Panel/JointsPanel';
import { type ViewerController, useResponsivePanelLayout } from '@/features/editor';

export function ViewerJointsPanel({
  controller,
  showJointPanel,
  setShowJointPanel,
  lang,
  onUpdate,
}: {
  controller: ViewerController;
  showJointPanel: boolean;
  setShowJointPanel?: (show: boolean) => void;
  lang: Language;
  onUpdate?: (type: 'link' | 'joint', id: string, data: unknown) => void;
}) {
  const t = translations[lang];
  const { jointsDefaultPosition, jointsPanelMaxHeight } = useResponsivePanelLayout({
    containerRef: controller.containerRef,
    optionsPanelRef: controller.optionsPanelRef,
    jointPanelRef: controller.jointPanelRef,
    showOptionsPanel: false,
    showJointPanel,
    preferEdgeDockedJointPanel: true,
  });

  return (
    <JointsPanel
      showJointPanel={showJointPanel}
      robot={controller.jointPanelRobot ?? controller.robot}
      jointPanelRef={controller.jointPanelRef}
      jointPanelPos={controller.jointPanelPos}
      defaultPosition={jointsDefaultPosition}
      maxHeight={jointsPanelMaxHeight}
      onMouseDown={(event) => controller.handleMouseDown('joints', event)}
      t={t}
      handleResetJoints={controller.handleResetJoints}
      angleUnit={controller.angleUnit}
      setAngleUnit={controller.setAngleUnit}
      isJointsCollapsed={controller.isJointsCollapsed}
      toggleJointsCollapsed={controller.toggleJointsCollapsed}
      setShowJointPanel={setShowJointPanel}
      jointPanelStore={controller.jointPanelStore}
      setActiveJoint={controller.setActiveJoint}
      handleJointAngleChange={controller.handleJointAngleChange}
      handleJointChangeCommit={controller.handleJointChangeCommit}
      onSelect={controller.handleSelectWrapper}
      onHover={controller.handleHoverWrapper}
      onUpdate={onUpdate}
    />
  );
}
