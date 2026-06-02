import type { AssemblyState, InteractionSelection } from '@/types';

interface MinimalAssemblySelection {
  type: 'assembly' | 'component' | null;
  id: string | null;
}

export interface ResolvedAssemblyRootComponentSelection {
  componentId: string;
  rootLinkId: string;
}

export function resolveAssemblyRootComponentSelection(
  assemblyState: AssemblyState | null | undefined,
  selection: Pick<InteractionSelection, 'type' | 'id'> | null | undefined,
): ResolvedAssemblyRootComponentSelection | null {
  if (!assemblyState || selection?.type !== 'link' || !selection.id) {
    return null;
  }

  for (const component of Object.values(assemblyState.components)) {
    const rootLinkId = component.robot.rootLinkId;
    const rootLink = component.robot.links[rootLinkId];
    if (!rootLink) {
      continue;
    }

    if (selection.id === rootLinkId || selection.id === rootLink.name) {
      return {
        componentId: component.id,
        rootLinkId,
      };
    }
  }

  return null;
}

export function isAssemblyTransformSelectionArmed(
  assemblyState: AssemblyState | null | undefined,
  assemblySelection: MinimalAssemblySelection | null | undefined,
  selection: Pick<InteractionSelection, 'type' | 'id' | 'helperKind'> | null | undefined,
): boolean {
  if (!assemblySelection?.type || !assemblySelection.id) {
    return false;
  }

  if (!assemblyState) {
    return false;
  }

  if (selection?.helperKind) {
    return false;
  }

  if (assemblySelection.type === 'assembly') {
    return true;
  }

  if (!assemblyState.components[assemblySelection.id]) {
    return false;
  }

  if (!selection?.type || !selection.id) {
    return true;
  }

  const resolvedSelection = resolveAssemblyRootComponentSelection(assemblyState, selection);
  return resolvedSelection?.componentId === assemblySelection.id;
}
