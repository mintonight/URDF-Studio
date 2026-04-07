import { useState, useCallback } from 'react';
import * as THREE from 'three';

export interface CollisionRefsState {
  collisionRefs: Record<string, THREE.Group | null>;
  handleRegisterCollisionRef: (
    linkId: string,
    objectIndex: number,
    ref: THREE.Group | null,
  ) => void;
  selectedCollisionRef: THREE.Group | null;
}

const getCollisionRefKey = (linkId: string, objectIndex = 0) => `${linkId}:${objectIndex}`;

/**
 * Custom hook to manage collision geometry references
 * Used for TransformControls to manipulate collision geometry in editor mode
 */
export function useCollisionRefs(
  selectionType?: 'link' | 'joint' | 'tendon',
  selectionId?: string,
  selectionSubType?: 'visual' | 'collision',
  selectionObjectIndex = 0,
): CollisionRefsState {
  const [collisionRefs, setCollisionRefs] = useState<Record<string, THREE.Group | null>>({});

  const handleRegisterCollisionRef = useCallback(
    (linkId: string, objectIndex: number, ref: THREE.Group | null) => {
      const collisionRefKey = getCollisionRefKey(linkId, objectIndex);
      setCollisionRefs((prev) => {
        if (ref) {
          if (prev[collisionRefKey] === ref) return prev;
          return { ...prev, [collisionRefKey]: ref };
        }

        if (!(collisionRefKey in prev)) return prev;
        const next = { ...prev };
        delete next[collisionRefKey];
        return next;
      });
    },
    [],
  );

  const selectedCollisionRef =
    selectionType === 'link' && selectionId && selectionSubType === 'collision'
      ? (collisionRefs[getCollisionRefKey(selectionId, selectionObjectIndex)] ?? null)
      : null;

  return {
    collisionRefs,
    handleRegisterCollisionRef,
    selectedCollisionRef,
  };
}
