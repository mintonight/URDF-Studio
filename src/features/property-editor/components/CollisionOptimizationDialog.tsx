import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  CheckSquare2,
  RefreshCw,
  ShieldAlert,
  Sparkles,
  Wand2,
} from 'lucide-react';
import { DraggableWindow } from '@/shared/components';
import { CompactSwitch } from '@/shared/components/ui';
import { useDraggableWindow } from '@/shared/hooks';
import { translations } from '@/shared/i18n';
import { GeometryType } from '@/types';
import { convertGeometryType } from '../utils';
import type {
  CollisionOptimizationAnalysis,
  CollisionOptimizationBaseAnalysis,
  CollisionOptimizationManualMergePair,
  CollisionOptimizationSource,
  CollisionOptimizationScope,
  CoaxialJointMergeStrategy,
  CylinderOptimizationStrategy,
  MeshOptimizationStrategy,
  RodBoxOptimizationStrategy,
} from '../utils/collisionOptimization';
import {
  buildCollisionOptimizationAnalysisAsync,
  buildCollisionOptimizationOperations,
  countSameLinkOverlapWarnings,
  createCollisionOptimizationCandidateKey,
  createCollisionOptimizationCandidateKeyFromTargets,
  prepareCollisionOptimizationBaseAnalysis,
  type CollisionOptimizationCandidate,
  type CollisionOptimizationOperation,
  type CollisionTargetRef,
} from '../utils/collisionOptimization';
import {
  CollisionOptimizationCandidatesPanel,
  type CollisionOptimizationCandidatesViewMode,
} from './CollisionOptimizationCandidatesPanel';
import type { CollisionOptimizationPlanarGraphConnectionState } from './CollisionOptimizationPlanarGraph';
import { CollisionOptimizationStrategyPanel } from './CollisionOptimizationStrategyPanel';
import type { InteractionSelection } from '@/types';

interface CollisionOptimizationDialogProps {
  source: CollisionOptimizationSource;
  assets: Record<string, string>;
  sourceFilePath?: string;
  lang: 'en' | 'zh';
  selection?: InteractionSelection;
  onClose: () => void;
  onApply: (operations: CollisionOptimizationOperation[]) => void;
  onSelectTarget?: (target: CollisionTargetRef) => void;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function afterNextPaint(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    const timeoutId = setTimeout(callback, 0);
    return () => clearTimeout(timeoutId);
  }

  let cancelled = false;
  let frameA = 0;
  let frameB = 0;

  frameA = window.requestAnimationFrame(() => {
    frameB = window.requestAnimationFrame(() => {
      if (!cancelled) {
        callback();
      }
    });
  });

  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frameA);
    window.cancelAnimationFrame(frameB);
  };
}

function createRelationKey(
  componentId: string | undefined,
  sourceLinkId: string,
  targetLinkId: string,
): string {
  return `${componentId ?? 'robot'}::${sourceLinkId}::${targetLinkId}`;
}

function createManualMergePairKey(primaryTargetId: string, secondaryTargetId: string): string {
  return `${primaryTargetId}::${secondaryTargetId}`;
}

function cloneGeometryOrigin(geometry: CollisionTargetRef['geometry']) {
  const origin = geometry.origin ?? {
    xyz: { x: 0, y: 0, z: 0 },
    rpy: { r: 0, p: 0, y: 0 },
  };

  return {
    xyz: { ...origin.xyz },
    rpy: { ...origin.rpy },
  };
}

function buildSuggestedGeometry(
  geometry: CollisionTargetRef['geometry'],
  type: GeometryType,
  meshAnalysis?: CollisionOptimizationAnalysis['meshAnalysisByTargetId'][string],
): CollisionTargetRef['geometry'] {
  const converted = convertGeometryType(geometry, type, meshAnalysis ?? undefined);
  return {
    ...geometry,
    type,
    dimensions: { ...converted.dimensions },
    origin: {
      xyz: { ...converted.origin.xyz },
      rpy: { ...converted.origin.rpy },
    },
    meshPath: type === GeometryType.MESH ? geometry.meshPath : undefined,
  };
}

function getCandidateOverrideOptions(candidate: CollisionOptimizationCandidate): GeometryType[] {
  if (candidate.secondaryTarget) {
    return [GeometryType.CAPSULE, GeometryType.CYLINDER];
  }

  if (candidate.currentType === GeometryType.MESH) {
    return [
      GeometryType.MESH,
      GeometryType.CAPSULE,
      GeometryType.CYLINDER,
      GeometryType.BOX,
      GeometryType.SPHERE,
    ];
  }

  if (candidate.currentType === GeometryType.CYLINDER) {
    return [GeometryType.CYLINDER, GeometryType.CAPSULE];
  }

  if (candidate.currentType === GeometryType.BOX) {
    return [GeometryType.BOX, GeometryType.CAPSULE, GeometryType.CYLINDER];
  }

  return candidate.suggestedType ? [candidate.suggestedType] : [];
}

