import type { AssemblyState, BridgeJoint, RobotState, UrdfJoint } from '@/types';

export interface PropertyEditorSelectionContext {
  robot: RobotState;
  selectedBridge: BridgeJoint | null;
  selectedClosedLoopBridge: BridgeJoint | null;
}

function createPropertyEditorBridgeJoint(bridge: BridgeJoint): UrdfJoint {
  return {
    ...bridge.joint,
    id: bridge.id,
    name: bridge.name,
    parentLinkId: bridge.parentLinkId,
    childLinkId: bridge.childLinkId,
  };
}

export function buildPropertyEditorSelectionContext(
  robot: RobotState,
  assemblyState: AssemblyState | null | undefined,
): PropertyEditorSelectionContext {
  const selectionId = robot.selection.type === 'joint' ? robot.selection.id : null;

  if (!selectionId || !assemblyState) {
    return {
      robot,
      selectedBridge: null,
      selectedClosedLoopBridge: null,
    };
  }

  const selectedBridge = assemblyState.bridges[selectionId] ?? null;
  if (!selectedBridge) {
    return {
      robot,
      selectedBridge: null,
      selectedClosedLoopBridge: null,
    };
  }

  if (robot.joints[selectedBridge.id]) {
    return {
      robot,
      selectedBridge,
      selectedClosedLoopBridge: null,
    };
  }

  return {
    robot: {
      ...robot,
      joints: {
        ...robot.joints,
        [selectedBridge.id]: createPropertyEditorBridgeJoint(selectedBridge),
      },
    },
    selectedBridge,
    selectedClosedLoopBridge: selectedBridge,
  };
}
