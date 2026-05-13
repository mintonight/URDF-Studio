import { DEFAULT_JOINT, DEFAULT_LINK, GeometryType, JointType } from '@/types';
import type {
  AssemblyComponent,
  AssemblyState,
  AssemblyTransform,
  RobotClosedLoopConstraint,
  RobotData,
  UrdfJoint,
  UrdfLink,
} from '@/types';
import { mergeAssembly } from './assemblyMerger';

const TRANSFORM_EPSILON = 1e-9;

export const IDENTITY_ASSEMBLY_TRANSFORM: AssemblyTransform = Object.freeze({
  position: { x: 0, y: 0, z: 0 },
  rotation: { r: 0, p: 0, y: 0 },
});

export const ASSEMBLY_EXPORT_ROOT_LINK_ID = '__assembly_root';
const ASSEMBLY_EXPORT_ROOT_JOINT_PREFIX = '__assembly_root_joint_';
const ASSEMBLY_COMPONENT_ROOT_LINK_PREFIX = '__assembly_component_root_';
const ASSEMBLY_COMPONENT_ROOT_JOINT_PREFIX = '__assembly_component_joint_';

export function cloneAssemblyTransform(transform?: AssemblyTransform | null): AssemblyTransform {
  if (!transform) {
    return {
      position: { ...IDENTITY_ASSEMBLY_TRANSFORM.position },
      rotation: { ...IDENTITY_ASSEMBLY_TRANSFORM.rotation },
    };
  }

  return {
    position: {
      x: Number.isFinite(transform.position?.x) ? transform.position.x : 0,
      y: Number.isFinite(transform.position?.y) ? transform.position.y : 0,
      z: Number.isFinite(transform.position?.z) ? transform.position.z : 0,
    },
    rotation: {
      r: Number.isFinite(transform.rotation?.r) ? transform.rotation.r : 0,
      p: Number.isFinite(transform.rotation?.p) ? transform.rotation.p : 0,
      y: Number.isFinite(transform.rotation?.y) ? transform.rotation.y : 0,
    },
  };
}

export function isIdentityAssemblyTransform(transform?: AssemblyTransform | null): boolean {
  if (!transform) {
    return true;
  }

  const normalized = cloneAssemblyTransform(transform);
  return (
    Math.abs(normalized.position.x) <= TRANSFORM_EPSILON &&
    Math.abs(normalized.position.y) <= TRANSFORM_EPSILON &&
    Math.abs(normalized.position.z) <= TRANSFORM_EPSILON &&
    Math.abs(normalized.rotation.r) <= TRANSFORM_EPSILON &&
    Math.abs(normalized.rotation.p) <= TRANSFORM_EPSILON &&
    Math.abs(normalized.rotation.y) <= TRANSFORM_EPSILON
  );
}

export function isAssemblyComponentIndividuallyTransformable(
  assemblyState: AssemblyState | null | undefined,
  componentId: string,
): boolean {
  if (!assemblyState?.components[componentId]) {
    return false;
  }

  return !Object.values(assemblyState.bridges).some(
    (bridge) => bridge.parentComponentId === componentId || bridge.childComponentId === componentId,
  );
}

function createSyntheticTransformLink(id: string, name: string): UrdfLink {
  return {
    ...DEFAULT_LINK,
    id,
    name,
    visual: {
      ...DEFAULT_LINK.visual,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
    },
    collision: {
      ...DEFAULT_LINK.collision,
      type: GeometryType.NONE,
      dimensions: { x: 0, y: 0, z: 0 },
    },
    inertial: {
      ...DEFAULT_LINK.inertial,
      mass: 0,
      inertia: { ixx: 0, ixy: 0, ixz: 0, iyy: 0, iyz: 0, izz: 0 },
    },
  };
}

function createFixedTransformJoint(
  id: string,
  name: string,
  parentLinkId: string,
  childLinkId: string,
  transform: AssemblyTransform,
): UrdfJoint {
  return {
    ...DEFAULT_JOINT,
    id,
    name,
    type: JointType.FIXED,
    parentLinkId,
    childLinkId,
    origin: {
      xyz: { ...transform.position },
      rpy: { ...transform.rotation },
    },
    axis: undefined,
    limit: undefined,
    dynamics: { damping: 0, friction: 0 },
  };
}

function cloneVisibleAssemblyState(assemblyState: AssemblyState): AssemblyState {
  const clonedAssembly = structuredClone(assemblyState);
  const visibleComponents = Object.fromEntries(
    Object.entries(clonedAssembly.components).filter(
      ([, component]) => component.visible !== false,
    ),
  );
  const visibleComponentIds = new Set(Object.keys(visibleComponents));
  const visibleBridges = Object.fromEntries(
    Object.entries(clonedAssembly.bridges).filter(
      ([, bridge]) =>
        visibleComponentIds.has(bridge.parentComponentId) &&
        visibleComponentIds.has(bridge.childComponentId),
    ),
  );

  return {
    ...clonedAssembly,
    components: visibleComponents,
    bridges: visibleBridges,
  };
}

