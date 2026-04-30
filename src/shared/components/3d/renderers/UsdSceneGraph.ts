import * as THREE from 'three';
import { resolveUsdRuntimeLinkPathForMesh } from '@/features/urdf-viewer/utils/usdRuntimeMeshMapping';
import { resolveUsdVisualMeshObjectOrder } from '@/features/urdf-viewer/utils/usdRuntimeMeshObjectOrder';
import { prepareUsdVisualMesh } from '@/features/urdf-viewer/utils/usdVisualRendering';
import type { RobotData, UrdfJoint } from '@/types';
import type { ViewerRobotDataResolution } from '@/features/urdf-viewer/utils/viewerRobotData';
import type {
  RaycastHit,
  RaycastOptions,
  RobotSceneGraph,
  TransformUpdateRequest,
} from './types';

type UsdMeshRole = 'visual' | 'collision';

type UsdRenderInterfaceLike = {
  meshes?: Record<string, { _mesh?: THREE.Mesh } | null | undefined>;
  getResolvedPrimPathForMeshId?: (meshId: string) => string | null;
  getResolvedVisualTransformPrimPathForMeshId?: (meshId: string) => string | null;
  getPreferredLinkWorldTransform?: (linkPath: string) => unknown;
  getWorldTransformForPrimPath?: (primPath: string) => unknown;
  getUrdfTruthLinkContextForMeshId?: (
    meshId: string,
    sectionName?: string,
  ) => { proto?: { protoIndex?: number } | null } | null | undefined;
};

export interface BuildUsdSceneGraphFromResolutionOptions {
  root: THREE.Group;
  renderInterface: UsdRenderInterfaceLike | null | undefined;
  resolution: ViewerRobotDataResolution;
  showVisual?: boolean;
  showCollision?: boolean;
}

const USD_VISUAL_SEGMENT_PATTERN = /(?:^|\/)visuals?(?:$|[/.])/i;
const USD_COLLISION_SEGMENT_PATTERN = /(?:^|\/)coll(?:isions?|iders?)(?:$|[/.])/i;

function getUsdMeshRole(meshId: string, meshName = ''): UsdMeshRole {
  const normalizedMeshId = String(meshId || '').toLowerCase();
  const normalizedMeshName = String(meshName || '').toLowerCase();
  if (
    USD_COLLISION_SEGMENT_PATTERN.test(normalizedMeshId) ||
    USD_COLLISION_SEGMENT_PATTERN.test(normalizedMeshName)
  ) {
    return 'collision';
  }

  return USD_VISUAL_SEGMENT_PATTERN.test(normalizedMeshId) ||
    USD_VISUAL_SEGMENT_PATTERN.test(normalizedMeshName)
    ? 'visual'
    : 'visual';
}

function toMatrix4(value: unknown): THREE.Matrix4 | null {
  if (!value) return null;
  if (value instanceof THREE.Matrix4) return value.clone();
  if (
    Array.isArray(value) ||
    (typeof value === 'object' && typeof (value as ArrayLike<number>).length === 'number')
  ) {
    const numeric = Array.from(value as ArrayLike<number>).map((entry) => Number(entry));
    if (numeric.length >= 16 && numeric.every((entry) => Number.isFinite(entry))) {
      return new THREE.Matrix4().fromArray(numeric.slice(0, 16));
    }
  }
  return null;
}

function resolveLinkLocalMatrix(
  root: THREE.Object3D,
  renderInterface: UsdRenderInterfaceLike | null | undefined,
  linkPath: string | null | undefined,
): THREE.Matrix4 | null {
  if (!linkPath) return null;
  const worldMatrix =
    toMatrix4(renderInterface?.getPreferredLinkWorldTransform?.(linkPath)) ??
    toMatrix4(renderInterface?.getWorldTransformForPrimPath?.(linkPath));
  if (!worldMatrix) return null;

  root.updateMatrixWorld(true);
  const rootInverse = root.matrixWorld.clone().invert();
  return rootInverse.multiply(worldMatrix);
}

