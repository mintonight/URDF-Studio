/**
 * Geometry and math-related types
 */

export type Vector3 = { x: number; y: number; z: number };
export type Euler = { r: number; p: number; y: number };
export type QuaternionXYZW = { x: number; y: number; z: number; w: number };
export type UrdfOrigin = { xyz: Vector3; rpy: Euler; quatXyzw?: QuaternionXYZW };

export enum GeometryType {
  BOX = 'box',
  PLANE = 'plane',
  CYLINDER = 'cylinder',
  SPHERE = 'sphere',
  ELLIPSOID = 'ellipsoid',
  CAPSULE = 'capsule',
  HFIELD = 'hfield',
  SDF = 'sdf',
  MESH = 'mesh',
  NONE = 'none',
}

export interface UrdfVisualMaterial {
  name?: string;
  color?: string;
  texture?: string;
}

export interface MjcfHfieldAssetSize {
  radiusX: number;
  radiusY: number;
  elevationZ: number;
  baseZ: number;
}

export interface MjcfHfieldAsset {
  name?: string;
  file?: string;
  contentType?: string;
  nrow?: number;
  ncol?: number;
  size?: MjcfHfieldAssetSize;
  elevation?: number[];
}

export interface MjcfMeshAsset {
  name?: string;
  file?: string;
  vertices?: number[];
  scale?: [number, number, number];
  refpos?: [number, number, number];
  refquat?: [number, number, number, number];
}

export interface UrdfVisual {
  name?: string;
  type: GeometryType;
  dimensions: Vector3; // Used variably based on type (x=radius, y=length for cylinder)
  color: string;
  materialSource?: 'inline' | 'named' | 'gazebo';
  authoredMaterials?: UrdfVisualMaterial[];
  meshPath?: string; // For later detailed design
  assetRef?: string; // MJCF-only asset reference (e.g. hfield name or sdf mesh asset)
  mjcfMesh?: MjcfMeshAsset;
  mjcfHfield?: MjcfHfieldAsset;
  origin: UrdfOrigin; // Offset relative to link frame
  verbose?: string;
  visible?: boolean;
}
