import type { RobotState } from '@/types';

export type TreeNodeEditingTarget =
  | {
      type: 'link';
      id: string;
      draft: string;
    }
  | {
      type: 'joint';
      id: string;
      draft: string;
    }
  | {
      type: 'geometry';
      linkId: string;
      subType: 'visual' | 'collision';
      objectIndex: number;
      draft: string;
    };

export type TreeNodeContextMenuTarget =
  | { type: 'link'; id: string; name: string }
  | { type: 'joint'; id: string; name: string }
  | {
      type: 'geometry';
      linkId: string;
      subType: 'visual' | 'collision';
      objectIndex: number;
      name: string;
    };

export interface TreeNodeContextMenuState {
  x: number;
  y: number;
  target: TreeNodeContextMenuTarget;
}

export interface VisibleCollisionBody {
  body: NonNullable<RobotState['links'][string]['collisionBodies']>[number];
  bodyIndex: number;
  objectIndex: number;
}

export interface VisibleVisualBody {
  body: NonNullable<RobotState['links'][string]['visualBodies']>[number];
  bodyIndex: number;
  objectIndex: number;
}
