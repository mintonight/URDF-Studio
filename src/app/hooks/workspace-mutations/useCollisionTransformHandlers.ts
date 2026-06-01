import { useCallback } from 'react';
import { resolveLinkKey, updateCollisionGeometryByObjectIndex } from '@/core/robot';
import type { UrdfLink } from '@/types';
import { useRobotStore } from '@/store';
import type { PendingCollisionTransform } from '@/store/collisionTransformStore';
import type { UpdateCommitMode, UpdateCommitOptions } from '@/types/viewer';

interface CollisionTransformParams {
  robotLinks: Record<string, UrdfLink>;
  setPendingCollisionTransform: (transform: PendingCollisionTransform) => void;
  clearPendingCollisionTransform: () => void;
  handleTransformPendingChange: (pending: boolean) => void;
  applyUpdate: (
    type: 'link',
    id: string,
    data: UrdfLink,
    options?: UpdateCommitOptions,
  ) => void;
}

export function useCollisionTransformHandlers({
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
      const latestAssemblyState = useRobotStore.getState().assemblyState;

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

      const latestLinks = useRobotStore.getState().links;
      const resolvedLinkId = resolveLinkKey(latestLinks, linkId);
      if (!resolvedLinkId) return;

      const link = latestLinks[resolvedLinkId];
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
    },
    [applyUpdate],
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
