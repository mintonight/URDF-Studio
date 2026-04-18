import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';
import type { AssemblyState, RobotFile } from '@/types';

interface PreparedUsdViewerAssetDescriptor {
  assetPath: string;
  blob: Blob;
  cacheKey: string;
}

interface UsePreparedUsdViewerAssetsOptions {
  assemblyState: AssemblyState | null;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  additionalSourceFiles?: RobotFile[];
  preparedExportCaches: Record<string, { meshFiles?: Record<string, Blob> } | null>;
  getUsdPreparedExportCache: (path: string) => { meshFiles?: Record<string, Blob> } | null;
  shouldRenderAssembly: boolean;
}

interface PreparedViewerAssetEntry {
  assetPath: string;
  blob: Blob;
  url: string;
}

function appendPreparedUsdViewerAssetDescriptors(
  descriptors: PreparedUsdViewerAssetDescriptor[],
  sourceFile: RobotFile,
  getUsdPreparedExportCache: UsePreparedUsdViewerAssetsOptions['getUsdPreparedExportCache'],
): void {
  if (sourceFile.format !== 'usd') {
    return;
  }

  const preparedCache = getUsdPreparedExportCache(sourceFile.name);
  if (!preparedCache?.meshFiles) {
    return;
  }

  Object.entries(preparedCache.meshFiles).forEach(([meshPath, blob]) => {
    const assetPath = resolveImportedAssetPath(meshPath, sourceFile.name);
    if (!assetPath) {
      return;
    }

    descriptors.push({
      assetPath,
      blob,
      cacheKey: `${sourceFile.name}::${meshPath}`,
    });
  });
}

export function buildPreparedUsdViewerAssetDescriptors({
  assemblyState,
  availableFiles,
  additionalSourceFiles = [],
  getUsdPreparedExportCache,
}: Omit<
  UsePreparedUsdViewerAssetsOptions,
  'assets' | 'preparedExportCaches' | 'shouldRenderAssembly'
>): PreparedUsdViewerAssetDescriptor[] {
  const availableFilesByPath = new Map(availableFiles.map((file) => [file.name, file] as const));
  const sourceFilesByPath = new Map<string, RobotFile>();

  additionalSourceFiles.forEach((sourceFile) => {
    if (sourceFile?.format === 'usd') {
      sourceFilesByPath.set(sourceFile.name, sourceFile);
    }
  });

  if (assemblyState) {
    Object.values(assemblyState.components).forEach((component) => {
      if (component.visible === false) {
        return;
      }

      const sourceFile = availableFilesByPath.get(component.sourceFile);
      if (sourceFile?.format === 'usd') {
        sourceFilesByPath.set(sourceFile.name, sourceFile);
      }
    });
  }

  const descriptors: PreparedUsdViewerAssetDescriptor[] = [];
  sourceFilesByPath.forEach((sourceFile) => {
    appendPreparedUsdViewerAssetDescriptors(descriptors, sourceFile, getUsdPreparedExportCache);
  });

  return descriptors;
}

export function usePreparedUsdViewerAssets({
  assemblyState,
  assets,
  availableFiles,
  additionalSourceFiles = [],
  preparedExportCaches,
  getUsdPreparedExportCache,
  shouldRenderAssembly,
}: UsePreparedUsdViewerAssetsOptions): Record<string, string> {
  const preparedAssetEntries = useMemo(
    () =>
      buildPreparedUsdViewerAssetDescriptors({
        assemblyState: shouldRenderAssembly ? assemblyState : null,
        availableFiles,
        additionalSourceFiles,
        getUsdPreparedExportCache,
      }),
    [
      additionalSourceFiles,
      assemblyState,
      availableFiles,
      getUsdPreparedExportCache,
      preparedExportCaches,
      shouldRenderAssembly,
    ],
  );

  const preparedAssetRegistryRef = useRef<Map<string, PreparedViewerAssetEntry>>(new Map());
  const [preparedAssets, setPreparedAssets] = useState<Record<string, string>>({});

  useLayoutEffect(() => {
    if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      setPreparedAssets({});
      return;
    }

    const previousRegistry = preparedAssetRegistryRef.current;
    const nextRegistry = new Map<string, PreparedViewerAssetEntry>();
    const nextPreparedAssets: Record<string, string> = {};

    preparedAssetEntries.forEach((entry) => {
      const existing = previousRegistry.get(entry.cacheKey);
      if (existing && existing.blob === entry.blob && existing.assetPath === entry.assetPath) {
        nextRegistry.set(entry.cacheKey, existing);
        nextPreparedAssets[entry.assetPath] = existing.url;
        return;
      }

      if (existing) {
        URL.revokeObjectURL(existing.url);
      }

      const nextEntry: PreparedViewerAssetEntry = {
        assetPath: entry.assetPath,
        blob: entry.blob,
        url: URL.createObjectURL(entry.blob),
      };
      nextRegistry.set(entry.cacheKey, nextEntry);
      nextPreparedAssets[entry.assetPath] = nextEntry.url;
    });

    previousRegistry.forEach((entry, key) => {
      if (!nextRegistry.has(key)) {
        URL.revokeObjectURL(entry.url);
      }
    });

    preparedAssetRegistryRef.current = nextRegistry;
    setPreparedAssets(nextPreparedAssets);
  }, [preparedAssetEntries]);

  useEffect(
    () => () => {
      preparedAssetRegistryRef.current.forEach((entry) => {
        URL.revokeObjectURL(entry.url);
      });
      preparedAssetRegistryRef.current.clear();
    },
    [],
  );

  return useMemo(
    () => (Object.keys(preparedAssets).length === 0 ? assets : { ...assets, ...preparedAssets }),
    [assets, preparedAssets],
  );
}