function createRuntimeLinkNode({
  root,
  renderInterface,
  linkId,
  linkPath,
}: {
  root: THREE.Group;
  renderInterface: UsdRenderInterfaceLike | null | undefined;
  linkId: string;
  linkPath: string | null | undefined;
}): THREE.Group {
  const linkNode = new THREE.Group();
  linkNode.name = linkId;
  (linkNode as THREE.Group & { isURDFLink?: boolean }).isURDFLink = true;
  linkNode.userData.runtimeNodeType = 'URDFLink';
  linkNode.userData.parentLinkName = linkId;
  linkNode.userData.linkId = linkId;
  linkNode.userData.usdLinkPath = linkPath ?? null;
  const linkLocalMatrix = resolveLinkLocalMatrix(root, renderInterface, linkPath);
  if (linkLocalMatrix) {
    linkNode.matrixAutoUpdate = false;
    linkNode.matrix.copy(linkLocalMatrix);
  }
  root.add(linkNode);
  linkNode.updateMatrixWorld(true);
  return linkNode;
}

function createRuntimeJointNode(
  joint: UrdfJoint,
  parentLink: THREE.Object3D | undefined,
): THREE.Group {
  const jointNode = new THREE.Group() as THREE.Group & {
    isURDFJoint?: boolean;
    jointType?: string;
    axis?: THREE.Vector3;
    limit?: UrdfJoint['limit'];
    angle?: number;
    setJointValue?: (value: number) => void;
    finalizeJointValue?: () => void;
    origPosition?: THREE.Vector3;
    origQuaternion?: THREE.Quaternion;
  };
  jointNode.name = joint.name || joint.id;
  jointNode.userData.runtimeNodeType = 'URDFJoint';
  jointNode.isURDFJoint = true;
  jointNode.jointType = joint.type;
  jointNode.axis = new THREE.Vector3(joint.axis?.x ?? 0, joint.axis?.y ?? 0, joint.axis?.z ?? 1);
  jointNode.limit = joint.limit;
  jointNode.angle = joint.angle ?? 0;
  jointNode.userData.jointId = joint.id;
  jointNode.setJointValue = (value: number) => {
    if (Number.isFinite(value)) {
      jointNode.angle = value;
    }
  };
  jointNode.finalizeJointValue = () => {};
  jointNode.position.set(
    joint.origin?.xyz?.x ?? 0,
    joint.origin?.xyz?.y ?? 0,
    joint.origin?.xyz?.z ?? 0,
  );
  jointNode.quaternion.setFromEuler(
    new THREE.Euler(
      joint.origin?.rpy?.r ?? 0,
      joint.origin?.rpy?.p ?? 0,
      joint.origin?.rpy?.y ?? 0,
      'ZYX',
    ),
  );
  jointNode.origPosition = jointNode.position.clone();
  jointNode.origQuaternion = jointNode.quaternion.clone();
  parentLink?.add(jointNode);
  return jointNode;
}

function connectRuntimeLinkHierarchy({
  runtimeLinks,
  runtimeJoints,
  robotData,
}: {
  runtimeLinks: Record<string, THREE.Object3D>;
  runtimeJoints: Record<string, THREE.Object3D>;
  robotData: RobotData;
}): void {
  Object.entries(robotData.joints).forEach(([jointId, joint]) => {
    const jointNode = runtimeJoints[jointId];
    const childLinkNode = runtimeLinks[joint.childLinkId];
    if (!jointNode || !childLinkNode || childLinkNode.parent === jointNode) {
      return;
    }

    jointNode.updateMatrixWorld(true);
    jointNode.attach(childLinkNode);
  });
}

function pushMesh(
  linkMeshMap: Map<string, THREE.Mesh[]>,
  key: string,
  mesh: THREE.Mesh,
): void {
  const meshes = linkMeshMap.get(key) ?? [];
  meshes.push(mesh);
  linkMeshMap.set(key, meshes);
}

function getUsdMeshSubType(mesh: THREE.Object3D): 'visual' | 'collision' {
  return mesh.userData?.isCollision === true ||
    mesh.userData?.isCollisionMesh === true ||
    mesh.userData?.geometryRole === 'collision'
    ? 'collision'
    : 'visual';
}

function getUsdMeshObjectIndex(mesh: THREE.Object3D): number | undefined {
  const rawIndex =
    mesh.userData?.objectIndex ??
    mesh.userData?.usdObjectIndex ??
    mesh.userData?.collisionObjectIndex ??
    mesh.userData?.visualObjectIndex;
  return Number.isInteger(rawIndex) ? rawIndex : undefined;
}

