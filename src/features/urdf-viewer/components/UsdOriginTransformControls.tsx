import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { UnifiedTransformControls, VISUALIZER_UNIFIED_GIZMO_SIZE } from '@/shared/components/3d';
import type { UrdfJoint } from '@/types';
import type { ViewerProps } from '../types';
import { useCollisionTransformDragLifecycle } from '../hooks/useCollisionTransformDragLifecycle';
import { getObjectRPY } from '../utils/collisionTransformMath';
import {
  canRenderCollisionTransformControls,
  resolveCurrentCollisionDraggingControls,
} from '../utils/collisionTransformControlsShared';

const ORIGIN_TRANSLATE_GIZMO_SIZE = VISUALIZER_UNIFIED_GIZMO_SIZE;
const ORIGIN_ROTATE_GIZMO_SIZE = VISUALIZER_UNIFIED_GIZMO_SIZE * 0.84;
const ORIGIN_GIZMO_THICKNESS_SCALE = 1.9;

const DEFAULT_POSITION = { x: 0, y: 0, z: 0 };
const DEFAULT_ROTATION = { r: 0, p: 0, y: 0 };

export interface UsdOriginTransformTarget {
  jointId: string;
  getOrigin: () => UrdfJoint['origin'] | undefined;
  getParentLinkWorldMatrix: () => THREE.Matrix4 | null;
}

interface UsdOriginTransformControlsProps {
  selection?: ViewerProps['selection'];
  transformMode: 'select' | 'translate' | 'rotate' | 'universal';
  setIsDragging: (dragging: boolean) => void;
  resolveTarget: (
    selection: NonNullable<ViewerProps['selection']>,
  ) => UsdOriginTransformTarget | null;
  onTransformChange?: (jointId: string, origin: UrdfJoint['origin']) => void;
  onTransformEnd?: (jointId: string, origin: UrdfJoint['origin']) => void;
  onTransformPending?: (pending: boolean) => void;
}

