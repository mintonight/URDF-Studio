import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Camera, X } from 'lucide-react';
import {
  Button,
  CompactSwitch,
  PanelSegmentedControl,
  PanelSelect,
  type SegmentedControlOption,
  type SelectOption,
} from '@/shared/components/ui';
import { DraggableWindow } from '@/shared/components';
import { useDraggableWindow } from '@/shared/hooks';
import {
  DEFAULT_SNAPSHOT_CAPTURE_OPTIONS,
  type SnapshotCaptureAction,
  type SnapshotCaptureOptions,
} from '@/shared/components/3d';
import { translations, type Language } from '@/shared/i18n';
import { SnapshotPreviewRenderer } from './snapshot-preview/SnapshotPreviewRenderer';
import type { SnapshotDialogPreviewState, SnapshotPreviewSession } from './snapshot-preview/types';

const SNAPSHOT_RESOLUTION_OPTIONS = [
  { value: '1280', label: '720p' },
  { value: '1920', label: '1080p' },
  { value: '2560', label: '2K' },
  { value: '3840', label: '4K' },
  { value: '7680', label: '8K' },
] as const;

const PANEL_SECTION_CLASS_NAME =
  'rounded-lg border border-border-black bg-panel-bg px-3 py-2 shadow-sm';
const FIELD_ROW_CLASS_NAME = 'grid grid-cols-[78px_minmax(0,1fr)] items-center gap-2';
const FIELD_LABEL_CLASS_NAME =
  'truncate text-[10px] font-medium tracking-[0.01em] text-text-secondary';
const SNAPSHOT_DIALOG_DEFAULT_SIZE = {
  width: 560,
  height: 690,
} as const;
const SNAPSHOT_DIALOG_MIN_SIZE = {
  width: 360,
  height: 420,
} as const;
const SNAPSHOT_DIALOG_HEADER_HEIGHT = 40;
const SNAPSHOT_DIALOG_VIEWPORT_MARGIN = 24;
const SNAPSHOT_DIALOG_VIEWPORT_MIN_HEIGHT = 320;
const SNAPSHOT_DIALOG_COMPACT_LAYOUT_WIDTH = 520;
const SNAPSHOT_PREVIEW_MIN_WIDTH = 220;
const SNAPSHOT_PREVIEW_REGULAR_MAX_WIDTH = 360;
const SNAPSHOT_PREVIEW_COMPACT_MAX_WIDTH = 300;
const SNAPSHOT_PREVIEW_REGULAR_WIDTH_GUTTER = 180;
const SNAPSHOT_PREVIEW_COMPACT_WIDTH_GUTTER = 96;

const clamp = (value: number, min: number, max: number) => {
  if (max < min) {
    return min;
  }
  return Math.max(min, Math.min(max, value));
};

const resolveSnapshotDialogHeight = ({
  scrollContentHeight,
  footerHeight,
  viewportHeight,
}: {
  scrollContentHeight: number;
  footerHeight: number;
  viewportHeight: number;
}) => {
  const viewportLimit = Math.max(
    SNAPSHOT_DIALOG_VIEWPORT_MIN_HEIGHT,
    viewportHeight - SNAPSHOT_DIALOG_VIEWPORT_MARGIN,
  );
  const minHeight = Math.min(SNAPSHOT_DIALOG_MIN_SIZE.height, viewportLimit);
  const naturalHeight = SNAPSHOT_DIALOG_HEADER_HEIGHT + footerHeight + scrollContentHeight;
  return clamp(naturalHeight, minHeight, viewportLimit);
};

interface SnapshotDialogProps {
  isOpen: boolean;
  isCapturing: boolean;
  lang: Language;
  onClose: () => void;
  onCapture: (options: SnapshotCaptureOptions) => Promise<void> | void;
  previewSession?: SnapshotPreviewSession | null;
  previewState?: SnapshotDialogPreviewState;
  onPreviewCaptureActionChange?: (action: SnapshotCaptureAction | null) => void;
}

function SnapshotSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className={PANEL_SECTION_CLASS_NAME}>
      <div className="mb-1.5 text-[10px] font-semibold tracking-[0.02em] text-text-tertiary">
        {title}
      </div>
      {children}
    </div>
  );
}

