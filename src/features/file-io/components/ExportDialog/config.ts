import type { ExportDialogConfig, MeshExportFormat } from './types';

export const EXPORT_FORMATS: MeshExportFormat[] = ['mjcf', 'urdf', 'xacro', 'sdf', 'usd'];

export const MJCF_SUPPORTS = ['MuJoCo', 'Motphys', 'Genesis'];
export const URDF_SUPPORTS = ['Isaac Sim', 'Isaac Gym', 'Genesis', 'PyBullet', 'ManiSkill', 'Motphys'];
export const XACRO_SUPPORTS = ['Gazebo', 'ROS1', 'ROS2'];
export const SDF_SUPPORTS = ['Gazebo', 'Ignition Gazebo', 'sdformat'];
export const USD_SUPPORTS = ['OpenUSD', 'Isaac Sim', 'Genesis', 'Omniverse'];

export const DEFAULT_CONFIG: ExportDialogConfig = {
  format: 'mjcf',
  includeSkeleton: false,
  mjcf: {
    meshdir: 'meshes/',
    addFloatBase: false,
    preferSharedMeshReuse: true,
    includeActuators: true,
    actuatorType: 'position',
    includeMeshes: true,
    compressSTL: false,
    stlQuality: 50,
  },
  urdf: {
    includeExtended: false,
    includeBOM: false,
    useRelativePaths: true,
    preferSourceVisualMeshes: true,
    includeMeshes: true,
    compressSTL: false,
    stlQuality: 50,
  },
  xacro: {
    rosVersion: 'ros2',
    rosHardwareInterface: 'effort',
    useRelativePaths: true,
    includeMeshes: true,
    compressSTL: false,
    stlQuality: 50,
  },
  sdf: {
    includeMeshes: true,
    compressSTL: false,
    stlQuality: 50,
  },
  usd: {
    fileFormat: 'usd',
    compressMeshes: true,
    meshQuality: 100,
  },
};

export function getExportFormatSupports(format: MeshExportFormat): string[] {
  switch (format) {
    case 'mjcf':
      return MJCF_SUPPORTS;
    case 'urdf':
      return URDF_SUPPORTS;
    case 'xacro':
      return XACRO_SUPPORTS;
    case 'sdf':
      return SDF_SUPPORTS;
    case 'usd':
      return USD_SUPPORTS;
    default: {
      const exhaustiveFormat: never = format;
      return exhaustiveFormat;
    }
  }
}
