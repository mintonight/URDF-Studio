import type { ExportProgressState } from '../../types';
import type { MjcfActuatorType } from '@/core/parsers/mjcf/mjcfGenerator';

export type ExportFormat = 'project' | 'mjcf' | 'urdf' | 'xacro' | 'sdf' | 'usd';
export type MeshExportFormat = Exclude<ExportFormat, 'project'>;

export interface MjcfExportConfig {
  meshdir: string;
  addFloatBase: boolean;
  preferSharedMeshReuse: boolean;
  includeActuators: boolean;
  actuatorType: MjcfActuatorType;
  includeMeshes: boolean;
  compressSTL: boolean;
  stlQuality: number;
}

export interface UrdfExportConfig {
  includeExtended: boolean;
  includeBOM: boolean;
  useRelativePaths: boolean;
  preferSourceVisualMeshes: boolean;
  includeMeshes: boolean;
  compressSTL: boolean;
  stlQuality: number;
}

export type RosVersion = 'ros1' | 'ros2';
export type RosHwInterface = 'effort' | 'position' | 'velocity';

export interface XacroExportConfig {
  rosVersion: RosVersion;
  rosHardwareInterface: RosHwInterface;
  useRelativePaths: boolean;
  includeMeshes: boolean;
  compressSTL: boolean;
  stlQuality: number;
}

export interface SdfExportConfig {
  includeMeshes: boolean;
  compressSTL: boolean;
  stlQuality: number;
}

export interface UsdExportConfig {
  fileFormat: 'usd' | 'usda';
  compressMeshes: boolean;
  meshQuality: number;
}

export interface ExportDialogConfig {
  format: ExportFormat;
  includeSkeleton: boolean;
  mjcf: MjcfExportConfig;
  urdf: UrdfExportConfig;
  xacro: XacroExportConfig;
  sdf: SdfExportConfig;
  usd: UsdExportConfig;
}

export interface ExportDialogProps {
  onClose: () => void;
  onExport: (
    config: ExportDialogConfig,
    options?: {
      onProgress?: (progress: ExportProgressState) => void;
    },
  ) => void | Promise<void>;
  lang: 'en' | 'zh';
  isExporting?: boolean;
  canExportUsd?: boolean;
  defaultFormat?: ExportFormat;
}
