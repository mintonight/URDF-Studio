import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { UnifiedTransformControls, VISUALIZER_UNIFIED_GIZMO_SIZE } from '@/shared/components/3d';
import { getObjectRPY } from '../utils/collisionTransformMath';
import { useCollisionTransformDragLifecycle } from '../hooks/useCollisionTransformDragLifecycle';
import {
  canRenderCollisionTransformControls,
  resolveCurrentCollisionDraggingControls,
} from '../utils/collisionTransformControlsShared';
import {
  applyOriginToRuntimeJoint,
  extractRuntimeJointOrigin,
  resolveOriginTransformClosedLoopPreview,
  resolveRuntimeJointForOriginTransform,
  resolveOriginTransformTarget,
} from '../utils/originTransformControlsShared';
import type { RobotModelProps } from '../types';
import type { JointQuaternion, RobotState, UrdfJoint } from '@/types';
import type { URDFJoint as RuntimeURDFJoint } from '@/core/parsers/urdf/loader';

const ORIGIN_TRANSLATE_GIZMO_SIZE = VISUALIZER_UNIFIED_GIZMO_SIZE;
const ORIGIN_ROTATE_GIZMO_SIZE = VISUALIZER_UNIFIED_GIZMO_SIZE * 0.84;
const ORIGIN_GIZMO_THICKNESS_SCALE = 1.9;

interface OriginTransformControlsProps {
  robot: THREE.Object3D | null;
  robotVersion?: number;
  selection: RobotModelProps['selection'];
  transformMode: RobotModelProps['transformMode'];
  setIsDragging: (dragging: boolean) => void;
  onTransformPending?: (pending: boolean) => void;
  onUpdate?: RobotModelProps['onUpdate'];
  robotJoints?: RobotModelProps['robotJoints'];
  closedLoopRobotState?: Pick<
    RobotState,
    'links' | 'joints' | 'rootLinkId' | 'closedLoopConstraints'
  > | null;
}

