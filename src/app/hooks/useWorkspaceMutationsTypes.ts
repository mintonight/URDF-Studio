import type { PendingCollisionTransform } from '@/store/collisionTransformStore';
import type {
  AssemblyState,
  AssemblyTransform,
  JointQuaternion,
  RobotData,
  RobotMjcfTendonVisualizationUpdate,
  UrdfJoint,
  UrdfLink,
} from '@/types';
import type { MJCFRenameOperation } from '../utils/mjcfEditableSourcePatch';

export interface UseWorkspaceMutationsParams {
  assemblyState: AssemblyState | null;
  robotLinks: Record<string, UrdfLink>;
  rootLinkId: string;
  setName: (name: string) => void;
  addChild: (parentId: string) => { linkId: string; jointId: string };
  deleteSubtree: (linkId: string) => void;
  updateLink: (
    id: string,
    updates: Partial<UrdfLink>,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateJoint: (
    id: string,
    updates: Partial<UrdfJoint>,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateMjcfTendon: (
    tendonName: string,
    updates: RobotMjcfTendonVisualizationUpdate,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  setAllLinksVisibility: (visible: boolean) => void;
  setJointAngle: (jointName: string, angle: number) => void;
  applyJointKinematicOverrides: (
    overrides: {
      angles?: Record<string, number>;
      quaternions?: Record<string, JointQuaternion>;
    },
    options?: { skipHistory?: boolean; historyLabel?: string },
  ) => void;
  updateComponentName: (
    componentId: string,
    name: string,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateComponentTransform: (
    componentId: string,
    transform: AssemblyTransform,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateComponentRobot: (
    componentId: string,
    partialRobot: Partial<RobotData>,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  updateAssemblyTransform: (
    transform: AssemblyTransform,
    options?: { skipHistory?: boolean; label?: string },
  ) => void;
  removeComponent: (id: string) => void;
  removeBridge: (id: string) => void;
  focusOn: (id: string) => void;
  patchEditableSourceAddChild?: (args: {
    sourceFileName?: string | null;
    parentLinkName: string;
    linkName: string;
    joint: UrdfJoint;
  }) => void;
  patchEditableSourceDeleteSubtree?: (args: {
    sourceFileName?: string | null;
    linkName: string;
  }) => void;
  patchEditableSourceAddCollisionBody?: (args: {
    sourceFileName?: string | null;
    linkName: string;
    geometry: UrdfLink['collision'];
  }) => void;
  patchEditableSourceDeleteCollisionBody?: (args: {
    sourceFileName?: string | null;
    linkName: string;
    objectIndex: number;
  }) => void;
  patchEditableSourceUpdateCollisionBody?: (args: {
    sourceFileName?: string | null;
    linkName: string;
    objectIndex: number;
    geometry: UrdfLink['collision'];
  }) => void;
  patchEditableSourceUpdateJointLimit?: (args: {
    sourceFileName?: string | null;
    jointName: string;
    jointType: UrdfJoint['type'];
    limit: NonNullable<UrdfJoint['limit']>;
  }) => void;
  patchEditableSourceRobotName?: (args: {
    sourceFileName?: string | null;
    name: string;
  }) => void;
  patchEditableSourceRenameEntities?: (args: {
    sourceFileName?: string | null;
    operations: MJCFRenameOperation[];
  }) => void;
  setSelection: (selection: {
    type: 'link' | 'joint' | null;
    id: string | null;
    subType?: 'visual' | 'collision';
    objectIndex?: number;
  }) => void;
  setPendingCollisionTransform: (transform: PendingCollisionTransform) => void;
  clearPendingCollisionTransform: () => void;
  handleTransformPendingChange: (pending: boolean) => void;
}