function getUsdMeshLinkId(mesh: THREE.Object3D): string | null {
  if (typeof mesh.userData?.linkId === 'string') {
    return mesh.userData.linkId;
  }
  if (typeof mesh.userData?.parentLinkName === 'string') {
    return mesh.userData.parentLinkName;
  }
  if (typeof mesh.userData?.runtimeLinkName === 'string') {
    return mesh.userData.runtimeLinkName;
  }
  return null;
}

function resolveMeshesForTransformRequest(
  sceneGraph: Pick<RobotSceneGraph, 'linkMeshMap'>,
  request: TransformUpdateRequest,
): THREE.Mesh[] {
  const role = request.isCollision ? 'collision' : 'visual';
  return (
    sceneGraph.linkMeshMap.get(`${request.linkId}:${role}`) ??
    sceneGraph.linkMeshMap.get(request.linkId) ??
    []
  );
}

export function updateUsdSceneGraphLinkTransform(
  sceneGraph: Pick<RobotSceneGraph, 'linkMeshMap'>,
  request: TransformUpdateRequest,
): boolean {
  const meshes = resolveMeshesForTransformRequest(sceneGraph, request);
  const targetMesh =
    request.objectIndex !== undefined
      ? meshes.find((mesh) => getUsdMeshObjectIndex(mesh) === request.objectIndex) ??
        meshes[request.objectIndex]
      : meshes[0];
  if (!targetMesh) {
    return false;
  }

  const localMatrix = request.matrix.clone();
  if (targetMesh.parent) {
    targetMesh.parent.updateMatrixWorld(true);
    localMatrix.premultiply(targetMesh.parent.matrixWorld.clone().invert());
  }

  targetMesh.matrix.copy(localMatrix);
  targetMesh.matrix.decompose(targetMesh.position, targetMesh.quaternion, targetMesh.scale);
  targetMesh.matrixWorldNeedsUpdate = true;
  targetMesh.updateMatrixWorld(true);
  return true;
}

export function raycastUsdSceneGraph(
  sceneGraph: Pick<RobotSceneGraph, 'linkMeshMap' | 'root'>,
  options: RaycastOptions,
): RaycastHit[] {
  const {
    raycaster,
    includeVisual = true,
    includeCollision = true,
    includeGizmos = false,
    additionalTargets,
  } = options;
  const targets: THREE.Object3D[] = [];

  sceneGraph.linkMeshMap.forEach((meshes) => {
    meshes.forEach((mesh) => {
      const role = getUsdMeshSubType(mesh);
      if ((role === 'visual' && includeVisual) || (role === 'collision' && includeCollision)) {
        targets.push(mesh);
      }
    });
  });

  if (includeGizmos && additionalTargets) {
    targets.push(...additionalTargets);
  } else if (additionalTargets && additionalTargets.length > 0) {
    targets.push(...additionalTargets.filter((target) => target.userData?.isGizmo !== true));
  }

  const seenObjects = new Set<THREE.Object3D>();
  const hits = raycaster.intersectObjects(targets, false).flatMap((hit): RaycastHit[] => {
    const mesh = hit.object as THREE.Mesh;
    if (seenObjects.has(mesh)) {
      return [];
    }
    seenObjects.add(mesh);
    const subType = getUsdMeshSubType(mesh);
    return [
      {
        object: mesh,
        point: hit.point,
        distance: hit.distance,
        linkId: getUsdMeshLinkId(mesh),
        jointId: null,
        subType,
        objectIndex: getUsdMeshObjectIndex(mesh),
        helperKind: undefined,
        highlightObjectId: undefined,
        isGizmo: mesh.userData?.isGizmo === true,
        meshId: mesh.userData?.usdMeshId,
        primPath: mesh.userData?.usdPrimPath ?? mesh.userData?.primPath,
      },
    ];
  });

  return hits.sort((a, b) => a.distance - b.distance);
}