export const UsdOriginTransformControls: React.FC<UsdOriginTransformControlsProps> = ({
  selection,
  transformMode,
  setIsDragging,
  resolveTarget,
  onTransformChange,
  onTransformEnd,
  onTransformPending,
}) => {
  const transformRef = useRef<any>(null);
  const rotateTransformRef = useRef<any>(null);
  const parentFrameRef = useRef<THREE.Group | null>(null);
  const proxyObjectRef = useRef<THREE.Group | null>(null);
  const { invalidate } = useThree();

  const [proxyObject, setProxyObject] = useState<THREE.Group | null>(null);
  const [hasActiveTarget, setHasActiveTarget] = useState(false);

  const activeTargetRef = useRef<UsdOriginTransformTarget | null>(null);
  const originalPositionRef = useRef(new THREE.Vector3());
  const originalQuaternionRef = useRef(new THREE.Quaternion());
  const onTransformChangeRef = useRef(onTransformChange);
  const onTransformEndRef = useRef(onTransformEnd);

  useEffect(() => {
    onTransformChangeRef.current = onTransformChange;
  }, [onTransformChange]);

  useEffect(() => {
    onTransformEndRef.current = onTransformEnd;
  }, [onTransformEnd]);

  const syncParentFrame = useCallback((target = activeTargetRef.current) => {
    const parentFrame = parentFrameRef.current;
    const parentWorldMatrix = target?.getParentLinkWorldMatrix();
    if (!parentFrame || !parentWorldMatrix) {
      return false;
    }

    parentFrame.matrixAutoUpdate = false;
    parentFrame.matrix.copy(parentWorldMatrix);
    parentFrame.matrixWorldNeedsUpdate = true;
    parentFrame.updateMatrixWorld(true);
    return true;
  }, []);

  const syncProxyFromTarget = useCallback(
    (target = activeTargetRef.current) => {
      const nextProxyObject = proxyObjectRef.current;
      if (!nextProxyObject || !target || !syncParentFrame(target)) {
        return;
      }

      const origin = target.getOrigin();
      const xyz = origin?.xyz ?? DEFAULT_POSITION;
      const rpy = origin?.rpy ?? DEFAULT_ROTATION;

      nextProxyObject.position.set(xyz.x, xyz.y, xyz.z);
      nextProxyObject.quaternion.setFromEuler(new THREE.Euler(rpy.r, rpy.p, rpy.y, 'ZYX'));
      nextProxyObject.scale.setScalar(1);
      nextProxyObject.updateMatrixWorld(true);
    },
    [syncParentFrame],
  );

  const resolveOriginFromProxy = useCallback((): UrdfJoint['origin'] | null => {
    const nextProxyObject = proxyObjectRef.current;
    if (!nextProxyObject) {
      return null;
    }

    return {
      xyz: {
        x: nextProxyObject.position.x,
        y: nextProxyObject.position.y,
        z: nextProxyObject.position.z,
      },
      rpy: getObjectRPY(nextProxyObject),
    };
  }, []);

  const emitTransformPreview = useCallback(() => {
    const activeTarget = activeTargetRef.current;
    const handleTransformChange = onTransformChangeRef.current;
    const nextOrigin = resolveOriginFromProxy();
    if (!activeTarget || !handleTransformChange || !nextOrigin) {
      return;
    }

    handleTransformChange(activeTarget.jointId, nextOrigin);
  }, [resolveOriginFromProxy]);

  const commitTransform = useCallback(() => {
    const activeTarget = activeTargetRef.current;
    const handleTransformEnd = onTransformEndRef.current;
    const nextOrigin = resolveOriginFromProxy();
    if (!activeTarget || !handleTransformEnd || !nextOrigin) {
      return false;
    }

    handleTransformEnd(activeTarget.jointId, nextOrigin);

    const nextProxyObject = proxyObjectRef.current;
    if (nextProxyObject) {
      originalPositionRef.current.copy(nextProxyObject.position);
      originalQuaternionRef.current.copy(nextProxyObject.quaternion);
    }

    return true;
  }, [resolveOriginFromProxy]);

  const hasTransformChanged = useCallback(() => {
    const nextProxyObject = proxyObjectRef.current;
    if (!nextProxyObject) {
      return false;
    }

    const positionChanged =
      originalPositionRef.current.distanceToSquared(nextProxyObject.position) > 1e-8;
    const rotationChanged =
      originalQuaternionRef.current.angleTo(nextProxyObject.quaternion) > 1e-4;
    return positionChanged || rotationChanged;
  }, []);

  const handleFinishDrag = useCallback(() => {
    if (hasTransformChanged()) {
      commitTransform();
    }
  }, [commitTransform, hasTransformChanged]);

  const handleCancelDrag = useCallback(() => {
    const nextProxyObject = proxyObjectRef.current;
    if (!nextProxyObject) {
      return;
    }

    nextProxyObject.position.copy(originalPositionRef.current);
    nextProxyObject.quaternion.copy(originalQuaternionRef.current);
    nextProxyObject.updateMatrixWorld(true);
  }, []);

  const handleBeginDrag = useCallback(() => {
    const nextProxyObject = proxyObjectRef.current;
    const activeTarget = activeTargetRef.current;
    if (!nextProxyObject || !activeTarget) {
      return false;
    }

    originalPositionRef.current.copy(nextProxyObject.position);
    originalQuaternionRef.current.copy(nextProxyObject.quaternion);
    return true;
  }, []);

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
        emitTransformPreview();
      }
    },
  });

  useEffect(() => {
    if (transformMode === 'select' || !selection?.type || !selection?.id) {
      if (isDraggingRef.current) {
        cancelActiveDrag();
      }
      activeTargetRef.current = null;
      setHasActiveTarget(false);
      return;
    }

    const resolvedTarget = resolveTarget(selection);
    if (!resolvedTarget) {
      if (isDraggingRef.current) {
        cancelActiveDrag();
      }
      activeTargetRef.current = null;
      setHasActiveTarget(false);
      return;
    }

    const isSameTarget = activeTargetRef.current?.jointId === resolvedTarget.jointId;
    if (isDraggingRef.current && !isSameTarget) {
      cancelActiveDrag();
    }

    activeTargetRef.current = resolvedTarget;
    setHasActiveTarget(true);

    if (!isDraggingRef.current) {
      activeControlsRef.current = null;
      syncProxyFromTarget(resolvedTarget);
    }
  }, [cancelActiveDrag, resolveTarget, selection, syncProxyFromTarget, transformMode]);

  useEffect(() => {
    if (!isDraggingRef.current) {
      syncProxyFromTarget();
    }
  }, [proxyObject, syncProxyFromTarget]);

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

    if (activeTargetRef.current) {
      syncProxyFromTarget(activeTargetRef.current);
    }
  }, 1000);

  const handleProxyRef = useCallback(
    (group: THREE.Group | null) => {
      proxyObjectRef.current = group;
      setProxyObject(group);
      if (group && activeTargetRef.current && !isDraggingRef.current) {
        syncProxyFromTarget(activeTargetRef.current);
      }
    },
    [syncProxyFromTarget],
  );

  const canRenderControls =
    Boolean(proxyObject) &&
    canRenderCollisionTransformControls(transformMode, shouldUseTranslateProxy, proxyObject);

  return (
    <>
      <group ref={parentFrameRef}>
        <group ref={handleProxyRef} />
      </group>

      {hasActiveTarget && proxyObject && transformMode !== 'select' && canRenderControls && (
        <UnifiedTransformControls
          ref={transformRef}
          rotateRef={rotateTransformRef}
          object={proxyObject}
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
      )}
    </>
  );
};
