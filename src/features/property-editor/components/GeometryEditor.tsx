/**
 * GeometryEditor - Visual/Collision geometry editing for a Link.
 * Handles geometry type selection, dimension editing, mesh selection,
 * origin/rotation, color, and auto-align.
 */
import React, { useState, useRef, useMemo, useEffect, useCallback } from 'react';
import { Upload, File, Wand, Check, Trash2, Eye } from 'lucide-react';
import type { RobotState, UrdfLink, UrdfVisual } from '@/types';
import { GeometryType } from '@/types';
import { translations } from '@/shared/i18n';
import { useCollisionTransformStore, useSelectionStore } from '@/store';
import type { Language } from '@/store';
import {
  canEditGeometryBaseTexture,
  getVisualGeometryEntries,
  getVisualGeometryByObjectIndex,
  resolveVisualMaterialOverride,
  updateVisualBaseTextureByObjectIndex,
  updateVisualGeometryByObjectIndex,
  getCollisionGeometryByObjectIndex,
  removeCollisionGeometryByObjectIndex,
  updateCollisionGeometryByObjectIndex,
} from '@/core/robot';
import {
  InputGroup,
  InlineInputGroup,
  NumberInput,
  PROPERTY_EDITOR_FIELD_LABEL_CLASS,
  PROPERTY_EDITOR_HELPER_TEXT_CLASS,
  PROPERTY_EDITOR_INPUT_CLASS,
  PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS,
  PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS,
  PROPERTY_EDITOR_PRIMARY_BUTTON_CLASS,
  PropertyEditorSelect,
  ReadonlyValueField,
  PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS,
  PROPERTY_EDITOR_SECTION_TITLE_CLASS,
} from './FormControls';

import { MeshPreview } from './MeshPreview';
import { computeAutoAlign, convertGeometryType } from '../utils/geometryConversion';
import { getColorPickerHexValue, mergeColorPickerHexValue } from '../utils/colorInput';
import type {
  MeshAnalysis,
  MeshAnalysisOptions,
  MeshClearanceObstacle,
} from '../utils/geometryConversion';
import { analyzeMeshBatchWithWorker } from '../utils/meshAnalysisWorkerBridge';
import {
  GEOMETRY_DIMENSION_STEP,
  MAX_GEOMETRY_DIMENSION_DECIMALS,
} from '@/core/utils/numberPrecision';
import {
  buildColladaRootNormalizationHints,
  shouldNormalizeColladaGeometry,
} from '@/core/loaders/colladaRootNormalization';
import { cleanFilePath } from '@/core/loaders';
import { TransformFields } from './TransformFields';
import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';

const GEOMETRY_EDITOR_MESH_ANALYSIS_OPTIONS = {
  includePrimitiveFits: true,
  includeSurfacePoints: false,
  pointCollectionLimit: 2048,
} satisfies MeshAnalysisOptions;

const GEOMETRY_EDITOR_COMPACT_ACTIONS_WIDTH = 360;
const GEOMETRY_EDITOR_RELAXED_OVERLAP_ALLOWANCE_RATIO = 0.12;
const GEOMETRY_EDITOR_RELAXED_FIT_VOLUME_WINDOW_RATIO = 1.75;
const EDITABLE_GEOMETRY_TYPES: GeometryType[] = [
  GeometryType.BOX,
  GeometryType.CYLINDER,
  GeometryType.SPHERE,
  GeometryType.ELLIPSOID,
  GeometryType.CAPSULE,
  GeometryType.MESH,
];
const MJCF_SPECIAL_GEOMETRY_TYPES = new Set<GeometryType>([
  GeometryType.PLANE,
  GeometryType.HFIELD,
  GeometryType.SDF,
]);
const COLLISION_VISUAL_MESH_REFERENCE_TYPES = new Set<GeometryType>([
  GeometryType.BOX,
  GeometryType.CYLINDER,
  GeometryType.ELLIPSOID,
  GeometryType.CAPSULE,
]);
const APPROXIMATE_VISUAL_REFERENCE_STEM_SUFFIX_PATTERN =
  /(?:[_\-.](?:visual|collision|collider|mesh|model|col|vis))+$/i;

async function yieldToNextFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }

    setTimeout(resolve, 0);
  });
}

function getOriginDistanceSquared(
  left: UrdfVisual['origin'] | undefined,
  right: UrdfVisual['origin'] | undefined,
): number {
  const leftX = left?.xyz?.x ?? 0;
  const leftY = left?.xyz?.y ?? 0;
  const leftZ = left?.xyz?.z ?? 0;
  const rightX = right?.xyz?.x ?? 0;
  const rightY = right?.xyz?.y ?? 0;
  const rightZ = right?.xyz?.z ?? 0;
  const dx = leftX - rightX;
  const dy = leftY - rightY;
  const dz = leftZ - rightZ;
  return dx * dx + dy * dy + dz * dz;
}

function normalizeMeshReferenceStem(meshPath: string | undefined): string | null {
  const normalizedPath = cleanFilePath((meshPath ?? '').trim());
  if (!normalizedPath) {
    return null;
  }

  const filename = normalizedPath.split('/').pop() ?? normalizedPath;
  const lastDotIndex = filename.lastIndexOf('.');
  const stem = (lastDotIndex >= 0 ? filename.slice(0, lastDotIndex) : filename).toLowerCase();
  if (!stem) {
    return null;
  }

  let simplifiedStem = stem;
  let previousStem = '';
  while (simplifiedStem && simplifiedStem !== previousStem) {
    previousStem = simplifiedStem;
    simplifiedStem = simplifiedStem.replace(APPROXIMATE_VISUAL_REFERENCE_STEM_SUFFIX_PATTERN, '');
  }

  return simplifiedStem || stem;
}

function resolveCollisionVisualMeshReference(
  link: UrdfLink,
  collisionObjectIndex: number,
  collisionGeometry: UrdfVisual,
): UrdfVisual | null {
  const meshEntries = getVisualGeometryEntries(link).filter(
    (entry) => entry.geometry.type === GeometryType.MESH && Boolean(entry.geometry.meshPath),
  );

  if (meshEntries.length === 0) {
    return null;
  }

  const collisionMeshStem = normalizeMeshReferenceStem(collisionGeometry.meshPath);

  const nearestEntry = meshEntries.reduce((bestEntry, entry) => {
    if (!bestEntry) {
      return entry;
    }

    const entryMeshStem = normalizeMeshReferenceStem(entry.geometry.meshPath);
    const bestMeshStem = normalizeMeshReferenceStem(bestEntry.geometry.meshPath);
    const entryStemMatched = Boolean(
      collisionMeshStem && entryMeshStem && collisionMeshStem === entryMeshStem,
    );
    const bestStemMatched = Boolean(
      collisionMeshStem && bestMeshStem && collisionMeshStem === bestMeshStem,
    );

    if (entryStemMatched !== bestStemMatched) {
      return entryStemMatched ? entry : bestEntry;
    }

    const entrySameIndex = entry.objectIndex === collisionObjectIndex;
    const bestSameIndex = bestEntry.objectIndex === collisionObjectIndex;
    if (entrySameIndex !== bestSameIndex) {
      return entrySameIndex ? entry : bestEntry;
    }

    const bestDistance = getOriginDistanceSquared(
      bestEntry.geometry.origin,
      collisionGeometry.origin,
    );
    const nextDistance = getOriginDistanceSquared(entry.geometry.origin, collisionGeometry.origin);

    if (nextDistance < bestDistance - 1e-8) {
      return entry;
    }

    if (
      Math.abs(nextDistance - bestDistance) <= 1e-8 &&
      entry.objectIndex < bestEntry.objectIndex
    ) {
      return entry;
    }

    return bestEntry;
  }, meshEntries[0] ?? null);

  return nearestEntry?.geometry ?? null;
}