export function buildUsdSceneGraphFromResolution({
  root,
  renderInterface,
  resolution,
  showVisual = true,
  showCollision = true,
}: BuildUsdSceneGraphFromResolutionOptions): RobotSceneGraph & { robotData: RobotData } {
  const robotData = structuredClone(resolution.robotData);
  const linkMeshMap = new Map<string, THREE.Mesh[]>();
  const runtimeLinks: Record<string, THREE.Object3D> = {};
  const runtimeJoints: Record<string, THREE.Object3D> = {};
  const visualFallbackOrderByLinkId = new Map<string, number>();
  const collisionFallbackOrderByLinkId = new Map<string, number>();

  Object.entries(robotData.links).forEach(([linkId]) => {
    runtimeLinks[linkId] = createRuntimeLinkNode({
      root,
      renderInterface,
      linkId,
      linkPath: resolution.linkPathById[linkId],
    });
  });

  Object.entries(robotData.joints).forEach(([jointId, joint]) => {
    runtimeJoints[jointId] = createRuntimeJointNode(joint, runtimeLinks[joint.parentLinkId]);
  });

  connectRuntimeLinkHierarchy({
    runtimeLinks,
    runtimeJoints,
    robotData,
  });

  Object.entries(renderInterface?.meshes ?? {}).forEach(([meshId, hydraMesh]) => {
    const mesh = hydraMesh?._mesh;
    if (!mesh) return;

    const resolvedPrimPath =
      renderInterface?.getResolvedVisualTransformPrimPathForMeshId?.(meshId) ??
      renderInterface?.getResolvedPrimPathForMeshId?.(meshId) ??
      null;
    const linkPath = resolveUsdRuntimeLinkPathForMesh({
      meshId,
      resolution,
      resolvedPrimPath,
    });
    if (!linkPath) return;

    const linkId = resolution.linkIdByPath[linkPath];
    if (!linkId) return;

    const role = getUsdMeshRole(meshId, mesh.name || '');
    const fallbackOrderMap =
      role === 'collision' ? collisionFallbackOrderByLinkId : visualFallbackOrderByLinkId;
    const fallbackOrder = fallbackOrderMap.get(linkId) ?? 0;
    const objectIndex =
      role === 'visual'
        ? resolveUsdVisualMeshObjectOrder({
            renderInterface,
            meshId,
            fallbackOrder,
          })
        : fallbackOrder;
    fallbackOrderMap.set(linkId, Math.max(fallbackOrder + 1, objectIndex + 1));

    mesh.userData = mesh.userData || {};
    mesh.userData.geometryRole = role;
    mesh.userData.parentLinkName = linkId;
    mesh.userData.linkId = linkId;
    mesh.userData.runtimeLinkName = linkId;
    mesh.userData.usdLinkPath = linkPath;
    mesh.userData.usdMeshId = meshId;
    mesh.userData.meshId = meshId;
    mesh.userData.usdPrimPath = resolvedPrimPath;
    mesh.userData.primPath = resolvedPrimPath;
    mesh.userData.usdObjectIndex = objectIndex;
    mesh.userData.objectIndex = objectIndex;
    if (role === 'collision') {
      (mesh as THREE.Mesh & { isURDFCollider?: boolean }).isURDFCollider = true;
      mesh.userData.isCollision = true;
      mesh.userData.isCollisionMesh = true;
      mesh.userData.isVisual = false;
      mesh.userData.isVisualMesh = false;
      mesh.userData.collisionObjectIndex = objectIndex;
      mesh.visible = showCollision;
    } else {
      (mesh as THREE.Mesh & { isURDFVisual?: boolean }).isURDFVisual = true;
      mesh.userData.isVisual = true;
      mesh.userData.isVisualMesh = true;
      mesh.userData.isCollision = false;
      mesh.userData.isCollisionMesh = false;
      mesh.userData.visualObjectIndex = objectIndex;
      mesh.visible = showVisual && robotData.links[linkId]?.visible !== false;
      prepareUsdVisualMesh(mesh);
    }

    pushMesh(linkMeshMap, `${linkId}:${role}`, mesh);
    runtimeLinks[linkId]?.attach(mesh);
  });

  (
    root as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
      joints?: Record<string, THREE.Object3D>;
    }
  ).links = runtimeLinks;
  (
    root as THREE.Group & {
      links?: Record<string, THREE.Object3D>;
      joints?: Record<string, THREE.Object3D>;
    }
  ).joints = runtimeJoints;
  root.userData.robotData = robotData;
  root.updateMatrixWorld(true);

  return {
    root,
    linkMeshMap,
    robotData,
    robotLinks: robotData.links,
    robotJoints: robotData.joints,
    rootLinkId: robotData.rootLinkId || null,
    version: 0,
  };
}
