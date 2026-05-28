import {
  GeometryType,
  type RobotClosedLoopConstraint,
  type RobotData,
  type RobotFile,
  type UrdfVisual,
  type UrdfVisualMaterial,
  type UrdfJoint,
  type UrdfLink,
} from '@/types';
import { rewriteRobotMeshPathsForSource } from '@/core/parsers/meshPathUtils';

const GENERIC_ASSEMBLY_COMPONENT_FILE_STEMS = new Set(['model', 'robot', 'scene']);

function sanitizeAssemblyComponentBaseName(value: string | null | undefined): string | null {
  const sanitized = String(value || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_');
  return sanitized || null;
}

function getPathSegments(fileName: string): string[] {
  return String(fileName || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
}

function getFileStem(fileName: string): string {
  const lastSegment = getPathSegments(fileName).pop() ?? '';
  return lastSegment.replace(/\.[^/.]+$/, '');
}

function resolveAssemblyComponentPathBaseName(fileName: string): string {
  const segments = getPathSegments(fileName);
  const fileStem = getFileStem(fileName);
  const parentSegment = segments.length > 1 ? segments[segments.length - 2] : '';
  const shouldPreferParent =
    Boolean(parentSegment) &&
    GENERIC_ASSEMBLY_COMPONENT_FILE_STEMS.has(fileStem.trim().toLowerCase());

  return (
    sanitizeAssemblyComponentBaseName(shouldPreferParent ? parentSegment : fileStem) ??
    sanitizeAssemblyComponentBaseName(parentSegment) ??
    'robot'
  );
}

function extractTagAttribute(source: string, tagPattern: string, attributeName: string): string | null {
  const tagMatch = source.match(new RegExp(`<\\s*${tagPattern}\\b[^>]*>`, 'i'));
  const tag = tagMatch?.[0];
  if (!tag) {
    return null;
  }

  const attributeMatch = tag.match(
    new RegExp(`\\b${attributeName}\\s*=\\s*(["'])(.*?)\\1`, 'i'),
  );
  return attributeMatch?.[2]?.trim() || null;
}

function extractAssemblyComponentSourceName(
  content: string | null | undefined,
  format?: RobotFile['format'] | null,
): string | null {
  const source = String(content || '');
  if (!source.trim()) {
    return null;
  }

  switch (format) {
    case 'sdf':
      return (
        extractTagAttribute(source, 'model', 'name') ??
        extractTagAttribute(source, 'world', 'name')
      );
    case 'mjcf':
      return extractTagAttribute(source, 'mujoco', 'model');
    case 'urdf':
    case 'xacro':
      return extractTagAttribute(source, '(?:[\\w.-]+:)?robot', 'name');
    default:
      return (
        extractTagAttribute(source, 'model', 'name') ??
        extractTagAttribute(source, '(?:[\\w.-]+:)?robot', 'name') ??
        extractTagAttribute(source, 'mujoco', 'model')
      );
  }
}

export function sanitizeAssemblyComponentId(filename: string): string {
  return sanitizeAssemblyComponentBaseName(getFileStem(filename)) ?? 'robot';
}

export function resolveAssemblyComponentBaseName(
  file: Pick<RobotFile, 'name' | 'content' | 'format'>,
  fallbackName?: string | null,
): string {
  return (
    sanitizeAssemblyComponentBaseName(
      extractAssemblyComponentSourceName(file.content, file.format),
    ) ??
    sanitizeAssemblyComponentBaseName(fallbackName) ??
    resolveAssemblyComponentPathBaseName(file.name)
  );
}

export function createUniqueAssemblyComponentName(
  baseName: string,
  existingNames: Set<string>,
): string {
  if (!existingNames.has(baseName)) {
    return baseName;
  }

  let suffix = 1;
  let candidate = `${baseName}_${suffix}`;
  while (existingNames.has(candidate)) {
    suffix += 1;
    candidate = `${baseName}_${suffix}`;
  }
  return candidate;
}

export function buildAssemblyComponentIdentity({
  fileName,
  baseName,
  existingComponentIds,
  existingComponentNames,
}: {
  fileName: string;
  baseName?: string | null;
  existingComponentIds: Iterable<string>;
  existingComponentNames: Iterable<string>;
}): {
  componentId: string;
  displayName: string;
} {
  const baseId =
    sanitizeAssemblyComponentBaseName(baseName) ?? resolveAssemblyComponentPathBaseName(fileName);
  const existingNameSet = new Set(existingComponentNames);
  const displayName = createUniqueAssemblyComponentName(baseId, existingNameSet);
  const existingIdSet = new Set(existingComponentIds);

  let componentId = `comp_${displayName}`;
  let suffix = 1;
  while (existingIdSet.has(componentId)) {
    componentId = `comp_${displayName}_${suffix++}`;
  }

  return {
    componentId,
    displayName,
  };
}

function hasVisibleAssemblyGeometry(link: UrdfLink): boolean {
  const hasPrimaryVisual = Boolean(link.visual?.type && link.visual.type !== GeometryType.NONE);
  const hasExtraVisual = (link.visualBodies || []).some(
    (visual) => visual.type !== GeometryType.NONE,
  );
  const hasPrimaryCollision = Boolean(
    link.collision?.type && link.collision.type !== GeometryType.NONE,
  );
  const hasExtraCollision = (link.collisionBodies || []).some(
    (collision) => collision.type !== GeometryType.NONE,
  );

  return hasPrimaryVisual || hasExtraVisual || hasPrimaryCollision || hasExtraCollision;
}

function shouldPreserveMjcfSyntheticWorldRootName(
  data: RobotData,
  sourceFormat: RobotFile['format'] | null | undefined,
  id: string,
  link: UrdfLink,
): boolean {
  const isMjcfSource = data.inspectionContext?.sourceFormat === 'mjcf' || sourceFormat === 'mjcf';
  if (!isMjcfSource || id !== data.rootLinkId) {
    return false;
  }

  const originalName = (link.name?.trim() || id).toLowerCase();
  if (originalName !== 'world') {
    return false;
  }

  return (link.inertial?.mass || 0) <= 0 && !hasVisibleAssemblyGeometry(link);
}

function cloneAssemblyVisualMaterial(material: UrdfVisualMaterial): UrdfVisualMaterial {
  const cloned: UrdfVisualMaterial = {
    ...material,
  };
  if (material.colorRgba) {
    cloned.colorRgba = [...material.colorRgba];
  }
  if (material.passes) {
    cloned.passes = material.passes.map((pass) => ({ ...pass }));
  }
  return cloned;
}

function cloneAssemblyGeometry<T extends UrdfVisual | UrdfLink['collision']>(geometry: T): T {
  return {
    ...geometry,
    dimensions: geometry.dimensions ? { ...geometry.dimensions } : geometry.dimensions,
    origin: geometry.origin
      ? {
          ...geometry.origin,
          xyz: { ...geometry.origin.xyz },
          rpy: { ...geometry.origin.rpy },
          ...(geometry.origin.quatXyzw ? { quatXyzw: { ...geometry.origin.quatXyzw } } : {}),
        }
      : geometry.origin,
    authoredMaterials: geometry.authoredMaterials?.map(cloneAssemblyVisualMaterial),
    meshMaterialGroups: geometry.meshMaterialGroups?.map((group) => ({ ...group })),
    polylinePoints: geometry.polylinePoints?.map((point) => ({ ...point })),
    sdfHeightmap: geometry.sdfHeightmap
      ? {
          ...geometry.sdfHeightmap,
          size: { ...geometry.sdfHeightmap.size },
          pos: { ...geometry.sdfHeightmap.pos },
          textures: geometry.sdfHeightmap.textures.map((texture) => ({ ...texture })),
          blends: geometry.sdfHeightmap.blends.map((blend) => ({ ...blend })),
        }
      : geometry.sdfHeightmap,
    usdMeshDescriptors: geometry.usdMeshDescriptors?.map((descriptor) => ({ ...descriptor })),
  };
}

export function namespaceAssemblyRobotData(
  data: RobotData,
  options: { componentId: string; rootName: string; sourceFormat?: RobotFile['format'] | null },
): RobotData {
  const { componentId, rootName } = options;
  const idPrefix = `${componentId}_`;
  const linkIdMap: Record<string, string> = {};
  const linkNameMap: Record<string, string> = {};
  const jointIdMap: Record<string, string> = {};
  const jointNameMap: Record<string, string> = {};
  const links: Record<string, UrdfLink> = {};
  const joints: Record<string, UrdfJoint> = {};
  const closedLoopConstraints: RobotClosedLoopConstraint[] = [];
  const materials: NonNullable<RobotData['materials']> = {};

  for (const [id, link] of Object.entries(data.links)) {
    const newId = idPrefix + id;
    linkIdMap[id] = newId;
    const originalName = link.name?.trim() || id;
    const isRootLink = id === data.rootLinkId;
    const newName = shouldPreserveMjcfSyntheticWorldRootName(
      data,
      options.sourceFormat,
      id,
      link,
    )
      ? originalName
      : isRootLink
        ? rootName
        : `${rootName}_${originalName}`;
    linkNameMap[originalName] = newId;

    links[newId] = {
      ...link,
      id: newId,
      name: newName,
      visual: cloneAssemblyGeometry(link.visual),
      visualBodies: link.visualBodies?.map(cloneAssemblyGeometry),
      collision: cloneAssemblyGeometry(link.collision),
      collisionBodies: link.collisionBodies?.map(cloneAssemblyGeometry),
      inertial: link.inertial
        ? {
            ...link.inertial,
            origin: link.inertial.origin
              ? {
                  ...link.inertial.origin,
                  xyz: { ...link.inertial.origin.xyz },
                  rpy: { ...link.inertial.origin.rpy },
                  ...(link.inertial.origin.quatXyzw
                    ? { quatXyzw: { ...link.inertial.origin.quatXyzw } }
                    : {}),
                }
              : link.inertial.origin,
            inertia: { ...link.inertial.inertia },
          }
        : link.inertial,
    };
  }

  Object.entries(data.materials || {}).forEach(([key, material]) => {
    const targetLinkId = linkIdMap[key] || linkNameMap[key] || key;
    materials[targetLinkId] = { ...material };
  });

  for (const [id, joint] of Object.entries(data.joints)) {
    const newId = idPrefix + id;
    const originalName = joint.name?.trim() || id;
    jointIdMap[id] = newId;
    jointNameMap[originalName] = newId;
  }

  for (const [id, joint] of Object.entries(data.joints)) {
    const newId = idPrefix + id;
    const parentId = linkIdMap[joint.parentLinkId] ?? idPrefix + joint.parentLinkId;
    const childId = linkIdMap[joint.childLinkId] ?? idPrefix + joint.childLinkId;
    const originalName = joint.name?.trim() || id;
    const mimicJoint = joint.mimic?.joint
      ? (jointIdMap[joint.mimic.joint] ?? jointNameMap[joint.mimic.joint] ?? joint.mimic.joint)
      : undefined;

    joints[newId] = {
      ...joint,
      id: newId,
      name: `${rootName}_${originalName}`,
      parentLinkId: parentId,
      childLinkId: childId,
      mimic: joint.mimic
        ? {
            ...joint.mimic,
            ...(mimicJoint ? { joint: mimicJoint } : {}),
          }
        : undefined,
    };
  }

  const rootLinkId = linkIdMap[data.rootLinkId] ?? idPrefix + data.rootLinkId;

  (data.closedLoopConstraints || []).forEach((constraint) => {
    closedLoopConstraints.push({
      ...constraint,
      id: `${idPrefix}${constraint.id}`,
      linkAId: linkIdMap[constraint.linkAId] ?? idPrefix + constraint.linkAId,
      linkBId: linkIdMap[constraint.linkBId] ?? idPrefix + constraint.linkBId,
      source: constraint.source
        ? {
            ...constraint.source,
            body1Name: `${rootName}_${constraint.source.body1Name}`,
            body2Name: `${rootName}_${constraint.source.body2Name}`,
          }
        : undefined,
    });
  });

  return {
    name: data.name,
    links,
    joints,
    rootLinkId,
    materials: Object.keys(materials).length > 0 ? materials : undefined,
    closedLoopConstraints: closedLoopConstraints.length > 0 ? closedLoopConstraints : undefined,
    inspectionContext: data.inspectionContext,
  };
}

export function prepareAssemblyRobotData(
  data: RobotData,
  options: {
    componentId: string;
    rootName: string;
    sourceFilePath?: string | null;
    sourceFormat?: RobotFile['format'] | null;
  },
): RobotData {
  const sourceRobotData =
    options.sourceFormat === 'usd'
      ? rewriteRobotMeshPathsForSource(data, options.sourceFilePath)
      : data;

  return namespaceAssemblyRobotData(sourceRobotData, {
    componentId: options.componentId,
    rootName: options.rootName,
    sourceFormat: options.sourceFormat,
  });
}
