import {
  createStableJsonSnapshot,
  stripTransientJointMotionFromJoint,
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

function stripPatchableRuntimeStateFromGeometry<T extends UrdfLink['visual']>(geometry: T): T {
  const { color: _color, visible: _visible, authoredMaterials, ...restGeometry } = geometry;
  const nextGeometry = { ...restGeometry } as T;

  if (authoredMaterials) {
    nextGeometry.authoredMaterials = authoredMaterials.map((material) => {
      const { color: _materialColor, colorRgba: _colorRgba, ...restMaterial } = material;
      return restMaterial;
    });
  }

  return nextGeometry;
}

function stripPatchableRuntimeStateFromJoints(
  joints: Record<string, UrdfJoint>,
): Record<string, Omit<UrdfJoint, 'origin'>> {
  // A joint `origin` change is applied incrementally by the in-place joint
  // patch path (detectJointPatches -> patchJointsInPlace), so — exactly like
  // patchable link geometry below — it must NOT contribute to the load-scope
  // signature. Otherwise an origin-only edit (e.g. dragging a link/component
  // origin, or the assembly viewer's synthetic root joints when a component is
  // first placed) churns the scope key and forces a full async robot rebuild,
  // flashing the pre-drag pose before snapping to the committed one. Structural
  // fields (id/type/parent/child/axis/limit/...) stay in the signature so real
  // topology changes still trigger a rebuild.
  return Object.fromEntries(
    Object.entries(joints).map(([jointId, joint]) => {
      const { origin: _origin, ...rest } = stripTransientJointMotionFromJoint(joint);
      return [jointId, rest];
    }),
  );
}

function stripPatchableRuntimeStateFromLinks(
  links: Record<string, UrdfLink>,
): Record<string, UrdfLink> {
  return Object.fromEntries(
    Object.entries(links).map(([linkId, link]) => {
      const {
        visible: _visible,
        visual,
        visualBodies,
        collision,
        collisionBodies,
        ...restLink
      } = link;

      return [
        linkId,
        {
          ...restLink,
          visual: stripPatchableRuntimeStateFromGeometry(visual),
          visualBodies: visualBodies?.map(stripPatchableRuntimeStateFromGeometry),
          collision: stripPatchableRuntimeStateFromGeometry(collision),
          collisionBodies: collisionBodies?.map(stripPatchableRuntimeStateFromGeometry),
        },
      ];
    }),
  );
}

function stripPatchableRuntimeStateFromJoint(joint: UrdfJoint): UrdfJoint {
  const { origin: _origin, ...restJoint } = stripTransientJointMotionFromJoint(joint);
  return restJoint as UrdfJoint;
}

function stripPatchableRuntimeStateFromJoints(
  joints: Record<string, UrdfJoint>,
): Record<string, UrdfJoint> {
  return Object.fromEntries(
    Object.entries(joints).map(([jointId, joint]) => [
      jointId,
      stripPatchableRuntimeStateFromJoint(joint),
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
      links: stripPatchableRuntimeStateFromLinks(robotLinks),
      joints: stripPatchableRuntimeStateFromJoints(robotJoints),
    });
    return `structured:${hashStringFNV1a(structuredSnapshot)}`;
  }

  return `content:${hashStringFNV1a(urdfContent)}`;
}