interface GeometryEditorProps {
  data: UrdfLink;
  robot: RobotState;
  category: 'visual' | 'collision';
  onUpdate: (d: UrdfLink) => void;
  assets: Record<string, string>;
  onUploadAsset: (file: File) => void;
  t: (typeof translations)['en'];
  lang: Language;
  isTabbed?: boolean;
  showCollisionDeleteAction?: boolean;
  sourceFilePath?: string;
  onLinkNameChange?: (name: string) => void;
}

interface DimensionInputField {
  label: string;
  max?: number;
  min?: number;
  onChange: (value: number) => void;
  value: number;
}

interface DeferredColorPickerInputProps {
  ariaLabel: string;
  className?: string;
  onCommit: (value: string) => void;
  value: string;
}

const DeferredColorPickerInput = ({
  ariaLabel,
  className,
  onCommit,
  value,
}: DeferredColorPickerInputProps) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draftValue, setDraftValue] = useState(value);
  const draftValueRef = useRef(value);
  const committedValueRef = useRef(value);
  const onCommitRef = useRef(onCommit);

  useEffect(() => {
    onCommitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    draftValueRef.current = value;
    committedValueRef.current = value;
    setDraftValue(value);
  }, [value]);

  const setDraft = useCallback((nextValue: string) => {
    draftValueRef.current = nextValue;
    setDraftValue((currentValue) => (currentValue === nextValue ? currentValue : nextValue));
  }, []);

  const commitDraft = useCallback(() => {
    const nextValue = draftValueRef.current;
    if (nextValue === committedValueRef.current) {
      return;
    }

    committedValueRef.current = nextValue;
    onCommitRef.current(nextValue);
  }, []);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) {
      return;
    }

    const handleNativeChange = () => {
      setDraft(input.value);
      commitDraft();
    };

    input.addEventListener('change', handleNativeChange);
    return () => {
      input.removeEventListener('change', handleNativeChange);
    };
  }, [commitDraft, setDraft]);

  return (
    <input
      ref={inputRef}
      type="color"
      value={draftValue}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onPointerUp={commitDraft}
      onMouseUp={commitDraft}
      onBlur={commitDraft}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commitDraft();
        }
      }}
      aria-label={ariaLabel}
      className={className}
    />
  );
};

const POSITIVE_GEOMETRY_VALUE_MIN = GEOMETRY_DIMENSION_STEP;
const stripAxisSuffix = (label: string) => label.replace(/\s*\([^)]*\)\s*$/, '');

const InlineDimensionInputRow = ({
  fields,
  columns = 3,
  labelClassName = PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS,
  labelWidthClassName = 'w-2 text-center',
  showStepper = true,
}: {
  fields: DimensionInputField[];
  columns?: 1 | 2 | 3;
  labelClassName?: string;
  labelWidthClassName?: string;
  showStepper?: boolean;
}) => (
  <div
    className={`min-w-0 ${
      columns === 1
        ? 'grid grid-cols-1 gap-1.5'
        : columns === 2
          ? 'grid grid-cols-2 gap-1.5'
          : 'grid grid-cols-3 gap-1.5'
    }`}
  >
    {fields.map((field) => (
      <div key={field.label} className="flex min-w-0 items-center gap-1.5">
        <span
          className={`${labelClassName} ${labelWidthClassName} min-w-0 shrink truncate`}
          title={field.label}
        >
          {field.label}
        </span>
        <div className="min-w-0 flex-1">
          <NumberInput
            value={field.value}
            onChange={field.onChange}
            min={field.min}
            max={field.max}
            compact
            showStepper={showStepper}
            step={GEOMETRY_DIMENSION_STEP}
            precision={MAX_GEOMETRY_DIMENSION_DECIMALS}
          />
        </div>
      </div>
    ))}
  </div>
);

