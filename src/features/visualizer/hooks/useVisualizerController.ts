import { useCallback, useEffect, useRef } from 'react';
import * as THREE from 'three';
import {
  isSyntheticWorldRoot,
  resolveLinkKey,
  updateCollisionGeometryByObjectIndex,
} from '@/core/robot';
import type { AppMode, RobotState } from '@/types';
import { useSelectionStore } from '@/store/selectionStore';
import { useUIStore } from '@/store';
import { alignObjectLowestPointToZ } from '@/shared/utils';
import { useCollisionRefs } from './useCollisionRefs';
import { useClosedLoopDragSync } from './useClosedLoopDragSync';
import { useDraggablePanel } from './useDraggablePanel';
import { useJointPivots } from './useJointPivots';
import { useTransformControls } from './useTransformControls';
import { useVisualizerState } from './useVisualizerState';
import { clearMaterialCache } from '../utils';
import { resetSyntheticRootGroundOffset } from '../utils/groundAlignment';
import { shouldEnableMergedVisualizerJointTransformControls } from '../utils/mergedVisualizerSceneMode';

interface UseVisualizerControllerProps {
  robot: RobotState;
  onUpdate: (type: 'link' | 'joint', id: string, data: any) => void;
  mode: AppMode;
  assemblyWorkspaceActive?: boolean;
  propShowVisual?: boolean;
  propSetShowVisual?: (show: boolean) => void;
}

export const useVisualizerController = ({
  robot,
  onUpdate,
  mode,
  assemblyWorkspaceActive = false,
  propShowVisual,
  propSetShowVisual,
}: UseVisualizerControllerProps) => {
  const tempRotationRef = useRef(new THREE.Euler(0, 0, 0, 'ZYX'));
  const pendingGroundAlignmentRef = useRef<number | null>(null);
  const clearSelection = useSelectionStore((state) => state.clearSelection);
  const clearHover = useSelectionStore((state) => state.clearHover);
  const setHoverFrozen = useSelectionStore((state) => state.setHoverFrozen);
  const groundPlaneOffset = useUIStore((state) => state.groundPlaneOffset);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const robotRootRef = useRef<THREE.Group | null>(null);

  const state = useVisualizerState({ propShowVisual, propSetShowVisual });
  const panel = useDraggablePanel();
  const {
    jointPivots,
    jointMotions,
    handleRegisterJointPivot,
    handleRegisterJointMotion,
    selectedJointPivot,
    selectedJointMotion,
  } = useJointPivots(robot.selection.type, robot.selection.id ?? undefined);
  const { handleRegisterCollisionRef, selectedCollisionRef } = useCollisionRefs(
    robot.selection.type,
    robot.selection.id ?? undefined,
    robot.selection.subType,
    robot.selection.objectIndex ?? 0,
  );

  const closedLoopDragSync = useClosedLoopDragSync({
    robot,
    jointPivots,
    jointMotions,
  });
  const jointTransformControlsEnabled = shouldEnableMergedVisualizerJointTransformControls(mode, {
    assemblyWorkspaceActive,
  });

  const transformControlsState = useTransformControls(
    selectedJointPivot,
    jointTransformControlsEnabled ? 'universal' : state.transformMode,
    robot,
    onUpdate,
    mode,
    {
      onPreviewObjectChange: closedLoopDragSync.previewConstraintCompensation,
      onPreviewRotateChange: closedLoopDragSync.previewConstraintMotionCompensation,
      onResetPreview: closedLoopDragSync.resetConstraintPreview,
      selectedRotateObject: selectedJointMotion,
    },
  );

  const handleAutoFitGround = useCallback(() => {
    const robotRoot = robotRootRef.current;
    if (!robotRoot) return;
    const aligned = alignObjectLowestPointToZ(robotRoot, groundPlaneOffset, {
      includeInvisible: false,
      includeVisual: true,
      includeCollision: false,
    });

    if (aligned === null) {
      alignObjectLowestPointToZ(robotRoot, groundPlaneOffset, {
        includeInvisible: true,
        includeVisual: true,
        includeCollision: false,
      });
    }
  }, [groundPlaneOffset]);

  const handleCollisionTransformEnd = useCallback(() => {
    if (!selectedCollisionRef || !robot.selection.id || robot.selection.type !== 'link') return;

    selectedCollisionRef.updateMatrixWorld(true);

    const linkId = resolveLinkKey(robot.links, robot.selection.id);
    if (!linkId) return;

    const link = robot.links[linkId];
    if (!link) return;

    const pos = selectedCollisionRef.position;
    const rot = tempRotationRef.current.setFromQuaternion(selectedCollisionRef.quaternion, 'ZYX');
    const objectIndex = robot.selection.objectIndex ?? 0;

    onUpdate('link', linkId, {
      ...updateCollisionGeometryByObjectIndex(link, objectIndex, {
        origin: {
          xyz: { x: pos.x, y: pos.y, z: pos.z },
          rpy: { r: rot.x, p: rot.y, y: rot.z },
        },
      }),
    });
  }, [onUpdate, robot, selectedCollisionRef]);

  const requestGroundRealignment = useCallback(() => {
    if (isSyntheticWorldRoot(robot, robot.rootLinkId)) return;

    if (typeof window === 'undefined') {
      handleAutoFitGround();
      return;
    }

    if (pendingGroundAlignmentRef.current !== null) {
      window.clearTimeout(pendingGroundAlignmentRef.current);
    }

    pendingGroundAlignmentRef.current = window.setTimeout(() => {
      pendingGroundAlignmentRef.current = null;
      handleAutoFitGround();
    }, 48);
  }, [handleAutoFitGround, robot]);

  useEffect(() => {
    if (!isSyntheticWorldRoot(robot, robot.rootLinkId)) {
      return;
    }

    // Workspace synthetic roots own grounding through component transforms.
    // Clear any legacy single-robot auto-fit offset so it does not leak into assembly mode.
    resetSyntheticRootGroundOffset(robotRootRef.current);
  }, [robot.rootLinkId]);

  useEffect(() => {
    if (isSyntheticWorldRoot(robot, robot.rootLinkId)) return;

    const timers = [0, 80, 220].map((delay) => window.setTimeout(handleAutoFitGround, delay));

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [groundPlaneOffset, handleAutoFitGround, robot.joints, robot.links]);

  useEffect(() => {
    return () => {
      if (pendingGroundAlignmentRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(pendingGroundAlignmentRef.current);
        pendingGroundAlignmentRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      setHoverFrozen(false);
      clearMaterialCache();
    };
  }, [setHoverFrozen]);

  useEffect(() => {
    state.setTransformMode('translate');
  }, [mode, state.setTransformMode]);

  return {
    clearSelection,
    clearHover,
    sceneRef,
    robotRootRef,
    state,
    panel,
    jointPivots,
    selectedJointPivot,
    selectedJointMotion,
    selectedCollisionRef,
    handleRegisterJointPivot,
    handleRegisterJointMotion,
    handleRegisterCollisionRef,
    transformControlsState,
    previewLinkIkKinematics: closedLoopDragSync.previewJointKinematics,
    clearLinkIkKinematicsPreview: closedLoopDragSync.clearJointKinematicsPreview,
    handleAutoFitGround,
    requestGroundRealignment,
    handleCollisionTransformEnd,
  };
};

export type VisualizerController = ReturnType<typeof useVisualizerController>;
