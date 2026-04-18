import * as THREE from 'three';

import type { RobotState } from '../../../types/index.ts';
import { disposeObject3D } from '../../../shared/utils/three/dispose.ts';
import { createUsdAssetRegistry } from './usdAssetRegistry.ts';
import { type UsdMeshCompressionOptions } from './usdSceneNodeFactory.ts';
import { collectUsdSerializationContext } from './usdSerializationContext.ts';
import { buildUsdBaseLayerContent } from './usdSceneSerialization.ts';
import {
  buildUsdLinkPathMaps,
  buildUsdPhysicsLayerContent,
  buildUsdRobotLayerContent,
  buildUsdRootLayerContent,
  buildUsdSensorLayerContent,
  createUsdArchivePackage,
  resolveUsdPackageLayoutProfile,
  type UsdLayerFileFormat,
  type UsdPackageLayoutProfile,
} from './usdPackageLayers.ts';
import { buildUsdLinkSceneRoot, flattenUsdLinkSceneHierarchy } from './usdLinkSceneBuilder.ts';
import { collectUsdExportAssetFiles } from './usdAssetCollection.ts';
import {
  advanceUsdProgress,
  createUsdProgressTracker,
  normalizeUsdProgressLabel,
  type UsdProgressEvent,
  type UsdProgressTracker,
  yieldToMainThread,
} from './usdProgress.ts';
import { sanitizeUsdIdentifier } from './usdTextFormatting.ts';

export type { UsdMeshCompressionOptions } from './usdSceneNodeFactory.ts';
export type { UsdLayerFileFormat, UsdPackageLayoutProfile } from './usdPackageLayers.ts';

const USD_EXPORT_RECORD_YIELD_INTERVAL = 4;

const createUsdExportRobot = (robot: RobotState): RobotState => {
  const exportRobot = structuredClone(robot);
  exportRobot.selection = { type: null, id: null };

  Object.values(exportRobot.joints).forEach((joint) => {
    if (joint.type === 'ball' || joint.type === 'floating') {
      delete joint.quaternion;
    }

    joint.angle = Number.isFinite(joint.referencePosition) ? joint.referencePosition! : 0;
  });

  return exportRobot;
};

export type ExportRobotToUsdPhase = 'links' | 'geometry' | 'scene' | 'assets';

export interface ExportRobotToUsdProgress {
  phase: ExportRobotToUsdPhase;
  completed: number;
  total: number;
  label?: string;
}

type UsdExportProgressTracker<TPhase extends ExportRobotToUsdPhase = ExportRobotToUsdPhase> =
  UsdProgressTracker<TPhase>;

export interface ExportRobotToUsdOptions {
  robot: RobotState;
  exportName: string;
  assets: Record<string, string>;
  extraMeshFiles?: Map<string, Blob>;
  meshCompression?: UsdMeshCompressionOptions;
  fileFormat?: UsdLayerFileFormat;
  layoutProfile?: UsdPackageLayoutProfile;
  onProgress?: (progress: ExportRobotToUsdProgress) => void;
}

export interface ExportRobotToUsdPayload {
  content: string;
  downloadFileName: string;
  archiveFileName: string;
  rootLayerPath: string;
  archiveFiles: Map<string, Blob>;
}

export async function exportRobotToUsd({
  robot,
  exportName,
  assets,
  extraMeshFiles,
  meshCompression,
  fileFormat = 'usd',
  layoutProfile = 'legacy',
  onProgress,
}: ExportRobotToUsdOptions): Promise<ExportRobotToUsdPayload> {
  const exportRobot = createUsdExportRobot(robot);
  const resolvedLayoutProfile = resolveUsdPackageLayoutProfile(layoutProfile);
  const normalizedExportName = sanitizeUsdIdentifier(exportName || exportRobot.name || 'robot');
  const configStem =
    resolvedLayoutProfile === 'isaacsim'
      ? normalizedExportName
      : `${normalizedExportName}${normalizedExportName.includes('description') ? '' : '_description'}`;
  const rootPrimName = configStem;
  const downloadExtension = fileFormat === 'usda' ? 'usda' : 'usd';
  const { registry, tempObjectUrls } = createUsdAssetRegistry(assets, extraMeshFiles);
  const pathMaps = buildUsdLinkPathMaps(exportRobot, rootPrimName, {
    layoutProfile: resolvedLayoutProfile,
  });
  const sceneRoot = new THREE.Group();
  sceneRoot.name = rootPrimName;
  const linkProgressTracker: UsdExportProgressTracker<'links'> = createUsdProgressTracker(
    'links',
    Math.max(1, Object.keys(exportRobot.links).length),
    onProgress as ((progress: UsdProgressEvent<'links'>) => void) | undefined,
  );

  try {
    const linkRoot = await buildUsdLinkSceneRoot({
      robot: exportRobot,
      registry,
      meshCompression,
      onLinkVisit: async (link) => {
        advanceUsdProgress(
          linkProgressTracker,
          normalizeUsdProgressLabel(link.name || link.id, 'link'),
        );

        if (
          linkProgressTracker.completed < linkProgressTracker.total &&
          linkProgressTracker.completed % 4 === 0
        ) {
          await yieldToMainThread();
        }
      },
    });
    sceneRoot.add(linkRoot);
    if (resolvedLayoutProfile === 'isaacsim') {
      flattenUsdLinkSceneHierarchy(sceneRoot);
    }
    sceneRoot.updateMatrixWorld(true);

    const rootLayerContent = buildUsdRootLayerContent(rootPrimName, configStem, {
      fileFormat,
      layoutProfile: resolvedLayoutProfile,
    });
    await yieldToMainThread();
    const usdContext = await collectUsdSerializationContext(sceneRoot, {
      rootPrimName,
      onProgress,
    });
    await yieldToMainThread();
    const baseLayerContent = await buildUsdBaseLayerContent(sceneRoot, usdContext, onProgress);
    await yieldToMainThread();
    const physicsLayerContent = buildUsdPhysicsLayerContent(
      exportRobot,
      pathMaps,
      rootPrimName,
      configStem,
      {
        fileFormat,
        layoutProfile: resolvedLayoutProfile,
      },
    );
    await yieldToMainThread();
    const sensorLayerContent = buildUsdSensorLayerContent(rootPrimName);
    const robotLayerContent =
      resolvedLayoutProfile === 'isaacsim'
        ? buildUsdRobotLayerContent(exportRobot, pathMaps, rootPrimName, {
            layoutProfile: resolvedLayoutProfile,
          })
        : undefined;
    await yieldToMainThread();
    const usdAssetFiles = await collectUsdExportAssetFiles({
      sceneRoot,
      context: usdContext,
      registry,
      onProgress,
      recordYieldInterval: USD_EXPORT_RECORD_YIELD_INTERVAL,
    });

    const archive = createUsdArchivePackage(
      normalizedExportName,
      {
        rootLayerContent,
        baseLayerContent,
        physicsLayerContent,
        sensorLayerContent,
        robotLayerContent,
      },
      usdAssetFiles,
      {
        fileFormat,
        layoutProfile: resolvedLayoutProfile,
      },
    );

    return {
      content: rootLayerContent,
      downloadFileName: `${normalizedExportName}.${downloadExtension}`,
      archiveFileName: archive.archiveFileName,
      rootLayerPath: archive.rootLayerPath,
      archiveFiles: archive.archiveFiles,
    };
  } finally {
    disposeObject3D(sceneRoot);
    tempObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  }
}