export const GeometryEditor: React.FC<GeometryEditorProps> = ({
  data,
  robot,
  category,
  onUpdate,
  assets,
  onUploadAsset,
  t,
  lang,
  isTabbed = false,
  showCollisionDeleteAction = true,
  sourceFilePath,
  onLinkNameChange,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textureFileInputRef = useRef<HTMLInputElement>(null);
  const [previewMeshPath, setPreviewMeshPath] = useState<string | null>(null);
  const [previewTexturePath, setPreviewTexturePath] = useState<string | null>(null);
  const geometryHeaderRowRef = useRef<HTMLDivElement>(null);
  const meshAnalysisRef = useRef<MeshAnalysis | null>(null);
  const meshAnalysisKeyRef = useRef<string | null>(null);
  const meshAnalysisCacheRef = useRef<Record<string, MeshAnalysis | null>>({});
  const meshAnalysisPromiseCacheRef = useRef<Record<string, Promise<MeshAnalysis | null>>>({});
  const typeChangeRequestRef = useRef(0);
  const [geometryHeaderRowWidth, setGeometryHeaderRowWidth] = useState<number | null>(null);
  const setSelection = useSelectionStore((state) => state.setSelection);
  const pendingCollisionTransform = useCollisionTransformStore(
    (state) => state.pendingCollisionTransform,
  );

  const selectedCollisionObjectIndex =
    category === 'collision' &&
    robot.selection.type === 'link' &&
    robot.selection.id === data.id &&
    robot.selection.subType === 'collision'
      ? (robot.selection.objectIndex ?? 0)
      : 0;
  const selectedVisualObjectIndex =
    category === 'visual' &&
    robot.selection.type === 'link' &&
    robot.selection.id === data.id &&
    robot.selection.subType === 'visual'
      ? (robot.selection.objectIndex ?? 0)
      : 0;
  const selectedCollisionGeometry =
    category === 'collision'
      ? getCollisionGeometryByObjectIndex(data, selectedCollisionObjectIndex)
      : null;
  const selectedVisualGeometry =
    category === 'visual' ? getVisualGeometryByObjectIndex(data, selectedVisualObjectIndex) : null;
  const geomData =
    category === 'collision'
      ? selectedCollisionGeometry?.geometry || data.collision
      : selectedVisualGeometry?.geometry || data.visual;
  const colladaRootNormalizationHints = useMemo(
    () => buildColladaRootNormalizationHints(robot.links),
    [robot.links],
  );
  const meshFiles = useMemo(
    () =>
      Object.keys(assets)
        .filter((filePath) => /\.(stl|obj|dae|gltf|glb)$/i.test(filePath))
        .sort((left, right) => left.localeCompare(right)),
    [assets],
  );
  const textureFiles = useMemo(
    () =>
      Object.keys(assets)
        .filter((filePath) => /\.(png|jpe?g|webp)$/i.test(filePath))
        .sort((left, right) => left.localeCompare(right)),
    [assets],
  );

  const isCompactGeometryActions =
    geometryHeaderRowWidth !== null &&
    geometryHeaderRowWidth < GEOMETRY_EDITOR_COMPACT_ACTIONS_WIDTH;
  const materialSourceLabel =
    geomData.materialSource === 'inline'
      ? t.materialSourceInline
      : geomData.materialSource === 'named'
        ? t.materialSourceNamed
        : geomData.materialSource === 'gazebo'
          ? t.materialSourceGazebo
          : null;
  const currentGeometryType = geomData.type || GeometryType.CYLINDER;
  const geometryNameValue = geomData.name?.trim() ?? '';
  const geometryTypeOptions =
    EDITABLE_GEOMETRY_TYPES.includes(currentGeometryType) ||
    currentGeometryType === GeometryType.NONE
      ? [...EDITABLE_GEOMETRY_TYPES, GeometryType.NONE]
      : [...EDITABLE_GEOMETRY_TYPES, currentGeometryType, GeometryType.NONE];
  const geometryAssetReference = geomData.assetRef?.trim() || geomData.meshPath?.trim() || '';
  const hfieldAssetMetadata =
    geomData.type === GeometryType.HFIELD ? geomData.mjcfHfield : undefined;
  const geometrySnapshotCacheRef = useRef<
    Record<
      string,
      Partial<
        Record<
          GeometryType,
          {
            dimensions?: { x: number; y: number; z: number };
            origin?: {
              xyz: { x: number; y: number; z: number };
              rpy: { r: number; p: number; y: number };
            };
            meshPath?: string;
            assetRef?: string;
            mjcfHfield?: typeof geomData.mjcfHfield;
            color?: string;
          }
        >
      >
    >
  >({});
  const snapshotKey =
    category === 'collision'
      ? `${data.id}:${category}:${selectedCollisionGeometry?.bodyIndex ?? 'primary'}`
      : `${data.id}:${category}:${selectedVisualGeometry?.bodyIndex ?? 'primary'}`;

  const createSnapshot = (source: typeof geomData) => ({
    dimensions: source?.dimensions
      ? {
          x: source.dimensions.x,
          y: source.dimensions.y,
          z: source.dimensions.z,
        }
      : undefined,
    origin: source?.origin
      ? {
          xyz: {
            x: source.origin.xyz.x,
            y: source.origin.xyz.y,
            z: source.origin.xyz.z,
          },
          rpy: {
            r: source.origin.rpy.r,
            p: source.origin.rpy.p,
            y: source.origin.rpy.y,
          },
        }
      : undefined,
    meshPath: source?.meshPath,
    assetRef: source?.assetRef,
    mjcfHfield: source?.mjcfHfield
      ? {
          ...source.mjcfHfield,
          size: source.mjcfHfield.size ? { ...source.mjcfHfield.size } : undefined,
          elevation: source.mjcfHfield.elevation ? [...source.mjcfHfield.elevation] : undefined,
        }
      : undefined,
    color: source?.color,
  });

  const normalizeColor = (value?: string) => value?.trim().toLowerCase();
  const authoredMaterialColors = useMemo(() => {
    const uniqueColors: string[] = [];
    const seenColors = new Set<string>();

    for (const material of geomData.authoredMaterials ?? []) {
      const rawColor = material.color?.trim();
      const normalizedColor = normalizeColor(rawColor);

      if (!rawColor || !normalizedColor || seenColors.has(normalizedColor)) {
        continue;
      }

      seenColors.add(normalizedColor);
      uniqueColors.push(rawColor);
    }

    return uniqueColors;
  }, [geomData.authoredMaterials]);
  const hasReadonlyAuthoredMaterialDisplay =
    category === 'visual' &&
    geomData.type === GeometryType.MESH &&
    !geomData.color &&
    authoredMaterialColors.length > 0;
  const authoredMaterialDisplayLabel = hasReadonlyAuthoredMaterialDisplay
    ? authoredMaterialColors.length === 1
      ? authoredMaterialColors[0]
      : `${t.multipleMaterials} (${geomData.authoredMaterials?.length ?? authoredMaterialColors.length})`
    : null;
  const isPrimaryVisualSelection =
    category === 'visual'
      ? selectedVisualGeometry
        ? selectedVisualGeometry.bodyIndex === null
        : selectedVisualObjectIndex === 0
      : false;
  const resolvedVisualMaterial =
    category === 'visual'
      ? resolveVisualMaterialOverride(robot, data, geomData, {
          isPrimaryVisual: isPrimaryVisualSelection,
        })
      : null;
  const effectiveTexturePath =
    category === 'visual' ? resolvedVisualMaterial?.texture?.trim() || '' : '';
  const displayedTexturePath = previewTexturePath || effectiveTexturePath;
  const displayedTextureAssetUrl = displayedTexturePath ? assets[displayedTexturePath] : null;
  const isTextureReadonly = category === 'visual' && !canEditGeometryBaseTexture(geomData);
  const effectiveColorValue =
    category === 'visual'
      ? resolvedVisualMaterial?.color?.trim() || geomData.color || '#ffffff'
      : geomData.color || '#ffffff';
  const describeMeshPath = (filePath: string) => {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const pathSegments = normalizedPath.split('/');
    const fileName = pathSegments[pathSegments.length - 1] || normalizedPath;
    const parentPath = pathSegments.slice(0, -1).join('/');

    return {
      fileName,
      parentPath,
    };
  };
  const displayedOrigin = useMemo(() => {
    if (category !== 'collision' || !pendingCollisionTransform) {
      return geomData.origin;
    }

    if (pendingCollisionTransform.linkId !== data.id) {
      return geomData.origin;
    }

    if ((pendingCollisionTransform.objectIndex ?? 0) !== selectedCollisionObjectIndex) {
      return geomData.origin;
    }

    return {
      xyz: pendingCollisionTransform.position,
      rpy: pendingCollisionTransform.rotation,
    };
  }, [category, data.id, geomData.origin, pendingCollisionTransform, selectedCollisionObjectIndex]);

  const createMeshAnalysisKey = (geometry: Pick<UrdfVisual, 'meshPath' | 'dimensions'>) =>
    [
      geometry.meshPath ?? '',
      geometry.dimensions?.x ?? 1,
      geometry.dimensions?.y ?? 1,
      geometry.dimensions?.z ?? 1,
      sourceFilePath ?? '',
    ].join('::');

  const analyzeMeshGeometry = async (
    geometry: Pick<UrdfVisual, 'meshPath' | 'dimensions' | 'type'>,
    signal?: AbortSignal,
  ): Promise<MeshAnalysis | null> => {
    if (geometry.type !== GeometryType.MESH || !geometry.meshPath) {
      return null;
    }

    const analysisKey = createMeshAnalysisKey(geometry);
    const workerResults = await analyzeMeshBatchWithWorker({
      assets,
      tasks: [
        {
          targetId: analysisKey,
          cacheKey: analysisKey,
          meshPath: geometry.meshPath,
          dimensions: geometry.dimensions,
          sourceFilePath,
        },
      ],
      options: GEOMETRY_EDITOR_MESH_ANALYSIS_OPTIONS,
      signal,
    });

    return workerResults[analysisKey] ?? null;
  };

  const update = (newData: Partial<typeof geomData>) => {
    if (category === 'collision') {
      if (selectedCollisionGeometry) {
        onUpdate(updateCollisionGeometryByObjectIndex(data, selectedCollisionObjectIndex, newData));
        return;
      }

      onUpdate({
        ...data,
        collision: {
          ...data.collision,
          ...newData,
        },
      });
      return;
    }

    if (selectedVisualGeometry) {
      onUpdate(updateVisualGeometryByObjectIndex(data, selectedVisualObjectIndex, newData));
      return;
    }

    onUpdate({
      ...data,
      visual: {
        ...data.visual,
        ...newData,
      },
    });
  };

  useEffect(() => {
    const node = geometryHeaderRowRef.current;

    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.round(node.getBoundingClientRect().width);
      setGeometryHeaderRowWidth((previousWidth) =>
        previousWidth === nextWidth ? previousWidth : nextWidth,
      );
    };

    updateWidth();

    const observer = new ResizeObserver(() => {
      updateWidth();
    });

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const currentType = geomData.type || GeometryType.CYLINDER;
    if (!geometrySnapshotCacheRef.current[snapshotKey]) {
      geometrySnapshotCacheRef.current[snapshotKey] = {};
    }
    geometrySnapshotCacheRef.current[snapshotKey][currentType] = createSnapshot(geomData);
  }, [geomData, snapshotKey]);

  useEffect(() => {
    setPreviewTexturePath(null);
  }, [category, data.id, selectedVisualObjectIndex]);

  useEffect(() => {
    if (geomData.type !== GeometryType.MESH || !geomData.meshPath) {
      return;
    }
    const analysisKey = createMeshAnalysisKey(geomData);
    if (meshAnalysisKeyRef.current === analysisKey && meshAnalysisRef.current) {
      return;
    }
    if (meshAnalysisPromiseCacheRef.current[analysisKey]) {
      return;
    }
    meshAnalysisKeyRef.current = analysisKey;
    meshAnalysisRef.current = null;
    const controller = new AbortController();
    const analysisPromise = analyzeMeshGeometry(geomData, controller.signal);
    meshAnalysisPromiseCacheRef.current[analysisKey] = analysisPromise;
    void analysisPromise
      .then((analysis) => {
        if (meshAnalysisPromiseCacheRef.current[analysisKey] === analysisPromise) {
          delete meshAnalysisPromiseCacheRef.current[analysisKey];
        }
        if (!controller.signal.aborted) {
          meshAnalysisCacheRef.current[analysisKey] = analysis;
          meshAnalysisRef.current = analysis;
        }
      })
      .catch((error) => {
        if (meshAnalysisPromiseCacheRef.current[analysisKey] === analysisPromise) {
          delete meshAnalysisPromiseCacheRef.current[analysisKey];
        }
        if (!controller.signal.aborted) {
          scheduleFailFastInDev(
            'GeometryEditor:meshAnalysis',
            new Error(`Failed to analyze mesh geometry for ${geomData.meshPath}.`, {
              cause: error,
            }),
          );
        }
      });
    return () => {
      controller.abort();
    };
  }, [
    geomData.meshPath,
    geomData.type,
    geomData.dimensions?.x,
    geomData.dimensions?.y,
    geomData.dimensions?.z,
    assets,
    sourceFilePath,
  ]);

  const resolveMeshAnalysisForGeometry = async (
    geometry: UrdfVisual,
  ): Promise<MeshAnalysis | null> => {
    if (geometry.type !== GeometryType.MESH || !geometry.meshPath) {
      return null;
    }

    const analysisKey = createMeshAnalysisKey(geometry);
    if (analysisKey in meshAnalysisCacheRef.current) {
      return meshAnalysisCacheRef.current[analysisKey];
    }
    if (meshAnalysisKeyRef.current === analysisKey && meshAnalysisRef.current) {
      meshAnalysisCacheRef.current[analysisKey] = meshAnalysisRef.current;
      return meshAnalysisRef.current;
    }

    const pendingAnalysis = meshAnalysisPromiseCacheRef.current[analysisKey];
    if (pendingAnalysis) {
      const analysis = await pendingAnalysis;
      meshAnalysisCacheRef.current[analysisKey] = analysis;
      return analysis;
    }

    const analysisPromise = analyzeMeshGeometry(geometry);
    meshAnalysisPromiseCacheRef.current[analysisKey] = analysisPromise;
    try {
      const analysis = await analysisPromise;
      meshAnalysisCacheRef.current[analysisKey] = analysis;

      if (
        geometry.meshPath === geomData.meshPath &&
        analysisKey === createMeshAnalysisKey(geomData)
      ) {
        meshAnalysisKeyRef.current = analysisKey;
        meshAnalysisRef.current = analysis;
      }

      return analysis;
    } finally {
      if (meshAnalysisPromiseCacheRef.current[analysisKey] === analysisPromise) {
        delete meshAnalysisPromiseCacheRef.current[analysisKey];
      }
    }
  };

  const resolveCollisionClearanceContext = async (): Promise<{
    siblingGeometries?: UrdfVisual[];
    meshClearanceObstacles?: MeshClearanceObstacle[];
    overlapAllowanceRatio?: number;
    fitVolumeWindowRatio?: number;
  }> => {
    if (category !== 'collision') {
      return {};
    }

    return {
      overlapAllowanceRatio: GEOMETRY_EDITOR_RELAXED_OVERLAP_ALLOWANCE_RATIO,
      fitVolumeWindowRatio: GEOMETRY_EDITOR_RELAXED_FIT_VOLUME_WINDOW_RATIO,
    };
  };

  const handleApplyMesh = () => {
    if (previewMeshPath) {
      update({ meshPath: previewMeshPath });
      setPreviewMeshPath(null);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onUploadAsset(e.target.files[0]);
    }
  };

  const applyVisualTexture = (texturePath: string | null | undefined) => {
    if (category !== 'visual') {
      return;
    }

    if (resolvedVisualMaterial?.source === 'legacy-link' && isPrimaryVisualSelection) {
      const nextTexture = String(texturePath || '').trim() || undefined;
      const nextColor = resolvedVisualMaterial.color?.trim() || undefined;
      const nextAuthoredMaterials =
        nextColor || nextTexture
          ? [
              {
                ...(nextColor ? { color: nextColor } : {}),
                ...(nextTexture ? { texture: nextTexture } : {}),
              },
            ]
          : undefined;

      if (selectedVisualGeometry) {
        onUpdate(
          updateVisualGeometryByObjectIndex(data, selectedVisualObjectIndex, {
            authoredMaterials: nextAuthoredMaterials,
          }),
        );
        return;
      }

      onUpdate({
        ...data,
        visual: {
          ...data.visual,
          authoredMaterials: nextAuthoredMaterials,
        },
      });
      return;
    }

    onUpdate(updateVisualBaseTextureByObjectIndex(data, selectedVisualObjectIndex, texturePath));
  };

  const handleApplyTexture = () => {
    if (!previewTexturePath) {
      return;
    }

    if (previewTexturePath === effectiveTexturePath) {
      setPreviewTexturePath(null);
      return;
    }

    applyVisualTexture(previewTexturePath);
    setPreviewTexturePath(null);
  };

  const handleTextureFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) {
      return;
    }

    onUploadAsset(file);
    setPreviewTexturePath(file.name);
    e.target.value = '';
  };

  // Memoized auto-align calculation
  const autoAlignResult = useMemo(() => computeAutoAlign(robot, data.id), [robot.joints, data.id]);

  const handleAutoAlign = () => {
    if (!autoAlignResult) return;

    const currentDims = geomData.dimensions || { x: 0.05, y: 0.5, z: 0.05 };
    const newDims = { ...currentDims, y: autoAlignResult.dimensions.y };

    update({
      dimensions: newDims,
      origin: autoAlignResult.origin,
    });
  };

  const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newType = e.currentTarget.value as GeometryType;
    const currentType = geomData.type || GeometryType.CYLINDER;
    if (newType === currentType) return;

    if (!geometrySnapshotCacheRef.current[snapshotKey]) {
      geometrySnapshotCacheRef.current[snapshotKey] = {};
    }
    const cacheByType = geometrySnapshotCacheRef.current[snapshotKey];
    cacheByType[currentType] = createSnapshot(geomData);

    const cachedTarget = cacheByType[newType];
    const representativeMeshColor =
      currentType === GeometryType.MESH && newType !== GeometryType.MESH
        ? meshAnalysisRef.current?.representativeColor
        : undefined;
    if (cachedTarget) {
      const shouldUseRepresentativeMeshColor =
        Boolean(representativeMeshColor) &&
        newType !== GeometryType.MESH &&
        (!cachedTarget.color ||
          normalizeColor(cachedTarget.color) === normalizeColor(geomData.color));

      update({
        type: newType,
        dimensions: cachedTarget.dimensions || geomData.dimensions,
        origin: cachedTarget.origin || geomData.origin,
        meshPath: newType === GeometryType.MESH ? cachedTarget.meshPath : undefined,
        assetRef: MJCF_SPECIAL_GEOMETRY_TYPES.has(newType) ? cachedTarget.assetRef : undefined,
        mjcfHfield: newType === GeometryType.HFIELD ? cachedTarget.mjcfHfield : undefined,
        color: shouldUseRepresentativeMeshColor
          ? representativeMeshColor
          : cachedTarget.color || geomData.color,
      });
      return;
    }

    const requestId = ++typeChangeRequestRef.current;

    void (async () => {
      await yieldToNextFrame();

      let conversionSourceGeometry = geomData;
      let meshAnalysis: MeshAnalysis | undefined;

      if (
        category === 'collision' &&
        (COLLISION_VISUAL_MESH_REFERENCE_TYPES.has(newType) || newType === GeometryType.MESH)
      ) {
        const visualMeshReference = resolveCollisionVisualMeshReference(
          data,
          selectedCollisionObjectIndex,
          geomData,
        );

        if (visualMeshReference) {
          if (newType === GeometryType.MESH) {
            conversionSourceGeometry = visualMeshReference;
          } else {
            const referenceMeshAnalysis = await resolveMeshAnalysisForGeometry(visualMeshReference);
            if (referenceMeshAnalysis) {
              conversionSourceGeometry = visualMeshReference;
              meshAnalysis = referenceMeshAnalysis;
            }
          }
        }
      }

      if (!meshAnalysis && currentType === GeometryType.MESH) {
        meshAnalysis = (await resolveMeshAnalysisForGeometry(geomData)) ?? undefined;
      }
      const resolvedRepresentativeMeshColor =
        currentType === GeometryType.MESH && newType !== GeometryType.MESH
          ? meshAnalysis?.representativeColor
          : undefined;
      const clearanceContext =
        newType !== GeometryType.MESH ? await resolveCollisionClearanceContext() : undefined;

      if (typeChangeRequestRef.current !== requestId) {
        return;
      }

      const converted =
        newType === GeometryType.MESH && conversionSourceGeometry.type === GeometryType.MESH
          ? {
              type: GeometryType.MESH,
              dimensions: conversionSourceGeometry.dimensions ?? { x: 1, y: 1, z: 1 },
              origin: conversionSourceGeometry.origin ?? {
                xyz: { x: 0, y: 0, z: 0 },
                rpy: { r: 0, p: 0, y: 0 },
              },
            }
          : convertGeometryType(conversionSourceGeometry, newType, meshAnalysis, clearanceContext);
      const nextGeom = {
        ...converted,
        meshPath:
          newType === GeometryType.MESH
            ? conversionSourceGeometry.type === GeometryType.MESH
              ? conversionSourceGeometry.meshPath
              : geomData.meshPath
            : undefined,
        assetRef: MJCF_SPECIAL_GEOMETRY_TYPES.has(newType) ? geomData.assetRef : undefined,
        mjcfHfield: newType === GeometryType.HFIELD ? geomData.mjcfHfield : undefined,
        color:
          newType === GeometryType.MESH
            ? geomData.color
            : resolvedRepresentativeMeshColor || geomData.color,
      };

      cacheByType[newType] = createSnapshot(nextGeom);
      update(nextGeom);
    })();
  };

  const handleDeleteCollision = () => {
    if (category !== 'collision') return;

    if (!selectedCollisionGeometry) {
      if (data.collision.type === GeometryType.NONE) return;
      onUpdate({
        ...data,
        collision: {
          ...data.collision,
          type: GeometryType.NONE,
          meshPath: undefined,
        },
      });
      setSelection({ type: 'link', id: data.id });
      return;
    }

    const {
      link: nextLink,
      removed,
      nextObjectIndex,
    } = removeCollisionGeometryByObjectIndex(data, selectedCollisionObjectIndex);

    if (!removed) return;

    onUpdate(nextLink);
    if (nextObjectIndex === null) {
      setSelection({ type: 'link', id: data.id });
      return;
    }

    setSelection({
      type: 'link',
      id: data.id,
      subType: 'collision',
      objectIndex: nextObjectIndex,
    });
  };

  return (
    <div className={isTabbed ? 'pt-1' : 'border-t border-border-black pt-4'}>
      {!isTabbed && (
        <div className="mb-2.5">
          <h3 className={`${PROPERTY_EDITOR_SECTION_TITLE_CLASS} capitalize`}>
            {category === 'visual' ? t.visualGeometry : t.collisionGeometry}
          </h3>
        </div>
      )}

      <div ref={geometryHeaderRowRef} className="mb-1 flex min-w-0 items-center gap-1.5">
        {category === 'visual' && onLinkNameChange ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} min-w-0 shrink whitespace-nowrap`}
            >
              {t.name}
            </span>
            <input
              type="text"
              value={data.name ?? ''}
              onChange={(e) => onLinkNameChange(e.target.value)}
              className={`${PROPERTY_EDITOR_INPUT_CLASS} min-w-0 flex-1`}
              spellCheck={false}
            />
          </div>
        ) : category === 'collision' ? (
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <span
              className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} min-w-0 shrink whitespace-nowrap`}
            >
              {t.name}
            </span>
            <input
              type="text"
              value={geometryNameValue}
              onChange={(e) => {
                const nextName = e.target.value.trim();
                update({ name: nextName || undefined });
              }}
              className={`${PROPERTY_EDITOR_INPUT_CLASS} min-w-0 flex-1`}
              spellCheck={false}
            />
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span
            className={`${PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS} min-w-0 shrink whitespace-nowrap`}
          >
            {t.type}
          </span>
          <div
            className="min-w-0 flex-1"
            style={{
              height: 22,
              display: 'flex',
              alignItems: 'center',
              overflow: 'hidden',
              lineHeight: 0,
            }}
          >
            <PropertyEditorSelect
              value={currentGeometryType}
              aria-label={t.type}
              options={geometryTypeOptions.map((typeOption) => {
                const label =
                  typeOption === GeometryType.BOX
                    ? t.box
                    : typeOption === GeometryType.PLANE
                      ? t.plane
                      : typeOption === GeometryType.CYLINDER
                        ? t.cylinder
                        : typeOption === GeometryType.SPHERE
                          ? t.sphere
                          : typeOption === GeometryType.ELLIPSOID
                            ? t.ellipsoid
                            : typeOption === GeometryType.CAPSULE
                              ? t.capsule
                              : typeOption === GeometryType.HFIELD
                                ? t.hfield
                                : typeOption === GeometryType.SDF
                                  ? t.sdf
                                  : typeOption === GeometryType.MESH
                                    ? t.mesh
                                    : t.none;

                return {
                  value: typeOption,
                  label,
                };
              })}
              onChange={handleTypeChange}
              className="min-w-0 w-full"
            />
          </div>
        </div>
        {category === 'collision' &&
          geomData.type === GeometryType.CYLINDER &&
          !isCompactGeometryActions && (
            <button
              onClick={handleAutoAlign}
              className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border border-border-strong bg-element-bg text-text-tertiary transition-colors hover:bg-element-hover hover:text-text-primary"
              title={t.autoAlign}
            >
              <Wand className="h-3.5 w-3.5" />
            </button>
          )}
      </div>

      {/* Mesh Selection UI */}
      {geomData.type === GeometryType.MESH && (
        <div className="mb-2 overflow-hidden rounded-lg border border-border-black bg-panel-bg/70">
          <div className="flex items-center justify-between gap-2 border-b border-border-black/60 bg-element-bg/70 px-2 py-1.5">
            <div className="flex min-w-0 items-center gap-1.5">
              <span className={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}>{t.meshLibrary}</span>
              <span className="inline-flex min-w-4 items-center justify-center rounded-full border border-border-black bg-panel-bg px-1 py-0.5 text-[8px] font-semibold leading-none text-text-tertiary">
                {meshFiles.length}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept=".stl,.STL,.obj,.OBJ,.dae,.DAE,.gltf,.GLTF,.glb,.GLB"
                onChange={handleFileChange}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-6 items-center justify-center gap-1 rounded-md bg-system-blue-solid px-1.5 text-[10px] font-semibold text-white transition-colors hover:bg-system-blue-hover"
              >
                <Upload className="h-2.5 w-2.5" />
                {t.upload}
              </button>
            </div>
          </div>

          <div className="space-y-1 px-1.5 py-1.5">
            <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto custom-scrollbar pr-0.5">
              {meshFiles.length === 0 && (
                <div className="rounded-md border border-dashed border-border-black/70 bg-element-bg/70 px-2 py-3 text-center">
                  <div className={`${PROPERTY_EDITOR_HELPER_TEXT_CLASS} italic`}>
                    {t.meshNotFound}
                  </div>
                </div>
              )}
              {meshFiles.map((filePath) => {
                const isApplied = geomData.meshPath === filePath && !previewMeshPath;
                const isPreviewing = previewMeshPath === filePath;
                const { fileName, parentPath } = describeMeshPath(filePath);

                return (
                  <div
                    key={filePath}
                    title={filePath}
                    onClick={() => setPreviewMeshPath(filePath)}
                    onDoubleClick={() => {
                      update({ meshPath: filePath });
                      setPreviewMeshPath(null);
                    }}
                    className={`
                                            grid cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border px-1.5 py-1 transition-colors
                                            ${
                                              isApplied
                                                ? 'border-system-blue/35 bg-system-blue/10 text-system-blue dark:bg-system-blue/20'
                                                : isPreviewing
                                                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                                  : 'border-transparent bg-transparent text-text-secondary hover:border-border-black/50 hover:bg-element-hover'
                                            }
                                        `}
                  >
                    <File className="h-3 w-3 shrink-0" />
                    <div className="min-w-0">
                      <div
                        className={`truncate text-[10px] font-medium ${isApplied ? 'text-system-blue' : 'text-text-primary'}`}
                      >
                        {fileName}
                      </div>
                      {parentPath && (
                        <div className="truncate text-[9px] leading-4 text-text-tertiary">
                          {parentPath}
                        </div>
                      )}
                    </div>
                    {isApplied ? (
                      <Check className="h-3 w-3 shrink-0" />
                    ) : isPreviewing ? (
                      <Eye className="h-3 w-3 shrink-0" />
                    ) : null}
                  </div>
                );
              })}
            </div>

            {previewMeshPath && (
              <div className="flex flex-col gap-1 rounded-md border border-border-black/60 bg-element-bg/70 p-1">
                <MeshPreview
                  meshPath={previewMeshPath}
                  assets={assets}
                  normalizeColladaRoot={shouldNormalizeColladaGeometry(
                    previewMeshPath,
                    geomData.origin,
                    colladaRootNormalizationHints,
                  )}
                  notFoundText={t.meshNotFound}
                />
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleApplyMesh}
                    className={`${PROPERTY_EDITOR_PRIMARY_BUTTON_CLASS} flex-1`}
                  >
                    <Check className="h-2.5 w-2.5" />
                    {t.applyMesh}
                  </button>
                  <button
                    onClick={() => setPreviewMeshPath(null)}
                    className={`${PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS} flex-1`}
                  >
                    {t.cancel}
                  </button>
                </div>
              </div>
            )}

            {geomData.meshPath && !previewMeshPath && (
              <div className="rounded-md border border-system-blue/20 bg-system-blue/5 px-1.5 py-0.5">
                <div className={`${PROPERTY_EDITOR_HELPER_TEXT_CLASS} truncate`}>
                  {t.selected}:{' '}
                  <span className="font-medium text-system-blue">{geomData.meshPath}</span>
                </div>
              </div>
            )}

            {!previewMeshPath && meshFiles.length > 0 && (
              <div className={`${PROPERTY_EDITOR_HELPER_TEXT_CLASS} px-0.5`}>{t.meshHint}</div>
            )}
          </div>
        </div>
      )}

      {geomData.type === GeometryType.MESH && (
        <div className="mb-1">
          <label className={`${PROPERTY_EDITOR_FIELD_LABEL_CLASS} mb-0.5`}>{t.meshScale}</label>
          <InlineDimensionInputRow
            columns={3}
            showStepper={false}
            fields={[
              {
                label: 'X',
                value: geomData.dimensions?.x ?? 1,
                onChange: (v: number) => update({ dimensions: { ...geomData.dimensions, x: v } }),
              },
              {
                label: 'Y',
                value: geomData.dimensions?.y ?? 1,
                onChange: (v: number) => update({ dimensions: { ...geomData.dimensions, y: v } }),
              },
              {
                label: 'Z',
                value: geomData.dimensions?.z ?? 1,
                onChange: (v: number) => update({ dimensions: { ...geomData.dimensions, z: v } }),
              },
            ]}
          />
        </div>
      )}

      {/* Box dimensions: Width (X), Depth (Y), Height (Z) */}
      {geomData.type === GeometryType.BOX && (
        <InlineDimensionInputRow
          columns={3}
          fields={[
            {
              label: stripAxisSuffix(t.width || 'Width'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.x || 0.1,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, x: v } }),
            },
            {
              label: stripAxisSuffix(t.height || 'Height'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.z || 0.1,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, z: v } }),
            },
            {
              label: stripAxisSuffix(t.depth || 'Depth'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.y || 0.1,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, y: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {geomData.type === GeometryType.PLANE && (
        <InlineDimensionInputRow
          columns={2}
          fields={[
            {
              label: stripAxisSuffix(t.width || 'Width'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.x || 1,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, x: v } }),
            },
            {
              label: stripAxisSuffix(t.depth || 'Depth'),
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.y || 1,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, y: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {/* Sphere dimensions: Radius only */}
      {geomData.type === GeometryType.SPHERE && (
        <InlineDimensionInputRow
          columns={1}
          fields={[
            {
              label: t.radius || 'Radius',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.x || 0.1,
              onChange: (v) => update({ dimensions: { x: v, y: v, z: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {/* Ellipsoid dimensions: axis radii */}
      {geomData.type === GeometryType.ELLIPSOID && (
        <InlineDimensionInputRow
          columns={3}
          fields={[
            {
              label: t.radiusX || 'Radius X',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.x || 0.1,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, x: v } }),
            },
            {
              label: t.radiusY || 'Radius Y',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.y || geomData.dimensions?.x || 0.1,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, y: v } }),
            },
            {
              label: t.radiusZ || 'Radius Z',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.z || geomData.dimensions?.x || 0.1,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, z: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {/* Cylinder dimensions: Radius and Height */}
      {geomData.type === GeometryType.CYLINDER && (
        <InlineDimensionInputRow
          columns={2}
          fields={[
            {
              label: t.radius || 'Radius',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.x || 0.05,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, x: v, z: v } }),
            },
            {
              label: t.height || 'Height',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.y || 0.5,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, y: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {/* Capsule dimensions: Radius and Total Length */}
      {geomData.type === GeometryType.CAPSULE && (
        <InlineDimensionInputRow
          columns={2}
          fields={[
            {
              label: t.radius || 'Radius',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.x || 0.05,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, x: v, z: v } }),
            },
            {
              label: t.totalLength || 'Total Length',
              min: POSITIVE_GEOMETRY_VALUE_MIN,
              value: geomData.dimensions?.y || 0.5,
              onChange: (v) => update({ dimensions: { ...geomData.dimensions, y: v } }),
            },
          ]}
          labelClassName={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}
          labelWidthClassName="whitespace-nowrap"
        />
      )}

      {(geomData.type === GeometryType.HFIELD || geomData.type === GeometryType.SDF) && (
        <div className="space-y-2">
          {geometryAssetReference ? (
            <InlineInputGroup label={t.assetReference} labelWidthClassName="w-16">
              <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                {geometryAssetReference}
              </ReadonlyValueField>
            </InlineInputGroup>
          ) : null}
          {hfieldAssetMetadata?.file ? (
            <InlineInputGroup label={t.file} labelWidthClassName="w-16">
              <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                {hfieldAssetMetadata.file}
              </ReadonlyValueField>
            </InlineInputGroup>
          ) : null}
          {hfieldAssetMetadata?.contentType ? (
            <InlineInputGroup label={t.contentType} labelWidthClassName="w-16">
              <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                {hfieldAssetMetadata.contentType}
              </ReadonlyValueField>
            </InlineInputGroup>
          ) : null}
          {hfieldAssetMetadata?.size ? (
            <>
              <InlineInputGroup label={t.size} labelWidthClassName="w-16">
                <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                  <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                    {`${t.width}: ${hfieldAssetMetadata.size.radiusX * 2}`}
                  </ReadonlyValueField>
                  <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                    {`${t.depth}: ${hfieldAssetMetadata.size.radiusY * 2}`}
                  </ReadonlyValueField>
                  <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                    {`${t.height}: ${hfieldAssetMetadata.size.elevationZ}`}
                  </ReadonlyValueField>
                  <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                    {`${t.baseHeight}: ${hfieldAssetMetadata.size.baseZ}`}
                  </ReadonlyValueField>
                </div>
              </InlineInputGroup>
            </>
          ) : null}
          {Number.isFinite(hfieldAssetMetadata?.nrow) ||
          Number.isFinite(hfieldAssetMetadata?.ncol) ? (
            <InlineInputGroup label={t.size} labelWidthClassName="w-16">
              <div className="grid min-w-0 flex-1 grid-cols-2 gap-1.5">
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {`${t.rows}: ${hfieldAssetMetadata?.nrow ?? 0}`}
                </ReadonlyValueField>
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {`${t.cols}: ${hfieldAssetMetadata?.ncol ?? 0}`}
                </ReadonlyValueField>
              </div>
            </InlineInputGroup>
          ) : null}
          <div className={PROPERTY_EDITOR_HELPER_TEXT_CLASS}>{t.mjcfLimitedGeometryHint}</div>
        </div>
      )}

      {geomData.type !== GeometryType.NONE && (
        <InputGroup label={t.originRelativeLink}>
          <TransformFields
            lang={lang}
            positionValue={displayedOrigin?.xyz || { x: 0, y: 0, z: 0 }}
            rotationValue={displayedOrigin?.rpy || { r: 0, p: 0, y: 0 }}
            compact={false}
            rotationQuickStepDegrees={90}
            onPositionChange={(v) =>
              update({
                origin: {
                  ...(displayedOrigin || { rpy: { r: 0, p: 0, y: 0 } }),
                  xyz: v as { x: number; y: number; z: number },
                },
              })
            }
            onRotationChange={(rpy) =>
              update({
                origin: { ...(displayedOrigin || { xyz: { x: 0, y: 0, z: 0 } }), rpy },
              })
            }
          />
        </InputGroup>
      )}

      {category === 'visual' && geomData.type !== GeometryType.NONE && (
        <div className="mt-3 overflow-hidden rounded-lg border border-border-black bg-panel-bg/70">
          <div className="border-b border-border-black/60 bg-element-bg/70 px-2 py-1.5">
            <h4 className={PROPERTY_EDITOR_SECTION_TITLE_CLASS}>{t.material}</h4>
          </div>

          <div className="space-y-2 px-2 py-2">
            {materialSourceLabel ? (
              <InlineInputGroup label={t.materialSource} labelWidthClassName="w-16">
                <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                  {materialSourceLabel}
                </ReadonlyValueField>
              </InlineInputGroup>
            ) : null}

            <InlineInputGroup label={t.color} labelWidthClassName="whitespace-nowrap">
              {hasReadonlyAuthoredMaterialDisplay ? (
                <div className="space-y-1.5">
                  <ReadonlyValueField className="bg-element-bg text-[10px] font-medium">
                    {authoredMaterialDisplayLabel}
                  </ReadonlyValueField>
                  <div className="flex flex-wrap gap-1">
                    {authoredMaterialColors.map((color) => (
                      <div
                        key={normalizeColor(color) ?? color}
                        className="inline-flex items-center gap-1 rounded-md border border-border-black/70 bg-element-bg px-1.5 py-0.5 text-[9px] font-medium text-text-secondary"
                      >
                        <span
                          aria-hidden="true"
                          className="h-2.5 w-2.5 shrink-0 rounded-full border border-border-black/70"
                          style={{ backgroundColor: color }}
                        />
                        <span className="font-mono uppercase tracking-[0.04em] text-text-primary">
                          {color}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={effectiveColorValue}
                    onChange={(e) => update({ color: e.target.value })}
                    className={`${PROPERTY_EDITOR_INPUT_CLASS} flex-1 font-mono uppercase tracking-[0.04em]`}
                    spellCheck={false}
                  />
                  <span
                    className={`${PROPERTY_EDITOR_INLINE_AXIS_LABEL_CLASS} w-auto whitespace-nowrap`}
                  >
                    HEX
                  </span>
                  <DeferredColorPickerInput
                    value={getColorPickerHexValue(effectiveColorValue)}
                    onCommit={(nextColor) =>
                      update({
                        color: mergeColorPickerHexValue(nextColor, effectiveColorValue),
                      })
                    }
                    ariaLabel={t.color}
                    className="h-7 w-8 shrink-0 cursor-pointer rounded-md border border-border-strong bg-input-bg p-0.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-border-black)_28%,transparent)]"
                  />
                </div>
              )}
            </InlineInputGroup>

            <InlineInputGroup label={t.texture} labelWidthClassName="whitespace-nowrap">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <ReadonlyValueField className="min-w-0 flex-1 bg-element-bg text-[10px] font-medium">
                    <span className="block truncate">{displayedTexturePath || t.none}</span>
                  </ReadonlyValueField>
                  <input
                    type="file"
                    ref={textureFileInputRef}
                    className="hidden"
                    accept=".png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.webp,.WEBP"
                    onChange={handleTextureFileChange}
                  />
                  {!isTextureReadonly && (
                    <button
                      type="button"
                      onClick={() => textureFileInputRef.current?.click()}
                      className={`${PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS} shrink-0`}
                    >
                      <Upload className="h-3 w-3" />
                      <span>{t.uploadTexture}</span>
                    </button>
                  )}
                  {!isTextureReadonly && effectiveTexturePath && (
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewTexturePath(null);
                        applyVisualTexture(undefined);
                      }}
                      className={`${PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS} shrink-0`}
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>{t.clearTexture}</span>
                    </button>
                  )}
                </div>
                {isTextureReadonly ? (
                  <div className={PROPERTY_EDITOR_HELPER_TEXT_CLASS}>
                    {t.textureReadonlyMultiMaterialHint}
                  </div>
                ) : null}
              </div>
            </InlineInputGroup>

            {!isTextureReadonly && (
              <div className="mb-2 overflow-hidden rounded-lg border border-border-black bg-panel-bg/70">
                <div className="flex items-center justify-between gap-2 border-b border-border-black/60 bg-element-bg/70 px-2 py-1.5">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className={PROPERTY_EDITOR_INLINE_FIELD_LABEL_CLASS}>
                      {t.textureLibrary}
                    </span>
                    <span className="inline-flex min-w-4 items-center justify-center rounded-full border border-border-black bg-panel-bg px-1 py-0.5 text-[8px] font-semibold leading-none text-text-tertiary">
                      {textureFiles.length}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 px-1.5 py-1.5">
                  <div className="flex max-h-32 flex-col gap-0.5 overflow-y-auto custom-scrollbar pr-0.5">
                    {textureFiles.length === 0 && (
                      <div className="rounded-md border border-dashed border-border-black/70 bg-element-bg/70 px-2 py-3 text-center">
                        <div className={`${PROPERTY_EDITOR_HELPER_TEXT_CLASS} italic`}>
                          {t.textureNotFound}
                        </div>
                      </div>
                    )}
                    {textureFiles.map((filePath) => {
                      const isApplied = effectiveTexturePath === filePath && !previewTexturePath;
                      const isPreviewing = previewTexturePath === filePath;
                      const { fileName, parentPath } = describeMeshPath(filePath);

                      return (
                        <div
                          key={filePath}
                          title={filePath}
                          onClick={() => setPreviewTexturePath(filePath)}
                          onDoubleClick={() => {
                            applyVisualTexture(filePath);
                            setPreviewTexturePath(null);
                          }}
                          className={`
                            grid w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-1.5 rounded-md border px-1.5 py-1 text-left transition-colors
                            ${
                              isApplied
                                ? 'border-system-blue/35 bg-system-blue/10 text-system-blue dark:bg-system-blue/20'
                                : isPreviewing
                                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                                  : 'border-transparent bg-transparent text-text-secondary hover:border-border-black/50 hover:bg-element-hover'
                            }
                          `}
                        >
                          <span
                            aria-hidden="true"
                            className="h-3 w-3 shrink-0 rounded border border-border-black/70 bg-cover bg-center"
                            style={
                              assets[filePath]
                                ? { backgroundImage: `url("${assets[filePath]}")` }
                                : undefined
                            }
                          />
                          <span className="min-w-0">
                            <span
                              className={`block truncate text-[10px] font-medium ${
                                isApplied ? 'text-system-blue' : 'text-text-primary'
                              }`}
                            >
                              {fileName}
                            </span>
                            {parentPath && (
                              <span className="block truncate text-[9px] leading-4 text-text-tertiary">
                                {parentPath}
                              </span>
                            )}
                          </span>
                          {isApplied ? (
                            <Check className="h-3 w-3 shrink-0" />
                          ) : isPreviewing ? (
                            <Eye className="h-3 w-3 shrink-0" />
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {displayedTexturePath ? (
              <div className="flex flex-col gap-1 rounded-md border border-border-black/60 bg-element-bg/70 p-1">
                <div className="overflow-hidden rounded-md border border-border-black/60 bg-panel-bg/80">
                  {displayedTextureAssetUrl ? (
                    <img
                      src={displayedTextureAssetUrl}
                      alt={`${t.preview}: ${displayedTexturePath}`}
                      className="block max-h-40 w-full object-contain"
                    />
                  ) : (
                    <div className="flex min-h-28 items-center justify-center px-2 py-3 text-center">
                      <div className={PROPERTY_EDITOR_HELPER_TEXT_CLASS}>{t.noPreviewImage}</div>
                    </div>
                  )}
                </div>
                {previewTexturePath ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={handleApplyTexture}
                      className={`${PROPERTY_EDITOR_PRIMARY_BUTTON_CLASS} flex-1`}
                    >
                      <Check className="h-2.5 w-2.5" />
                      {t.apply}
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewTexturePath(null)}
                      className={`${PROPERTY_EDITOR_SECONDARY_BUTTON_CLASS} flex-1`}
                    >
                      {t.cancel}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {category === 'collision' &&
        showCollisionDeleteAction &&
        geomData.type !== GeometryType.NONE && (
          <div className="mt-4 border-t border-border-black pt-3">
            <button
              type="button"
              onClick={handleDeleteCollision}
              className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 text-[10px] font-medium text-red-600 transition-colors hover:bg-red-100 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>{t.deleteCollisionGeometry}</span>
            </button>
          </div>
        )}
    </div>
  );
};
