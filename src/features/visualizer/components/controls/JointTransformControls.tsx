import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { JointType, RobotState } from '@/types';
import { UnifiedTransformControls, VISUALIZER_UNIFIED_GIZMO_SIZE } from '@/shared/components/3d';
import { TransformControlsState } from '../../hooks/useTransformControls';
interface JointTransformControlsProps {
  mode: 'editor';
  selectedJointPivot: THREE.Group | null;
  selectedJointMotion: THREE.Group | null;
  robot: RobotState;
  transformMode: 'translate' | 'rotate' | 'universal';
  transformControlsState: TransformControlsState;
}

const JOINT_GIZMO_THICKNESS_SCALE = 1.6;

/**
 * JointTransformControls - Handles joint TransformControls in editor mode
 *
 * Features:
 * - Renders TransformControls for selected joint pivot
 * - Applies drag results immediately
 * - Skips fixed joints (they cannot be transformed)
 */
export const JointTransformControls = memo(function JointTransformControls({
  mode,
  selectedJointPivot,
  selectedJointMotion,
  robot,
  transformMode,
  transformControlsState,
}: JointTransformControlsProps) {
  const { invalidate } = useThree();
  const {
    transformControlRef,
    rotateTransformControlRef,
    setRotateInputObject,
    handleObjectChange,
    handleRotateObjectChange,
  } = transformControlsState;
  const [translateProxy, setTranslateProxy] = useState<THREE.Group | null>(null);
  const rotateProxyRef = useRef<THREE.Group | null>(null);
  const [rotateProxy, setRotateProxy] = useState<THREE.Group | null>(null);
  const translateProxyRef = useRef<THREE.Group | null>(null);
  const isTranslateDraggingRef = useRef(false);
  const lastActiveControlRef = useRef<'translate' | 'rotate' | null>(null);
  const worldPositionRef = useRef(new THREE.Vector3());
  const parentQuaternionRef = useRef(new THREE.Quaternion());
  const localPositionRef = useRef(new THREE.Vector3());

  const jointId = robot.selection.type === 'joint' ? robot.selection.id : null;
  const joint = jointId ? robot.joints[jointId] : null;

  const syncTranslateProxy = useCallback(
    (proxyTarget: THREE.Object3D | null) => {
      if (!selectedJointPivot || !proxyTarget) return;

      selectedJointPivot.updateMatrixWorld(true);
      selectedJointPivot.getWorldPosition(worldPositionRef.current);
      proxyTarget.position.copy(worldPositionRef.current);

      const parent = selectedJointPivot.parent;
      if (parent) {
        parent.getWorldQuaternion(parentQuaternionRef.current);
        proxyTarget.quaternion.copy(parentQuaternionRef.current);
      } else {
        proxyTarget.quaternion.identity();
      }

      proxyTarget.scale.setScalar(1);
      proxyTarget.updateMatrixWorld(true);
    },
    [selectedJointPivot],
  );

  const handleTranslateProxyRef = useCallback(
    (proxy: THREE.Group | null) => {
      translateProxyRef.current = proxy;
      setTranslateProxy(proxy);
      syncTranslateProxy(proxy);
    },
    [syncTranslateProxy],
  );

  const applyTranslateProxyToPivot = useCallback(() => {
    const proxy = translateProxyRef.current;
    if (proxy && selectedJointPivot) {
      proxy.updateMatrixWorld(true);
      proxy.getWorldPosition(worldPositionRef.current);
      localPositionRef.current.copy(worldPositionRef.current);

      const parent = selectedJointPivot.parent;
      if (parent) {
        parent.worldToLocal(localPositionRef.current);
      }

      selectedJointPivot.position.copy(localPositionRef.current);
      selectedJointPivot.updateMatrixWorld(true);
    }
  }, [selectedJointPivot]);

  const syncRotateProxy = useCallback(() => {
    const proxy = rotateProxyRef.current;
    if (!proxy || !selectedJointMotion) return;

    proxy.position.copy(selectedJointMotion.position);
    proxy.quaternion.copy(selectedJointMotion.quaternion);
    proxy.scale.copy(selectedJointMotion.scale);
    proxy.updateMatrixWorld(true);
  }, [selectedJointMotion]);

  useEffect(() => {
    if (!selectedJointMotion?.parent) {
      if (rotateProxyRef.current?.parent) {
        rotateProxyRef.current.parent.remove(rotateProxyRef.current);
      }
      rotateProxyRef.current = null;
      setRotateProxy(null);
      setRotateInputObject(null);
      return;
    }

    const proxy = rotateProxyRef.current ?? new THREE.Group();
    proxy.visible = false;

    if (proxy.parent !== selectedJointMotion.parent) {
      proxy.parent?.remove(proxy);
      selectedJointMotion.parent.add(proxy);
    }

    rotateProxyRef.current = proxy;
    setRotateProxy(proxy);
    setRotateInputObject(proxy);
    syncRotateProxy();

    return () => {
      if (rotateProxyRef.current === proxy) {
        rotateProxyRef.current = null;
      }
      setRotateProxy((current) => (current === proxy ? null : current));
      setRotateInputObject(null);
      proxy.parent?.remove(proxy);
    };
  }, [selectedJointMotion, setRotateInputObject, syncRotateProxy]);

  useEffect(() => {
    if (!isTranslateDraggingRef.current) {
      syncTranslateProxy(translateProxyRef.current);
    }
  }, [jointId, selectedJointPivot, syncTranslateProxy]);

  const handleJointObjectChange = useCallback(() => {
    const translateControls = transformControlRef.current;
    const rotateControls = rotateTransformControlRef.current;

    if (translateControls?.dragging) {
      isTranslateDraggingRef.current = true;
      lastActiveControlRef.current = 'translate';
      applyTranslateProxyToPivot();
      handleObjectChange();
      invalidate();
      return;
    }

    if (rotateControls?.dragging) {
      lastActiveControlRef.current = 'rotate';
      handleRotateObjectChange();
      invalidate();
    }
  }, [
    applyTranslateProxyToPivot,
    handleObjectChange,
    handleRotateObjectChange,
    invalidate,
    rotateTransformControlRef,
    transformControlRef,
  ]);

  const handleDraggingChanged = useCallback(
    (event?: { value?: boolean }) => {
      const translateControls = transformControlRef.current;
      const rotateControls = rotateTransformControlRef.current;

      if (event?.value) {
        if (translateControls?.dragging) {
          isTranslateDraggingRef.current = true;
          lastActiveControlRef.current = 'translate';
        } else if (rotateControls?.dragging) {
          lastActiveControlRef.current = 'rotate';
        }
        return;
      }

      const isTranslateDragging = Boolean(translateControls?.dragging);
      isTranslateDraggingRef.current = isTranslateDragging;

      if (!isTranslateDragging) {
        syncTranslateProxy(translateProxyRef.current);
        if (lastActiveControlRef.current === 'translate') {
          lastActiveControlRef.current = null;
        }
      }
      if (!rotateControls?.dragging && lastActiveControlRef.current === 'rotate') {
        lastActiveControlRef.current = null;
      }
      invalidate();
    },
    [invalidate, rotateTransformControlRef, syncTranslateProxy, transformControlRef],
  );

  useFrame(() => {
    const translateControls = transformControlRef.current;
    const rotateControls = rotateTransformControlRef.current;

    if (translateControls?.dragging) {
      if (!isTranslateDraggingRef.current) {
        isTranslateDraggingRef.current = true;
        lastActiveControlRef.current = 'translate';
      }
      applyTranslateProxyToPivot();
      handleObjectChange();
      invalidate();
      return;
    }

    if (rotateControls?.dragging) {
      lastActiveControlRef.current = 'rotate';
      handleRotateObjectChange();
      invalidate();
      return;
    }

    if (rotateProxyRef.current) {
      syncRotateProxy();
    }

    if (isTranslateDraggingRef.current || lastActiveControlRef.current === 'translate') {
      isTranslateDraggingRef.current = false;
      lastActiveControlRef.current = null;
      syncTranslateProxy(translateProxyRef.current);
      invalidate();
      return;
    }

    if (lastActiveControlRef.current === 'rotate') {
      lastActiveControlRef.current = null;
      invalidate();
    }
  }, 1000);

  void mode;
  if (!selectedJointPivot || !jointId || !joint) return null;

  // Don't show TransformControls for fixed joints
  const jointTypeStr = String(joint.type).toLowerCase();
  if (jointTypeStr === 'fixed' || joint.type === JointType.FIXED || joint.type === JointType.BALL)
    return null;

  const shouldRenderTranslateProxy = transformMode === 'translate' || transformMode === 'universal';
  const canRenderControls = transformMode === 'rotate' || Boolean(translateProxy);

  return (
    <>
      {shouldRenderTranslateProxy && <group ref={handleTranslateProxyRef} visible={false} />}

      {/* TransformControls at root Canvas level - not nested in hierarchy */}
      {canRenderControls && (
        <UnifiedTransformControls
          ref={transformControlRef}
          rotateRef={rotateTransformControlRef}
          object={selectedJointPivot}
          translateObject={shouldRenderTranslateProxy ? (translateProxy ?? undefined) : undefined}
          rotateObject={rotateProxy ?? selectedJointMotion ?? undefined}
          // Translate edits the joint origin/pivot. Rotate edits the joint motion
          // group so closed-loop compensation can follow the live kinematic pose.
          mode={transformMode}
          size={VISUALIZER_UNIFIED_GIZMO_SIZE}
          translateSpace="local"
          rotateSpace="local"
          hoverStyle="single-axis"
          displayStyle="thick-primary"
          displayThicknessScale={JOINT_GIZMO_THICKNESS_SCALE}
          onObjectChange={handleJointObjectChange}
          onDraggingChanged={handleDraggingChanged}
        />
      )}
    </>
  );
});
