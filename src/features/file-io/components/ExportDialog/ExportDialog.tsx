import React, { useState, useCallback, useEffect } from 'react';
import { Upload, Package, FileCode, Layers, Lock, Braces, Loader2, Info } from 'lucide-react';
import { DraggableWindow } from '@/shared/components';
import { useDraggableWindow } from '@/shared/hooks';
import { Slider, Switch, Tooltip } from '@/shared/components/ui';
import { translations } from '@/shared/i18n';
import type { TranslationKeys } from '@/shared/i18n/types';
import type { ExportProgressState } from '../../types';
import type { MjcfActuatorType } from '@/core/parsers/mjcf/mjcfGenerator';
import { ExportProgressView } from '../ExportProgressView';

export type ExportFormat = 'project' | 'mjcf' | 'urdf' | 'xacro' | 'sdf' | 'usd';

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

const MJCF_SUPPORTS = ['MuJoCo', 'Motphys', 'Genesis'];
const URDF_SUPPORTS = ['Isaac Sim', 'Isaac Gym', 'Genesis', 'PyBullet', 'ManiSkill', 'Motphys'];
const XACRO_SUPPORTS = ['Gazebo', 'ROS1', 'ROS2'];
const SDF_SUPPORTS = ['Gazebo', 'Ignition Gazebo', 'sdformat'];
const USD_SUPPORTS = ['OpenUSD', 'Isaac Sim', 'Omniverse'];

const DEFAULT_CONFIG: ExportDialogConfig = {
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
    meshQuality: 50,
  },
};

interface ExportDialogProps {
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9px] font-semibold tracking-[0.02em] text-text-tertiary mb-1.5 mt-3 first:mt-0">
      {children}
    </div>
  );
}

