import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, PanelLeftClose, PanelLeftOpen, ScanSearch, Square, X } from 'lucide-react';
import type { InspectionReport, RobotState } from '@/types';
import type { Language, TranslationKeys } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { useAssemblyStore } from '@/store';
import { DraggableWindow } from '@/shared/components/DraggableWindow';
import { Button } from '@/shared/components/ui/Button';
import { Dialog } from '@/shared/components/ui/Dialog';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl';
import { useDraggableWindow } from '@/shared/hooks/useDraggableWindow';
import { useManagedWindowLayer } from '@/store';
import { runRobotInspection } from '../services/aiService';
import {
  INSPECTION_PROFILE_DEFINITIONS,
  getAllInspectionProfileItemCount,
} from '../config/inspectionProfiles';
import {
  buildInspectionRunContext,
  type InspectionRunContext,
} from '../utils/inspectionRunContext';
import { buildInspectionProfileRecommendation } from '../utils/inspectionProfileRecommendation';
import {
  buildNormalInspectionPlan,
  type NormalInspectionPlanOverride,
} from '../utils/inspectionNormalPlan';
import {
  cloneSelectedInspectionProfiles,
  countSelectedInspectionProfileItems,
  countSelectedInspectionProfiles,
  createProfileScoreMetrics,
  createSelectedInspectionProfilesForProfileIds,
  restoreInspectionProfileSelection,
  toSelectedInspectionProfileMap,
  type SelectedInspectionProfiles,
} from '../utils/inspectionProfileSelection';
import { resolveInspectionIssueSelectionTarget } from '../utils/inspectionSelectionTargets';
import { exportInspectionReportPdf } from '../utils/pdfExport';
import { getScoreBgColor } from '../utils/scoreHelpers';
import { InspectionProgress, type InspectionProgressState } from './InspectionProgress';
import {
  buildInspectionProfileAnchorId,
  buildInspectionItemAnchorId,
  InspectionReportView,
} from './InspectionReport';
import { InspectionRecommendationBanner } from './InspectionRecommendationBanner';
import { InspectionSidebar } from './InspectionSidebar';
import { InspectionSetupNormalView } from './InspectionSetupNormalView';
import { InspectionSetupView } from './InspectionSetupView';
import {
  createInitialSelectedItems,
  readStoredInspectionSetupMode,
  recalculateReportMetrics,
  TOTAL_INSPECTION_ITEM_COUNT,
  writeStoredInspectionSetupMode,
  type InspectionRunPointerLayout,
  type InspectionSetupMode,
  type ReportScrollTarget,
  type RetestingItemState,
} from './inspectionModalState';

interface AIInspectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  robot: RobotState;
  lang: Language;
  onSelectItem: (type: 'link' | 'joint', id: string) => void;
  onOpenConversationWithReport: (
    report: InspectionReport,
    robotSnapshot: RobotState,
    options?: {
      selectedEntity?: { type: 'link' | 'joint'; id: string } | null;
      focusedIssue?: InspectionReport['issues'][number] | null;
    },
  ) => void;
}

const cloneInspectionRobotSnapshot = (robot: RobotState): RobotState => {
  if (typeof structuredClone === 'function') {
    return structuredClone(robot);
  }

  return JSON.parse(JSON.stringify(robot)) as RobotState;
};

const getInspectionProgressStageLabel = (
  stage: InspectionProgressState['stage'],
  t: TranslationKeys,
) => {
  switch (stage) {
    case 'preparing-context':
      return t.inspectionPreparingContext;
    case 'requesting-model':
      return t.inspectionRequestingModel;
    case 'processing-response':
      return t.inspectionProcessingResponse;
    case 'finalizing-report':
      return t.inspectionFinalizingReport;
  }
};

