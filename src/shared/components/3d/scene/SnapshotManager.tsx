import { useEffect, useRef, useState } from 'react';
import { useThree } from '@react-three/fiber';
import { useEnvironment } from '@react-three/drei';
import * as THREE from 'three';
import type { RefObject } from 'react';
import type { Theme } from '@/types';
import { resolveSnapshotRenderPlan } from './snapshotResolution';
import {
  getSnapshotFileExtension,
  getSnapshotMimeType,
  normalizeSnapshotCaptureOptions,
  SNAPSHOT_DETAIL_SUPERSAMPLE_SCALE,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
  type SnapshotPreviewAction,
} from './snapshotConfig';
import { resolveSnapshotPreviewCaptureOptions } from './snapshotPreviewConfig';
import {
  applySnapshotBackgroundStyle,
  applySnapshotLightingPreset,
  applySnapshotSceneVisibility,
  applySnapshotShadowQuality,
  applySnapshotTextureQuality,
  type SnapshotBackgroundFill,
} from './snapshotSceneQuality';
import { SnapshotExportLook } from './SnapshotExportLook';
import { useSnapshotRenderContext } from './SnapshotRenderContext';
import {
  clampSnapshotRenderPlanToPixelBudget,
  resolveSnapshotRenderTargetSamples,
} from './snapshotResolution';
import { renderSceneWithDofToCanvas, resolveSnapshotDofSettings } from './snapshotPostprocessing';
import { applyWorkspaceCameraSnapshot } from '../workspace/workspaceCameraSnapshot';

const SNAPSHOT_RENDER_TARGET_SAMPLES = {
  viewport: 4,
  high: 8,
  ultra: 8,
} as const;

const SNAPSHOT_INTERNAL_RENDER_PIXEL_BUDGET = {
  viewport: 16_000_000,
  high: 33_000_000,
  ultra: 48_000_000,
} as const;

const SNAPSHOT_DOF_PIXEL_BUDGET_MULTIPLIER = 0.72;

const SNAPSHOT_HDR_PRELOAD_FILE = '/potsdamer_platz_1k.hdr';

let snapshotHdrPreloadPromise: Promise<void> | null = null;

function ensureSnapshotHdrPreloaded(): Promise<void> {
  if (!snapshotHdrPreloadPromise) {
    snapshotHdrPreloadPromise = Promise.resolve().then(() => {
      useEnvironment.preload({ files: SNAPSHOT_HDR_PRELOAD_FILE });
    });
  }

  return snapshotHdrPreloadPromise;
}

interface SnapshotManagerProps {
  actionRef?: RefObject<SnapshotCaptureAction | null>;
  onSnapshotActionChange?: (action: SnapshotCaptureAction | null) => void;
  previewActionRef?: RefObject<SnapshotPreviewAction | null>;
  onPreviewActionChange?: (action: SnapshotPreviewAction | null) => void;
  robotName: string;
  theme: Theme;
  groundOffset?: number;
}

