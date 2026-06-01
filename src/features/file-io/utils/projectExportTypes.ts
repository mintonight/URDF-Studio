import type {
  AssemblyState,
  RobotData,
  RobotFile,
  UsdPreparedExportCache,
} from '@/types';

export type ProjectActivityEntry = {
  id: string;
  timestamp: string;
  label: string;
};

export type ProjectHistorySnapshot<T> = {
  present: T;
  past: T[];
  future: T[];
  activity: ProjectActivityEntry[];
};

export type ProjectAssetEntry = {
  logicalPath: string;
  archivePath: string;
};

export type ProjectExportWarningCode =
  | 'project_mesh_asset_missing'
  | 'project_mesh_package_failed'
  | 'project_asset_pack_failed'
  | 'project_component_mesh_asset_missing'
  | 'project_component_mesh_package_failed';

export interface ProjectExportWarning {
  code: ProjectExportWarningCode;
  message: string;
  context?: Record<string, string>;
}

export type ProjectExportProgressPhase =
  | 'assets'
  | 'metadata'
  | 'components'
  | 'output'
  | 'archive';

export interface ProjectExportProgress {
  phase: ProjectExportProgressPhase;
  completed: number;
  total: number;
  label?: string;
}

export interface ExportProjectResult {
  blob: Blob;
  partial: boolean;
  warnings: ProjectExportWarning[];
}

export interface ProjectManifest {
  version: string;
  name: string;
  lastModified: string;
  ui: Record<string, never>;
  workspace?: {
    selectedFile: string | null;
  };
  assets: {
    availableFiles: { name: string; format: string }[];
    originalFileFormat: 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | null;
    assetEntries?: ProjectAssetEntry[];
    allFileContentsFile?: string;
    motorLibraryFile?: string;
    originalUrdfContentFile?: string;
  };
  history?: {
    robotFile?: string;
    assemblyFile?: string;
  };
  assembly?: {
    name: string;
    transform?: AssemblyState['transform'];
    components: Record<
      string,
      {
        id: string;
        name: string;
        sourceFile: string;
        transform?: AssemblyState['components'][string]['transform'];
        visible: boolean;
      }
    >;
  };
}

export interface ExportProjectParams {
  name: string;
  uiState: {
    appMode: string;
    lang: string;
  };
  assetsState: {
    availableFiles: RobotFile[];
    assets: Record<string, string>;
    allFileContents: Record<string, string>;
    motorLibrary: Record<string, unknown>;
    selectedFileName: string | null;
    originalUrdfContent: string;
    originalFileFormat: 'urdf' | 'mjcf' | 'usd' | 'xacro' | 'sdf' | null;
    usdPreparedExportCaches: Record<string, UsdPreparedExportCache>;
  };
  robotState: {
    present: RobotData;
    history: { past: RobotData[]; future: RobotData[] };
    activity: Array<{ id?: string; timestamp?: string; label?: string }>;
  };
  assemblyState: {
    present: AssemblyState | null;
    history: { past: Array<AssemblyState | null>; future: Array<AssemblyState | null> };
    activity: Array<{ id?: string; timestamp?: string; label?: string }>;
  };
  getMergedRobotData: () => RobotData | null;
  onProgress?: (progress: ProjectExportProgress) => void;
}
