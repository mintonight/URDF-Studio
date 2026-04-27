import { useCallback, useRef } from 'react';
import { useAssetsStore } from '@/store';
import type { DocumentLoadState } from '@/store/assetsStore';
import { classifyLibraryFileKind } from '@/shared/utils/robotFileSupport';
import type { RobotData, RobotFile } from '@/types';
import {
  buildStandaloneImportAssetWarning,
  buildStandalonePrimitiveGeometryHint,
  canProceedWithStandaloneImportAssetWarning,
  collectStandaloneImportSupportAssetPaths,
} from '../utils/importPackageAssetReferences';
import {
  mapRobotImportProgressToDocumentLoadPercent,
  resolveBootstrapDocumentLoadPhase,
} from '../utils/documentLoadProgress';
import { resolveRobotFileDataWithWorker } from './robotImportWorkerBridge';

interface PreviewFeedbackLabels {
  failedToParseFormat: string;
  importPackageAssetBundleHint: string;
  importPrimitiveGeometryHint: string;
  usdPreviewRequiresOpen: string;
  xacroSourceOnlyPreviewHint: string;
}

interface UsePreviewFileWithFeedbackOptions {
  allFileContents: Record<string, string>;
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  getUsdPreparedExportCache: (path: string) => { robotData?: RobotData } | null;
  handlePreviewFile: (file: RobotFile) => void;
  labels: PreviewFeedbackLabels;
  setDocumentLoadState: (state: DocumentLoadState) => void;
  showToast: (message: string, type?: 'info' | 'success') => void;
}