function buildRootLinkComponentMap(
  components: Record<string, AssemblyComponent>,
): Map<string, string> {
  const map = new Map<string, string>();
  Object.values(components).forEach((component) => {
    Object.keys(component.robot.links).forEach((linkId) => {
      map.set(linkId, component.id);
    });
  });
  return map;
}

function collectTopLevelRootLinkIds(robot: RobotData): string[] {
  const childLinkIds = new Set<string>();
  Object.values(robot.joints).forEach((joint) => {
    childLinkIds.add(joint.childLinkId);
  });

  return Object.keys(robot.links).filter((linkId) => !childLinkIds.has(linkId));
}

function stripPrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) || value : value;
}

function stripComponentIdPrefix(value: string, component: AssemblyComponent): string {
  return stripPrefix(value.trim(), `${component.id}_`);
}

function buildComponentNamePrefixes(component: AssemblyComponent): string[] {
  const prefixes = new Set<string>();
  const addPrefix = (value: string | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) {
      prefixes.add(`${trimmed}_`);
    }
  };

  addPrefix(component.name);
  addPrefix(component.robot.name);
  addPrefix(component.id.replace(/^comp_/, ''));

  return Array.from(prefixes).sort((a, b) => b.length - a.length);
}

function stripComponentDisplayPrefix(value: string, namePrefixes: string[]): string {
  const trimmed = value.trim();
  for (const prefix of namePrefixes) {
    const stripped = stripPrefix(trimmed, prefix);
    if (stripped !== trimmed) {
      return stripped;
    }
  }

  return trimmed;
}

function stripSingleComponentReference(
  value: string,
  component: AssemblyComponent,
  namePrefixes: string[],
): string {
  const withoutIdPrefix = stripComponentIdPrefix(value, component);
  if (withoutIdPrefix !== value.trim()) {
    return withoutIdPrefix;
  }

  return stripComponentDisplayPrefix(value, namePrefixes);
}

function isComponentRootAlias(value: string, component: AssemblyComponent): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  return [component.id, component.name, component.robot.name, component.id.replace(/^comp_/, '')]
    .map((alias) => alias.trim())
    .filter(Boolean)
    .includes(trimmed);
}

function denamespaceSingleComponentLabel(
  value: string | undefined,
  fallbackId: string,
  component: AssemblyComponent,
  namePrefixes: string[],
  options: { rootLink?: boolean } = {},
): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallbackId;
  }

  if (options.rootLink && isComponentRootAlias(trimmed, component)) {
    return fallbackId;
  }

  const stripped = stripSingleComponentReference(trimmed, component, namePrefixes);
  return stripped || fallbackId;
}

function buildSingleComponentExportRobotData(visibleAssembly: AssemblyState): RobotData | null {
  const components = Object.values(visibleAssembly.components);
  if (
    components.length !== 1 ||
    Object.keys(visibleAssembly.bridges).length > 0 ||
    !isIdentityAssemblyTransform(visibleAssembly.transform)
  ) {
    return null;
  }

  const [component] = components;
  if (!component || !isIdentityAssemblyTransform(component.transform)) {
    return null;
  }

  const robot = component.robot;
  const namePrefixes = buildComponentNamePrefixes(component);
  const linkIdMap = new Map<string, string>();
  const jointIdMap = new Map<string, string>();

  Object.keys(robot.links).forEach((linkId) => {
    linkIdMap.set(linkId, stripComponentIdPrefix(linkId, component));
  });
  Object.keys(robot.joints).forEach((jointId) => {
    jointIdMap.set(jointId, stripComponentIdPrefix(jointId, component));
  });

  const resolveLinkReference = (linkId: string) =>
    linkIdMap.get(linkId) ?? stripSingleComponentReference(linkId, component, namePrefixes);
  const resolveJointReference = (jointId: string) =>
    jointIdMap.get(jointId) ?? stripSingleComponentReference(jointId, component, namePrefixes);

  const links: Record<string, UrdfLink> = {};
  Object.entries(robot.links).forEach(([linkId, link]) => {
    const nextLinkId = resolveLinkReference(linkId);
    links[nextLinkId] = {
      ...link,
      id: nextLinkId,
      name: denamespaceSingleComponentLabel(link.name, nextLinkId, component, namePrefixes, {
        rootLink: linkId === robot.rootLinkId,
      }),
    };
  });

  const joints: Record<string, UrdfJoint> = {};
  Object.entries(robot.joints).forEach(([jointId, joint]) => {
    const nextJointId = resolveJointReference(jointId);
    const mimicJoint = joint.mimic?.joint ? resolveJointReference(joint.mimic.joint) : undefined;
    joints[nextJointId] = {
      ...joint,
      id: nextJointId,
      name: denamespaceSingleComponentLabel(joint.name, nextJointId, component, namePrefixes),
      parentLinkId: resolveLinkReference(joint.parentLinkId),
      childLinkId: resolveLinkReference(joint.childLinkId),
      mimic: joint.mimic
        ? {
            ...joint.mimic,
            ...(mimicJoint ? { joint: mimicJoint } : {}),
          }
        : undefined,
    };
  });

  const materials: NonNullable<RobotData['materials']> = {};
  Object.entries(robot.materials || {}).forEach(([key, material]) => {
    const nextKey = resolveLinkReference(key);
    materials[nextKey] = { ...material };
  });

  const closedLoopConstraints: RobotClosedLoopConstraint[] = (
    robot.closedLoopConstraints || []
  ).map((constraint) => ({
    ...constraint,
    id: stripSingleComponentReference(constraint.id, component, namePrefixes),
    linkAId: resolveLinkReference(constraint.linkAId),
    linkBId: resolveLinkReference(constraint.linkBId),
    source: constraint.source
      ? {
          ...constraint.source,
          body1Name: stripSingleComponentReference(
            constraint.source.body1Name,
            component,
            namePrefixes,
          ),
          body2Name: stripSingleComponentReference(
            constraint.source.body2Name,
            component,
            namePrefixes,
          ),
        }
      : undefined,
  }));

  return {
    name: robot.name || visibleAssembly.name || component.name,
    ...(robot.version ? { version: robot.version } : {}),
    links,
    joints,
    rootLinkId: resolveLinkReference(robot.rootLinkId),
    materials: Object.keys(materials).length > 0 ? materials : undefined,
    closedLoopConstraints: closedLoopConstraints.length > 0 ? closedLoopConstraints : undefined,
    inspectionContext: robot.inspectionContext,
  };
}