function applyCandidateTypeOverride(
  candidate: CollisionOptimizationCandidate,
  overrideType: GeometryType | undefined,
  meshAnalysisByTargetId: CollisionOptimizationAnalysis['meshAnalysisByTargetId'] | undefined,
): CollisionOptimizationCandidate {
  if (!overrideType) {
    return candidate;
  }

  if (candidate.secondaryTarget) {
    if (
      (overrideType !== GeometryType.CAPSULE && overrideType !== GeometryType.CYLINDER) ||
      !candidate.nextGeometry
    ) {
      return candidate;
    }

    if (overrideType === candidate.suggestedType) {
      return candidate;
    }

    return {
      ...candidate,
      suggestedType: overrideType,
      reason:
        overrideType === GeometryType.CAPSULE
          ? 'coaxial-merge-to-capsule'
          : 'coaxial-merge-to-cylinder',
      nextGeometry: {
        ...candidate.nextGeometry,
        type: overrideType,
        dimensions: { ...candidate.nextGeometry.dimensions },
        origin: cloneGeometryOrigin(candidate.nextGeometry),
      },
      mutations: candidate.mutations?.map((mutation) =>
        mutation.type === 'update' && mutation.nextGeometry
          ? {
              ...mutation,
              nextGeometry: {
                ...mutation.nextGeometry,
                type: overrideType,
                dimensions: { ...mutation.nextGeometry.dimensions },
                origin: cloneGeometryOrigin(mutation.nextGeometry),
              },
            }
          : mutation,
      ),
    };
  }

  if (overrideType === candidate.currentType) {
    return {
      ...candidate,
      eligible: false,
      suggestedType: null,
      status: 'disabled',
      reason: undefined,
      nextGeometry: undefined,
      mutations: undefined,
      affectedTargetIds: undefined,
    };
  }

  if (candidate.currentType === GeometryType.MESH) {
    const meshAnalysis = meshAnalysisByTargetId?.[candidate.target.id];
    if (!meshAnalysis) {
      return candidate;
    }

    return {
      ...candidate,
      eligible: true,
      suggestedType: overrideType,
      status: 'ready',
      reason: 'mesh-manual-fit',
      nextGeometry: buildSuggestedGeometry(candidate.target.geometry, overrideType, meshAnalysis),
    };
  }

  if (candidate.currentType === GeometryType.CYLINDER && overrideType === GeometryType.CAPSULE) {
    return {
      ...candidate,
      eligible: true,
      suggestedType: GeometryType.CAPSULE,
      status: 'ready',
      reason: 'cylinder-to-capsule',
      nextGeometry: buildSuggestedGeometry(candidate.target.geometry, GeometryType.CAPSULE),
    };
  }

  if (
    candidate.currentType === GeometryType.BOX &&
    (overrideType === GeometryType.CAPSULE || overrideType === GeometryType.CYLINDER)
  ) {
    return {
      ...candidate,
      eligible: true,
      suggestedType: overrideType,
      status: 'ready',
      reason: overrideType === GeometryType.CAPSULE ? 'rod-box-to-capsule' : 'rod-box-to-cylinder',
      nextGeometry: buildSuggestedGeometry(candidate.target.geometry, overrideType),
    };
  }

  return candidate;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-2 text-[8.5px] font-semibold tracking-[0.02em] text-text-tertiary first:mt-0">
      {children}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  tone = 'default',
}: {
  label: string;
  value: React.ReactNode;
  icon: React.ReactNode;
  tone?: 'default' | 'good' | 'warn';
}) {
  const surfaceClass =
    tone === 'good'
      ? 'border-green-500/20 bg-green-500/10'
      : tone === 'warn'
        ? 'border-amber-500/20 bg-amber-500/10'
        : 'border-border-black bg-element-bg';
  const accentClass =
    tone === 'good'
      ? 'text-green-700 dark:text-green-300'
      : tone === 'warn'
        ? 'text-amber-700 dark:text-amber-300'
        : 'text-text-secondary';
  const valueClass =
    tone === 'good'
      ? 'text-green-800 dark:text-green-200'
      : tone === 'warn'
        ? 'text-amber-800 dark:text-amber-200'
        : 'text-text-primary';

  return (
    <div
      className={`flex w-full min-w-0 items-center justify-between gap-1.5 rounded-md border px-1.75 py-1 ${surfaceClass}`}
    >
      <div className={`flex min-w-0 items-center gap-1.25 ${accentClass}`}>
        <span className="shrink-0">{icon}</span>
        <span className="truncate text-[8px] font-medium tracking-[0.02em]">{label}</span>
      </div>
      <div className={`shrink-0 text-[10px] font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function OptionButton({
  active,
  onClick,
  children,
  disabled = false,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`min-h-6.5 rounded-md border px-1.75 py-1 text-[9.5px] font-medium leading-none transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        disabled
          ? 'opacity-40 cursor-not-allowed border-border-black text-text-tertiary'
          : active
            ? 'bg-white dark:bg-segmented-active text-text-primary shadow-sm border-border-black'
            : 'bg-transparent text-text-secondary border-transparent hover:text-text-primary hover:bg-element-hover'
      }`}
    >
      {children}
    </button>
  );
}

function PanelSwitchButton({
  active,
  onClick,
  icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-0 flex-1 items-center justify-center gap-1.25 rounded-lg px-2 py-1.25 text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${
        active
          ? 'bg-white dark:bg-segmented-active text-text-primary shadow-sm'
          : 'text-text-secondary hover:bg-element-hover hover:text-text-primary'
      }`}
    >
      {icon}
      <span className="truncate">{label}</span>
      {badge ? (
        <span className="rounded-full border border-border-black bg-element-bg px-1 py-0.5 text-[9px] leading-none text-text-tertiary">
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function StrategyField({
  label,
  desc,
  children,
}: {
  label: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border-black bg-panel-bg px-2 py-2">
      <div className="text-[10px] font-medium leading-tight text-text-primary">{label}</div>
      {desc ? (
        <div className="mt-0.5 text-[9px] leading-snug text-text-tertiary">{desc}</div>
      ) : null}
      <div className={`${desc ? 'mt-1.5' : 'mt-1'} flex flex-wrap gap-1`}>{children}</div>
    </div>
  );
}

export const CollisionOptimizationDialog: React.FC<CollisionOptimizationDialogProps> = ({
  source,
  assets,
  sourceFilePath,
  lang,
  selection,
  onClose,
  onApply,
  onSelectTarget,
}) => {
  const t = translations[lang];
  const copy = {
    title: t.collisionOptimizerDialog,
    scope: t.collisionOptimizerScope,
    scopeAll: t.collisionOptimizerScopeAll,
    scopeMesh: t.collisionOptimizerScopeMesh,
    scopePrimitive: t.collisionOptimizerScopePrimitive,
    scopeSelected: t.collisionOptimizerScopeSelected,
    panelCandidates: t.collisionOptimizerCandidates,
    panelSettings: t.collisionOptimizerSettings,
    strategies: t.collisionOptimizerStrategies,
    strategySmart: t.collisionOptimizerStrategySmart,
    strategyKeep: t.collisionOptimizerStrategyKeep,
    strategyBox: t.box,
    strategySphere: t.sphere,
    strategyCylinder: t.cylinder,
    strategyCapsule: t.capsule,
    defaultStrategies: t.collisionOptimizerDefaultStrategies,
    showDefaultStrategies: t.collisionOptimizerShowDefaultStrategies,
    hideDefaultStrategies: t.collisionOptimizerHideDefaultStrategies,
    selectCandidateHint: t.collisionOptimizerSelectCandidateHint,
    selectedCandidate: t.collisionOptimizerSelectedCandidate,
    includeCandidate: t.collisionOptimizerIncludeCandidate,
    excludeCandidate: t.collisionOptimizerExcludeCandidate,
    meshStrategyLabel: t.collisionOptimizerMeshStrategyLabel,
    meshStrategyDesc: t.collisionOptimizerMeshStrategyDesc,
    cylinderStrategyLabel: t.collisionOptimizerCylinderStrategyLabel,
    cylinderStrategyDesc: t.collisionOptimizerCylinderStrategyDesc,
    rodBoxStrategyLabel: t.collisionOptimizerRodBoxStrategyLabel,
    rodBoxStrategyDesc: t.collisionOptimizerRodBoxStrategyDesc,
    coaxialMergeStrategyLabel: t.collisionOptimizerCoaxialMergeStrategyLabel,
    coaxialMergeStrategyDesc: t.collisionOptimizerCoaxialMergeStrategyDesc,
    rules: t.collisionOptimizerRules,
    avoidSiblingOverlap: t.collisionOptimizerAvoidSiblingOverlap,
    avoidSiblingOverlapDesc: t.collisionOptimizerAvoidSiblingOverlapDesc,
    candidates: t.collisionOptimizerCandidates,
    selectAll: t.collisionOptimizerSelectAll,
    clearAll: t.collisionOptimizerClearSelection,
    selectedCount: t.selected,
    noCandidates: t.collisionOptimizerNoSuggestion,
    noSelectedCollision: t.collisionOptimizerNoSelectedCollision,
    analyzing: t.collisionOptimizerLoading,
    apply: t.collisionOptimizerApplyAction,
    warningTitle: t.collisionOptimizerWarningTitle,
    warningBefore: t.collisionOptimizerWarningBefore,
    warningAfter: t.collisionOptimizerWarningAfter,
    ready: t.collisionOptimizerReady,
    disabled: t.collisionOptimizerDisabled,
    missingMeshPath: t.collisionOptimizerMissingMeshPath,
    meshAnalysisFailed: t.collisionOptimizerMeshAnalysisFailed,
    noRuleMatch: t.collisionOptimizerNoRuleMatch,
    reasonMeshSmart: t.collisionOptimizerReasonMeshSmart,
    reasonMeshManual: t.collisionOptimizerReasonMeshManual,
    reasonCylinder: t.collisionOptimizerReasonCylinder,
    reasonRodBox: t.collisionOptimizerReasonRodBox,
    reasonRodBoxCylinder: t.collisionOptimizerReasonRodBoxCylinder,
    reasonCoaxialCapsule: t.collisionOptimizerReasonCoaxialCapsule,
    reasonCoaxialCylinder: t.collisionOptimizerReasonCoaxialCylinder,
    totalCollisions: t.collisionOptimizerStatsTotal,
    meshCollisions: t.collisionOptimizerStatsMeshes,
    eligible: t.collisionOptimizerStatsOptimizable,
    warnings: t.collisionOptimizerStatsWarnings,
    collisionIndex: t.collisionOptimizerCollisionIndex,
    current: t.collisionOptimizerCurrent,
    primary: t.collisionOptimizerPrimary,
    component: t.collisionOptimizerComponent,
    jointPair: t.collisionOptimizerJointPair,
    suggested: t.collisionOptimizerSuggested,
    viewList: t.collisionOptimizerViewList,
    viewGraph: t.collisionOptimizerViewGraph,
    frontView: t.collisionOptimizerFrontView,
    graphHint: t.collisionOptimizerGraphHint,
    clearManualPairs: t.collisionOptimizerClearManualPairs,
    manualPair: t.collisionOptimizerManualPair,
    autoPair: t.collisionOptimizerAutoPair,
    mergeTo: t.collisionOptimizerMergeTo,
    mergedInto: t.collisionOptimizerMergedInto,
    connectTargets: t.collisionOptimizerConnectTargets,
    zoomIn: t.collisionOptimizerZoomIn,
    zoomOut: t.collisionOptimizerZoomOut,
    resetView: t.collisionOptimizerResetView,
  };

  const [scope, setScope] = useState<CollisionOptimizationScope>('all');
  const [meshStrategy, setMeshStrategy] = useState<MeshOptimizationStrategy>('capsule');
  const [cylinderStrategy, setCylinderStrategy] = useState<CylinderOptimizationStrategy>('capsule');
  const [rodBoxStrategy, setRodBoxStrategy] = useState<RodBoxOptimizationStrategy>('capsule');
  const [coaxialJointMergeStrategy, setCoaxialJointMergeStrategy] =
    useState<CoaxialJointMergeStrategy>('capsule');
  const [avoidSiblingOverlap, setAvoidSiblingOverlap] = useState(false);
  const [isPreparingBaseAnalysis, setIsPreparingBaseAnalysis] = useState(true);
  const [isComputingCandidates, setIsComputingCandidates] = useState(false);
  const [baseAnalysis, setBaseAnalysis] = useState<CollisionOptimizationBaseAnalysis | null>(null);
  const [analysis, setAnalysis] = useState<CollisionOptimizationAnalysis | null>(null);
  const [checkedCandidateKeys, setCheckedCandidateKeys] = useState<Set<string>>(new Set());
  const [candidateTypeOverrides, setCandidateTypeOverrides] = useState<
    Record<string, GeometryType | undefined>
  >({});
  const [activeCandidateKey, setActiveCandidateKey] = useState<string | null>(null);
  const [stackedPanel, setStackedPanel] = useState<'candidates' | 'settings'>('candidates');
  const [showDefaultStrategies, setShowDefaultStrategies] = useState(false);
  const [candidatesViewMode, setCandidatesViewMode] =
    useState<CollisionOptimizationCandidatesViewMode>('list');
  const [manualMergePairs, setManualMergePairs] = useState<CollisionOptimizationManualMergePair[]>(
    [],
  );
  const [manualConnection, setManualConnection] =
    useState<CollisionOptimizationPlanarGraphConnectionState | null>(null);
  const [hasRequestedPrimitiveFits, setHasRequestedPrimitiveFits] = useState(false);
  const hasCustomCheckedSelectionRef = useRef(false);
  const isAnalyzing = isPreparingBaseAnalysis || isComputingCandidates;

  const defaultWindowSize = useMemo(() => {
    if (typeof window === 'undefined') {
      return { width: 560, height: 460 };
    }

    return {
      width: Math.min(660, Math.max(520, Math.round(window.innerWidth * 0.4))),
      height: Math.min(500, Math.max(400, Math.round(window.innerHeight * 0.52))),
    };
  }, []);

  const windowState = useDraggableWindow({
    defaultSize: defaultWindowSize,
    minSize: { width: 480, height: 380 },
    centerOnMount: true,
    enableMinimize: false,
    enableMaximize: false,
  });
  const dialogWidth = windowState.size.width;
  const isStackedLayout = dialogWidth < 960;
  const isCompactLayout = dialogWidth < 840;
  const isDenseLayout = dialogWidth < 720;
  const isWideLayout = dialogWidth >= 1180;
  const isUltraWideLayout = dialogWidth >= 1400;

  const selectedTargetId = useMemo(() => {
    if (
      selection?.type !== 'link' ||
      selection.subType !== 'collision' ||
      !selection.id ||
      !baseAnalysis
    ) {
      return null;
    }

    const matches = baseAnalysis.targets.filter(
      (target) =>
        target.linkId === selection.id && (selection.objectIndex ?? 0) === target.objectIndex,
    );

    return matches.length === 1 ? matches[0].id : null;
  }, [baseAnalysis, selection]);

  const targetById = useMemo(
    () => new Map((baseAnalysis?.targets ?? []).map((target) => [target.id, target] as const)),
    [baseAnalysis?.targets],
  );

  const linkRelationByDirection = useMemo(() => {
    const relationMap = new Map<
      string,
      { componentId?: string; parentLinkId: string; childLinkId: string }
    >();

    if (source.kind === 'robot') {
      Object.values(source.robot.joints).forEach((joint) => {
        if (joint.type !== 'fixed' && joint.type !== 'revolute' && joint.type !== 'continuous') {
          return;
        }

        const relation = {
          componentId: undefined,
          parentLinkId: joint.parentLinkId,
          childLinkId: joint.childLinkId,
        };
        relationMap.set(
          createRelationKey(undefined, joint.parentLinkId, joint.childLinkId),
          relation,
        );
        relationMap.set(
          createRelationKey(undefined, joint.childLinkId, joint.parentLinkId),
          relation,
        );
      });
      return relationMap;
    }

    Object.values(source.assembly.components).forEach((component) => {
      Object.values(component.robot.joints).forEach((joint) => {
        if (joint.type !== 'fixed' && joint.type !== 'revolute' && joint.type !== 'continuous') {
          return;
        }

        const relation = {
          componentId: component.id,
          parentLinkId: joint.parentLinkId,
          childLinkId: joint.childLinkId,
        };
        relationMap.set(
          createRelationKey(component.id, joint.parentLinkId, joint.childLinkId),
          relation,
        );
        relationMap.set(
          createRelationKey(component.id, joint.childLinkId, joint.parentLinkId),
          relation,
        );
      });
    });

    return relationMap;
  }, [source]);

  const effectiveSelectedTargetId = scope === 'selected' ? selectedTargetId : null;

  useEffect(() => {
    if (hasRequestedPrimitiveFits) {
      return;
    }

    if (candidatesViewMode === 'graph' || manualMergePairs.length > 0) {
      setHasRequestedPrimitiveFits(true);
    }
  }, [candidatesViewMode, hasRequestedPrimitiveFits, manualMergePairs.length]);

  useEffect(() => {
    const controller = new AbortController();
    setIsPreparingBaseAnalysis(true);
    setIsComputingCandidates(false);
    setBaseAnalysis(null);
    setAnalysis(null);
    hasCustomCheckedSelectionRef.current = false;
    setCheckedCandidateKeys(new Set());
    setCandidateTypeOverrides({});
    setActiveCandidateKey(null);
    setManualMergePairs([]);
    setManualConnection(null);

    const cancelScheduledStart = afterNextPaint(() => {
      void prepareCollisionOptimizationBaseAnalysis(source, assets, {
        signal: controller.signal,
        includeClearanceData: avoidSiblingOverlap,
        includePrimitiveFits: hasRequestedPrimitiveFits,
        sourceFilePath,
      })
        .then((result) => {
          if (controller.signal.aborted) return;
          setBaseAnalysis(result);
        })
        .catch((error) => {
          if (!isAbortError(error)) {
            console.error('Failed to prepare collision optimization base analysis', error);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsPreparingBaseAnalysis(false);
          }
        });
    });

    return () => {
      cancelScheduledStart();
      controller.abort();
    };
  }, [assets, avoidSiblingOverlap, hasRequestedPrimitiveFits, source, sourceFilePath]);

  useEffect(() => {
    if (!baseAnalysis) {
      setIsComputingCandidates(false);
      setAnalysis(null);
      return;
    }

    const controller = new AbortController();
    setIsComputingCandidates(true);
    setAnalysis(null);

    void buildCollisionOptimizationAnalysisAsync(
      baseAnalysis,
      {
        scope,
        meshStrategy,
        cylinderStrategy,
        rodBoxStrategy,
        coaxialJointMergeStrategy,
        manualMergePairs,
        avoidSiblingOverlap,
        selectedTargetId: effectiveSelectedTargetId,
      },
      {
        signal: controller.signal,
      },
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setAnalysis(result);
      })
      .catch((error) => {
        if (!isAbortError(error)) {
          console.error('Failed to build collision optimization candidates', error);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsComputingCandidates(false);
        }
      });

    return () => {
      controller.abort();
    };
  }, [
    avoidSiblingOverlap,
    baseAnalysis,
    coaxialJointMergeStrategy,
    cylinderStrategy,
    effectiveSelectedTargetId,
    manualMergePairs,
    meshStrategy,
    rodBoxStrategy,
    scope,
  ]);

  useEffect(() => {
    if (!analysis || hasCustomCheckedSelectionRef.current) {
      return;
    }

    setCheckedCandidateKeys(
      new Set(
        analysis.candidates
          .filter((candidate) => candidate.eligible && candidate.autoSelect !== false)
          .map((candidate) => createCollisionOptimizationCandidateKey(candidate)),
      ),
    );
  }, [analysis]);

  const totalCollisionCount = analysis?.targets.length ?? 0;
  const meshCollisionCount = useMemo(
    () =>
      analysis?.targets.filter((target) => target.geometry.type === GeometryType.MESH).length ?? 0,
    [analysis?.targets],
  );
  const manualPairKeySet = useMemo(
    () =>
      new Set(
        manualMergePairs.map((pair) =>
          createManualMergePairKey(pair.primaryTargetId, pair.secondaryTargetId),
        ),
      ),
    [manualMergePairs],
  );
  const rawDisplayCandidates = useMemo(() => {
    if (!analysis) {
      return [];
    }

    const singles: CollisionOptimizationCandidate[] = [];
    const pairCandidatesByKey = new Map<string, CollisionOptimizationCandidate>();

    analysis.candidates.forEach((candidate) => {
      if (!candidate.secondaryTarget) {
        singles.push(candidate);
        return;
      }

      const pairKey = createManualMergePairKey(candidate.target.id, candidate.secondaryTarget.id);
      const existing = pairCandidatesByKey.get(pairKey);
      const isManualPair = manualPairKeySet.has(pairKey);
      if (!existing || isManualPair) {
        pairCandidatesByKey.set(pairKey, candidate);
      }
    });

    return [...singles, ...pairCandidatesByKey.values()];
  }, [analysis, manualPairKeySet]);
  const displayCandidates = useMemo(
    () =>
      rawDisplayCandidates.map((candidate) =>
        applyCandidateTypeOverride(
          candidate,
          candidateTypeOverrides[createCollisionOptimizationCandidateKey(candidate)],
          analysis?.meshAnalysisByTargetId,
        ),
      ),
    [analysis?.meshAnalysisByTargetId, candidateTypeOverrides, rawDisplayCandidates],
  );
  const selectedCandidates = useMemo(
    () =>
      displayCandidates.filter((candidate) =>
        checkedCandidateKeys.has(createCollisionOptimizationCandidateKey(candidate)),
      ),
    [checkedCandidateKeys, displayCandidates],
  );
  const activeCandidate = useMemo(
    () =>
      displayCandidates.find(
        (candidate) => createCollisionOptimizationCandidateKey(candidate) === activeCandidateKey,
      ) ?? null,
    [activeCandidateKey, displayCandidates],
  );
  const selectedCandidateCount = selectedCandidates.length;
  const activeOperations = useMemo(
    () =>
      buildCollisionOptimizationOperations(
        selectedCandidates,
        new Set(selectedCandidates.map((candidate) => candidate.target.id)),
      ),
    [selectedCandidates],
  );
  const overridesByTargetId = useMemo<
    Record<string, CollisionOptimizationOperation['nextGeometry']>
  >(
    () =>
      activeOperations.reduce<Record<string, CollisionOptimizationOperation['nextGeometry']>>(
        (accumulator, operation) => {
          accumulator[operation.id] = operation.nextGeometry;
          return accumulator;
        },
        {},
      ),
    [activeOperations],
  );
  const eligibleCount = useMemo(
    () => displayCandidates.filter((candidate) => candidate.eligible).length,
    [displayCandidates],
  );
  const warningBefore = useMemo(
    () =>
      analysis
        ? countSameLinkOverlapWarnings(analysis.targets, analysis.meshAnalysisByTargetId)
        : 0,
    [analysis],
  );
  const warningAfter = useMemo(
    () =>
      analysis
        ? countSameLinkOverlapWarnings(
            analysis.targets,
            analysis.meshAnalysisByTargetId,
            overridesByTargetId,
          )
        : 0,
    [analysis, overridesByTargetId],
  );

  useEffect(() => {
    if (!selectedTargetId) {
      return;
    }

    const matchedCandidate = displayCandidates.find(
      (candidate) =>
        candidate.target.id === selectedTargetId ||
        candidate.secondaryTarget?.id === selectedTargetId,
    );

    if (!matchedCandidate) {
      return;
    }

    const matchedCandidateKey = createCollisionOptimizationCandidateKey(matchedCandidate);
    setActiveCandidateKey((previous) =>
      previous === matchedCandidateKey ? previous : matchedCandidateKey,
    );
  }, [displayCandidates, selectedTargetId]);

  useEffect(() => {
    const validCandidateKeys = new Set(
      displayCandidates.map((candidate) => createCollisionOptimizationCandidateKey(candidate)),
    );

    setCheckedCandidateKeys((previous) => {
      let changed = false;
      const next = new Set<string>();
      previous.forEach((key) => {
        if (validCandidateKeys.has(key)) {
          next.add(key);
        } else {
          changed = true;
        }
      });
      return changed ? next : previous;
    });

    setCandidateTypeOverrides((previous) => {
      let changed = false;
      const next: Record<string, GeometryType | undefined> = {};
      Object.entries(previous).forEach(([key, value]) => {
        if (validCandidateKeys.has(key)) {
          next[key] = value;
        } else {
          changed = true;
        }
      });
      return changed ? next : previous;
    });

    setActiveCandidateKey((previous) => {
      if (previous && validCandidateKeys.has(previous)) {
        return previous;
      }

      if (displayCandidates.length === 0) {
        return null;
      }

      return createCollisionOptimizationCandidateKey(displayCandidates[0]);
    });
  }, [displayCandidates]);

  const toggleCandidate = useCallback((candidateKey: string) => {
    hasCustomCheckedSelectionRef.current = true;
    setCheckedCandidateKeys((previous) => {
      const next = new Set(previous);
      if (next.has(candidateKey)) {
        next.delete(candidateKey);
      } else {
        next.add(candidateKey);
      }
      return next;
    });
  }, []);

  const activateCandidate = useCallback(
    (candidateKey: string, _candidate: CollisionOptimizationCandidate) => {
      setActiveCandidateKey(candidateKey);
    },
    [],
  );

  const setCandidateOverride = useCallback(
    (candidate: CollisionOptimizationCandidate, nextType: GeometryType) => {
      const candidateKey = createCollisionOptimizationCandidateKey(candidate);
      setCandidateTypeOverrides((previous) => ({
        ...previous,
        [candidateKey]: nextType,
      }));
      setActiveCandidateKey(candidateKey);
      hasCustomCheckedSelectionRef.current = true;
      setCheckedCandidateKeys((previous) => {
        const next = new Set(previous);
        if (!candidate.secondaryTarget && nextType === candidate.currentType) {
          next.delete(candidateKey);
          return next;
        }

        next.add(candidateKey);
        return next;
      });
    },
    [],
  );

  const handleSelectAll = useCallback(() => {
    hasCustomCheckedSelectionRef.current = true;
    setCheckedCandidateKeys(
      new Set(
        displayCandidates
          .filter((candidate) => candidate.eligible)
          .map((candidate) => createCollisionOptimizationCandidateKey(candidate)),
      ),
    );
  }, [displayCandidates]);

  const handleClearAll = useCallback(() => {
    hasCustomCheckedSelectionRef.current = true;
    setCheckedCandidateKeys(new Set());
  }, []);

  const canCreateManualPair = useCallback(
    (sourceTargetId: string, targetTargetId: string) => {
      if (sourceTargetId === targetTargetId) {
        return false;
      }

      const sourceTarget = targetById.get(sourceTargetId);
      const target = targetById.get(targetTargetId);
      if (!sourceTarget || !target) {
        return false;
      }

      if ((sourceTarget.componentId ?? 'robot') !== (target.componentId ?? 'robot')) {
        return false;
      }

      return linkRelationByDirection.has(
        createRelationKey(sourceTarget.componentId, sourceTarget.linkId, target.linkId),
      );
    },
    [linkRelationByDirection, targetById],
  );

  const handleClearManualPairs = useCallback(() => {
    setManualConnection(null);
    setManualMergePairs([]);
  }, []);

  const handleManualConnectionStart = useCallback((target: CollisionTargetRef) => {
    setManualConnection({
      sourceTargetId: target.id,
      pointer: null,
    });
  }, []);

  const handleManualConnectionMove = useCallback((pointer: { x: number; y: number }) => {
    setManualConnection((previous) => (previous ? { ...previous, pointer } : previous));
  }, []);

  const handleManualConnectionCancel = useCallback(() => {
    setManualConnection(null);
  }, []);

  const handleManualConnectionEnd = useCallback(
    (target: CollisionTargetRef | null) => {
      if (!manualConnection) {
        return;
      }

      const sourceTarget = targetById.get(manualConnection.sourceTargetId);
      setManualConnection(null);

      if (!sourceTarget || !target || !canCreateManualPair(sourceTarget.id, target.id)) {
        return;
      }

      const relation = linkRelationByDirection.get(
        createRelationKey(sourceTarget.componentId, sourceTarget.linkId, target.linkId),
      );
      if (!relation) {
        return;
      }

      const primaryTarget = relation.parentLinkId === sourceTarget.linkId ? sourceTarget : target;
      const secondaryTarget = primaryTarget.id === sourceTarget.id ? target : sourceTarget;
      const nextPairKey = createManualMergePairKey(primaryTarget.id, secondaryTarget.id);
      const nextStrategy =
        coaxialJointMergeStrategy === 'keep' ? 'capsule' : coaxialJointMergeStrategy;

      setManualMergePairs((previous) => {
        const existingIndex = previous.findIndex(
          (pair) =>
            createManualMergePairKey(pair.primaryTargetId, pair.secondaryTargetId) === nextPairKey,
        );

        if (existingIndex >= 0) {
          const nextPairs = [...previous];
          nextPairs[existingIndex] = {
            ...nextPairs[existingIndex],
            strategy: nextStrategy,
          };
          return nextPairs;
        }

        return [
          ...previous,
          {
            primaryTargetId: primaryTarget.id,
            secondaryTargetId: secondaryTarget.id,
            strategy: nextStrategy,
          },
        ];
      });

      hasCustomCheckedSelectionRef.current = true;
      setCheckedCandidateKeys((previous) => {
        const next = new Set(previous);
        next.add(
          createCollisionOptimizationCandidateKeyFromTargets(primaryTarget.id, secondaryTarget.id),
        );
        return next;
      });
      onSelectTarget?.(primaryTarget);
    },
    [
      canCreateManualPair,
      coaxialJointMergeStrategy,
      linkRelationByDirection,
      manualConnection,
      onSelectTarget,
      targetById,
    ],
  );

  const handleApply = useCallback(() => {
    if (activeOperations.length === 0) return;
    onApply(activeOperations);
  }, [activeOperations, onApply]);

  const formatGeometryType = useCallback(
    (type: GeometryType | null | undefined) => {
      switch (type) {
        case GeometryType.BOX:
          return t.box;
        case GeometryType.PLANE:
          return t.plane;
        case GeometryType.SPHERE:
          return t.sphere;
        case GeometryType.ELLIPSOID:
          return t.ellipsoid;
        case GeometryType.CYLINDER:
          return t.cylinder;
        case GeometryType.CAPSULE:
          return t.capsule;
        case GeometryType.HFIELD:
          return t.hfield;
        case GeometryType.SDF:
          return t.sdf;
        case GeometryType.MESH:
          return t.mesh;
        default:
          return t.none;
      }
    },
    [t],
  );

  const getStatusLabel = useCallback(
    (candidate: CollisionOptimizationCandidate) => {
      if (candidate.eligible) {
        return copy.ready;
      }

      switch (candidate.status) {
        case 'disabled':
          return copy.disabled;
        case 'missing-mesh-path':
          return copy.missingMeshPath;
        case 'mesh-analysis-failed':
          return copy.meshAnalysisFailed;
        case 'no-rule-match':
        default:
          return copy.noRuleMatch;
      }
    },
    [copy],
  );

  const getReasonLabel = useCallback(
    (candidate: CollisionOptimizationCandidate) => {
      switch (candidate.reason) {
        case 'mesh-smart-fit':
          return copy.reasonMeshSmart;
        case 'mesh-manual-fit':
          return copy.reasonMeshManual;
        case 'cylinder-to-capsule':
          return copy.reasonCylinder;
        case 'rod-box-to-capsule':
          return copy.reasonRodBox;
        case 'rod-box-to-cylinder':
          return copy.reasonRodBoxCylinder;
        case 'coaxial-merge-to-capsule':
          return copy.reasonCoaxialCapsule;
        case 'coaxial-merge-to-cylinder':
          return copy.reasonCoaxialCylinder;
        default:
          return null;
      }
    },
    [copy],
  );

  const activeCandidateStrategyField = useMemo(() => {
    if (!activeCandidate) {
      return null;
    }

    if (activeCandidate.secondaryTarget) {
      return {
        label: copy.coaxialMergeStrategyLabel,
        desc: copy.coaxialMergeStrategyDesc,
      };
    }

    if (activeCandidate.currentType === GeometryType.MESH) {
      return {
        label: copy.meshStrategyLabel,
        desc: copy.meshStrategyDesc,
      };
    }

    if (activeCandidate.currentType === GeometryType.CYLINDER) {
      return {
        label: copy.cylinderStrategyLabel,
        desc: copy.cylinderStrategyDesc,
      };
    }

    if (activeCandidate.currentType === GeometryType.BOX) {
      return {
        label: copy.rodBoxStrategyLabel,
        desc: copy.rodBoxStrategyDesc,
      };
    }

    return null;
  }, [
    activeCandidate,
    copy.coaxialMergeStrategyDesc,
    copy.coaxialMergeStrategyLabel,
    copy.cylinderStrategyDesc,
    copy.cylinderStrategyLabel,
    copy.meshStrategyDesc,
    copy.meshStrategyLabel,
    copy.rodBoxStrategyDesc,
    copy.rodBoxStrategyLabel,
  ]);

  const isSelectedScopeWithoutSelection =
    scope === 'selected' &&
    (!selection?.id || selection.subType !== 'collision' || selection.type !== 'link');

  const footerLabel = `${copy.selectedCount} ${selectedCandidateCount} / ${eligibleCount}`;
  const hasOverlapWarnings = warningBefore > 0 || warningAfter > 0;
  const showCandidatesPanel = !isStackedLayout || stackedPanel === 'candidates';
  const showSettingsPanel = !isStackedLayout || stackedPanel === 'settings';
  const candidatePanelLabels = useMemo(
    () => ({
      analyzing: copy.analyzing,
      clearAll: copy.clearAll,
      clearManualPairs: copy.clearManualPairs,
      eligible: copy.eligible,
      noCandidates: copy.noCandidates,
      noSelectedCollision: copy.noSelectedCollision,
      scopeAll: copy.scopeAll,
      scopeMesh: copy.scopeMesh,
      scopePrimitive: copy.scopePrimitive,
      scopeSelected: copy.scopeSelected,
      selectAll: copy.selectAll,
      selectedCount: copy.selectedCount,
      title: copy.candidates,
      viewGraph: copy.viewGraph,
      viewList: copy.viewList,
    }),
    [copy],
  );
  const candidateListLabels = useMemo(
    () => ({
      clearAll: copy.clearAll,
      collisionIndex: copy.collisionIndex,
      component: copy.component,
      jointPair: copy.jointPair,
      mergeTo: copy.mergeTo,
      noCandidates: copy.noCandidates,
      selectedCount: copy.selectedCount,
    }),
    [copy],
  );
  const graphLabels = useMemo(
    () => ({
      autoPair: copy.autoPair,
      collisionIndex: copy.collisionIndex,
      component: copy.component,
      connectionHandle: copy.connectTargets,
      dragHint: copy.graphHint,
      empty: copy.noCandidates,
      frontView: copy.frontView,
      manualPair: copy.manualPair,
      mergeTo: copy.mergeTo,
      mergedInto: copy.mergedInto,
      primary: copy.primary,
      selectCandidate: copy.selectAll,
      resetView: copy.resetView,
      unselectCandidate: copy.clearAll,
      zoomIn: copy.zoomIn,
      zoomOut: copy.zoomOut,
    }),
    [copy],
  );
  const statsGridClass = 'grid-cols-4';
  const isGraphView = candidatesViewMode === 'graph';
  const mainPanelsGridClass = isStackedLayout
    ? 'grid-cols-1'
    : isGraphView
      ? isUltraWideLayout
        ? 'grid-cols-[minmax(0,1.7fr)_minmax(300px,360px)]'
        : 'grid-cols-[minmax(0,1.45fr)_minmax(280px,340px)]'
      : isUltraWideLayout
        ? 'grid-cols-[minmax(500px,1.35fr)_minmax(320px,0.88fr)]'
        : 'grid-cols-[minmax(420px,1.22fr)_minmax(300px,0.92fr)]';
  const settingsLayoutClass = isWideLayout
    ? 'grid grid-cols-[minmax(0,1.35fr)_minmax(280px,0.95fr)] items-start gap-2.5'
    : 'space-y-2.5';
  const strategyGridClass = isWideLayout ? 'grid-cols-2' : 'grid-cols-1';

  const meshStrategyOptions: Array<{ value: MeshOptimizationStrategy; label: string }> = [
    { value: 'capsule', label: copy.strategyCapsule },
    { value: 'smart', label: copy.strategySmart },
    { value: 'cylinder', label: copy.strategyCylinder },
    { value: 'box', label: copy.strategyBox },
    { value: 'sphere', label: copy.strategySphere },
    { value: 'keep', label: copy.strategyKeep },
  ];

  const cylinderStrategyOptions: Array<{ value: CylinderOptimizationStrategy; label: string }> = [
    { value: 'capsule', label: copy.strategyCapsule },
    { value: 'keep', label: copy.strategyKeep },
  ];

  const rodBoxStrategyOptions: Array<{ value: RodBoxOptimizationStrategy; label: string }> = [
    { value: 'capsule', label: copy.strategyCapsule },
    { value: 'cylinder', label: copy.strategyCylinder },
    { value: 'keep', label: copy.strategyKeep },
  ];

  const coaxialMergeStrategyOptions: Array<{ value: CoaxialJointMergeStrategy; label: string }> = [
    { value: 'capsule', label: copy.strategyCapsule },
    { value: 'cylinder', label: copy.strategyCylinder },
    { value: 'keep', label: copy.strategyKeep },
  ];

  return (
    <DraggableWindow
      window={windowState}
      onClose={onClose}
      title={
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="rounded-md border border-border-black bg-element-bg p-1 text-text-secondary">
            <Sparkles className="h-3 w-3" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold text-text-primary">{copy.title}</div>
          </div>
        </div>
      }
      className="z-[110] flex flex-col overflow-hidden rounded-lg border border-border-black bg-panel-bg text-text-primary shadow-lg"
      headerClassName="flex h-10 shrink-0 items-center justify-between border-b border-border-black bg-element-bg px-2"
      interactionClassName="select-none"
      showMinimizeButton={false}
      showMaximizeButton={false}
      closeTitle={t.close}
      closeButtonClassName="rounded-md p-1 text-text-tertiary transition-colors hover:bg-red-500 hover:text-white"
      showResizeHandles={true}
    >
      <div className="flex-1 min-h-0 overflow-hidden px-2 py-2 sm:px-2.5">
        <div className="flex h-full min-h-0 flex-col gap-2">
          <div className={`grid gap-1 ${statsGridClass}`}>
            <StatCard
              label={copy.totalCollisions}
              value={totalCollisionCount}
              icon={<Boxes className="w-3.5 h-3.5" />}
            />
            <StatCard
              label={copy.meshCollisions}
              value={meshCollisionCount}
              icon={<Wand2 className="w-3.5 h-3.5" />}
            />
            <StatCard
              label={copy.eligible}
              value={eligibleCount}
              icon={<CheckSquare2 className="w-3.5 h-3.5" />}
              tone={eligibleCount > 0 ? 'good' : 'default'}
            />
            <StatCard
              label={copy.warnings}
              value={`${warningBefore} → ${warningAfter}`}
              icon={<ShieldAlert className="w-3.5 h-3.5" />}
              tone={warningAfter > 0 ? 'warn' : 'good'}
            />
          </div>

          {isStackedLayout && (
            <div className="shrink-0 rounded-lg border border-border-black bg-segmented-bg p-0.5">
              <div className="flex gap-1">
                <PanelSwitchButton
                  active={stackedPanel === 'candidates'}
                  onClick={() => setStackedPanel('candidates')}
                  icon={<Boxes className="h-3.5 w-3.5 shrink-0" />}
                  label={copy.panelCandidates}
                  badge={displayCandidates.length}
                />
                <PanelSwitchButton
                  active={stackedPanel === 'settings'}
                  onClick={() => setStackedPanel('settings')}
                  icon={<Wand2 className="h-3.5 w-3.5 shrink-0" />}
                  label={copy.strategies}
                />
              </div>
            </div>
          )}

          <div className={`grid flex-1 min-h-0 gap-2 ${mainPanelsGridClass}`}>
            {showCandidatesPanel && (
              <CollisionOptimizationCandidatesPanel
                activeCandidateKey={activeCandidateKey}
                source={source}
                analysis={analysis}
                candidates={displayCandidates}
                selection={selection}
                scope={scope}
                viewMode={candidatesViewMode}
                checkedCandidateKeys={checkedCandidateKeys}
                eligibleCount={eligibleCount}
                activeSelectionCount={selectedCandidateCount}
                isAnalyzing={isAnalyzing}
                isSelectedScopeWithoutSelection={isSelectedScopeWithoutSelection}
                manualMergePairs={manualMergePairs}
                manualConnection={manualConnection}
                labels={candidatePanelLabels}
                listLabels={candidateListLabels}
                graphLabels={graphLabels}
                formatGeometryType={formatGeometryType}
                getStatusLabel={getStatusLabel}
                canCreateManualPair={canCreateManualPair}
                onActivateCandidate={activateCandidate}
                onScopeChange={setScope}
                onViewModeChange={setCandidatesViewMode}
                onSelectAll={handleSelectAll}
                onClearAll={handleClearAll}
                onClearManualPairs={handleClearManualPairs}
                onToggleCandidate={toggleCandidate}
                onSelectTarget={onSelectTarget}
                onManualConnectionStart={handleManualConnectionStart}
                onManualConnectionMove={handleManualConnectionMove}
                onManualConnectionEnd={handleManualConnectionEnd}
                onManualConnectionCancel={handleManualConnectionCancel}
              />
            )}

            {showSettingsPanel && (
              <div className="min-h-0 flex flex-col overflow-hidden rounded-lg border border-border-black bg-element-bg">
                <div className="shrink-0 border-b border-border-black bg-panel-bg px-2 py-1.5">
                  <div className="text-[10px] font-semibold text-text-primary">
                    {copy.strategies}
                  </div>
                </div>

                <div className={`flex-1 min-h-0 overflow-y-auto px-2 py-2 ${settingsLayoutClass}`}>
                  <div className="space-y-2">
                    <CollisionOptimizationStrategyPanel
                      activeCandidate={activeCandidate}
                      activeCandidateKey={activeCandidateKey}
                      getCandidateOverrideOptions={getCandidateOverrideOptions}
                      getReasonLabel={getReasonLabel}
                      getStatusLabel={getStatusLabel}
                      isChecked={
                        activeCandidate
                          ? checkedCandidateKeys.has(
                              createCollisionOptimizationCandidateKey(activeCandidate),
                            )
                          : false
                      }
                      labels={{
                        current: copy.current,
                        excludeCandidate: copy.excludeCandidate,
                        includeCandidate: copy.includeCandidate,
                        reason: t.collisionOptimizerReason,
                        selectCandidateHint: copy.selectCandidateHint,
                        selectedCandidate: copy.selectedCandidate,
                        status: t.collisionOptimizerStatus,
                        suggested: copy.suggested,
                      }}
                      onSelectTarget={onSelectTarget}
                      onSetCandidateOverride={setCandidateOverride}
                      onToggleCandidate={toggleCandidate}
                      formatGeometryType={formatGeometryType}
                      strategyField={activeCandidateStrategyField}
                    />

                    <button
                      type="button"
                      onClick={() => setShowDefaultStrategies((previous) => !previous)}
                      className="flex w-full items-center justify-between rounded-lg border border-border-black bg-element-bg px-2 py-1.5 text-left transition-colors hover:bg-panel-bg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                    >
                      <div>
                        <div className="text-[10px] font-semibold text-text-primary">
                          {copy.defaultStrategies}
                        </div>
                        <div className="mt-0.5 text-[9px] text-text-tertiary">
                          {showDefaultStrategies
                            ? copy.hideDefaultStrategies
                            : copy.showDefaultStrategies}
                        </div>
                      </div>
                      {showDefaultStrategies ? (
                        <ChevronDown className="h-4 w-4 text-text-tertiary" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-text-tertiary" />
                      )}
                    </button>

                    {showDefaultStrategies ? (
                      <div className="rounded-lg border border-border-black bg-element-bg px-2 py-2">
                        <div className={`grid gap-2 ${strategyGridClass}`}>
                          <StrategyField
                            label={copy.meshStrategyLabel}
                            desc={copy.meshStrategyDesc}
                          >
                            {meshStrategyOptions.map((option) => (
                              <OptionButton
                                key={option.value}
                                active={meshStrategy === option.value}
                                onClick={() => setMeshStrategy(option.value)}
                              >
                                {option.label}
                              </OptionButton>
                            ))}
                          </StrategyField>

                          <StrategyField
                            label={copy.cylinderStrategyLabel}
                            desc={copy.cylinderStrategyDesc}
                          >
                            {cylinderStrategyOptions.map((option) => (
                              <OptionButton
                                key={option.value}
                                active={cylinderStrategy === option.value}
                                onClick={() => setCylinderStrategy(option.value)}
                              >
                                {option.label}
                              </OptionButton>
                            ))}
                          </StrategyField>

                          <div className={isWideLayout ? 'col-span-2' : ''}>
                            <StrategyField
                              label={copy.rodBoxStrategyLabel}
                              desc={copy.rodBoxStrategyDesc}
                            >
                              {rodBoxStrategyOptions.map((option) => (
                                <OptionButton
                                  key={option.value}
                                  active={rodBoxStrategy === option.value}
                                  onClick={() => setRodBoxStrategy(option.value)}
                                >
                                  {option.label}
                                </OptionButton>
                              ))}
                            </StrategyField>
                          </div>

                          <div className={isWideLayout ? 'col-span-2' : ''}>
                            <StrategyField
                              label={copy.coaxialMergeStrategyLabel}
                              desc={copy.coaxialMergeStrategyDesc}
                            >
                              {coaxialMergeStrategyOptions.map((option) => (
                                <OptionButton
                                  key={option.value}
                                  active={coaxialJointMergeStrategy === option.value}
                                  onClick={() => setCoaxialJointMergeStrategy(option.value)}
                                >
                                  {option.label}
                                </OptionButton>
                              ))}
                            </StrategyField>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="rounded-lg border border-border-black bg-element-bg px-2 py-2">
                      <SectionLabel>{copy.rules}</SectionLabel>
                      <div
                        className={`rounded-lg border border-border-black bg-panel-bg px-2 py-2 gap-2 ${isDenseLayout ? 'flex flex-col' : 'flex items-start justify-between'}`}
                      >
                        <div className="min-w-0">
                          <div className="text-[10px] font-medium leading-tight text-text-primary">
                            {copy.avoidSiblingOverlap}
                          </div>
                          <div className="mt-0.5 text-[9px] leading-relaxed text-text-tertiary">
                            {copy.avoidSiblingOverlapDesc}
                          </div>
                        </div>
                        <CompactSwitch
                          checked={avoidSiblingOverlap}
                          onChange={setAvoidSiblingOverlap}
                          ariaLabel={copy.avoidSiblingOverlap}
                        />
                      </div>
                    </div>

                    {hasOverlapWarnings && (
                      <div className="rounded-lg border border-border-black bg-element-bg px-2 py-2">
                        <SectionLabel>{copy.warningTitle}</SectionLabel>
                        <div
                          className={`grid gap-1.5 ${isDenseLayout ? 'grid-cols-1' : 'grid-cols-2'}`}
                        >
                          <div className="rounded-lg border border-border-black bg-panel-bg px-2 py-1.5">
                            <div className="text-[8px] font-medium tracking-[0.02em] text-text-tertiary">
                              {copy.warningBefore}
                            </div>
                            <div className="mt-0.5 text-[12px] font-semibold text-text-primary">
                              {warningBefore}
                            </div>
                          </div>
                          <div className="rounded-lg border border-border-black bg-panel-bg px-2 py-1.5">
                            <div className="text-[8px] font-medium tracking-[0.02em] text-text-tertiary">
                              {copy.warningAfter}
                            </div>
                            <div className="mt-0.5 text-[12px] font-semibold text-text-primary">
                              {warningAfter}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div
        className={`shrink-0 gap-2 border-t border-border-black bg-element-bg px-2.5 py-2 ${isCompactLayout ? 'flex flex-wrap items-center' : 'flex items-center'}`}
      >
        <div
          className={`flex items-center gap-1.25 text-[9px] text-text-tertiary ${isCompactLayout ? 'order-1' : ''}`}
        >
          <RefreshCw className="h-3 w-3" />
          <span>{footerLabel}</span>
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          className={`rounded-md px-2.25 py-1.25 text-[10px] font-medium text-text-secondary transition-colors hover:bg-panel-bg hover:text-text-primary ${isCompactLayout ? 'order-2' : ''}`}
        >
          {t.cancel}
        </button>
        <button
          type="button"
          onClick={handleApply}
          disabled={activeOperations.length === 0 || isAnalyzing}
          className={`flex items-center gap-1.25 rounded-md bg-system-blue-solid px-3 py-1.25 text-[10px] font-semibold text-white transition-colors hover:bg-system-blue disabled:cursor-not-allowed disabled:opacity-50 ${isCompactLayout ? 'order-3 ml-auto' : ''}`}
        >
          <Sparkles className="h-3 w-3" />
          {copy.apply}
        </button>
      </div>
    </DraggableWindow>
  );
};

export default CollisionOptimizationDialog;