export const SnapshotManager = ({
  actionRef,
  onSnapshotActionChange,
  previewActionRef,
  onPreviewActionChange,
  robotName,
  theme,
  groundOffset = 0,
}: SnapshotManagerProps) => {
  const { gl, get, invalidate } = useThree();
  const pendingCaptureRef = useRef<number | null>(null);
  const [activeSnapshotOptions, setActiveSnapshotOptions] = useState<ReturnType<
    typeof normalizeSnapshotCaptureOptions
  > | null>(null);
  const { setSnapshotRenderActive } = useSnapshotRenderContext();

  useEffect(() => {
    if (!actionRef && !onSnapshotActionChange && !previewActionRef && !onPreviewActionChange) {
      return;
    }

    const cloneSnapshotCamera = (camera: THREE.Camera) => {
      const snapshotCamera = camera.clone();
      snapshotCamera.layers.mask = camera.layers.mask;
      snapshotCamera.matrixAutoUpdate = camera.matrixAutoUpdate;
      snapshotCamera.matrix.copy(camera.matrix);
      snapshotCamera.matrixWorld.copy(camera.matrixWorld);
      snapshotCamera.matrixWorldInverse.copy(camera.matrixWorldInverse);
      snapshotCamera.projectionMatrix.copy(camera.projectionMatrix);
      snapshotCamera.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
      snapshotCamera.updateMatrixWorld(true);
      return snapshotCamera;
    };

    const clearPendingFrames = () => {
      if (pendingCaptureRef.current !== null) {
        cancelAnimationFrame(pendingCaptureRef.current);
        pendingCaptureRef.current = null;
      }
    };

    const waitFrames = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        invalidate();
        await new Promise<void>((resolve) => {
          pendingCaptureRef.current = requestAnimationFrame(() => {
            pendingCaptureRef.current = null;
            resolve();
          });
        });
      }
    };

    const resolveSnapshotSize = (longEdgePx: number) => {
      const drawingBufferSize = gl.getDrawingBufferSize(new THREE.Vector2());
      const baseWidth = Math.max(1, Math.round(drawingBufferSize.x || 1));
      const baseHeight = Math.max(1, Math.round(drawingBufferSize.y || 1));
      const context = gl.getContext();

      return resolveSnapshotRenderPlan({
        baseWidth,
        baseHeight,
        basePixelRatio: gl.getPixelRatio(),
        targetLongEdge: longEdgePx,
        maxRenderbufferSize: context.getParameter(context.MAX_RENDERBUFFER_SIZE),
        maxTextureSize: context.getParameter(context.MAX_TEXTURE_SIZE),
      });
    };

    const resolveSnapshotWarmupFrameCount = (
      options: ReturnType<typeof normalizeSnapshotCaptureOptions>,
    ) => {
      let frameCount = options.environmentPreset === 'viewport' ? 2 : 3;
      if (options.groundStyle === 'reflective') {
        frameCount = Math.max(frameCount, 4);
      }
      if (options.dofMode !== 'off') {
        frameCount = Math.max(frameCount, 3);
      }
      return frameCount;
    };

    const resolveSnapshotRenderPixelBudget = (
      options: ReturnType<typeof normalizeSnapshotCaptureOptions>,
    ) => {
      const baseBudget = SNAPSHOT_INTERNAL_RENDER_PIXEL_BUDGET[options.detailLevel];
      if (options.dofMode === 'off') {
        return baseBudget;
      }

      return Math.max(12_000_000, Math.floor(baseBudget * SNAPSHOT_DOF_PIXEL_BUDGET_MULTIPLIER));
    };

    const canvasToBlob = async (canvas: HTMLCanvasElement, options: SnapshotCaptureOptions) => {
      const mimeType = getSnapshotMimeType(options.imageFormat);
      const quality =
        mimeType === 'image/png'
          ? undefined
          : Math.min(1, Math.max(0.6, options.imageQuality / 100));

      if (canvas.toBlob) {
        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => {
              if (!blob) {
                reject(
                  new Error(
                    `[Snapshot] Failed to generate ${options.imageFormat.toUpperCase()} blob.`,
                  ),
                );
                return;
              }

              resolve(blob);
            },
            mimeType,
            quality,
          );
        });
      }

      const dataUrl = canvas.toDataURL(mimeType, quality);
      const response = await fetch(dataUrl);
      return response.blob();
    };

    const downloadCanvas = async (canvas: HTMLCanvasElement, options: SnapshotCaptureOptions) => {
      const safeRobotName = (robotName || 'robot').replace(/[\\/:*?"<>|]/g, '_');
      const now = new Date();
      const timestamp = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
        '_',
        String(now.getHours()).padStart(2, '0'),
        String(now.getMinutes()).padStart(2, '0'),
        String(now.getSeconds()).padStart(2, '0'),
      ].join('');
      const filename = `${safeRobotName}_snapshot_${timestamp}.${getSnapshotFileExtension(options.imageFormat)}`;

      const triggerDownload = (href: string) => {
        const link = document.createElement('a');
        link.href = href;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      };

      const blob = await canvasToBlob(canvas, options);
      const url = URL.createObjectURL(blob);
      triggerDownload(url);
      URL.revokeObjectURL(url);
    };

    const buildCanvasFromPixelBuffer = (pixelBuffer: Uint8Array, width: number, height: number) => {
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = width;
      captureCanvas.height = height;
      const ctx = captureCanvas.getContext('2d');

      if (!ctx) {
        return captureCanvas;
      }

      const imageData = ctx.createImageData(width, height);
      const rowStride = width * 4;

      for (let sourceRow = 0; sourceRow < height; sourceRow += 1) {
        const destinationRow = height - sourceRow - 1;
        const sourceOffset = sourceRow * rowStride;
        const destinationOffset = destinationRow * rowStride;
        imageData.data.set(
          pixelBuffer.subarray(sourceOffset, sourceOffset + rowStride),
          destinationOffset,
        );
      }

      ctx.putImageData(imageData, 0, 0);
      return captureCanvas;
    };

    const readRenderTargetToCanvas = (
      renderTarget: THREE.WebGLRenderTarget,
      width: number,
      height: number,
    ) => {
      const pixelBuffer = new Uint8Array(width * height * 4);
      gl.readRenderTargetPixels(renderTarget, 0, 0, width, height, pixelBuffer);
      return buildCanvasFromPixelBuffer(pixelBuffer, width, height);
    };

    const renderSceneToCanvas = ({
      scene,
      camera,
      width,
      height,
      requestedSamples,
    }: {
      scene: THREE.Scene;
      camera: THREE.Camera;
      width: number;
      height: number;
      requestedSamples: number;
    }) => {
      const renderTarget = new THREE.WebGLRenderTarget(width, height, {
        type: THREE.UnsignedByteType,
        depthBuffer: true,
        stencilBuffer: false,
      });
      renderTarget.texture.colorSpace = THREE.SRGBColorSpace;
      renderTarget.samples = resolveSnapshotRenderTargetSamples({
        width,
        height,
        requestedSamples,
        maxSupportedSamples: gl.capabilities.maxSamples,
      });

      const previousRenderTarget = gl.getRenderTarget();
      const previousAutoClear = gl.autoClear;

      try {
        gl.autoClear = true;
        gl.setRenderTarget(renderTarget);
        gl.render(scene, camera);
        return readRenderTargetToCanvas(renderTarget, width, height);
      } finally {
        gl.setRenderTarget(previousRenderTarget);
        gl.autoClear = previousAutoClear;
        renderTarget.dispose();
      }
    };

    const createExportCanvas = (
      sourceCanvas: HTMLCanvasElement,
      targetWidth: number,
      targetHeight: number,
      backgroundFill: SnapshotBackgroundFill,
    ) => {
      const needsResize =
        sourceCanvas.width !== targetWidth || sourceCanvas.height !== targetHeight;
      if (backgroundFill.kind === 'transparent' && !needsResize) {
        return sourceCanvas;
      }

      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = targetWidth;
      exportCanvas.height = targetHeight;
      const ctx = exportCanvas.getContext('2d');

      if (!ctx) {
        return sourceCanvas;
      }

      if (backgroundFill.kind === 'solid' && backgroundFill.colors?.[0]) {
        ctx.fillStyle = backgroundFill.colors[0];
        ctx.fillRect(0, 0, targetWidth, targetHeight);
      } else if (backgroundFill.kind === 'linear-gradient' && backgroundFill.colors) {
        const gradient = ctx.createLinearGradient(0, 0, 0, targetHeight);
        gradient.addColorStop(0, backgroundFill.colors[0]);
        gradient.addColorStop(1, backgroundFill.colors[1]);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, targetWidth, targetHeight);
      }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, targetWidth, targetHeight);
      return exportCanvas;
    };

    const renderSnapshotCanvas = async (
      snapshotOptions: SnapshotCaptureOptions,
      frozenCamera?: THREE.Camera,
    ) => {
      const outputPlan = resolveSnapshotSize(snapshotOptions.longEdgePx);
      const supersampleScale = SNAPSHOT_DETAIL_SUPERSAMPLE_SCALE[snapshotOptions.detailLevel];
      const renderPlan = clampSnapshotRenderPlanToPixelBudget(
        resolveSnapshotSize(Math.round(snapshotOptions.longEdgePx * supersampleScale)),
        resolveSnapshotRenderPixelBudget(snapshotOptions),
      );
      let restoreSceneVisibility: (() => void) | null = null;
      let restoreTextureQuality: (() => void) | null = null;
      let restoreShadowQuality: (() => void) | null = null;
      let restoreLightingPreset: (() => void) | null = null;
      let restoreBackgroundStyle: (() => void) | null = null;
      let backgroundFill: SnapshotBackgroundFill = { kind: 'transparent' };

      try {
        const { scene: latestScene, camera: liveCamera } = get();
        const captureCamera = frozenCamera ?? cloneSnapshotCamera(liveCamera);
        if (snapshotOptions.cameraSnapshot) {
          applyWorkspaceCameraSnapshot(captureCamera, undefined, snapshotOptions.cameraSnapshot);
        }
        const backgroundState = applySnapshotBackgroundStyle(
          latestScene,
          gl,
          snapshotOptions.backgroundStyle,
        );
        restoreBackgroundStyle = backgroundState.restore;
        backgroundFill = backgroundState.fill;
        restoreSceneVisibility = applySnapshotSceneVisibility(latestScene, {
          hideGrid: snapshotOptions.hideGrid,
        });
        restoreTextureQuality = applySnapshotTextureQuality(
          latestScene,
          gl,
          snapshotOptions.detailLevel,
        );
        restoreLightingPreset = applySnapshotLightingPreset(
          latestScene,
          gl,
          snapshotOptions.environmentPreset,
        );
        restoreShadowQuality = applySnapshotShadowQuality(
          latestScene,
          gl,
          snapshotOptions.detailLevel,
          snapshotOptions.shadowStyle,
        );

        const originalRenderTarget = gl.getRenderTarget();
        const originalViewport = gl.getViewport(new THREE.Vector4());
        const originalScissor = gl.getScissor(new THREE.Vector4());
        const originalScissorTest = gl.getScissorTest();
        let capturedCanvas: HTMLCanvasElement;

        try {
          const dofSettings = resolveSnapshotDofSettings(
            latestScene,
            captureCamera,
            snapshotOptions.dofMode,
          );

          if (dofSettings) {
            capturedCanvas = renderSceneWithDofToCanvas({
              gl,
              scene: latestScene,
              camera: captureCamera,
              width: renderPlan.targetWidth,
              height: renderPlan.targetHeight,
              samples: Math.min(
                gl.capabilities.maxSamples,
                SNAPSHOT_RENDER_TARGET_SAMPLES[snapshotOptions.detailLevel],
              ),
              settings: dofSettings,
            });
          } else {
            capturedCanvas = renderSceneToCanvas({
              scene: latestScene,
              camera: captureCamera,
              width: renderPlan.targetWidth,
              height: renderPlan.targetHeight,
              requestedSamples: SNAPSHOT_RENDER_TARGET_SAMPLES[snapshotOptions.detailLevel],
            });
          }
        } finally {
          gl.setRenderTarget(originalRenderTarget);
          gl.setViewport(originalViewport);
          gl.setScissor(originalScissor);
          gl.setScissorTest(originalScissorTest);
        }

        restoreShadowQuality();
        restoreShadowQuality = null;
        restoreLightingPreset?.();
        restoreLightingPreset = null;
        restoreTextureQuality();
        restoreTextureQuality = null;
        restoreSceneVisibility();
        restoreSceneVisibility = null;
        restoreBackgroundStyle();
        restoreBackgroundStyle = null;
        capturedCanvas = createExportCanvas(
          capturedCanvas,
          outputPlan.targetWidth,
          outputPlan.targetHeight,
          backgroundFill,
        );
        invalidate();
        return {
          canvas: capturedCanvas,
          width: outputPlan.targetWidth,
          height: outputPlan.targetHeight,
          options: snapshotOptions,
        };
      } catch (error) {
        restoreBackgroundStyle?.();
        restoreShadowQuality?.();
        restoreLightingPreset?.();
        restoreTextureQuality?.();
        restoreSceneVisibility?.();
        invalidate();
        throw error;
      }
    };

    const runSnapshotCapture = async (
      requestedOptions: Parameters<SnapshotCaptureAction>[0],
      resolveOptions: (options?: Partial<SnapshotCaptureOptions> | null) => SnapshotCaptureOptions,
    ) => {
      const snapshotOptions = resolveOptions(requestedOptions);
      const frozenCamera = cloneSnapshotCamera(get().camera);
      await ensureSnapshotHdrPreloaded();
      clearPendingFrames();
      setSnapshotRenderActive(true);
      setActiveSnapshotOptions(snapshotOptions);
      invalidate();

      try {
        await waitFrames(resolveSnapshotWarmupFrameCount(snapshotOptions));
        return await renderSnapshotCanvas(snapshotOptions, frozenCamera);
      } finally {
        setActiveSnapshotOptions(null);
        setSnapshotRenderActive(false);
        invalidate();
      }
    };

    const captureAction: SnapshotCaptureAction = async (requestedOptions) => {
      const capture = await runSnapshotCapture(requestedOptions, normalizeSnapshotCaptureOptions);
      await downloadCanvas(capture.canvas, capture.options);
    };

    if (actionRef) {
      actionRef.current = captureAction;
    }
    onSnapshotActionChange?.(captureAction);

    const previewAction: SnapshotPreviewAction = async (requestedOptions) => {
      const capture = await runSnapshotCapture(
        requestedOptions,
        resolveSnapshotPreviewCaptureOptions,
      );
      return {
        blob: await canvasToBlob(capture.canvas, capture.options),
        width: capture.width,
        height: capture.height,
        options: capture.options,
      };
    };

    if (previewActionRef) {
      previewActionRef.current = previewAction;
    }
    onPreviewActionChange?.(previewAction);

    return () => {
      clearPendingFrames();
      setSnapshotRenderActive(false);
      if (actionRef) {
        actionRef.current = null;
      }
      onSnapshotActionChange?.(null);
      if (previewActionRef) {
        previewActionRef.current = null;
      }
      onPreviewActionChange?.(null);
    };
  }, [
    actionRef,
    get,
    gl,
    invalidate,
    onSnapshotActionChange,
    onPreviewActionChange,
    previewActionRef,
    robotName,
    setSnapshotRenderActive,
  ]);

  return activeSnapshotOptions ? (
    <SnapshotExportLook options={activeSnapshotOptions} theme={theme} groundOffset={groundOffset} />
  ) : null;
};