export function buildExportableAssemblyRobotData(assemblyState: AssemblyState): RobotData {
  const visibleAssembly = cloneVisibleAssemblyState(assemblyState);
  const singleComponentRobot = buildSingleComponentExportRobotData(visibleAssembly);
  if (singleComponentRobot) {
    return singleComponentRobot;
  }

  const linkToComponentId = buildRootLinkComponentMap(visibleAssembly.components);

  Object.values(visibleAssembly.components).forEach((component) => {
    if (!isAssemblyComponentIndividuallyTransformable(visibleAssembly, component.id)) {
      return;
    }

    if (isIdentityAssemblyTransform(component.transform)) {
      return;
    }

    const componentRootLinkId = component.robot.rootLinkId;
    const wrapperRootLinkId = `${ASSEMBLY_COMPONENT_ROOT_LINK_PREFIX}${component.id}`;
    const wrapperJointId = `${ASSEMBLY_COMPONENT_ROOT_JOINT_PREFIX}${component.id}`;
    const wrapperTransform = cloneAssemblyTransform(component.transform);

    component.robot = {
      ...component.robot,
      links: {
        ...component.robot.links,
        [wrapperRootLinkId]: createSyntheticTransformLink(wrapperRootLinkId, wrapperRootLinkId),
      },
      joints: {
        ...component.robot.joints,
        [wrapperJointId]: createFixedTransformJoint(
          wrapperJointId,
          wrapperJointId,
          wrapperRootLinkId,
          componentRootLinkId,
          wrapperTransform,
        ),
      },
      rootLinkId: wrapperRootLinkId,
    };
    linkToComponentId.set(wrapperRootLinkId, component.id);
  });

  const mergedRobot = mergeAssembly(visibleAssembly);
  if (isIdentityAssemblyTransform(visibleAssembly.transform)) {
    return mergedRobot;
  }

  const assemblyTransform = cloneAssemblyTransform(visibleAssembly.transform);
  const topLevelRootLinkIds = collectTopLevelRootLinkIds(mergedRobot);
  if (topLevelRootLinkIds.length === 0) {
    return mergedRobot;
  }

  const links: Record<string, UrdfLink> = {
    ...mergedRobot.links,
    [ASSEMBLY_EXPORT_ROOT_LINK_ID]: createSyntheticTransformLink(
      ASSEMBLY_EXPORT_ROOT_LINK_ID,
      ASSEMBLY_EXPORT_ROOT_LINK_ID,
    ),
  };
  const joints: Record<string, UrdfJoint> = {
    ...mergedRobot.joints,
  };

  topLevelRootLinkIds.forEach((rootLinkId) => {
    const componentId = linkToComponentId.get(rootLinkId) ?? rootLinkId;
    const wrapperJointId = `${ASSEMBLY_EXPORT_ROOT_JOINT_PREFIX}${componentId}`;
    joints[wrapperJointId] = createFixedTransformJoint(
      wrapperJointId,
      wrapperJointId,
      ASSEMBLY_EXPORT_ROOT_LINK_ID,
      rootLinkId,
      assemblyTransform,
    );
  });

  return {
    ...mergedRobot,
    links,
    joints,
    rootLinkId: ASSEMBLY_EXPORT_ROOT_LINK_ID,
  };
}
