import {
  cloneAssemblyTransform,
  IDENTITY_ASSEMBLY_TRANSFORM,
} from '@/core/robot/assemblyTransforms';
import { estimateRobotGroundOffset } from '@/core/robot/assemblyPlacement';
import type { AssemblyComponent, AssemblyTransform } from '@/types';

type SourceSceneAssemblyComponentLike = Pick<
  AssemblyComponent,
  'robot' | 'renderableBounds' | 'transform'
>;

function resolveSourceSceneGroundBaseline(
  component?: SourceSceneAssemblyComponentLike | null,
): number {
  if (!component) {
    return 0;
  }

  return estimateRobotGroundOffset(component.robot, {
    renderableBounds: component.renderableBounds,
  });
}

export function normalizeSourceSceneAssemblyComponentTransform(
  component?: SourceSceneAssemblyComponentLike | null,
): AssemblyTransform {
  const next = cloneAssemblyTransform(component?.transform);
  if (!component?.transform) {
    return next;
  }

  next.position.z -= resolveSourceSceneGroundBaseline(component);
  return next;
}

export function denormalizeSourceSceneAssemblyComponentTransform(
  component: SourceSceneAssemblyComponentLike | null | undefined,
  transform: AssemblyTransform,
): AssemblyTransform {
  const next = cloneAssemblyTransform(transform);
  next.position.z += resolveSourceSceneGroundBaseline(component);
  return next;
}

export function buildDefaultSourceSceneAssemblyComponentTransform(): AssemblyTransform {
  return cloneAssemblyTransform(IDENTITY_ASSEMBLY_TRANSFORM);
}