export function usePreviewFileWithFeedback({
  allFileContents,
  assets,
  availableFiles,
  getUsdPreparedExportCache,
  handlePreviewFile,
  labels,
  setDocumentLoadState,
  showToast,
}: UsePreviewFileWithFeedbackOptions) {
  const previewRequestIdRef = useRef(0);

  const handlePreviewFileWithFeedback = useCallback(
    (file: RobotFile) => {
      const requestId = ++previewRequestIdRef.current;
      if (classifyLibraryFileKind(file) === 'image') {
        setDocumentLoadState({
          status: 'ready',
          fileName: file.name,
          format: file.format,
          error: null,
          phase: null,
          message: null,
          progressMode: 'percent',
          progressPercent: 100,
          loadedCount: null,
          totalCount: null,
        });
        handlePreviewFile(file);
        return;
      }

      const importedAssetPaths = collectStandaloneImportSupportAssetPaths(assets, availableFiles);
      const standaloneImportAssetWarning = buildStandaloneImportAssetWarning(
        file,
        importedAssetPaths,
        {
          allFileContents,
          sourcePath: file.name,
        },
      );
      if (standaloneImportAssetWarning) {
        const assetLabel =
          standaloneImportAssetWarning.missingAssetPaths.length > 3
            ? `${standaloneImportAssetWarning.missingAssetPaths.slice(0, 3).join(', ')}, ...`
            : standaloneImportAssetWarning.missingAssetPaths.join(', ');
        const warningMessage = labels.importPackageAssetBundleHint
          .replace('{packages}', assetLabel)
          .replace('{assets}', assetLabel);

        showToast(warningMessage, 'info');
        if (!canProceedWithStandaloneImportAssetWarning(file)) {
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: warningMessage,
            phase: null,
            message: null,
            progressPercent: null,
            loadedCount: null,
            totalCount: null,
          });
          return;
        }
      }

      const primitiveGeometryHint = buildStandalonePrimitiveGeometryHint(file, importedAssetPaths, {
        allFileContents,
        sourcePath: file.name,
      });
      if (primitiveGeometryHint) {
        const assetLabel =
          primitiveGeometryHint.siblingMeshAssetCount >
          primitiveGeometryHint.siblingMeshAssetPaths.length
            ? `${primitiveGeometryHint.siblingMeshAssetPaths.join(', ')}, ...`
            : primitiveGeometryHint.siblingMeshAssetPaths.join(', ');
        showToast(labels.importPrimitiveGeometryHint.replace('{assets}', assetLabel), 'info');
      }

      setDocumentLoadState({
        status: 'loading',
        fileName: file.name,
        format: file.format,
        error: null,
        phase: resolveBootstrapDocumentLoadPhase(file.format),
        message: null,
        progressMode: 'percent',
        progressPercent: 0,
        loadedCount: null,
        totalCount: null,
      });
      handlePreviewFile(file);

      void resolveRobotFileDataWithWorker(
        file,
        {
          availableFiles,
          assets,
          allFileContents,
          usdRobotData: getUsdPreparedExportCache(file.name)?.robotData ?? null,
        },
        {
          onProgress: (progress) => {
            if (requestId !== previewRequestIdRef.current) {
              return;
            }

            const currentDocumentLoadState = useAssetsStore.getState().documentLoadState;
            const mappedProgressPercent = mapRobotImportProgressToDocumentLoadPercent(
              file.format,
              progress,
            );
            const nextProgressPercent =
              currentDocumentLoadState.fileName === file.name &&
              (currentDocumentLoadState.status === 'loading' ||
                currentDocumentLoadState.status === 'hydrating')
                ? Math.max(currentDocumentLoadState.progressPercent ?? 0, mappedProgressPercent)
                : mappedProgressPercent;

            setDocumentLoadState({
              status: 'loading',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: resolveBootstrapDocumentLoadPhase(file.format),
              message: progress.message ?? null,
              progressMode: 'percent',
              progressPercent: nextProgressPercent,
              loadedCount: null,
              totalCount: null,
            });
          },
        },
      )
        .then((previewResult) => {
          if (requestId !== previewRequestIdRef.current) {
            return;
          }

          if (previewResult.status === 'ready') {
            setDocumentLoadState({
              status: 'ready',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: null,
              message: null,
              progressMode: 'percent',
              progressPercent: 100,
              loadedCount: null,
              totalCount: null,
            });
            return;
          }

          if (previewResult.status === 'needs_hydration') {
            setDocumentLoadState({
              status: 'ready',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: null,
              message: labels.usdPreviewRequiresOpen,
              progressMode: 'percent',
              progressPercent: 100,
              loadedCount: null,
              totalCount: null,
            });
            showToast(labels.usdPreviewRequiresOpen, 'info');
            return;
          }

          if (previewResult.reason === 'source_only_fragment') {
            setDocumentLoadState({
              status: 'ready',
              fileName: file.name,
              format: file.format,
              error: null,
              phase: null,
              message: labels.xacroSourceOnlyPreviewHint,
              progressMode: 'percent',
              progressPercent: 100,
              loadedCount: null,
              totalCount: null,
            });
            showToast(labels.xacroSourceOnlyPreviewHint, 'info');
            return;
          }

          const errorMessage = labels.failedToParseFormat.replace(
            '{format}',
            file.format.toUpperCase(),
          );
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: errorMessage,
          });
          showToast(errorMessage, 'info');
        })
        .catch((error) => {
          if (requestId !== previewRequestIdRef.current) {
            return;
          }

          console.error(
            `[usePreviewFileWithFeedback] Failed to resolve preview robot data for "${file.name}".`,
            error,
          );
          const errorMessage = labels.failedToParseFormat.replace(
            '{format}',
            file.format.toUpperCase(),
          );
          setDocumentLoadState({
            status: 'error',
            fileName: file.name,
            format: file.format,
            error: errorMessage,
          });
          showToast(errorMessage, 'info');
        });
    },
    [
      allFileContents,
      assets,
      availableFiles,
      getUsdPreparedExportCache,
      handlePreviewFile,
      labels.failedToParseFormat,
      labels.importPackageAssetBundleHint,
      labels.importPrimitiveGeometryHint,
      labels.usdPreviewRequiresOpen,
      labels.xacroSourceOnlyPreviewHint,
      setDocumentLoadState,
      showToast,
    ],
  );

  return {
    handlePreviewFileWithFeedback,
  };
}