function DismissibleInspectionCancellationNotice({
  notice,
  t,
  onDismiss,
}: {
  notice: string;
  t: TranslationKeys;
  onDismiss: () => void;
}) {
  return (
    <div
      data-inspection-cancelled-notice
      className="flex items-start gap-3 rounded-lg border border-warning-border bg-warning-soft px-3 py-2 text-xs font-medium text-warning"
    >
      <span className="min-w-0 flex-1 leading-5">{notice}</span>
      <button
        type="button"
        data-inspection-cancelled-notice-dismiss
        aria-label={t.close}
        title={t.close}
        onClick={onDismiss}
        className="-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-warning transition-colors hover:bg-warning/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function AIInspectionModal({
  isOpen,
  onClose,
  robot,
  lang,
  onSelectItem,
  onOpenConversationWithReport,
}: AIInspectionModalProps) {
  const t = translations[lang];
  const assemblyState = useAssemblyStore((state) => state.assemblyState);
  const assemblyWorkflowContext = useMemo(() => {
    if (!assemblyState) {
      return undefined;
    }

    return {
      assemblyActive: true,
      componentCount: Object.keys(assemblyState.components).length,
      bridgeCount: Object.keys(assemblyState.bridges).length,
      componentTransformAuthored:
        Boolean(assemblyState.transform) ||
        Object.values(assemblyState.components).some((component) => Boolean(component.transform)),
    };
  }, [assemblyState]);
  const profileRecommendation = useMemo(
    () =>
      buildInspectionProfileRecommendation(robot, {
        workflowContext: assemblyWorkflowContext,
      }),
    [assemblyWorkflowContext, robot],
  );
  const profileRecommendationKey = profileRecommendation.profileIds.join('\u0000');
  const recommendedProfileIds = useMemo(
    () => (profileRecommendationKey ? profileRecommendationKey.split('\u0000') : []),
    [profileRecommendationKey],
  );
  const [normalPlanOverride, setNormalPlanOverride] = useState<NormalInspectionPlanOverride>({});
  const normalInspectionPlan = useMemo(
    () =>
      buildNormalInspectionPlan({
        robot,
        workflowContext: assemblyWorkflowContext,
        override: normalPlanOverride,
      }),
    [assemblyWorkflowContext, normalPlanOverride, robot],
  );
  const recommendedProfiles = normalInspectionPlan.selectedProfiles;
  const normalInspectionPlanKey = useMemo(
    () =>
      normalInspectionPlan.includedProfileIds
        .map((profileId) => `${profileId}:${normalInspectionPlan.selectedProfiles[profileId]?.size ?? 0}`)
        .join('\u0000'),
    [normalInspectionPlan],
  );
  const normalInspectionPlanSelectionKey = useMemo(
    () =>
      normalInspectionPlan.includedProfileIds
        .map((profileId) => {
          const itemIds = Array.from(normalInspectionPlan.selectedProfiles[profileId] ?? []).sort();
          return `${profileId}:${itemIds.join(',')}`;
        })
        .join('\u0000'),
    [normalInspectionPlan],
  );
  const windowState = useDraggableWindow({
    isOpen,
    defaultSize: { width: 1080, height: 720 },
    minSize: { width: 760, height: 520 },
    centerOnMount: true,
    enableMinimize: true,
  });
  const { isMinimized, size, isResizing } = windowState;

  const [inspectionReport, setInspectionReport] = useState<InspectionReport | null>(null);
  const [inspectionRobotSnapshot, setInspectionRobotSnapshot] = useState<RobotState | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionProgress, setInspectionProgress] = useState<InspectionProgressState | null>(
    null,
  );
  const [inspectionCancellationNotice, setInspectionCancellationNotice] = useState<string | null>(
    null,
  );
  const [inspectionElapsedSeconds, setInspectionElapsedSeconds] = useState(0);
  const [inspectionRunContext, setInspectionRunContext] = useState<InspectionRunContext | null>(
    null,
  );
  const [isRegenerateConfirmOpen, setIsRegenerateConfirmOpen] = useState(false);
  const [isSavingReportBeforeRegenerate, setIsSavingReportBeforeRegenerate] = useState(false);
  const [retestingItem, setRetestingItem] = useState<RetestingItemState | null>(null);
  const [expandedProfiles, setExpandedProfiles] = useState<Set<string>>(() => new Set());
  const [selectedProfiles, setSelectedProfiles] = useState<SelectedInspectionProfiles>(() =>
    createSelectedInspectionProfilesForProfileIds(profileRecommendation.profileIds),
  );
  const [inspectionSetupMode, setInspectionSetupMode] = useState<InspectionSetupMode>(() =>
    readStoredInspectionSetupMode(),
  );
  const [inspectionSetupSidebarCollapsed, setInspectionSetupSidebarCollapsed] = useState(true);
  const [showRunInspectionPointer, setShowRunInspectionPointer] = useState(false);
  const [runInspectionPointerReplayToken, setRunInspectionPointerReplayToken] = useState(0);
  const [runInspectionPointerLayout, setRunInspectionPointerLayout] =
    useState<InspectionRunPointerLayout>({
      deltaX: 0,
      deltaY: 0,
      targetX: 0,
      targetY: 0,
    });
  const [focusedProfileId, setFocusedProfileId] = useState<string>(
    profileRecommendation.profileIds[0] ?? INSPECTION_PROFILE_DEFINITIONS[0]?.id ?? '',
  );
  const [pendingReportScrollTarget, setPendingReportScrollTarget] =
    useState<ReportScrollTarget | null>(null);
  const [pendingSetupItemScrollTarget, setPendingSetupItemScrollTarget] =
    useState<SetupItemScrollTarget | null>(null);
  const inspectionSidebarReadOnly = Boolean(inspectionProgress || inspectionReport);

  const isMountedRef = useRef(false);
  const inspectionRunIdRef = useRef(0);
  const inspectionAbortControllerRef = useRef<AbortController | null>(null);
  const retestRequestIdRef = useRef(0);
  const reportScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const inspectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runInspectionPointerTimerRef = useRef<number | null>(null);
  const lastRunInspectionPointerKeyRef = useRef<string | null>(null);
  const lastInspectionSetupSelectionSyncKeyRef = useRef<string | null>(null);
  const runInspectionButtonRef = useRef<HTMLButtonElement | null>(null);

  const totalSelectedCount = countSelectedInspectionProfileItems(selectedProfiles);
  const selectedProfileCount = countSelectedInspectionProfiles(selectedProfiles);
  const selectedCoveragePercentage = Math.round(
    (selectedProfileCount / Math.max(INSPECTION_PROFILE_DEFINITIONS.length, 1)) * 100,
  );
  const maxPossibleScore = totalSelectedCount * 10;
  const reportRobot = inspectionRobotSnapshot ?? robot;

  const clearInspectionTimer = useCallback(() => {
    if (inspectionTimerRef.current !== null) {
      clearInterval(inspectionTimerRef.current);
      inspectionTimerRef.current = null;
    }
  }, []);

  const clearRunInspectionPointerTimer = useCallback(() => {
    if (runInspectionPointerTimerRef.current !== null) {
      window.clearTimeout(runInspectionPointerTimerRef.current);
      runInspectionPointerTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    writeStoredInspectionSetupMode(inspectionSetupMode);
  }, [inspectionSetupMode]);

  useEffect(() => {
    const selectionSyncKey = `${inspectionSetupMode}:${normalInspectionPlanSelectionKey}`;
    if (lastInspectionSetupSelectionSyncKeyRef.current === selectionSyncKey) {
      return;
    }

    lastInspectionSetupSelectionSyncKeyRef.current = selectionSyncKey;

    if (inspectionSetupMode === 'normal') {
      setExpandedProfiles(new Set(normalInspectionPlan.includedProfileIds));
      setSelectedProfiles(cloneSelectedInspectionProfiles(normalInspectionPlan.selectedProfiles));
      setFocusedProfileId(
        normalInspectionPlan.includedProfileIds[0] ??
          recommendedProfileIds[0] ??
          INSPECTION_PROFILE_DEFINITIONS[0]?.id ??
          '',
      );
      return;
    }

    setExpandedProfiles(new Set());
    setInspectionSetupSidebarCollapsed(true);
    setSelectedProfiles(cloneSelectedInspectionProfiles(normalInspectionPlan.selectedProfiles));
    setFocusedProfileId(
      normalInspectionPlan.includedProfileIds[0] ??
        recommendedProfileIds[0] ??
        INSPECTION_PROFILE_DEFINITIONS[0]?.id ??
        '',
    );
  }, [
    inspectionSetupMode,
    normalInspectionPlan.includedProfileIds,
    normalInspectionPlan.selectedProfiles,
    normalInspectionPlanKey,
    normalInspectionPlanSelectionKey,
    recommendedProfileIds,
  ]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      inspectionRunIdRef.current += 1;
      inspectionAbortControllerRef.current?.abort();
      inspectionAbortControllerRef.current = null;
      retestRequestIdRef.current += 1;
      clearInspectionTimer();
      clearRunInspectionPointerTimer();
    };
  }, [clearInspectionTimer, clearRunInspectionPointerTimer]);

  const handleClose = useCallback(() => {
    setIsRegenerateConfirmOpen(false);
    setIsSavingReportBeforeRegenerate(false);
    setShowRunInspectionPointer(false);
    onClose();
  }, [onClose]);

  const handleRunInspection = async () => {
    if (isInspecting) {
      return;
    }

    inspectionRunIdRef.current += 1;
    const runId = inspectionRunIdRef.current;
    const isRunActive = () => isMountedRef.current && inspectionRunIdRef.current === runId;
    const robotSnapshot = cloneInspectionRobotSnapshot(robot);
    const abortController = new AbortController();
    inspectionAbortControllerRef.current = abortController;

    clearInspectionTimer();
    setIsInspecting(true);
    setInspectionCancellationNotice(null);
    setIsRegenerateConfirmOpen(false);
    setIsSavingReportBeforeRegenerate(false);
    setInspectionReport(null);
    setInspectionRobotSnapshot(null);
    setPendingReportScrollTarget(null);
    setRetestingItem(null);
    setInspectionElapsedSeconds(0);

    const totalItems = countSelectedInspectionProfileItems(selectedProfiles);
    const selectedItemsMap = toSelectedInspectionProfileMap(selectedProfiles);

    if (totalItems === 0) {
      if (inspectionAbortControllerRef.current === abortController) {
        inspectionAbortControllerRef.current = null;
      }
      setInspectionProgress(null);
      setInspectionRunContext(null);
      setIsInspecting(false);
      return;
    }

    setExpandedProfiles(new Set(Object.keys(selectedItemsMap)));
    setInspectionRunContext(
      buildInspectionRunContext(robotSnapshot, selectedProfiles, lang, t.inspectionNormalizedModel),
    );
    setInspectionProgress({
      stage: 'preparing-context',
      selectedCount: totalItems,
    });
    inspectionTimerRef.current = setInterval(() => {
      if (!isRunActive()) {
        clearInspectionTimer();
        return;
      }

      setInspectionElapsedSeconds((current) => current + 1);
    }, 1000);

    try {
      const report = await runRobotInspection(robotSnapshot, selectedItemsMap, lang, {
        signal: abortController.signal,
        onStageChange: (stage) => {
          if (!isRunActive()) {
            return;
          }

          setInspectionProgress({
            stage,
            selectedCount: totalItems,
          });
        },
      });

      if (!isRunActive()) {
        return;
      }

      setInspectionRobotSnapshot(report ? robotSnapshot : null);
      setInspectionReport(report);
    } catch (error) {
      console.error('Inspection Error', error);
    } finally {
      if (isRunActive()) {
        if (inspectionAbortControllerRef.current === abortController) {
          inspectionAbortControllerRef.current = null;
        }
        clearInspectionTimer();
        setInspectionProgress(null);
        setInspectionElapsedSeconds(0);
        setIsInspecting(false);
      }
    }
  };

  const handleStopInspection = useCallback(() => {
    inspectionRunIdRef.current += 1;
    inspectionAbortControllerRef.current?.abort();
    inspectionAbortControllerRef.current = null;
    clearInspectionTimer();
    setInspectionProgress(null);
    setInspectionRunContext(null);
    setInspectionElapsedSeconds(0);
    setInspectionReport(null);
    setInspectionRobotSnapshot(null);
    setPendingReportScrollTarget(null);
    setRetestingItem(null);
    setIsRegenerateConfirmOpen(false);
    setIsSavingReportBeforeRegenerate(false);
    setIsInspecting(false);
    setInspectionCancellationNotice(t.inspectionCancelledNoReport);
  }, [clearInspectionTimer, t.inspectionCancelledNoReport]);

  const handleDismissInspectionCancellationNotice = useCallback(() => {
    setInspectionCancellationNotice(null);
  }, []);

  const handleRetestItem = async (profileId: string, itemId: string) => {
    const requestId = retestRequestIdRef.current + 1;
    retestRequestIdRef.current = requestId;
    const isRequestActive = () => isMountedRef.current && retestRequestIdRef.current === requestId;

    setRetestingItem({ profileId, itemId });

    try {
      const selectedItemsMap: Record<string, string[]> = {
        [profileId]: [itemId],
      };
      const report = await runRobotInspection(reportRobot, selectedItemsMap, lang);
      if (!isRequestActive() || !report || !inspectionReport) {
        return;
      }

      const updatedIssues = inspectionReport.issues.filter(
        (issue) => !(issue.profileId === profileId && issue.itemId === itemId),
      );
      const nextIssues = report.issues.filter(
        (issue) => issue.profileId === profileId && issue.itemId === itemId,
      );
      const mergedIssues = [...updatedIssues, ...nextIssues] as InspectionReport['issues'];
      const nextMetrics = recalculateReportMetrics(mergedIssues, inspectionReport.maxScore);

      setInspectionReport({
        ...inspectionReport,
        issues: mergedIssues,
        ...nextMetrics,
      });
    } catch (error) {
      if (!isRequestActive()) {
        return;
      }
      console.error('Retest Error', error);
    } finally {
      if (isRequestActive()) {
        setRetestingItem(null);
      }
    }
  };

  const handleToggleReportProfile = (profileId: string) => {
    setExpandedProfiles((prev) => {
      const next = new Set(prev);
      if (next.has(profileId)) {
        next.delete(profileId);
      } else {
        next.add(profileId);
      }
      return next;
    });
  };

  const ensureReportProfileExpanded = useCallback((profileId: string) => {
    setExpandedProfiles((prev) => {
      if (prev.has(profileId)) {
        return prev;
      }

      const next = new Set(prev);
      next.add(profileId);
      return next;
    });
  }, []);

  const scrollToReportAnchor = useCallback((anchorId: string) => {
    const reportScrollViewport = reportScrollViewportRef.current;
    if (!reportScrollViewport) {
      return false;
    }

    const target = reportScrollViewport.querySelector<HTMLElement>(
      `[data-inspection-anchor-id="${anchorId}"]`,
    );
    if (!target) {
      return false;
    }

    target.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
      inline: 'nearest',
    });
    return true;
  }, []);

  const handleNavigateToReportProfile = useCallback(
    (profileId: string) => {
      setFocusedProfileId(profileId);
      ensureReportProfileExpanded(profileId);
      setPendingReportScrollTarget({
        anchorId: buildInspectionProfileAnchorId(profileId),
      });
    },
    [ensureReportProfileExpanded],
  );

  const handleNavigateToReportItem = useCallback(
    (profileId: string, itemId: string) => {
      setFocusedProfileId(profileId);
      ensureReportProfileExpanded(profileId);
      setPendingReportScrollTarget({
        anchorId: buildInspectionItemAnchorId(profileId, itemId),
      });
    },
    [ensureReportProfileExpanded],
  );

  const handleNavigateToSetupItem = useCallback((profileId: string, itemId: string) => {
    setFocusedProfileId(profileId);
    setPendingSetupItemScrollTarget({ profileId, itemId });
  }, []);

  useEffect(() => {
    if (!inspectionReport || !pendingReportScrollTarget) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      if (scrollToReportAnchor(pendingReportScrollTarget.anchorId)) {
        setPendingReportScrollTarget(null);
      }
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [expandedProfiles, inspectionReport, pendingReportScrollTarget, scrollToReportAnchor]);

  useEffect(() => {
    if (
      !pendingSetupItemScrollTarget ||
      inspectionProgress ||
      inspectionReport ||
      inspectionSetupMode !== 'advanced'
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const target = reportScrollViewportRef.current?.querySelector<HTMLElement>(
        `[data-inspection-setup-item-anchor="${pendingSetupItemScrollTarget.profileId}:${pendingSetupItemScrollTarget.itemId}"]`,
      );

      if (!target) {
        return;
      }

      target.scrollIntoView?.({
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest',
      });
      target.focus({ preventScroll: true });
      setPendingSetupItemScrollTarget(null);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [inspectionProgress, inspectionReport, inspectionSetupMode, pendingSetupItemScrollTarget]);

  const handleDownloadPDF = () => {
    return exportInspectionReportPdf({
      inspectionReport,
      robotName: reportRobot.name,
      lang,
      inspectionContext: reportRobot.inspectionContext,
    });
  };

  const handleSaveReportFromConfirmDialog = async () => {
    setIsSavingReportBeforeRegenerate(true);

    try {
      await handleDownloadPDF();
    } finally {
      if (isMountedRef.current) {
        setIsSavingReportBeforeRegenerate(false);
      }
    }

    if (!isMountedRef.current) {
      return;
    }

    setIsRegenerateConfirmOpen(false);
  };

  const handleReturnToSetupFromRegenerate = useCallback(() => {
    inspectionAbortControllerRef.current?.abort();
    inspectionAbortControllerRef.current = null;
    inspectionRunIdRef.current += 1;
    clearInspectionTimer();
    setIsRegenerateConfirmOpen(false);
    setIsSavingReportBeforeRegenerate(false);
    setInspectionProgress(null);
    setInspectionRunContext(null);
    setInspectionElapsedSeconds(0);
    setInspectionReport(null);
    setInspectionRobotSnapshot(null);
    setPendingReportScrollTarget(null);
    setRetestingItem(null);
    setIsInspecting(false);
    setInspectionCancellationNotice(null);
  }, [clearInspectionTimer]);

  const handleToggleSelectedItem = useCallback((profileId: string, itemId: string) => {
    setSelectedProfiles((prev) => {
      const next = { ...prev };
      const currentItems = new Set(next[profileId] ?? []);

      if (currentItems.has(itemId)) {
        currentItems.delete(itemId);
      } else {
        currentItems.add(itemId);
      }

      next[profileId] = currentItems;
      return next;
    });
  }, []);

  const handleRestoreRecommendation = useCallback(() => {
    setExpandedProfiles(new Set(normalInspectionPlan.includedProfileIds));
    setSelectedProfiles(cloneSelectedInspectionProfiles(recommendedProfiles));
    setFocusedProfileId(
      normalInspectionPlan.includedProfileIds[0] ??
        recommendedProfileIds[0] ??
        INSPECTION_PROFILE_DEFINITIONS[0]?.id ??
        '',
    );
  }, [normalInspectionPlan.includedProfileIds, recommendedProfileIds, recommendedProfiles]);

  const handleRestoreProfileRecommendation = useCallback(
    (profileId: string) => {
      setSelectedProfiles((prev) =>
        restoreInspectionProfileSelection(prev, recommendedProfiles, profileId),
      );
    },
    [recommendedProfiles],
  );

  const handleAskAboutIssue = useCallback(
    (issue: InspectionReport['issues'][number]) => {
      if (!inspectionReport) {
        return;
      }

      onOpenConversationWithReport(inspectionReport, reportRobot, {
        focusedIssue: issue,
        selectedEntity: resolveInspectionIssueSelectionTarget(reportRobot, issue),
      });
    },
    [inspectionReport, onOpenConversationWithReport, reportRobot],
  );

  const isSetupView = !inspectionProgress && !inspectionReport;
  const shouldShowRunInspectionPointer =
    isSetupView && showRunInspectionPointer && totalSelectedCount > 0 && !isMinimized;
  const runInspectionPointerKey = `${isOpen}:${isSetupView}:${inspectionSetupMode}:${isMinimized}`;
  const inspectionSetupSummary =
    `${t.inspectionRunSummary}${lang === 'zh' ? '：' : ': '}` +
    `${t.inspectionSelectedChecks.replace('{count}', String(totalSelectedCount))} | ` +
    `${t.inspectionSelectedCategories}: ${selectedProfileCount} | ` +
    `${t.inspectionWeightedCoverage}: ${selectedCoveragePercentage}% | ` +
    `${t.inspectionMaxPossibleScore}: ${maxPossibleScore}`;

  useEffect(() => {
    if (!isOpen || !isSetupView) {
      lastRunInspectionPointerKeyRef.current = null;
      setShowRunInspectionPointer(false);
      clearRunInspectionPointerTimer();
      return;
    }

    if (isMinimized || totalSelectedCount === 0) {
      setShowRunInspectionPointer(false);
      clearRunInspectionPointerTimer();
      return;
    }

    if (lastRunInspectionPointerKeyRef.current === runInspectionPointerKey) {
      return;
    }

    lastRunInspectionPointerKeyRef.current = runInspectionPointerKey;
    setShowRunInspectionPointer(true);
    setRunInspectionPointerReplayToken((current) => current + 1);
    clearRunInspectionPointerTimer();

    runInspectionPointerTimerRef.current = window.setTimeout(() => {
      if (isMountedRef.current) {
        setShowRunInspectionPointer(false);
      }
    }, RUN_INSPECTION_POINTER_DURATION_MS);

    return () => {
      clearRunInspectionPointerTimer();
    };
  }, [
    clearRunInspectionPointerTimer,
    isMinimized,
    isOpen,
    isSetupView,
    inspectionSetupMode,
    runInspectionPointerKey,
    totalSelectedCount,
  ]);

  useEffect(() => {
    if (!shouldShowRunInspectionPointer) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const windowContainer = windowState.containerRef.current;
      const runButton = runInspectionButtonRef.current;
      const containerRect = windowContainer?.getBoundingClientRect();
      const buttonRect = runButton?.getBoundingClientRect();
      const containerWidth = containerRect?.width || size.width;
      const containerHeight = containerRect?.height || size.height;
      const originX = containerWidth / 2;
      const originY = containerHeight / 2;
      const fallbackTargetX = containerWidth - 116;
      const fallbackTargetY = containerHeight - 54;
      const targetX =
        containerRect && buttonRect && buttonRect.width > 0
          ? buttonRect.left - containerRect.left + buttonRect.width * 0.5
          : fallbackTargetX;
      const targetY =
        containerRect && buttonRect && buttonRect.height > 0
          ? buttonRect.top - containerRect.top + buttonRect.height * 0.5
          : fallbackTargetY;

      setRunInspectionPointerLayout({
        deltaX: targetX - originX,
        deltaY: targetY - originY,
        targetX,
        targetY,
      });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    shouldShowRunInspectionPointer,
    inspectionSetupMode,
    isOpen,
    size.height,
    size.width,
    windowState.containerRef,
  ]);

  if (!isOpen) {
    return null;
  }

  const runInspectionPointerOverlayStyle = {
    '--inspection-run-pointer-origin-x': '50%',
    '--inspection-run-pointer-origin-y': '50%',
    '--inspection-run-pointer-dx': `${runInspectionPointerLayout.deltaX}px`,
    '--inspection-run-pointer-dy': `${runInspectionPointerLayout.deltaY}px`,
    '--inspection-run-pointer-target-x': `${runInspectionPointerLayout.targetX}px`,
    '--inspection-run-pointer-target-y': `${runInspectionPointerLayout.targetY}px`,
  } as CSSProperties;

  return (
    <>
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[90] bg-transparent" />

      <DraggableWindow
        window={windowState}
        onClose={handleClose}
        title={
          isSetupView ? (
            <div className="flex min-w-0 items-center gap-3">
              <div
                data-inspection-setup-header-logo
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-border-black bg-panel-bg text-system-blue shadow-sm dark:bg-element-bg"
              >
                <ScanSearch className="h-[18px] w-[18px]" />
              </div>
              <h1 className="text-sm font-semibold text-text-primary">{t.aiInspection}</h1>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <div className="rounded-lg border border-border-black bg-panel-bg p-1.5 text-system-blue dark:bg-element-bg dark:text-system-blue">
                  <ScanSearch className="w-4 h-4" />
                </div>
                <h1 className="text-sm font-semibold text-text-primary">{t.aiInspection}</h1>
              </div>

              {inspectionReport && !isMinimized && (
                <div className="ml-4 hidden items-center gap-2 rounded-lg border border-border-black bg-panel-bg px-2 py-1 shadow-sm dark:bg-panel-bg md:flex">
                  <div
                    className={`w-2 h-2 rounded-full ${getScoreBgColor(
                      inspectionReport.overallScore || 0,
                      inspectionReport.maxScore || 100,
                    )}`}
                  />
                  <span className="text-[10px] font-medium tracking-wide text-text-secondary">
                    {t.overallScore}: {inspectionReport.overallScore?.toFixed(1)}/
                    {inspectionReport.maxScore ?? 100}
                  </span>
                </div>
              )}
            </>
          )
        }
        className="flex flex-col overflow-hidden rounded-2xl border border-border-black bg-panel-bg text-text-primary shadow-xl select-none dark:bg-panel-bg"
        zIndex={inspectionWindowLayer.zIndex}
        onActivate={inspectionWindowLayer.onActivate}
        headerClassName="relative h-12 border-b border-border-black flex items-center justify-between px-4 bg-element-bg shrink-0"
        headerLeftClassName={isSetupView ? 'flex min-w-0 items-center' : 'flex items-center gap-3'}
        headerRightClassName={
          isSetupView ? 'flex shrink-0 items-center gap-1 ml-auto' : 'flex items-center gap-1'
        }
        headerActions={
          isSetupView && !isMinimized ? (
            <div
              data-inspection-setup-mode-switcher
              className="absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
            >
              <SegmentedControl<InspectionSetupMode>
                options={[
                  { value: 'normal', label: t.inspectionNormalMode },
                  { value: 'advanced', label: t.inspectionAdvancedMode },
                ]}
                value={inspectionSetupMode}
                onChange={setInspectionSetupMode}
                stretch={false}
                className="w-full max-w-[300px]"
                itemClassName="min-w-[126px]"
              />
            </div>
          ) : undefined
        }
        interactionClassName="select-none"
        showMinimizeButton={false}
        minimizeTitle={t.minimize}
        maximizeTitle={t.maximize}
        restoreTitle={t.restore}
        closeTitle={t.close}
        controlButtonClassName="p-1.5 hover:bg-element-hover rounded-md transition-colors"
        closeButtonClassName="p-1.5 text-text-tertiary hover:bg-red-500 hover:text-white rounded-md transition-colors"
        rightResizeHandleClassName="absolute resize-edge-right resize-edge-visual-right top-0 bottom-0 z-20 w-2 cursor-ew-resize after:absolute after:right-0 after:top-0 after:bottom-0 after:w-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
        bottomResizeHandleClassName="absolute resize-edge-bottom resize-edge-visual-bottom left-0 right-0 z-20 h-2 cursor-ns-resize after:absolute after:bottom-0 after:left-0 after:right-0 after:h-px after:bg-transparent after:content-[''] after:transition-colors hover:after:bg-system-blue/50 active:after:bg-system-blue/70"
        cornerResizeHandleClassName="absolute resize-edge-bottom resize-edge-right z-30 flex h-6 w-6 cursor-nwse-resize items-center justify-center"
        cornerResizeHandle={<div className="h-2 w-2 border-b border-r border-border-strong" />}
      >
        {!isMinimized && (
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {isSetupView ? (
              inspectionSetupMode === 'advanced' ? (
                <>
                  {inspectionSetupSidebarCollapsed ? (
                    <div
                      data-inspection-setup-sidebar-collapsed
                      className="flex w-12 shrink-0 flex-col items-center border-r border-border-black bg-panel-bg p-2 dark:bg-element-bg"
                    >
                      <button
                        type="button"
                        aria-label={`${t.expand} ${t.inspectionItems}`}
                        title={`${t.expand} ${t.inspectionItems}`}
                        className="flex h-8 w-8 items-center justify-center rounded-lg border border-border-black bg-element-bg text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                        onClick={() => setInspectionSetupSidebarCollapsed(false)}
                      >
                        <PanelLeftOpen className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="relative flex shrink-0">
                      <InspectionSidebar
                        lang={lang}
                        t={t}
                        isGeneratingAI={isInspecting}
                        readOnly={false}
                        focusedProfileId={focusedProfileId}
                        expandedProfiles={expandedProfiles}
                        selectedProfiles={selectedProfiles}
                        recommendedProfiles={recommendedProfiles}
                        setExpandedProfiles={setExpandedProfiles}
                        setSelectedProfiles={setSelectedProfiles}
                        onFocusProfile={setFocusedProfileId}
                        onNavigateToSetupItem={handleNavigateToSetupItem}
                      />

                      <button
                        type="button"
                        aria-label={t.collapseSidebar}
                        title={t.collapseSidebar}
                        className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-lg border border-border-black bg-element-bg text-text-tertiary shadow-sm transition-colors hover:bg-element-hover hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                        onClick={() => setInspectionSetupSidebarCollapsed(true)}
                      >
                        <PanelLeftClose className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}

                  <div
                    ref={reportScrollViewportRef}
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app-bg dark:bg-panel-bg"
                  >
                    <div className="flex flex-1 flex-col gap-4 p-6">
                      {inspectionCancellationNotice && (
                        <DismissibleInspectionCancellationNotice
                          notice={inspectionCancellationNotice}
                          t={t}
                          onDismiss={handleDismissInspectionCancellationNotice}
                        />
                      )}
                      <InspectionRecommendationBanner
                        t={t}
                        plan={normalInspectionPlan}
                        selectedProfiles={selectedProfiles}
                        recommendedProfiles={recommendedProfiles}
                        totalItemCount={TOTAL_INSPECTION_ITEM_COUNT}
                        onRestoreRecommendation={handleRestoreRecommendation}
                      />
                      <InspectionSetupView
                        robot={robot}
                        lang={lang}
                        t={t}
                        selectedProfiles={selectedProfiles}
                        recommendedProfiles={recommendedProfiles}
                        focusedProfileId={focusedProfileId}
                        onToggleItem={handleToggleSelectedItem}
                        onRestoreProfileRecommendation={handleRestoreProfileRecommendation}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <div
                  ref={reportScrollViewportRef}
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app-bg dark:bg-panel-bg"
                >
                  <div className="flex flex-1 flex-col p-6">
                    {inspectionCancellationNotice && (
                      <div className="mb-4">
                        <DismissibleInspectionCancellationNotice
                          notice={inspectionCancellationNotice}
                          t={t}
                          onDismiss={handleDismissInspectionCancellationNotice}
                        />
                      </div>
                    )}
                    <InspectionSetupNormalView
                      lang={lang}
                      t={t}
                      plan={normalInspectionPlan}
                      override={normalPlanOverride}
                      onOverrideChange={setNormalPlanOverride}
                    />
                  </div>
                </div>
              )
            ) : (
              <>
                {inspectionProgress ? null : (
                  <InspectionSidebar
                    lang={lang}
                    t={t}
                    isGeneratingAI={isInspecting}
                    readOnly={inspectionSidebarReadOnly}
                    focusedProfileId={focusedProfileId}
                    expandedProfiles={expandedProfiles}
                    selectedProfiles={selectedProfiles}
                    recommendedProfiles={recommendedProfiles}
                    setExpandedProfiles={setExpandedProfiles}
                    setSelectedProfiles={setSelectedProfiles}
                    onFocusProfile={setFocusedProfileId}
                    onNavigateToProfile={
                      inspectionReport ? handleNavigateToReportProfile : undefined
                    }
                    onNavigateToItem={inspectionReport ? handleNavigateToReportItem : undefined}
                  />
                )}

                <div
                  ref={reportScrollViewportRef}
                  className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app-bg dark:bg-panel-bg"
                >
                  <div className="flex flex-1 flex-col p-6">
                    {inspectionProgress && inspectionRunContext ? (
                      <InspectionProgress
                        progress={inspectionProgress}
                        elapsedSeconds={inspectionElapsedSeconds}
                        runContext={inspectionRunContext}
                        t={t}
                      />
                    ) : inspectionReport ? (
                      <div className="animate-in slide-in-from-bottom-2 fade-in duration-300">
                        <div className="space-y-6 pb-20">
                          <InspectionReportView
                            report={inspectionReport}
                            robot={reportRobot}
                            lang={lang}
                            t={t}
                            expandedProfiles={expandedProfiles}
                            retestingItem={retestingItem}
                            isGeneratingAI={isInspecting}
                            onToggleProfile={handleToggleReportProfile}
                            onRetestItem={handleRetestItem}
                            onDownloadPDF={handleDownloadPDF}
                            onSelectItem={onSelectItem}
                            onAskAboutIssue={handleAskAboutIssue}
                          />

                          <div className="flex justify-center">
                            <button
                              onClick={() =>
                                onOpenConversationWithReport(inspectionReport, reportRobot)
                              }
                              className="h-8 rounded-lg border border-border-black bg-panel-bg px-4 text-xs font-medium text-system-blue shadow-sm transition-colors hover:bg-element-bg dark:bg-element-bg"
                            >
                              <span className="flex items-center gap-2">
                                <MessageCircle className="w-4 h-4" />
                                {t.discussReportWithAI}
                              </span>
                            </button>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <div
          data-inspection-progress-footer={inspectionProgress ? 'true' : undefined}
          className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-t border-border-black bg-element-bg px-4 py-2"
        >
          {inspectionProgress ? (
            <>
              <div className="flex min-w-0 items-center gap-2 text-xs font-medium text-text-secondary">
                <span
                  aria-hidden="true"
                  className="h-2 w-2 shrink-0 rounded-full bg-system-blue"
                />
                <span className="truncate">
                  {getInspectionProgressStageLabel(inspectionProgress.stage, t)}
                </span>
              </div>

              <button
                type="button"
                onClick={handleStopInspection}
                className="inline-flex h-8 items-center gap-2 rounded-lg border border-border-black bg-panel-bg px-4 text-xs font-semibold text-text-secondary shadow-sm transition-colors hover:bg-element-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 dark:bg-element-bg"
              >
                <Square className="h-3.5 w-3.5" />
                {t.inspectionStopReview}
              </button>
            </>
          ) : inspectionReport ? (
            <>
              <div className="flex min-w-0 items-center gap-2" />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsRegenerateConfirmOpen(true)}
                  disabled={isSavingReportBeforeRegenerate}
                  className="h-8 rounded-lg bg-system-blue-solid px-5 text-xs font-semibold text-white transition-colors hover:bg-system-blue-hover disabled:opacity-30"
                >
                  {t.retryLastResponse}
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="min-w-0 flex-1">
                {inspectionSetupMode === 'normal' ? (
                  <div
                    data-inspection-normal-footer-summary
                    className="inline-flex items-center gap-3 rounded-xl border border-border-black bg-panel-bg px-3 py-2 shadow-sm"
                  >
                    <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                      {t.inspectionSelectedChecksLabel}
                    </span>
                    <div className="flex items-baseline gap-1.5">
                      <span
                        data-inspection-normal-footer-primary-count
                        className="text-2xl font-semibold leading-none tabular-nums text-text-primary"
                      >
                        {totalSelectedCount}
                      </span>
                      <span className="text-xs font-medium text-text-tertiary">/</span>
                      <span
                        data-inspection-normal-footer-total-count
                        className="text-sm font-semibold tabular-nums text-text-secondary"
                      >
                        {TOTAL_INSPECTION_ITEM_COUNT}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div
                    data-inspection-setup-summary
                    className="inline-flex w-fit max-w-full flex-wrap items-center rounded-lg border border-border-black bg-panel-bg px-3 py-2 text-[11px] leading-5 text-text-secondary shadow-sm"
                  >
                    {inspectionSetupSummary}
                  </div>
                )}
              </div>

              <div className="relative flex items-center gap-2">
                <button
                  onClick={handleClose}
                  className="h-8 rounded-lg px-4 text-xs font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary"
                >
                  {t.cancel}
                </button>
                <button
                  key={
                    shouldShowRunInspectionPointer
                      ? `run-inspection-cue-${runInspectionPointerReplayToken}`
                      : 'run-inspection'
                  }
                  ref={runInspectionButtonRef}
                  data-inspection-run-button
                  onClick={handleRunInspection}
                  disabled={isInspecting || totalSelectedCount === 0}
                  className={`h-8 rounded-lg bg-system-blue-solid px-5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-system-blue-hover disabled:opacity-30 ${
                    shouldShowRunInspectionPointer
                      ? 'inspection-run-cta-pulse inspection-run-cta-breathe-sync'
                      : ''
                  }`}
                  title={totalSelectedCount === 0 ? t.inspectionNoChecksSelected : undefined}
                >
                  {isInspecting ? t.thinking : t.runInspection}
                </button>
              </div>
            </>
          )}
        </div>
        {isResizing && (
          <div className="absolute bottom-2 right-12 z-50 rounded-lg bg-system-blue-solid px-2 py-1 text-[10px] font-medium text-white shadow-sm">
            {size.width} × {size.height}
          </div>
        )}
      </DraggableWindow>

      {shouldShowRunInspectionPointer &&
        windowState.containerRef.current &&
        createPortal(
          <div
            key={`run-inspection-pointer-${runInspectionPointerReplayToken}`}
            data-inspection-run-pointer-overlay
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-40 overflow-hidden"
            style={runInspectionPointerOverlayStyle}
          >
            <span
              className="inspection-run-pointer-target absolute h-3 w-3 rounded-full border border-system-blue/25 bg-system-blue/10"
              style={{
                left: 'var(--inspection-run-pointer-target-x)',
                top: 'var(--inspection-run-pointer-target-y)',
                transform: 'translate(-50%, -50%)',
              }}
            />
            <div
              data-inspection-run-pointer
              className="absolute"
              style={{
                left: 'var(--inspection-run-pointer-origin-x)',
                top: 'var(--inspection-run-pointer-origin-y)',
                transform: 'translate(-50%, -50%)',
              }}
            >
              <svg
                viewBox="0 0 20 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="inspection-run-pointer-cta h-8 w-7 text-system-blue"
              >
                <path
                  d="M3 1.75V17.2L7.4 14.02L9.72 19.25L12.65 17.94L10.35 12.75L16.02 12.4L3 1.75Z"
                  fill="var(--ui-panel-bg)"
                  stroke="currentColor"
                  strokeWidth="1.35"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>,
          windowState.containerRef.current,
        )}

      <Dialog
        isOpen={isRegenerateConfirmOpen}
        onClose={() => {
          if (!isSavingReportBeforeRegenerate) {
            setIsRegenerateConfirmOpen(false);
          }
        }}
        title={t.inspectionRegenerateConfirmTitle}
        width="w-[460px]"
        closeLabel={t.close}
        zIndexClassName="z-[260]"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setIsRegenerateConfirmOpen(false)}
              disabled={isSavingReportBeforeRegenerate}
            >
              {t.back}
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                void handleSaveReportFromConfirmDialog();
              }}
              isLoading={isSavingReportBeforeRegenerate}
            >
              {t.saveReport}
            </Button>
            <Button
              type="button"
              onClick={() => {
                handleReturnToSetupFromRegenerate();
              }}
              disabled={isSavingReportBeforeRegenerate}
            >
              {t.retryLastResponse}
            </Button>
          </div>
        }
      >
        <p className="text-sm leading-6 text-text-secondary">
          {t.inspectionRegenerateConfirmMessage}
        </p>
      </Dialog>
    </>
  );
}

export default AIInspectionModal;
