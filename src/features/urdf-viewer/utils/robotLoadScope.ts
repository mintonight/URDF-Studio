import {
  createStableJsonSnapshot,
  stripTransientJointMotionFromJoints,
} from '@/shared/utils/robot/semanticSnapshot';
import type { UrdfJoint, UrdfLink } from '@/types';

interface CreateViewerRobotLoadInputSignatureOptions {
  urdfContent: string;
  hasStructuredRobotState: boolean;
  robotLinks?: Record<string, UrdfLink>;
  robotJoints?: Record<string, UrdfJoint>;
}

function hashStringFNV1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function stripPatchableMaterialStateFromGeometry<T extends UrdfLink['visual']>(geometry: T): T {
  const { color: _color, authoredMaterials, ...restGeometry } = geometry;
  const nextGeometry = { ...restGeometry } as T;

  if (authoredMaterials) {
    nextGeometry.authoredMaterials = authoredMaterials.map((material) => {
      const { color: _materialColor, colorRgba: _colorRgba, ...restMaterial } = material;
      return restMaterial;
    });
  }

  return nextGeometry;
}

function stripPatchableMaterialStateFromLinks(
  links: Record<string, UrdfLink>,
): Record<string, UrdfLink> {
  return Object.fromEntries(
    Object.entries(links).map(([linkId, link]) => [
      linkId,
      {
        ...link,
        visual: stripPatchableMaterialStateFromGeometry(link.visual),
        visualBodies: link.visualBodies?.map(stripPatchableMaterialStateFromGeometry),
        collision: stripPatchableMaterialStateFromGeometry(link.collision),
        collisionBodies: link.collisionBodies?.map(stripPatchableMaterialStateFromGeometry),
      },
    ]),
  );
}

export function createViewerRobotLoadInputSignature({
  urdfContent,
  hasStructuredRobotState,
  robotLinks,
  robotJoints,
}: CreateViewerRobotLoadInputSignatureOptions): string {
  if (hasStructuredRobotState && robotLinks && robotJoints) {
    const structuredSnapshot = createStableJsonSnapshot({
      links: stripPatchableMaterialStateFromLinks(robotLinks),
      joints: stripTransientJointMotionFromJoints(robotJoints),
    });
    return `structured:${hashStringFNV1a(structuredSnapshot)}`;
  }

  return `content:${hashStringFNV1a(urdfContent)}`;
}
