import type { RobotClosedLoopConstraint, RobotData, RobotFile, UrdfJoint, UrdfLink } from '@/types';
import { rewriteRobotMeshPathsForSource } from '@/core/parsers/meshPathUtils';

export function sanitizeAssemblyComponentId(filename: string): string {
  const base =
    filename
      .split('/')
      .pop()
      ?.replace(/\.[^/.]+$/, '') ?? 'robot';
  const sanitized = base.replace(/[^a-zA-Z0-9_]/g, '_');
  return sanitized || 'robot';
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
  existingComponentIds,
  existingComponentNames,
}: {
  fileName: string;
  existingComponentIds: Iterable<string>;
  existingComponentNames: Iterable<string>;
}): {
  componentId: string;
  displayName: string;
} {
  const baseId = sanitizeAssemblyComponentId(fileName);
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

export function namespaceAssemblyRobotData(
  data: RobotData,
  options: { componentId: string; rootName: string },
): RobotData {
  const { componentId, rootName } = options;
  const idPrefix = `${componentId}_`;
  const linkIdMap: Record<string, string> = {};
  const linkNameMap: Record<string, string> = {};
  const links: Record<string, UrdfLink> = {};
  const joints: Record<string, UrdfJoint> = {};
  const closedLoopConstraints: RobotClosedLoopConstraint[] = [];
  const materials: NonNullable<RobotData['materials']> = {};

  for (const [id, link] of Object.entries(data.links)) {
    const newId = idPrefix + id;
    linkIdMap[id] = newId;
    const originalName = link.name?.trim() || id;
    const isRootLink = id === data.rootLinkId;
    const newName = isRootLink ? rootName : `${rootName}_${originalName}`;
    linkNameMap[originalName] = newId;

    links[newId] = {
      ...link,
      id: newId,
      name: newName,
    };
  }

  Object.entries(data.materials || {}).forEach(([key, material]) => {
    const targetLinkId = linkIdMap[key] || linkNameMap[key] || key;
    materials[targetLinkId] = { ...material };
  });

  for (const [id, joint] of Object.entries(data.joints)) {
    const newId = idPrefix + id;
    const parentId = linkIdMap[joint.parentLinkId] ?? idPrefix + joint.parentLinkId;
    const childId = linkIdMap[joint.childLinkId] ?? idPrefix + joint.childLinkId;
    const originalName = joint.name?.trim() || id;

    joints[newId] = {
      ...joint,
      id: newId,
      name: `${rootName}_${originalName}`,
      parentLinkId: parentId,
      childLinkId: childId,
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
  });
}