function Row({
  label,
  desc,
  hint,
  stacked = false,
  children,
}: {
  label: string;
  desc?: string;
  hint?: string;
  stacked?: boolean;
  children: React.ReactNode;
}) {
  const isCenteredRow = !stacked && !desc;

  return (
    <div
      className={`flex gap-3 border-b border-border-black py-1.5 last:border-0 ${
        stacked
          ? 'flex-col'
          : isCenteredRow
            ? 'items-center justify-between'
            : 'items-start justify-between'
      }`}
    >
      <div className={`min-w-0 flex flex-col gap-0.5 ${isCenteredRow ? 'justify-center' : ''}`}>
        <div className={`flex min-w-0 gap-1.5 ${isCenteredRow ? 'items-center' : 'items-start'}`}>
          <span className="text-[11px] text-text-primary leading-tight">{label}</span>
          {hint && (
            <Tooltip content={hint} side="top" align="start" className="max-w-[20rem]">
              <button
                type="button"
                aria-label={hint}
                className="mt-px inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-tertiary transition-colors hover:bg-system-blue/10 hover:text-system-blue focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
              >
                <Info className="h-3 w-3" />
              </button>
            </Tooltip>
          )}
        </div>
        {desc && <span className="text-[9px] text-text-tertiary leading-tight">{desc}</span>}
      </div>
      <div
        className={stacked ? 'w-full min-w-0' : isCenteredRow ? 'shrink-0 self-center' : 'shrink-0'}
      >
        {children}
      </div>
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <Switch checked={value} onChange={onChange} size="sm" />;
}

function SelectField({
  value,
  options,
  onChange,
  title,
  fullWidth = false,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  title?: string;
  fullWidth?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      title={title}
      className={`bg-input-bg border border-border-black text-text-primary text-xs rounded-md px-2 py-1 focus:ring-2 focus:ring-system-blue/25 focus:border-system-blue transition-all ${
        fullWidth ? 'w-full min-w-0' : ''
      }`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function SegmentedChoiceField<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-xl border border-border-black bg-segmented-bg p-1">
      {options.map((option) => {
        const isActive = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-8 items-center justify-center rounded-lg px-3 py-1.5 text-center text-xs font-medium leading-none transition-all ${
              isActive
                ? 'bg-white text-text-primary shadow-sm dark:bg-segmented-active'
                : 'text-text-secondary hover:bg-element-hover hover:text-text-primary'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function TextField({
  value,
  onChange,
  placeholder,
  fullWidth = false,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  fullWidth?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={`bg-input-bg border border-border-black text-text-primary text-xs rounded-md px-2 py-1 focus:ring-2 focus:ring-system-blue/25 focus:border-system-blue transition-all ${
        fullWidth ? 'w-full min-w-0' : 'w-28'
      }`}
    />
  );
}

const STL_QUALITY_PRESETS = [
  { key: 'none', quality: 100, compress: false },
  { key: 'light', quality: 75, compress: true },
  { key: 'medium', quality: 50, compress: true },
] as const;

type StlPresetKey = (typeof STL_QUALITY_PRESETS)[number]['key'] | 'custom';

const QUALITY_SLIDER_MIN = 10;
const QUALITY_SLIDER_MAX = 100;

function getStlPreset(compressSTL: boolean, stlQuality: number): StlPresetKey {
  if (!compressSTL) return 'none';
  if (stlQuality === 75) return 'light';
  if (stlQuality === 50) return 'medium';
  return 'custom';
}

function getCustomCompressionLabel(t: TranslationKeys, quality: number): string {
  if (quality <= 25) return t.compressionLevelAggressive;
  if (quality <= 45) return t.compressionLevelCompact;
  if (quality <= 65) return t.compressionLevelBalanced;
  if (quality <= 85) return t.compressionLevelDetailed;
  return t.compressionLevelPreserve;
}

function STLQualitySelector({
  compressSTL,
  stlQuality,
  mode,
  t,
  onCompressChange,
  onQualityChange,
  onModeChange,
  label,
  description,
}: {
  compressSTL: boolean;
  stlQuality: number;
  mode: StlPresetKey;
  t: TranslationKeys;
  onCompressChange: (v: boolean) => void;
  onQualityChange: (v: number) => void;
  onModeChange: (mode: StlPresetKey) => void;
  label?: string;
  description?: string | null;
}) {
  const active = mode;
  const presetLabels: Record<StlPresetKey, string> = {
    none: t.stlQualityOriginal,
    light: t.stlQualityLight,
    medium: t.stlQualityMedium,
    custom: t.presetCustom,
  };
  const customQuality = Math.min(
    Math.max(Math.round(stlQuality), QUALITY_SLIDER_MIN),
    QUALITY_SLIDER_MAX,
  );

  const handlePresetSelect = useCallback(
    (preset: StlPresetKey) => {
      onModeChange(preset);

      if (preset === 'custom') {
        if (!compressSTL) onCompressChange(true);
        return;
      }

      const selectedPreset = STL_QUALITY_PRESETS.find((candidate) => candidate.key === preset);
      if (!selectedPreset) return;

      onCompressChange(selectedPreset.compress);
      if (selectedPreset.compress) {
        onQualityChange(selectedPreset.quality);
      }
    },
    [compressSTL, onCompressChange, onModeChange, onQualityChange],
  );

  const resolvedDescription = description === undefined ? t.stlMeshQualityDesc : description;

  return (
    <div className="py-2">
      <div className="text-xs text-text-primary mb-0.5">{label || t.stlMeshQuality}</div>
      {resolvedDescription ? (
        <div className="mb-2 text-[10px] text-text-tertiary">{resolvedDescription}</div>
      ) : null}
      <div className="grid grid-cols-4 gap-1 p-1 bg-segmented-bg rounded-xl border border-border-black">
        {[...STL_QUALITY_PRESETS, { key: 'custom' as const }].map((p) => (
          <button
            key={p.key}
            onClick={() => handlePresetSelect(p.key)}
            className={`flex-1 py-1 px-2.5 text-xs rounded-lg transition-all font-medium ${
              active === p.key
                ? 'bg-white dark:bg-segmented-active text-text-primary shadow-sm'
                : 'text-text-secondary hover:text-text-primary hover:bg-element-hover'
            }`}
          >
            {presetLabels[p.key]}
          </button>
        ))}
      </div>
      {active === 'custom' && compressSTL && (
        <div className="mt-3 px-1">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-text-primary">{t.presetCustom}</span>
            <span className="rounded-md bg-element-bg px-1.5 py-0.5 text-[10px] text-text-secondary">
              {getCustomCompressionLabel(t, customQuality)}
            </span>
          </div>
          <Slider
            value={customQuality}
            min={QUALITY_SLIDER_MIN}
            max={QUALITY_SLIDER_MAX}
            step={1}
            showValue={false}
            onChange={(value) => {
              onModeChange('custom');
              if (!compressSTL) onCompressChange(true);
              onQualityChange(value);
            }}
          />
          <div className="mt-1.5 flex items-center justify-between text-[10px] text-text-tertiary">
            <span>{t.compressionSmallerFile}</span>
            <span>{t.compressionMoreDetail}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export const ExportDialog: React.FC<ExportDialogProps> = ({
  onClose,
  onExport,
  lang,
  isExporting = false,
  canExportUsd = false,
  defaultFormat = DEFAULT_CONFIG.format,
}) => {
  const t = translations[lang];
  type MeshExportFormat = Exclude<ExportFormat, 'project'>;
  const initialFormat = defaultFormat === 'project' ? DEFAULT_CONFIG.format : defaultFormat;
  const [config, setConfig] = useState<ExportDialogConfig>(() => ({
    ...DEFAULT_CONFIG,
    format: initialFormat,
  }));
  const [localExportProgress, setLocalExportProgress] = useState<ExportProgressState | null>(null);
  const [pendingExportFormat, setPendingExportFormat] = useState<ExportFormat | null>(null);
  const [qualityModes, setQualityModes] = useState<Record<MeshExportFormat, StlPresetKey>>(() => ({
    mjcf: getStlPreset(DEFAULT_CONFIG.mjcf.compressSTL, DEFAULT_CONFIG.mjcf.stlQuality),
    urdf: getStlPreset(DEFAULT_CONFIG.urdf.compressSTL, DEFAULT_CONFIG.urdf.stlQuality),
    xacro: getStlPreset(DEFAULT_CONFIG.xacro.compressSTL, DEFAULT_CONFIG.xacro.stlQuality),
    sdf: getStlPreset(DEFAULT_CONFIG.sdf.compressSTL, DEFAULT_CONFIG.sdf.stlQuality),
    usd: getStlPreset(DEFAULT_CONFIG.usd.compressMeshes, DEFAULT_CONFIG.usd.meshQuality),
  }));

  const windowState = useDraggableWindow({
    defaultSize: { width: 420, height: 560 },
    minSize: { width: 380, height: 440 },
    centerOnMount: true,
    enableMinimize: false,
    enableMaximize: false,
  });

  useEffect(() => {
    if (!isExporting) {
      setPendingExportFormat(null);
    }
  }, [isExporting]);

  const dialogWidth = windowState.size.width;
  const isCompactLayout = dialogWidth < 480;
  const isStackedLayout = dialogWidth < 420;
  const isCompactFormatPicker = dialogWidth < 400;
  const formatGridClassName = 'grid-cols-5';

  const setFormat = useCallback(
    (fmt: MeshExportFormat) => {
      if (fmt === 'usd' && !canExportUsd) return;
      setConfig((prev) => ({ ...prev, format: fmt }));
    },
    [canExportUsd],
  );

  const updateMjcf = useCallback(
    <K extends keyof MjcfExportConfig>(key: K, value: MjcfExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, mjcf: { ...prev.mjcf, [key]: value } }));
    },
    [],
  );

  const updateUrdf = useCallback(
    <K extends keyof UrdfExportConfig>(key: K, value: UrdfExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, urdf: { ...prev.urdf, [key]: value } }));
    },
    [],
  );

  const updateXacro = useCallback(
    <K extends keyof XacroExportConfig>(key: K, value: XacroExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, xacro: { ...prev.xacro, [key]: value } }));
    },
    [],
  );

  const updateSdf = useCallback(
    <K extends keyof SdfExportConfig>(key: K, value: SdfExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, sdf: { ...prev.sdf, [key]: value } }));
    },
    [],
  );

  const updateUsd = useCallback(
    <K extends keyof UsdExportConfig>(key: K, value: UsdExportConfig[K]) => {
      setConfig((prev) => ({ ...prev, usd: { ...prev.usd, [key]: value } }));
    },
    [],
  );

  const updateIncludeSkeleton = useCallback((value: boolean) => {
    setConfig((prev) => ({ ...prev, includeSkeleton: value }));
  }, []);

  const updateQualityMode = useCallback((format: MeshExportFormat, mode: StlPresetKey) => {
    setQualityModes((prev) => (prev[format] === mode ? prev : { ...prev, [format]: mode }));
  }, []);

  const actuatorTypeOptions = [
    { value: 'position', label: t.exportActuatorPosition },
    { value: 'velocity', label: t.exportActuatorVelocity },
    { value: 'motor', label: t.exportActuatorMotor },
  ];
  const activeExportFormat = pendingExportFormat ?? config.format;
  const fallbackTotalSteps =
    activeExportFormat === 'project'
      ? 6
      : activeExportFormat === 'usd'
        ? config.usd.fileFormat === 'usda'
          ? 3
          : 4
        : activeExportFormat === 'mjcf'
          ? config.mjcf.includeMeshes
            ? 5
            : 4
          : (
                activeExportFormat === 'urdf'
                  ? config.urdf.includeMeshes
                  : activeExportFormat === 'xacro'
                    ? config.xacro.includeMeshes
                    : config.sdf.includeMeshes
              )
            ? 4
            : 3;
  const progressState = localExportProgress ?? {
    stepLabel: t.exportProgressPreparing,
    detail: t.exportProgressPreparingDetail,
    progress: 0.08,
    currentStep: 1,
    totalSteps: fallbackTotalSteps,
    indeterminate: true,
  };

  const startExport = useCallback(
    (format: ExportFormat) => {
      setPendingExportFormat(format);
      setLocalExportProgress(null);
      void onExport(
        { ...config, format },
        {
          onProgress: setLocalExportProgress,
        },
      );
    },
    [config, onExport],
  );

  const handleExportClick = useCallback(() => {
    startExport(config.format);
  }, [config.format, startExport]);

  const formatExt =
    config.format === 'mjcf'
      ? '.xml'
      : config.format === 'xacro'
        ? '.urdf.xacro'
        : config.format === 'sdf'
          ? '.sdf'
          : config.format === 'usd'
            ? `.${config.usd.fileFormat}`
            : '.urdf';

  const formatLabel: Record<MeshExportFormat, string> = {
    mjcf: t.exportFormatMJCF,
    urdf: t.exportFormatURDF,
    xacro: t.exportFormatXacro,
    sdf: t.exportFormatSDF,
    usd: t.exportFormatUSD,
  };

  return (
    <>
      <DraggableWindow
        window={windowState}
        onClose={onClose}
        title={
          <div className="flex items-center gap-2">
            <div className="p-1 rounded-md bg-element-bg text-text-secondary border border-border-black">
              <Upload className="w-3.5 h-3.5" />
            </div>
            <span className="text-xs font-semibold text-text-primary">{t.exportDialog}</span>
          </div>
        }
        className="z-[100] bg-panel-bg flex flex-col text-text-primary overflow-hidden rounded-2xl shadow-xl border border-border-black"
        headerClassName="h-10 border-b border-border-black flex items-center justify-between px-3 bg-element-bg shrink-0"
        interactionClassName="select-none"
        headerDraggableClassName="cursor-grab"
        headerDraggingClassName="cursor-grabbing"
        showMinimizeButton={false}
        showMaximizeButton={false}
        showCloseButton={!isExporting}
        closeTitle={t.close}
        closeButtonClassName="p-1.5 text-text-tertiary hover:bg-red-500 hover:text-white rounded transition-colors"
        showResizeHandles={true}
      >
        {/* Scrollable body */}
        {isExporting ? (
          <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
            <ExportProgressView progress={progressState} t={t} />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-1">
            {/* Format Selector */}
            <SectionLabel>{t.exportFormat}</SectionLabel>
            <div
              data-export-format-picker
              className={`grid gap-1 rounded-xl border border-border-black bg-segmented-bg p-1 ${formatGridClassName}`}
            >
              {(['mjcf', 'urdf', 'xacro', 'sdf', 'usd'] as MeshExportFormat[]).map((fmt) => {
                const isDisabled = fmt === 'usd' && !canExportUsd;
                const isActive = config.format === fmt;
                return (
                  <button
                    key={fmt}
                    onClick={() => setFormat(fmt)}
                    disabled={isDisabled}
                    className={`relative flex min-w-0 items-center justify-center rounded-lg px-1.5 py-1.5 font-medium transition-all ${
                      isCompactFormatPicker ? 'gap-1 text-[10px]' : 'gap-1.5 text-[11px]'
                    } ${
                      isDisabled
                        ? 'opacity-40 cursor-not-allowed text-text-tertiary'
                        : isActive
                          ? 'bg-white dark:bg-segmented-active text-text-primary shadow-sm'
                          : 'text-text-secondary hover:text-text-primary hover:bg-element-hover'
                    }`}
                  >
                    {fmt === 'mjcf' && <FileCode className="w-3.5 h-3.5" />}
                    {fmt === 'urdf' && <Layers className="w-3.5 h-3.5" />}
                    {fmt === 'xacro' && <Braces className="w-3.5 h-3.5" />}
                    {fmt === 'sdf' && <Layers className="w-3.5 h-3.5" />}
                    {fmt === 'usd' && <Package className="w-3.5 h-3.5" />}
                    <span className="min-w-0 whitespace-nowrap leading-none">
                      {formatLabel[fmt]}
                    </span>
                    {isDisabled && (
                      <span className="absolute -top-1.5 -right-1 bg-element-hover text-text-tertiary text-[8px] px-1 py-0.5 rounded border border-border-black flex items-center gap-0.5">
                        <Lock className="w-2 h-2" />
                        {t.exportComingSoon}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Compatible simulators */}
            <div className="flex flex-wrap gap-1 pt-1 pb-0.5">
              {(config.format === 'mjcf'
                ? MJCF_SUPPORTS
                : config.format === 'urdf'
                  ? URDF_SUPPORTS
                  : config.format === 'xacro'
                    ? XACRO_SUPPORTS
                    : config.format === 'sdf'
                      ? SDF_SUPPORTS
                      : USD_SUPPORTS
              ).map((name) => (
                <span
                  key={name}
                  className="px-2 py-0.5 bg-element-bg border border-border-black rounded-full text-[10px] text-text-tertiary"
                >
                  {name}
                </span>
              ))}
            </div>

            {/* Divider */}
            <div className="h-px bg-border-black my-3" />

            {/* MJCF Options */}
            {config.format === 'mjcf' && (
              <>
                <SectionLabel>{t.exportOptionsSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row label={t.exportMeshdir} stacked={isStackedLayout}>
                    <TextField
                      value={config.mjcf.meshdir}
                      onChange={(v) => updateMjcf('meshdir', v)}
                      placeholder="meshes/"
                      fullWidth={isStackedLayout}
                    />
                  </Row>
                  <Row
                    label={t.exportFloatBase}
                    desc={t.exportFloatBaseDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.mjcf.addFloatBase}
                      onChange={(v) => updateMjcf('addFloatBase', v)}
                    />
                  </Row>
                  <Row
                    label={t.exportPreferSharedMeshReuse}
                    desc={t.exportPreferSharedMeshReuseDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.mjcf.preferSharedMeshReuse}
                      onChange={(v) => updateMjcf('preferSharedMeshReuse', v)}
                    />
                  </Row>
                  <Row label={t.exportIncludeActuators} stacked={isStackedLayout}>
                    <Toggle
                      value={config.mjcf.includeActuators}
                      onChange={(v) => updateMjcf('includeActuators', v)}
                    />
                  </Row>
                  {config.mjcf.includeActuators && (
                    <Row label={t.exportActuatorType} stacked={isStackedLayout}>
                      <SelectField
                        value={config.mjcf.actuatorType}
                        options={actuatorTypeOptions}
                        onChange={(v) => updateMjcf('actuatorType', v as MjcfActuatorType)}
                        fullWidth={isStackedLayout}
                      />
                    </Row>
                  )}
                </div>

                <SectionLabel>{t.exportOutputSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeSkeleton}
                    desc={t.exportIncludeSkeletonDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle value={config.includeSkeleton} onChange={updateIncludeSkeleton} />
                  </Row>
                  <Row label={t.exportIncludeMeshes} stacked={isStackedLayout}>
                    <Toggle
                      value={config.mjcf.includeMeshes}
                      onChange={(v) => updateMjcf('includeMeshes', v)}
                    />
                  </Row>
                  {config.mjcf.includeMeshes && (
                    <STLQualitySelector
                      compressSTL={config.mjcf.compressSTL}
                      stlQuality={config.mjcf.stlQuality}
                      mode={qualityModes.mjcf}
                      t={t}
                      onCompressChange={(v) => updateMjcf('compressSTL', v)}
                      onQualityChange={(v) => updateMjcf('stlQuality', v)}
                      onModeChange={(mode) => updateQualityMode('mjcf', mode)}
                    />
                  )}
                </div>
              </>
            )}

            {/* URDF Options */}
            {config.format === 'urdf' && (
              <>
                <SectionLabel>{t.exportOptionsSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeExtended}
                    desc={t.exportIncludeExtendedDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.urdf.includeExtended}
                      onChange={(v) => updateUrdf('includeExtended', v)}
                    />
                  </Row>
                  <Row
                    label={t.exportIncludeBOM}
                    desc={t.exportIncludeBOMDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.urdf.includeBOM}
                      onChange={(v) => updateUrdf('includeBOM', v)}
                    />
                  </Row>
                  <Row
                    label={t.exportRelativePaths}
                    desc={t.exportRelativePathsDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.urdf.useRelativePaths}
                      onChange={(v) => updateUrdf('useRelativePaths', v)}
                    />
                  </Row>
                  {!config.urdf.includeExtended && (
                    <Row
                      label={t.exportPreferSourceVisualMeshes}
                      desc={t.exportPreferSourceVisualMeshesDesc}
                      stacked={isStackedLayout}
                    >
                      <Toggle
                        value={config.urdf.preferSourceVisualMeshes}
                        onChange={(v) => updateUrdf('preferSourceVisualMeshes', v)}
                      />
                    </Row>
                  )}
                </div>
                <SectionLabel>{t.exportOutputSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeSkeleton}
                    desc={t.exportIncludeSkeletonDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle value={config.includeSkeleton} onChange={updateIncludeSkeleton} />
                  </Row>
                  <Row label={t.exportIncludeMeshes} stacked={isStackedLayout}>
                    <Toggle
                      value={config.urdf.includeMeshes}
                      onChange={(v) => updateUrdf('includeMeshes', v)}
                    />
                  </Row>
                  {config.urdf.includeMeshes && (
                    <STLQualitySelector
                      compressSTL={config.urdf.compressSTL}
                      stlQuality={config.urdf.stlQuality}
                      mode={qualityModes.urdf}
                      t={t}
                      onCompressChange={(v) => updateUrdf('compressSTL', v)}
                      onQualityChange={(v) => updateUrdf('stlQuality', v)}
                      onModeChange={(mode) => updateQualityMode('urdf', mode)}
                    />
                  )}
                </div>
              </>
            )}

            {/* Xacro Options */}
            {config.format === 'xacro' && (
              <>
                <SectionLabel>{t.exportOptionsSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.rosVersion}
                    hint={`${t.exportXacroStaticHint} ${config.xacro.rosVersion === 'ros1' ? t.rosProfileDescRos1 : t.rosProfileDescRos2}`}
                    stacked={isCompactLayout}
                  >
                    <div
                      data-xacro-profile-picker
                      className={`grid gap-1.5 rounded-xl border border-border-black bg-segmented-bg p-1.5 ${
                        isCompactLayout ? 'grid-cols-1 w-full' : 'min-w-[220px] grid-cols-2'
                      }`}
                    >
                      {(['ros1', 'ros2'] as RosVersion[]).map((v) => {
                        const isActive = config.xacro.rosVersion === v;
                        const label = v === 'ros1' ? t.rosProfileRos1 : t.rosProfileRos2;
                        const description =
                          v === 'ros1' ? t.rosProfileDescRos1 : t.rosProfileDescRos2;

                        return (
                          <button
                            key={v}
                            type="button"
                            onClick={() => updateXacro('rosVersion', v)}
                            title={description}
                            aria-label={`${label}. ${description}`}
                            aria-pressed={isActive}
                            className={`flex min-h-[2.5rem] items-center rounded-lg border px-2.5 py-2 text-left text-[10px] font-semibold leading-tight whitespace-normal transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
                              isActive
                                ? 'border-system-blue/30 bg-system-blue/10 text-system-blue shadow-sm'
                                : 'border-transparent text-text-secondary hover:border-system-blue/20 hover:bg-element-hover hover:text-text-primary'
                            }`}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </Row>
                  <Row
                    label={t.hardwareInterface}
                    hint={
                      config.xacro.rosVersion === 'ros1'
                        ? t.hardwareInterfaceDescRos1
                        : t.hardwareInterfaceDescRos2
                    }
                    stacked={isStackedLayout}
                  >
                    <SelectField
                      value={config.xacro.rosHardwareInterface}
                      title={
                        config.xacro.rosVersion === 'ros1'
                          ? t.hardwareInterfaceDescRos1
                          : t.hardwareInterfaceDescRos2
                      }
                      options={[
                        { value: 'effort', label: t.hardwareInterfaceEffort },
                        { value: 'position', label: t.hardwareInterfacePosition },
                        { value: 'velocity', label: t.hardwareInterfaceVelocity },
                      ]}
                      onChange={(v) => updateXacro('rosHardwareInterface', v as RosHwInterface)}
                      fullWidth={isStackedLayout}
                    />
                  </Row>
                  <Row
                    label={t.exportRelativePaths}
                    desc={t.exportRelativePathsDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle
                      value={config.xacro.useRelativePaths}
                      onChange={(v) => updateXacro('useRelativePaths', v)}
                    />
                  </Row>
                </div>
                <SectionLabel>{t.exportOutputSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeSkeleton}
                    desc={t.exportIncludeSkeletonDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle value={config.includeSkeleton} onChange={updateIncludeSkeleton} />
                  </Row>
                  <Row label={t.exportIncludeMeshes} stacked={isStackedLayout}>
                    <Toggle
                      value={config.xacro.includeMeshes}
                      onChange={(v) => updateXacro('includeMeshes', v)}
                    />
                  </Row>
                  {config.xacro.includeMeshes && (
                    <STLQualitySelector
                      compressSTL={config.xacro.compressSTL}
                      stlQuality={config.xacro.stlQuality}
                      mode={qualityModes.xacro}
                      t={t}
                      onCompressChange={(v) => updateXacro('compressSTL', v)}
                      onQualityChange={(v) => updateXacro('stlQuality', v)}
                      onModeChange={(mode) => updateQualityMode('xacro', mode)}
                    />
                  )}
                </div>
              </>
            )}

            {config.format === 'sdf' && (
              <>
                <SectionLabel>{t.exportOutputSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row
                    label={t.exportIncludeSkeleton}
                    desc={t.exportIncludeSkeletonDesc}
                    stacked={isStackedLayout}
                  >
                    <Toggle value={config.includeSkeleton} onChange={updateIncludeSkeleton} />
                  </Row>
                  <Row label={t.exportIncludeMeshes} stacked={isStackedLayout}>
                    <Toggle
                      value={config.sdf.includeMeshes}
                      onChange={(v) => updateSdf('includeMeshes', v)}
                    />
                  </Row>
                  {config.sdf.includeMeshes && (
                    <STLQualitySelector
                      compressSTL={config.sdf.compressSTL}
                      stlQuality={config.sdf.stlQuality}
                      mode={qualityModes.sdf}
                      t={t}
                      onCompressChange={(v) => updateSdf('compressSTL', v)}
                      onQualityChange={(v) => updateSdf('stlQuality', v)}
                      onModeChange={(mode) => updateQualityMode('sdf', mode)}
                    />
                  )}
                </div>
                <p className="mt-2 text-[11px] leading-5 text-text-tertiary">
                  {t.exportSdfTextureOverrideNotice}
                </p>
              </>
            )}

            {config.format === 'usd' && (
              <>
                <SectionLabel>{t.exportOptionsSection}</SectionLabel>
                <div className="bg-element-bg rounded-xl border border-border-black px-3 divide-y divide-border-black">
                  <Row label={t.exportUsdFileFormat} stacked={isStackedLayout}>
                    <div data-usd-file-format-picker className={isStackedLayout ? 'w-full' : ''}>
                      <SegmentedChoiceField
                        value={config.usd.fileFormat}
                        options={[
                          { value: 'usd', label: t.exportUsdFileFormatUsd },
                          { value: 'usda', label: t.exportUsdFileFormatUsda },
                        ]}
                        onChange={(value) => updateUsd('fileFormat', value)}
                      />
                    </div>
                  </Row>
                  <STLQualitySelector
                    compressSTL={config.usd.compressMeshes}
                    stlQuality={config.usd.meshQuality}
                    mode={qualityModes.usd}
                    t={t}
                    label={t.exportCompressMeshes}
                    description={null}
                    onCompressChange={(v) => updateUsd('compressMeshes', v)}
                    onQualityChange={(v) => updateUsd('meshQuality', v)}
                    onModeChange={(mode) => updateQualityMode('usd', mode)}
                  />
                </div>
              </>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-border-black bg-element-bg">
          <div
            className={`flex gap-3 ${isCompactLayout ? 'flex-col items-stretch' : 'items-center'}`}
          >
            {isExporting ? (
              <div className="flex min-w-0 items-center gap-2 text-[11px] text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-system-blue" />
                <span className="truncate">
                  {t.exportProgressStepCounter
                    .replace('{current}', String(progressState.currentStep))
                    .replace('{total}', String(progressState.totalSteps))}
                </span>
              </div>
            ) : (
              <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-tertiary">
                {config.format === 'mjcf' ? (
                  <FileCode className="w-4 h-4" />
                ) : config.format === 'xacro' ? (
                  <Braces className="w-4 h-4" />
                ) : config.format === 'sdf' ? (
                  <Layers className="w-4 h-4" />
                ) : config.format === 'usd' ? (
                  <Package className="w-4 h-4" />
                ) : (
                  <Layers className="w-4 h-4" />
                )}
                <span className="font-mono break-all">
                  {config.format === 'usd'
                    ? `${formatExt} layered package → .zip`
                    : `${formatExt} + meshes → .zip`}
                </span>
              </div>
            )}
            {!isCompactLayout && <div className="flex-1" />}
            <button
              onClick={handleExportClick}
              disabled={isExporting}
              className={`flex items-center justify-center gap-2 rounded-lg bg-system-blue-solid px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-system-blue disabled:cursor-not-allowed disabled:opacity-50 ${
                isCompactLayout ? 'w-full' : ''
              }`}
            >
              {isExporting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Upload className="w-3.5 h-3.5" />
              )}
              {isExporting ? t.exporting : t.exportDoExport}
            </button>
          </div>
        </div>
      </DraggableWindow>
    </>
  );
};
