import { create } from 'zustand';

import type { JointQuaternion, UrdfJoint } from '@/types';

export type JointInteractionPreviewSource = 'visualizer' | 'urdf-viewer';

export interface JointInteractionPreviewSnapshot {
  source: JointInteractionPreviewSource | null;
  dragSessionId: string | null;
  activeJointId: string | null;
  jointAngles: Record<string, number>;
  jointQuaternions: Record<string, JointQuaternion>;
  jointOrigins: Record<string, UrdfJoint['origin']>;
}

export interface JointInteractionPreviewMatch {
  source?: JointInteractionPreviewSource | null;
  dragSessionId?: string | null;
}

export const EMPTY_JOINT_INTERACTION_PREVIEW: JointInteractionPreviewSnapshot = {
  source: null,
  dragSessionId: null,
  activeJointId: null,
  jointAngles: {},
  jointQuaternions: {},
  jointOrigins: {},
};

interface JointInteractionPreviewState {
  preview: JointInteractionPreviewSnapshot;
  publishPreview: (preview: JointInteractionPreviewSnapshot) => void;
  clearPreview: (match?: JointInteractionPreviewMatch | null) => void;
}

function numbersEqual(left: number | undefined, right: number | undefined): boolean {
  if (typeof left !== 'number' || typeof right !== 'number') {
    return left === right;
  }

  return Math.abs(left - right) <= 1e-9;
}

function quaternionsEqual(
  left: JointQuaternion | undefined,
  right: JointQuaternion | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    numbersEqual(left.x, right.x) &&
    numbersEqual(left.y, right.y) &&
    numbersEqual(left.z, right.z) &&
    numbersEqual(left.w, right.w)
  );
}

function originsEqual(
  left: UrdfJoint['origin'] | undefined,
  right: UrdfJoint['origin'] | undefined,
): boolean {
  if (!left || !right) {
    return left === right;
  }

  return (
    numbersEqual(left.xyz.x, right.xyz.x) &&
    numbersEqual(left.xyz.y, right.xyz.y) &&
    numbersEqual(left.xyz.z, right.xyz.z) &&
    numbersEqual(left.rpy.r, right.rpy.r) &&
    numbersEqual(left.rpy.p, right.rpy.p) &&
    numbersEqual(left.rpy.y, right.rpy.y)
  );
}

function recordMapsEqual<T>(
  left: Record<string, T>,
  right: Record<string, T>,
  compare: (left: T | undefined, right: T | undefined) => boolean,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }

  return leftKeys.every((key) => compare(left[key], right[key]));
}

function previewsEqual(
  left: JointInteractionPreviewSnapshot,
  right: JointInteractionPreviewSnapshot,
): boolean {
  return (
    left.source === right.source &&
    left.dragSessionId === right.dragSessionId &&
    left.activeJointId === right.activeJointId &&
    recordMapsEqual(left.jointAngles, right.jointAngles, numbersEqual) &&
    recordMapsEqual(left.jointQuaternions, right.jointQuaternions, quaternionsEqual) &&
    recordMapsEqual(left.jointOrigins, right.jointOrigins, originsEqual)
  );
}

export function hasJointInteractionPreview(
  preview: JointInteractionPreviewSnapshot | null | undefined,
): boolean {
  if (!preview) {
    return false;
  }

  return (
    Object.keys(preview.jointAngles).length > 0 ||
    Object.keys(preview.jointQuaternions).length > 0 ||
    Object.keys(preview.jointOrigins).length > 0
  );
}

export const useJointInteractionPreviewStore = create<JointInteractionPreviewState>()((set) => ({
  preview: EMPTY_JOINT_INTERACTION_PREVIEW,
  publishPreview: (preview) =>
    set((state) => (previewsEqual(state.preview, preview) ? state : { preview })),
  clearPreview: (match) =>
    set((state) => {
      if (match?.source && state.preview.source && state.preview.source !== match.source) {
        return state;
      }

      if (
        match?.dragSessionId &&
        state.preview.dragSessionId &&
        state.preview.dragSessionId !== match.dragSessionId
      ) {
        return state;
      }

      return previewsEqual(state.preview, EMPTY_JOINT_INTERACTION_PREVIEW)
        ? state
        : { preview: EMPTY_JOINT_INTERACTION_PREVIEW };
    }),
}));
