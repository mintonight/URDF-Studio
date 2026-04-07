import React, { useRef, useState, useMemo, useEffect, useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { UnifiedTransformControls } from '@/shared/components/3d';
import { useSnapshotRenderActive } from '@/shared/components/3d/scene/SnapshotRenderContext';
import { hasEffectivelyFiniteJointLimits } from '@/shared/utils/jointUnits';
import {
  extractSignedAngleAroundAxis,
  getJointActualAngleFromMotionAngle,
  getJointMotionAngleFromActualAngle,
} from '@/core/robot';
import type { JointInteractionProps } from '../types';

export const JointInteraction: React.FC<JointInteractionProps> = ({
  joint,
  value,
  onChange,
  onCommit,
  setIsDragging,
  onInteractionLockChange,
}) => {
  const transformRef = useRef<any>(null);
  const dummyRef = useRef<THREE.Object3D>(new THREE.Object3D());
  const lastRotation = useRef<number>(value);
  const isDragging = useRef(false);
  const unlockTimerRef = useRef<number | null>(null);
  const [, forceUpdate] = useState(0);
  const { invalidate } = useThree();
  const snapshotRenderActive = useSnapshotRenderActive();

  if (!joint || snapshotRenderActive) return null;

  // Get joint axis - ensure it's a proper Vector3
  const axisNormalized = useMemo(() => {
    const axis = joint.axis;
    if (axis instanceof THREE.Vector3) {
      return axis.clone().normalize();
    } else if (axis && typeof axis.x === 'number') {
      return new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
    }
    return new THREE.Vector3(1, 0, 0);
  }, [joint]);

  // Determine which rotation mode to use based on axis
  const rotationAxis = useMemo((): 'X' | 'Y' | 'Z' => {
    const absX = Math.abs(axisNormalized.x);
    const absY = Math.abs(axisNormalized.y);
    const absZ = Math.abs(axisNormalized.z);
    if (absX >= absY && absX >= absZ) return 'X';
    if (absY >= absX && absY >= absZ) return 'Y';
    return 'Z';
  }, [axisNormalized]);
  const displayedMotionAngle = useMemo(
    () => getJointMotionAngleFromActualAngle(joint, value),
    [joint, value],
  );

  // Function to update dummy position and orientation
  const updateDummyTransform = useCallback(() => {
    if (dummyRef.current && joint) {
      try {
        // Copy world position from joint
        joint.getWorldPosition(dummyRef.current.position);

        // Only update orientation if NOT dragging to prevent fighting with controls
        if (!isDragging.current) {
          // Get parent's world quaternion (so gizmo doesn't spin with joint rotation)
          const parent = joint.parent;
          if (parent) {
            parent.getWorldQuaternion(dummyRef.current.quaternion);
          } else {
            joint.getWorldQuaternion(dummyRef.current.quaternion);
          }

          // Align the gizmo with the joint axis
          const alignVector = new THREE.Vector3(1, 0, 0); // Default X
          if (rotationAxis === 'Y') alignVector.set(0, 1, 0);
          if (rotationAxis === 'Z') alignVector.set(0, 0, 1);

          const alignQ = new THREE.Quaternion().setFromUnitVectors(alignVector, axisNormalized);
          dummyRef.current.quaternion.multiply(alignQ);

          // Apply the current joint angle rotation
          const rotQ = new THREE.Quaternion().setFromAxisAngle(alignVector, displayedMotionAngle);
          dummyRef.current.quaternion.multiply(rotQ);
        }
      } catch (e) {
        // Prevent crash on math error
      }
    }
  }, [axisNormalized, displayedMotionAngle, joint, rotationAxis]);

  // Force update on mount to ensure TransformControls has the dummy object
  useEffect(() => {
    forceUpdate((n) => n + 1);
  }, []);

  // Update dummy transform when value or joint changes (instead of useFrame)
  useEffect(() => {
    updateDummyTransform();
    invalidate();
  }, [updateDummyTransform, invalidate]);

  const clearUnlockTimer = useCallback(() => {
    if (unlockTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(unlockTimerRef.current);
      unlockTimerRef.current = null;
    }
  }, []);

  const lockInteraction = useCallback(() => {
    clearUnlockTimer();
    onInteractionLockChange?.(true);
  }, [clearUnlockTimer, onInteractionLockChange]);

  const unlockInteraction = useCallback(
    (defer = false) => {
      clearUnlockTimer();

      if (!onInteractionLockChange) {
        return;
      }

      if (defer && typeof window !== 'undefined') {
        unlockTimerRef.current = window.setTimeout(() => {
          unlockTimerRef.current = null;
          onInteractionLockChange(false);
        }, 0);
        return;
      }

      onInteractionLockChange(false);
    },
    [clearUnlockTimer, onInteractionLockChange],
  );

  useEffect(() => {
    return () => {
      unlockInteraction();
      setIsDragging?.(false);
    };
  }, [setIsDragging, unlockInteraction]);

  const handleChange = useCallback(() => {
    if (!dummyRef.current || !isDragging.current) return;

    try {
      // Calculate the angle from the current quaternion relative to the zero-angle frame
      const parent = joint.parent;
      const parentQuat = new THREE.Quaternion();
      if (parent) {
        parent.getWorldQuaternion(parentQuat);
      } else {
        joint.getWorldQuaternion(parentQuat);
      }

      // Re-calculate alignment (same as in updateDummyTransform)
      const alignVector = new THREE.Vector3(1, 0, 0);
      if (rotationAxis === 'Y') alignVector.set(0, 1, 0);
      if (rotationAxis === 'Z') alignVector.set(0, 0, 1);

      const alignQ = new THREE.Quaternion().setFromUnitVectors(alignVector, axisNormalized);

      // Q_zero = Q_parent * Q_align
      const zeroQuat = parentQuat.clone().multiply(alignQ);

      // Q_delta = Q_zero^-1 * Q_current
      const deltaQuat = zeroQuat.clone().invert().multiply(dummyRef.current.quaternion);

      const motionAngle = extractSignedAngleAroundAxis(deltaQuat, alignVector);
      let newValue = getJointActualAngleFromMotionAngle(joint, motionAngle);

      // Apply limits for revolute joints
      const limit = joint.limit;
      const hasFiniteLimit = hasEffectivelyFiniteJointLimits(limit);
      if (joint.jointType === 'revolute' && hasFiniteLimit) {
        newValue = Math.max(limit.lower, Math.min(limit.upper, newValue));
      }

      if (Math.abs(newValue - lastRotation.current) > 0.001) {
        lastRotation.current = newValue;
        onChange(newValue);
      }
    } catch (e) {
      console.error('Error in JointInteraction handleChange:', e);
    }
  }, [joint, onChange, rotationAxis, axisNormalized]);

  // Reset lastRotation when value changes externally
  useEffect(() => {
    lastRotation.current = value;
  }, [value]);

  return (
    <>
      <primitive object={dummyRef.current} />
      <UnifiedTransformControls
        ref={transformRef}
        object={dummyRef.current}
        mode="rotate"
        showX={rotationAxis === 'X'}
        showY={rotationAxis === 'Y'}
        showZ={rotationAxis === 'Z'}
        size={1.2}
        space="local"
        hoverStyle="single-axis"
        displayStyle="thick-primary"
        onMouseDown={() => {
          isDragging.current = true;
          lockInteraction();
          setIsDragging?.(true);
        }}
        onMouseUp={() => {
          isDragging.current = false;
          setIsDragging?.(false);
          unlockInteraction(true);
          if (onCommit) onCommit(lastRotation.current);
        }}
        onObjectChange={handleChange}
      />
    </>
  );
};