export const OriginTransformControls: React.FC<OriginTransformControlsProps> = ({
  robot,
  robotVersion,
  selection,
  transformMode,
  setIsDragging,
  onTransformPending,
  onUpdate,
  robotJoints,
  closedLoopRobotState = null,
}) => {
  const transformRef = useRef<any>(null);
  const rotateTransformRef = useRef<any>(null);
  const proxyRef = useRef<THREE.Group | null>(null);
  const targetJointRef = useRef<RuntimeURDFJoint | null>(null);
  const activeSelectionRef = useRef<{ jointId: string } | null>(null);
  const originalOriginRef = useRef<ReturnType<typeof extractRuntimeJointOrigin> | null>(null);
  const previewedClosedLoopJointIdsRef = useRef<Set<string>>(new Set());
  const { invalidate } = useThree();
  const [targetJoint, setTargetJoint] = useState<RuntimeURDFJoint | null>(null);
  const [proxy, setProxy] = useState<THREE.Group | null>(null);
  const onUpdateRef = useRef(onUpdate);

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(() => {
    targetJointRef.current = targetJoint;
  }, [targetJoint]);

  const syncProxyFromJoint = useCallback(
    (proxyObject: THREE.Group | null, joint = targetJointRef.current) => {
      if (!proxyObject || !joint) {
        return;
      }

      const origin = extractRuntimeJointOrigin(joint);
      proxyObject.position.set(origin.xyz.x, origin.xyz.y, origin.xyz.z);
      proxyObject.rotation.set(0, 0, 0);
      proxyObject.quaternion.setFromEuler(
        new THREE.Euler(origin.rpy.r, origin.rpy.p, origin.rpy.y, 'ZYX'),
      );
      proxyObject.updateMatrixWorld(true);
    },
    [],
  );

  useEffect(() => {
    if (!targetJoint?.parent) {
      proxyRef.current?.parent?.remove(proxyRef.current);
      proxyRef.current = null;
      setProxy(null);
      return;
    }

    const nextProxy = proxyRef.current ?? new THREE.Group();
    nextProxy.visible = false;

    if (nextProxy.parent !== targetJoint.parent) {
      nextProxy.parent?.remove(nextProxy);
      targetJoint.parent.add(nextProxy);
    }

    proxyRef.current = nextProxy;
    setProxy(nextProxy);
    syncProxyFromJoint(nextProxy, targetJoint);

    return () => {
      if (proxyRef.current === nextProxy) {
        proxyRef.current = null;
      }
      setProxy((current) => (current === nextProxy ? null : current));
      nextProxy.parent?.remove(nextProxy);
    };
  }, [syncProxyFromJoint, targetJoint]);

  const handleBeginDrag = useCallback(() => {
    const resolvedTarget = resolveOriginTransformTarget(robot, selection, robotJoints);
    const activeJoint = resolvedTarget?.runtimeJoint ?? targetJointRef.current;
    if (!activeJoint) {
      return false;
    }

    targetJointRef.current = activeJoint;
    activeSelectionRef.current = {
      jointId:
        resolvedTarget?.jointId ?? activeSelectionRef.current?.jointId ?? selection?.id ?? '',
    };
    originalOriginRef.current = extractRuntimeJointOrigin(activeJoint);
    return Boolean(activeSelectionRef.current.jointId);
  }, [robot, robotJoints, selection]);

  const applyProxyOriginToJoint = useCallback(() => {
    const activeJoint = targetJointRef.current;
    const proxyObject = proxyRef.current;
    if (!activeJoint || !proxyObject) {
      return null;
    }

    const rotation = getObjectRPY(proxyObject);
    return applyOriginToRuntimeJoint(activeJoint, {
      xyz: {
        x: proxyObject.position.x,
        y: proxyObject.position.y,
        z: proxyObject.position.z,
      },
      rpy: rotation,
    });
  }, []);

  const applyRuntimeJointQuaternion = useCallback(
    (joint: RuntimeURDFJoint, quaternion: JointQuaternion | undefined): void => {
      const runtimeJoint = joint as RuntimeURDFJoint & {
        setJointQuaternion?: (value: JointQuaternion) => boolean;
      };
      if (typeof runtimeJoint.setJointQuaternion !== 'function') {
        return;
      }

      runtimeJoint.setJointQuaternion(
        quaternion ?? {
          x: 0,
          y: 0,
          z: 0,
          w: 1,
        },
      );
    },
    [],
  );

  const restoreRuntimeJointFromRobotState = useCallback(
    (jointId: string) => {
      const runtimeJoint = resolveRuntimeJointForOriginTransform(robot, jointId, robotJoints);
      const sourceJoint = robotJoints?.[jointId];
      if (!runtimeJoint || !sourceJoint) {
        return;
      }

      applyOriginToRuntimeJoint(runtimeJoint, sourceJoint.origin);
      applyRuntimeJointQuaternion(runtimeJoint, sourceJoint.quaternion);
    },
    [applyRuntimeJointQuaternion, robot, robotJoints],
  );

  const clearClosedLoopRuntimePreview = useCallback(() => {
    previewedClosedLoopJointIdsRef.current.forEach((jointId) => {
      restoreRuntimeJointFromRobotState(jointId);
    });
    previewedClosedLoopJointIdsRef.current.clear();
  }, [restoreRuntimeJointFromRobotState]);

  const applyClosedLoopRuntimePreview = useCallback(
    (selectedJointId: string, selectedOrigin: UrdfJoint['origin']) => {
      const preview = resolveOriginTransformClosedLoopPreview(
        closedLoopRobotState,
        selectedJointId,
        selectedOrigin,
      );
      const nextPreviewedJointIds = new Set([
        ...Object.keys(preview.origins),
        ...Object.keys(preview.quaternions),
      ]);

      previewedClosedLoopJointIdsRef.current.forEach((jointId) => {
        if (!nextPreviewedJointIds.has(jointId)) {
          restoreRuntimeJointFromRobotState(jointId);
        }
      });

      Object.entries(preview.origins).forEach(([jointId, origin]) => {
        const runtimeJoint = resolveRuntimeJointForOriginTransform(robot, jointId, robotJoints);
        if (runtimeJoint) {
          applyOriginToRuntimeJoint(runtimeJoint, origin);
        }
      });

      Object.entries(preview.quaternions).forEach(([jointId, quaternion]) => {
        const runtimeJoint = resolveRuntimeJointForOriginTransform(robot, jointId, robotJoints);
        if (runtimeJoint) {
          applyRuntimeJointQuaternion(runtimeJoint, quaternion);
        }
      });

      previewedClosedLoopJointIdsRef.current = nextPreviewedJointIds;
    },
    [
      applyRuntimeJointQuaternion,
      closedLoopRobotState,
      restoreRuntimeJointFromRobotState,
      robot,
      robotJoints,
    ],
  );

  const handleCancelDrag = useCallback(() => {
    const activeJoint = targetJointRef.current;
    const originalOrigin = originalOriginRef.current;
    if (!activeJoint || !originalOrigin) {
      return;
    }

    applyOriginToRuntimeJoint(activeJoint, originalOrigin);
    clearClosedLoopRuntimePreview();
    syncProxyFromJoint(proxyRef.current, activeJoint);
  }, [clearClosedLoopRuntimePreview, syncProxyFromJoint]);

  const handleFinishDrag = useCallback(() => {
    const activeJoint = targetJointRef.current;
    const activeSelection = activeSelectionRef.current;
    const originalOrigin = originalOriginRef.current;
    const update = onUpdateRef.current;

    if (!activeJoint || !activeSelection?.jointId || !originalOrigin) {
      return;
    }

    const nextOrigin = extractRuntimeJointOrigin(activeJoint);
    const currentJoint = robotJoints?.[activeSelection.jointId];
    if (update && currentJoint) {
      update('joint', activeSelection.jointId, {
        ...currentJoint,
        origin: nextOrigin,
      });
    }

    originalOriginRef.current = nextOrigin;
    previewedClosedLoopJointIdsRef.current.clear();
    syncProxyFromJoint(proxyRef.current, activeJoint);
  }, [robotJoints, syncProxyFromJoint]);

  const {
    activeControlsRef,
    beginActiveDrag,
    cancelActiveDrag,
    controlMode,
    finishActiveDrag,
    handleDraggingChanged,
    handleObjectChange,
    isDraggingRef,
    shouldUseTranslateProxy,
  } = useCollisionTransformDragLifecycle({
    transformMode,
    transformRef,
    rotateTransformRef,
    invalidate,
    setIsDragging,
    onTransformPending,
    onBeginDrag: handleBeginDrag,
    onFinishDrag: handleFinishDrag,
    onCancelDrag: handleCancelDrag,
    onObjectChange: ({ isDragging }) => {
      if (isDragging) {
        const nextOrigin = applyProxyOriginToJoint();
        const activeSelection = activeSelectionRef.current;
        if (nextOrigin && activeSelection?.jointId) {
          applyClosedLoopRuntimePreview(activeSelection.jointId, nextOrigin);
        }
      }
    },
  });

  useEffect(() => {
    const resolvedTarget = resolveOriginTransformTarget(robot, selection, robotJoints);
    if (!resolvedTarget || transformMode === 'select' || !onUpdate) {
      if (isDraggingRef.current) {
        cancelActiveDrag();
      }
      activeSelectionRef.current = null;
      setTargetJoint((current) => (current === null ? current : null));
      return;
    }

    activeSelectionRef.current = { jointId: resolvedTarget.jointId };

    const isSameTarget = targetJointRef.current === resolvedTarget.runtimeJoint;
    if (isDraggingRef.current && targetJointRef.current && !isSameTarget) {
      cancelActiveDrag();
    }

    setTargetJoint((current) =>
      current === resolvedTarget.runtimeJoint ? current : resolvedTarget.runtimeJoint,
    );

    if (!isDraggingRef.current) {
      originalOriginRef.current = extractRuntimeJointOrigin(resolvedTarget.runtimeJoint);
      syncProxyFromJoint(proxyRef.current, resolvedTarget.runtimeJoint);
    }
  }, [
    cancelActiveDrag,
    isDraggingRef,
    onUpdate,
    robot,
    robotJoints,
    robotVersion,
    selection,
    syncProxyFromJoint,
    transformMode,
  ]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      syncProxyFromJoint(proxyRef.current, targetJoint);
    }
  }, [syncProxyFromJoint, targetJoint]);

  useFrame(() => {
    const draggingControls = resolveCurrentCollisionDraggingControls(
      transformRef.current,
      rotateTransformRef.current,
    );

    if (draggingControls) {
      beginActiveDrag(draggingControls);
      invalidate();
      return;
    }

    if (isDraggingRef.current) {
      finishActiveDrag();
      return;
    }

    if (proxyRef.current && targetJointRef.current) {
      syncProxyFromJoint(proxyRef.current, targetJointRef.current);
    }
  }, 1000);

  if (!proxy || !targetJoint || !onUpdate || transformMode === 'select') {
    return null;
  }

  const canRenderControls = canRenderCollisionTransformControls(
    transformMode,
    shouldUseTranslateProxy,
    proxy,
  );

  return canRenderControls ? (
    <UnifiedTransformControls
      ref={transformRef}
      rotateRef={rotateTransformRef}
      object={proxy}
      mode={controlMode}
      size={ORIGIN_TRANSLATE_GIZMO_SIZE}
      rotateSize={ORIGIN_ROTATE_GIZMO_SIZE}
      translateSpace="local"
      rotateSpace="local"
      hoverStyle="single-axis"
      displayStyle="thick-primary"
      displayThicknessScale={ORIGIN_GIZMO_THICKNESS_SCALE}
      onObjectChange={handleObjectChange}
      onDraggingChanged={handleDraggingChanged}
    />
  ) : null;
};