function SnapshotField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className={FIELD_ROW_CLASS_NAME}>
      <div className={FIELD_LABEL_CLASS_NAME}>{label}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SnapshotDialog({
  isOpen,
  isCapturing,
  lang,
  onClose,
  onCapture,
  previewSession = null,
  previewState,
  onPreviewCaptureActionChange,
}: SnapshotDialogProps) {
  const t = translations[lang];
  const [resolutionPreset, setResolutionPreset] = useState(
    String(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.longEdgePx),
  );
  const [imageFormat, setImageFormat] = useState(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.imageFormat);
  const [imageQuality, setImageQuality] = useState(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.imageQuality);
  const [detailLevel, setDetailLevel] = useState(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.detailLevel);
  const [environmentPreset, setEnvironmentPreset] = useState(
    DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.environmentPreset,
  );
  const [shadowStyle, setShadowStyle] = useState(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.shadowStyle);
  const [groundStyle, setGroundStyle] = useState(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.groundStyle);
  const [dofMode, setDofMode] = useState(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.dofMode);
  const [backgroundStyle, setBackgroundStyle] = useState(
    DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle,
  );
  const [hideGrid, setHideGrid] = useState(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.hideGrid);
  const [internalPreviewState, setInternalPreviewState] = useState<SnapshotDialogPreviewState>({
    status: 'idle',
    imageUrl: null,
    aspectRatio: previewSession?.viewportAspectRatio ?? 16 / 9,
  });
  const scrollBodyRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);

  const windowState = useDraggableWindow({
    isOpen,
    defaultSize: SNAPSHOT_DIALOG_DEFAULT_SIZE,
    minSize: SNAPSHOT_DIALOG_MIN_SIZE,
    centerOnMount: true,
    enableMinimize: false,
    enableMaximize: false,
    clampResizeToViewport: true,
    dragBounds: {
      allowNegativeX: false,
      minVisibleWidth: 280,
      topMargin: 12,
      bottomMargin: 56,
    },
  });

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    setResolutionPreset(String(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.longEdgePx));
    setImageFormat(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.imageFormat);
    setImageQuality(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.imageQuality);
    setDetailLevel(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.detailLevel);
    setEnvironmentPreset(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.environmentPreset);
    setShadowStyle(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.shadowStyle);
    setGroundStyle(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.groundStyle);
    setDofMode(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.dofMode);
    setBackgroundStyle(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle);
    setHideGrid(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.hideGrid);
    setInternalPreviewState({
      status: 'idle',
      imageUrl: null,
      aspectRatio: previewSession?.viewportAspectRatio ?? 16 / 9,
    });
  }, [isOpen, previewSession?.viewportAspectRatio]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    const scrollBody = scrollBodyRef.current;
    const footer = footerRef.current;

    if (!scrollBody || !footer) {
      return;
    }

    const nextHeight = resolveSnapshotDialogHeight({
      scrollContentHeight: scrollBody.scrollHeight,
      footerHeight: footer.offsetHeight,
      viewportHeight: window.innerHeight,
    });

    windowState.setSize((currentSize) =>
      currentSize.height === nextHeight ? currentSize : { ...currentSize, height: nextHeight },
    );
  }, [
    isOpen,
    lang,
    internalPreviewState.aspectRatio,
    internalPreviewState.imageUrl,
    internalPreviewState.status,
    previewState?.imageUrl,
    previewState?.status,
    previewSession?.viewportAspectRatio,
    previewState?.aspectRatio,
    windowState.setSize,
  ]);

  useEffect(() => {
    if (imageFormat === 'jpeg' && backgroundStyle === 'transparent') {
      setBackgroundStyle(DEFAULT_SNAPSHOT_CAPTURE_OPTIONS.backgroundStyle);
    }
  }, [backgroundStyle, imageFormat]);

  useEffect(() => {
    if (backgroundStyle === 'transparent' && dofMode !== 'off') {
      setDofMode('off');
    }
  }, [backgroundStyle, dofMode]);

  const resolvedOptions = useMemo<SnapshotCaptureOptions>(
    () => ({
      longEdgePx: Number(resolutionPreset),
      imageFormat,
      imageQuality,
      detailLevel,
      environmentPreset,
      shadowStyle,
      groundStyle,
      dofMode,
      backgroundStyle,
      hideGrid,
    }),
    [
      backgroundStyle,
      detailLevel,
      dofMode,
      environmentPreset,
      groundStyle,
      hideGrid,
      imageFormat,
      imageQuality,
      resolutionPreset,
      shadowStyle,
    ],
  );

  const supportsLossyCompression = imageFormat !== 'png';
  const resolutionOptions = useMemo<SelectOption[]>(
    () =>
      SNAPSHOT_RESOLUTION_OPTIONS.map((option) => ({
        value: option.value,
        label: option.label,
      })),
    [],
  );
  const formatOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'png', label: t.snapshotFormatPng },
      { value: 'jpeg', label: t.snapshotFormatJpeg },
      { value: 'webp', label: t.snapshotFormatWebp },
    ],
    [t],
  );
  const environmentOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'viewport', label: t.snapshotEnvironmentViewport },
      { value: 'studio', label: t.snapshotEnvironmentStudio },
      { value: 'city', label: t.snapshotEnvironmentCity },
      { value: 'contrast', label: t.snapshotEnvironmentContrast },
    ],
    [t],
  );
  const backgroundOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [
      { value: 'viewport', label: t.snapshotBackgroundViewport },
      { value: 'studio', label: t.snapshotBackgroundStudio },
      { value: 'sky', label: t.snapshotBackgroundSky },
      { value: 'dark', label: t.snapshotBackgroundDark },
    ];

    if (imageFormat !== 'jpeg') {
      options.push({ value: 'transparent', label: t.snapshotBackgroundTransparent });
    }

    return options;
  }, [imageFormat, t]);
  const shadowOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'soft', label: t.snapshotShadowSoft },
      { value: 'balanced', label: t.snapshotShadowBalanced },
      { value: 'crisp', label: t.snapshotShadowCrisp },
    ],
    [t],
  );
  const groundOptions = useMemo<SelectOption[]>(
    () => [
      { value: 'shadow', label: t.snapshotFloorShadow },
      { value: 'contact', label: t.snapshotFloorContact },
      { value: 'reflective', label: t.snapshotFloorReflective },
    ],
    [t],
  );
  const dofOptions = useMemo<SelectOption[]>(() => {
    const options: SelectOption[] = [{ value: 'off', label: t.snapshotDofOff }];

    if (backgroundStyle !== 'transparent') {
      options.push(
        { value: 'subtle', label: t.snapshotDofSubtle },
        { value: 'hero', label: t.snapshotDofHero },
      );
    }

    return options;
  }, [backgroundStyle, t]);
  const antialiasOptions = useMemo<
    ReadonlyArray<SegmentedControlOption<SnapshotCaptureOptions['detailLevel']>>
  >(
    () => [
      { value: 'viewport', label: '1x' },
      { value: 'high', label: '2x' },
      { value: 'ultra', label: '4x' },
    ],
    [],
  );
  const compressionOptions = useMemo<ReadonlyArray<SegmentedControlOption<number | 'lossless'>>>(
    () =>
      supportsLossyCompression
        ? [
            { value: 60, label: t.compressionLevelCompact },
            { value: 80, label: t.compressionLevelBalanced },
            { value: 96, label: t.compressionLevelPreserve },
          ]
        : [{ value: 'lossless', label: t.snapshotCompressionLossless, disabled: true }],
    [supportsLossyCompression, t],
  );
  const compactLabels = useMemo(
    () => ({
      output: lang === 'zh' ? '输出' : 'Output',
      scene: lang === 'zh' ? '场景' : 'Scene',
      resolution: lang === 'zh' ? '分辨率' : 'Resolution',
      format: lang === 'zh' ? '格式' : 'Format',
      aa: 'AA',
      quality: lang === 'zh' ? '压缩' : 'Compression',
      lighting: lang === 'zh' ? '灯光' : 'Lighting',
      background: lang === 'zh' ? '背景' : 'Background',
      shadow: lang === 'zh' ? '阴影' : 'Shadow',
      ground: lang === 'zh' ? '地面' : 'Ground',
      dof: lang === 'zh' ? '景深' : 'DoF',
      grid: lang === 'zh' ? '网格' : 'Grid',
    }),
    [lang],
  );
  const selectedAntialiasOption =
    antialiasOptions.find((option) => option.value === detailLevel) ?? antialiasOptions[1];
  const selectedResolutionLabel =
    SNAPSHOT_RESOLUTION_OPTIONS.find((option) => option.value === resolutionPreset)?.label ??
    `${resolutionPreset}px`;
  const captureSummary = [
    selectedResolutionLabel,
    imageFormat.toUpperCase(),
    selectedAntialiasOption.label,
  ].join(' · ');
  const compressionPreset = supportsLossyCompression
    ? imageQuality >= 90
      ? 96
      : imageQuality >= 70
        ? 80
        : 60
    : 'lossless';
  const effectivePreviewState = previewState ?? internalPreviewState;
  const isCompactLayout = windowState.size.width <= SNAPSHOT_DIALOG_COMPACT_LAYOUT_WIDTH;
  const settingsGridClassName = isCompactLayout
    ? 'grid grid-cols-1 gap-y-1.5'
    : 'grid grid-cols-2 gap-x-3 gap-y-1.5';
  const previewCardClassName = `rounded-xl border border-border-black bg-element-bg px-3 py-2 shadow-sm ${
    isCompactLayout ? 'flex min-h-[220px] flex-col' : 'flex min-h-[260px] flex-1 flex-col'
  }`;
  const previewStatusText =
    effectivePreviewState.status === 'loading' || effectivePreviewState.status === 'idle'
      ? t.snapshotPreviewLoading
      : effectivePreviewState.status === 'refreshing'
        ? t.snapshotPreviewRefreshing
        : effectivePreviewState.status === 'error'
          ? t.snapshotPreviewFailed
          : t.snapshotPreviewReady;
  const previewAspectRatio =
    effectivePreviewState.aspectRatio > 0 ? effectivePreviewState.aspectRatio : 16 / 9;
  const previewFrameMaxWidth = clamp(
    windowState.size.width -
      (isCompactLayout
        ? SNAPSHOT_PREVIEW_COMPACT_WIDTH_GUTTER
        : SNAPSHOT_PREVIEW_REGULAR_WIDTH_GUTTER),
    SNAPSHOT_PREVIEW_MIN_WIDTH,
    isCompactLayout ? SNAPSHOT_PREVIEW_COMPACT_MAX_WIDTH : SNAPSHOT_PREVIEW_REGULAR_MAX_WIDTH,
  );

  if (!isOpen) {
    return null;
  }

  return (
    <DraggableWindow
      window={windowState}
      onClose={() => {
        if (!isCapturing) {
          onClose();
        }
      }}
      title={
        <div className="flex items-center gap-2">
          <div className="rounded-lg border border-border-black bg-panel-bg p-1 text-system-blue shadow-sm">
            <Camera className="h-3 w-3" />
          </div>
          <div className="text-[12px] font-semibold tracking-[0.01em] text-text-primary">
            {t.snapshotCapture}
          </div>
        </div>
      }
      className="z-[95] overflow-hidden rounded-2xl border border-border-black bg-panel-bg text-text-primary shadow-xl pointer-events-auto"
      headerClassName="flex h-10 items-center justify-between border-b border-border-black bg-element-bg px-3"
      interactionClassName="select-none"
      controlButtonClassName="rounded-md p-1 text-text-tertiary transition-colors hover:bg-panel-bg hover:text-text-primary"
      closeButtonClassName="rounded-md p-1 text-text-tertiary transition-colors hover:bg-danger hover:text-white"
      controlIcons={{ close: <X className="h-3.5 w-3.5" /> }}
      showMinimizeButton={false}
      showMaximizeButton={false}
      showResizeHandles
      leftResizeHandleClassName="hidden"
      rightResizeHandleClassName="absolute right-0 top-0 bottom-3 w-2 cursor-ew-resize transition-colors hover:bg-system-blue/15 active:bg-system-blue/20 z-20"
      bottomResizeHandleClassName="absolute bottom-0 left-0 right-3 h-2 cursor-ns-resize transition-colors hover:bg-system-blue/15 active:bg-system-blue/20 z-20"
      cornerResizeHandleClassName="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize transition-colors hover:bg-system-blue/20 active:bg-system-blue/25 z-30"
      cornerResizeHandle={
        <div className="absolute bottom-0 right-0 h-2.5 w-2.5 border-b-2 border-r-2 border-border-strong/80" />
      }
      closeTitle={t.close}
    >
      <div className="flex h-[calc(100%-40px)] min-h-0 flex-col overflow-hidden bg-panel-bg">
        <div
          ref={scrollBodyRef}
          className="flex flex-1 min-h-0 flex-col gap-1.5 overflow-y-auto px-2.5 py-2"
        >
          <SnapshotSection title={compactLabels.output}>
            <div className={settingsGridClassName}>
              <SnapshotField label={compactLabels.resolution}>
                <PanelSelect
                  variant="snapshot"
                  value={resolutionPreset}
                  options={resolutionOptions}
                  disabled={isCapturing}
                  onChange={(event) => setResolutionPreset(event.target.value)}
                />
              </SnapshotField>
              <SnapshotField label={compactLabels.format}>
                <PanelSelect
                  variant="snapshot"
                  value={imageFormat}
                  options={formatOptions}
                  disabled={isCapturing}
                  onChange={(event) =>
                    setImageFormat(event.target.value as SnapshotCaptureOptions['imageFormat'])
                  }
                />
              </SnapshotField>
              <SnapshotField label={compactLabels.aa}>
                <PanelSegmentedControl
                  value={detailLevel}
                  options={antialiasOptions}
                  disabled={isCapturing}
                  className="w-full"
                  stretch
                  onChange={(value) =>
                    setDetailLevel(value as SnapshotCaptureOptions['detailLevel'])
                  }
                />
              </SnapshotField>
              <SnapshotField label={compactLabels.quality}>
                <PanelSegmentedControl
                  value={compressionPreset}
                  options={compressionOptions}
                  disabled={isCapturing || !supportsLossyCompression}
                  className="w-full"
                  stretch
                  onChange={(value) => {
                    if (typeof value === 'number') {
                      setImageQuality(value);
                    }
                  }}
                />
              </SnapshotField>
            </div>
          </SnapshotSection>

          <SnapshotSection title={compactLabels.scene}>
            <div className={settingsGridClassName}>
              <SnapshotField label={compactLabels.lighting}>
                <PanelSelect
                  variant="snapshot"
                  value={environmentPreset}
                  options={environmentOptions}
                  disabled={isCapturing}
                  onChange={(event) =>
                    setEnvironmentPreset(
                      event.target.value as SnapshotCaptureOptions['environmentPreset'],
                    )
                  }
                />
              </SnapshotField>
              <SnapshotField label={compactLabels.background}>
                <PanelSelect
                  variant="snapshot"
                  value={backgroundStyle}
                  options={backgroundOptions}
                  disabled={isCapturing}
                  onChange={(event) =>
                    setBackgroundStyle(
                      event.target.value as SnapshotCaptureOptions['backgroundStyle'],
                    )
                  }
                />
              </SnapshotField>
              <SnapshotField label={compactLabels.shadow}>
                <PanelSelect
                  variant="snapshot"
                  value={shadowStyle}
                  options={shadowOptions}
                  disabled={isCapturing}
                  onChange={(event) =>
                    setShadowStyle(event.target.value as SnapshotCaptureOptions['shadowStyle'])
                  }
                />
              </SnapshotField>
              <SnapshotField label={compactLabels.ground}>
                <PanelSelect
                  variant="snapshot"
                  value={groundStyle}
                  options={groundOptions}
                  disabled={isCapturing}
                  onChange={(event) =>
                    setGroundStyle(event.target.value as SnapshotCaptureOptions['groundStyle'])
                  }
                />
              </SnapshotField>
              <SnapshotField label={compactLabels.dof}>
                <PanelSelect
                  variant="snapshot"
                  value={dofMode}
                  options={dofOptions}
                  disabled={isCapturing}
                  onChange={(event) =>
                    setDofMode(event.target.value as SnapshotCaptureOptions['dofMode'])
                  }
                />
              </SnapshotField>
              <SnapshotField label={compactLabels.grid}>
                <CompactSwitch
                  checked={!hideGrid}
                  onChange={(checked) => setHideGrid(!checked)}
                  disabled={isCapturing}
                  ariaLabel={t.snapshotHideGrid}
                  className="w-full justify-start"
                />
              </SnapshotField>
            </div>
          </SnapshotSection>

          <div data-testid="snapshot-preview-card" className={previewCardClassName}>
            <div
              className={`mb-2 flex shrink-0 gap-3 ${isCompactLayout ? 'flex-col items-start' : 'items-start justify-between'}`}
            >
              <div className="min-w-0">
                <div className="text-[10px] font-semibold tracking-[0.02em] text-text-primary">
                  {t.snapshotPreviewTitle}
                </div>
              </div>
              <div className="shrink-0 rounded-md border border-border-black bg-panel-bg px-1.5 py-0.5 text-[9px] font-medium text-text-secondary">
                {previewStatusText}
              </div>
            </div>

            <div className="flex min-h-[160px] flex-1 items-center justify-center">
              <div
                data-testid="snapshot-preview-frame-shell"
                className="w-full"
                style={{ maxWidth: `${previewFrameMaxWidth}px` }}
              >
                <div
                  data-testid="snapshot-preview-frame"
                  className="w-full overflow-hidden rounded-lg border border-border-black bg-panel-bg"
                  style={{ aspectRatio: String(previewAspectRatio) }}
                >
                  {effectivePreviewState.imageUrl ? (
                    <div className="relative h-full w-full">
                      <img
                        src={effectivePreviewState.imageUrl}
                        alt={t.snapshotPreviewAlt}
                        draggable={false}
                        className="h-full w-full object-contain"
                      />
                      {effectivePreviewState.status === 'refreshing' ? (
                        <div className="absolute inset-0 flex items-end justify-start bg-panel-bg/18 p-2">
                          <div className="rounded-md border border-border-black bg-element-bg/92 px-1.5 py-1 text-[10px] font-medium text-text-primary shadow-sm">
                            {t.snapshotPreviewRefreshing}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[120px] items-center justify-center px-4 text-center text-[11px] text-text-secondary">
                      {effectivePreviewState.status === 'error'
                        ? t.snapshotPreviewFailed
                        : t.snapshotPreviewLoading}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className={`mt-2 flex shrink-0 gap-3 text-[10px] text-text-secondary ${
                isCompactLayout ? 'flex-col items-start' : 'items-start justify-between'
              }`}
            >
              <div className={`min-w-0 ${isCompactLayout ? 'break-words' : 'truncate'}`}>
                {captureSummary}
              </div>
              {effectivePreviewState.status === 'error' ? (
                <div
                  className={`text-[10px] text-danger ${isCompactLayout ? '' : 'shrink-0 text-right'}`}
                >
                  {t.snapshotPreviewRetryingHint}
                </div>
              ) : null}
            </div>
          </div>
        </div>

        <div
          ref={footerRef}
          className="shrink-0 border-t border-border-black bg-element-bg/95 px-3 py-2.5 backdrop-blur-sm"
        >
          <div className="flex flex-wrap items-center justify-end gap-1.5">
            <Button
              type="button"
              variant="secondary"
              onClick={onClose}
              disabled={isCapturing}
              className="h-[26px] rounded-lg px-2.5 text-[11px]"
            >
              {t.close}
            </Button>
            <Button
              type="button"
              onClick={() => void onCapture(resolvedOptions)}
              isLoading={isCapturing}
              disabled={isCapturing}
              icon={<Camera className="h-3 w-3" />}
              className="h-[26px] min-w-[118px] rounded-lg px-3 text-[11px]"
            >
              {isCapturing ? t.snapshotCapturing : t.snapshotCapture}
            </Button>
          </div>
        </div>
      </div>
      {!previewState && previewSession ? (
        <SnapshotPreviewRenderer
          isOpen={isOpen}
          lang={lang}
          session={previewSession}
          options={resolvedOptions}
          onStateChange={setInternalPreviewState}
          onCaptureActionChange={onPreviewCaptureActionChange}
        />
      ) : null}
    </DraggableWindow>
  );
}

export default SnapshotDialog;
