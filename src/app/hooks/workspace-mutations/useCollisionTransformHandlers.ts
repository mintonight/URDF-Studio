import { startTransition, useCallback } from 'react';
import { resolveLinkKey, updateCollisionGeometryByObjectIndex } from '@/core/robot';
import type { AssemblyState, UpdateCommitMode, UrdfJoint, UrdfLink } from '@/types';
import { useRobotStore } from '@/store';

interface CollisionTransformParams {
  assemblyState: AssemblyState | null;
  robotLinks: Record<string, UrdfLink>;
  setPendingCollisionTransform: (transform: {
    linkId: string;
    objectIndex: number;
    position: { x: number; y: number; z: number };
    rotation: { r: number; p: number; y: number };
  }) => void;
  clearPendingCollisionTransform: () => void;
  handleTransformPendingChange: (pending: boolean) => void;
  applyUpdate: (
    type: 'link' | 'joint',
    id: string,
    data: UrdfLink | UrdfJoint,
    options?: {
      commitMode?: UpdateCommitMode;
      historyKey?: string;
      historyLabel?: string;
      debounceMs?: number;
    },
  ) => void;
}

export function useCollisionTransformHandlers({
  assemblyState,
  robotLinks,
  setPendingCollisionTransform,
  clearPendingCollisionTransform,
  handleTransformPendingChange,
  applyUpdate,
}: CollisionTransformParams) {
  const applyCollisionTransformUpdate = useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      commitMode: UpdateCommitMode,
      objectIndex?: number,
    ) => {
      const latestAssemblyState = assemblyState;

      const updateTransform = () => {
        const resolvedLinkId = resolveLinkKey(useRobotStore.getState().links, linkId);
        if (!resolvedLinkId) return;
        const link = useRobotStore.getState().links[resolvedLinkId];
        if (!link) return;
        const updatedLink = updateCollisionGeometryByObjectIndex(link, objectIndex ?? 0, {
          origin: {
            xyz: position,
            rpy: rotation,
          },
        });
        applyUpdate('link', resolvedLinkId, updatedLink, {
          historyKey: `collision-transform:${resolvedLinkId}:${objectIndex ?? 0}`,
          historyLabel: 'Transform collision body',
          commitMode,
        });
      };

      if (latestAssemblyState) {
        for (const comp of Object.values(latestAssemblyState.components)) {
          const resolvedLinkId = resolveLinkKey(comp.robot.links, linkId);
          if (!resolvedLinkId) continue;
          const link = comp.robot.links[resolvedLinkId];
          if (!link) {
            return;
          }
          const updatedLink = updateCollisionGeometryByObjectIndex(link, objectIndex ?? 0, {
            origin: {
              xyz: position,
              rpy: rotation,
            },
          });
          applyUpdate('link', resolvedLinkId, updatedLink, {
            historyKey: `collision-transform:${comp.id}:${resolvedLinkId}:${objectIndex ?? 0}`,
            historyLabel: 'Transform collision body',
            commitMode,
          });
          return;
        }
        return;
      }

      updateTransform();
    },
    [assemblyState, applyUpdate],
  );

  const handleCollisionTransformPreview = useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      objectIndex?: number,
    ) => {
      const resolvedLinkId = resolveLinkKey(robotLinks, linkId) ?? linkId;
      setPendingCollisionTransform({
        linkId: resolvedLinkId,
        objectIndex: objectIndex ?? 0,
        position,
        rotation,
      });
    },
    [robotLinks, setPendingCollisionTransform],
  );

  const handleCollisionTransform = useCallback(
    (
      linkId: string,
      position: { x: number; y: number; z: number },
      rotation: { r: number; p: number; y: number },
      objectIndex?: number,
    ) => {
      clearPendingCollisionTransform();
      applyCollisionTransformUpdate(linkId, position, rotation, 'immediate', objectIndex);
    },
    [applyCollisionTransformUpdate, clearPendingCollisionTransform],
  );

  const handleCollisionTransformPendingChange = useCallback(
    (pending: boolean) => {
      handleTransformPendingChange(pending);
      if (!pending) {
        clearPendingCollisionTransform();
      }
    },
    [clearPendingCollisionTransform, handleTransformPendingChange],
  );

  return {
    applyCollisionTransformUpdate,
    handleCollisionTransformPreview,
    handleCollisionTransform,
    handleCollisionTransformPendingChange,
  };
}
