import type { Language } from '@/store';
import {
  JointType,
  type AssemblyState,
  type BridgeJoint,
  type UrdfJoint,
  type UrdfOrigin,
} from '@/types';

export type BridgeRotationDisplayMode = 'euler_deg' | 'euler_rad' | 'quaternion';
export type BridgeEulerAxisKey = 'r' | 'p' | 'y';

export type BridgeCreateParams = {
  name: string;
  parentComponentId: string;
  parentLinkId: string;
  childComponentId: string;
  childLinkId: string;
  joint: {
    type: JointType;
    origin: UrdfOrigin;
    axis: { x: number; y: number; z: number };
    limit?: { lower: number; upper: number; effort: number; velocity: number };
    hardware?: UrdfJoint['hardware'];
  };
};

export interface BridgeCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPreviewChange?: (bridge: BridgeJoint | null) => void;
  onCreate: (params: BridgeCreateParams) => void;
  assemblyState: AssemblyState;
  lang: Language;
}
