import type { AssemblyComponent, AssemblyState } from '@/types';
import type { Selection } from '@/store/selectionStore';
import type { BridgePickTarget } from '@/shared/utils/assembly/bridgePickAssignment';
import { resolveAssemblyRootComponentSelection } from '@/shared/utils/assembly/transformSelection';

export type { BridgePickTarget };
export { resolveBridgePickAssignment } from '@/shared/utils/assembly/bridgePickAssignment';

export interface ResolvedAssemblySelection {
  componentId: string;
  componentName: string;
  linkId: string;
  linkName: string;
}

export interface BridgeInteractionState {
  pickTarget: BridgePickTarget;
  parentComponentId: string;
  childComponentId: string;
}

function resolveComponentLinkSelection(component: AssemblyComponent, selectionId: string) {
  const directMatch = component.robot.links[selectionId];
  if (directMatch) {
    return directMatch;
  }

  return Object.values(component.robot.links).find((link) => link.name === selectionId) ?? null;
}

function resolveComponentJointSelection(component: AssemblyComponent, selectionId: string) {
  const directMatch = component.robot.joints[selectionId];
  if (directMatch) {
    return directMatch;
  }

  return Object.values(component.robot.joints).find((joint) => joint.name === selectionId) ?? null;
}

export function resolveAssemblySelection(
  assemblyState: AssemblyState,
  selection: Selection,
): ResolvedAssemblySelection | null {
  if (!selection.id || !selection.type) {
    return null;
  }

  for (const component of Object.values(assemblyState.components)) {
    if (selection.type === 'link') {
      const link = resolveComponentLinkSelection(component, selection.id);
      if (link) {
        return {
          componentId: component.id,
          componentName: component.name,
          linkId: link.id,
          linkName: link.name,
        };
      }
      continue;
    }

    const joint = resolveComponentJointSelection(component, selection.id);
    if (!joint) {
      continue;
    }

    const childLink = component.robot.links[joint.childLinkId];
    if (!childLink) {
      continue;
    }

    return {
      componentId: component.id,
      componentName: component.name,
      linkId: childLink.id,
      linkName: childLink.name,
    };
  }

  return null;
}

export function resolveAssemblyViewerComponentSelection(
  assemblyState: AssemblyState | null | undefined,
  selection: Selection,
  options: {
    hasInteractionGuard?: boolean;
  } = {},
): string | null {
  if (!assemblyState || options.hasInteractionGuard) {
    return null;
  }

  return resolveAssemblyRootComponentSelection(assemblyState, selection)?.componentId ?? null;
}

export function resolveBlockedBridgeComponentId({
  pickTarget,
  parentComponentId,
  childComponentId,
}: BridgeInteractionState): string | null {
  if (pickTarget === 'parent') {
    return childComponentId || null;
  }

  return parentComponentId || null;
}

export function isAssemblySelectionAllowedForBridge(
  assemblyState: AssemblyState,
  selection: Selection,
  blockedComponentId: string | null,
): boolean {
  if (!selection.id || !selection.type || !blockedComponentId) {
    return true;
  }

  const resolvedSelection = resolveAssemblySelection(assemblyState, selection);
  if (!resolvedSelection) {
    return false;
  }

  return resolvedSelection.componentId !== blockedComponentId;
}

export function filterSelectableBridgeComponents(
  components: AssemblyComponent[],
  blockedComponentId: string | null,
): AssemblyComponent[] {
  if (!blockedComponentId) {
    return components;
  }

  return components.filter((component) => component.id !== blockedComponentId);
}
