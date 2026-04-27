import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { MessageCircle, ScanSearch } from 'lucide-react';
import type { InspectionReport, RobotState } from '@/types';
import type { Language } from '@/shared/i18n';
import { translations } from '@/shared/i18n';
import { DraggableWindow } from '@/shared/components';
import { Button } from '@/shared/components/ui/Button';
import { Dialog } from '@/shared/components/ui/Dialog';
import { SegmentedControl } from '@/shared/components/ui/SegmentedControl';
import { useDraggableWindow } from '@/shared/hooks';
import { runRobotInspection } from '../services/aiService';
import { calculateOverallScore, INSPECTION_CRITERIA } from '../utils/inspectionCriteria';
import {
  buildInspectionRunContext,
  type InspectionRunContext,
} from '../utils/inspectionRunContext';
import { resolveInspectionIssueSelectionTarget } from '../utils/inspectionSelectionTargets';
import { exportInspectionReportPdf } from '../utils/pdfExport';
import { getScoreBgColor } from '../utils/scoreHelpers';
import { InspectionProgress, type InspectionProgressState } from './InspectionProgress';
import {
  buildInspectionCategoryAnchorId,
  buildInspectionItemAnchorId,
  InspectionReportView,
} from './InspectionReport';
import { InspectionSidebar, type SelectedInspectionItems } from './InspectionSidebar';
import { InspectionSetupNormalView } from './InspectionSetupNormalView';
import { InspectionSetupView } from './InspectionSetupView';

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

interface RetestingItemState {
  categoryId: string;
  itemId: string;
}

interface ReportScrollTarget {
  anchorId: string;
}

interface InspectionRunPointerLayout {
  deltaX: number;
  deltaY: number;
  targetX: number;
  targetY: number;
}

type InspectionSetupMode = 'normal' | 'advanced';

const INSPECTION_SETUP_MODE_STORAGE_KEY = 'urdf-studio.ai-inspection.setup-mode';
const TOTAL_INSPECTION_ITEM_COUNT = INSPECTION_CRITERIA.reduce(
  (sum, category) => sum + category.items.length,
  0,
);

function readStoredInspectionSetupMode(): InspectionSetupMode {
  if (typeof window === 'undefined') {
    return 'advanced';
  }

  try {
    const storedMode = window.localStorage.getItem(INSPECTION_SETUP_MODE_STORAGE_KEY);
    return storedMode === 'normal' || storedMode === 'advanced' ? storedMode : 'advanced';
  } catch {
    return 'advanced';
  }
}

function createInitialSelectedItems(): SelectedInspectionItems {
  const initial: SelectedInspectionItems = {};
  INSPECTION_CRITERIA.forEach((category) => {
    initial[category.id] = new Set(category.items.map((item) => item.id));
  });
  return initial;
}

function recalculateReportMetrics(
  issues: InspectionReport['issues'],
  fallbackMaxScore: number | undefined,
): Pick<InspectionReport, 'overallScore' | 'categoryScores' | 'maxScore'> {
  const categoryScoreBuckets: Record<string, number[]> = {};
  INSPECTION_CRITERIA.forEach((category) => {
    categoryScoreBuckets[category.id] = [];
  });

  issues.forEach((issue) => {
    if (!issue.category || issue.score === undefined) {
      return;
    }
    if (!categoryScoreBuckets[issue.category]) {
      categoryScoreBuckets[issue.category] = [];
    }
    categoryScoreBuckets[issue.category].push(issue.score);
  });

  const categoryScores: Record<string, number> = {};
  Object.entries(categoryScoreBuckets).forEach(([categoryId, scores]) => {
    categoryScores[categoryId] =
      scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 10;
  });

  const allItemScores = issues
    .map((issue) => issue.score)
    .filter((score): score is number => score !== undefined);

  const overallScore = calculateOverallScore(categoryScores, allItemScores);

  return {
    overallScore: Math.round(overallScore * 10) / 10,
    categoryScores,
    maxScore: allItemScores.length > 0 ? allItemScores.length * 10 : (fallbackMaxScore ?? 100),
  };
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
  const windowState = useDraggableWindow({
    isOpen,
    defaultSize: { width: 1080, height: 720 },
    minSize: { width: 760, height: 520 },
    centerOnMount: true,
    enableMinimize: true,
  });
  const { isMinimized, size, isResizing } = windowState;

  const [inspectionReport, setInspectionReport] = useState<InspectionReport | null>(null);
  const [isInspecting, setIsInspecting] = useState(false);
  const [inspectionProgress, setInspectionProgress] = useState<InspectionProgressState | null>(
    null,
  );
  const [inspectionElapsedSeconds, setInspectionElapsedSeconds] = useState(0);
  const [inspectionRunContext, setInspectionRunContext] = useState<InspectionRunContext | null>(
    null,
  );
  const [isRegenerateConfirmOpen, setIsRegenerateConfirmOpen] = useState(false);
  const [isSavingReportBeforeRegenerate, setIsSavingReportBeforeRegenerate] = useState(false);
  const [retestingItem, setRetestingItem] = useState<RetestingItemState | null>(null);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(INSPECTION_CRITERIA.map((category) => category.id)),
  );
  const [selectedItems, setSelectedItems] = useState<SelectedInspectionItems>(() =>
    createInitialSelectedItems(),
  );
  const [inspectionSetupMode, setInspectionSetupMode] = useState<InspectionSetupMode>(() =>
    readStoredInspectionSetupMode(),
  );
  const [showRunInspectionPointer, setShowRunInspectionPointer] = useState(false);
  const [runInspectionPointerReplayToken, setRunInspectionPointerReplayToken] = useState(0);
  const [runInspectionPointerLayout, setRunInspectionPointerLayout] =
    useState<InspectionRunPointerLayout>({
      deltaX: 0,
      deltaY: 0,
      targetX: 0,
      targetY: 0,
    });
  const [focusedCategoryId, setFocusedCategoryId] = useState<string>(
    INSPECTION_CRITERIA[0]?.id ?? '',
  );
  const [pendingReportScrollTarget, setPendingReportScrollTarget] =
    useState<ReportScrollTarget | null>(null);
  const inspectionSidebarReadOnly = Boolean(inspectionProgress || inspectionReport);

  const isMountedRef = useRef(false);
  const inspectionRunIdRef = useRef(0);
  const retestRequestIdRef = useRef(0);
  const reportScrollViewportRef = useRef<HTMLDivElement | null>(null);
  const inspectionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runInspectionPointerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRunInspectionPointerKeyRef = useRef<string | null>(null);
  const runInspectionButtonRef = useRef<HTMLButtonElement | null>(null);

  let totalSelectedCount = 0;
  let selectedCategoryCount = 0;
  let selectedWeight = 0;

  INSPECTION_CRITERIA.forEach((category) => {
    const count = selectedItems[category.id]?.size ?? 0;
    totalSelectedCount += count;
    if (count > 0) {
      selectedCategoryCount += 1;
      selectedWeight += category.weight;
    }
  });

  const selectedWeightPercentage = Math.round(selectedWeight * 100);
  const maxPossibleScore = totalSelectedCount * 10;

  const clearInspectionTimer = useCallback(() => {
    if (inspectionTimerRef.current !== null) {
      clearInterval(inspectionTimerRef.current);
      inspectionTimerRef.current = null;
    }
  }, []);

  const clearRunInspectionPointerTimer = useCallback(() => {
    if (runInspectionPointerTimerRef.current !== null) {
      clearTimeout(runInspectionPointerTimerRef.current);
      runInspectionPointerTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    try {
      window.localStorage.setItem(INSPECTION_SETUP_MODE_STORAGE_KEY, inspectionSetupMode);
    } catch {
      // Ignore storage write failures and keep the in-memory mode.
    }
  }, [inspectionSetupMode]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      inspectionRunIdRef.current += 1;
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

    clearInspectionTimer();
    setIsInspecting(true);
    setIsRegenerateConfirmOpen(false);
    setIsSavingReportBeforeRegenerate(false);
    setInspectionReport(null);
    setPendingReportScrollTarget(null);
    setRetestingItem(null);
    setInspectionElapsedSeconds(0);

    let totalItems = 0;
    Object.keys(selectedItems).forEach((categoryId) => {
      totalItems += selectedItems[categoryId]?.size || 0;
    });

    const selectedItemsMap: Record<string, string[]> = {};
    Object.keys(selectedItems).forEach((categoryId) => {
      const itemIds = Array.from(selectedItems[categoryId]);
      if (itemIds.length > 0) {
        selectedItemsMap[categoryId] = itemIds;
      }
    });

    if (totalItems === 0) {
      setInspectionProgress(null);
      setInspectionRunContext(null);
      setIsInspecting(false);
      return;
    }

    setInspectionRunContext(
      buildInspectionRunContext(robot, selectedItems, lang, t.inspectionNormalizedModel),
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
      const report = await runRobotInspection(robot, selectedItemsMap, lang, {
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

      setInspectionReport(report);
    } catch (error) {
      console.error('Inspection Error', error);
    } finally {
      if (isRunActive()) {
        clearInspectionTimer();
        setInspectionProgress(null);
        setInspectionElapsedSeconds(0);
        setIsInspecting(false);
      }
    }
  };

  const handleRetestItem = async (categoryId: string, itemId: string) => {
    const requestId = retestRequestIdRef.current + 1;
    retestRequestIdRef.current = requestId;
    const isRequestActive = () => isMountedRef.current && retestRequestIdRef.current === requestId;

    setRetestingItem({ categoryId, itemId });

    try {
      const selectedItemsMap: Record<string, string[]> = {
        [categoryId]: [itemId],
      };
      const report = await runRobotInspection(robot, selectedItemsMap, lang);
      if (!isRequestActive() || !report || !inspectionReport) {
        return;
      }

      const updatedIssues = inspectionReport.issues.filter(
        (issue) => !(issue.category === categoryId && issue.itemId === itemId),
      );
      const nextIssues = report.issues.filter(
        (issue) => issue.category === categoryId && issue.itemId === itemId,
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

  const handleToggleReportCategory = (categoryId: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) {
        next.delete(categoryId);
      } else {
        next.add(categoryId);
      }
      return next;
    });
  };

  const ensureReportCategoryExpanded = useCallback((categoryId: string) => {
    setExpandedCategories((prev) => {
      if (prev.has(categoryId)) {
        return prev;
      }

      const next = new Set(prev);
      next.add(categoryId);
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

  const handleNavigateToReportCategory = useCallback(
    (categoryId: string) => {
      setFocusedCategoryId(categoryId);
      ensureReportCategoryExpanded(categoryId);
      setPendingReportScrollTarget({
        anchorId: buildInspectionCategoryAnchorId(categoryId),
      });
    },
    [ensureReportCategoryExpanded],
  );

  const handleNavigateToReportItem = useCallback(
    (categoryId: string, itemId: string) => {
      setFocusedCategoryId(categoryId);
      ensureReportCategoryExpanded(categoryId);
      setPendingReportScrollTarget({
        anchorId: buildInspectionItemAnchorId(categoryId, itemId),
      });
    },
    [ensureReportCategoryExpanded],
  );

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
  }, [expandedCategories, inspectionReport, pendingReportScrollTarget, scrollToReportAnchor]);

  const handleDownloadPDF = () => {
    return exportInspectionReportPdf({
      inspectionReport,
      robotName: robot.name,
      lang,
      inspectionContext: robot.inspectionContext,
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
    clearInspectionTimer();
    setIsRegenerateConfirmOpen(false);
    setIsSavingReportBeforeRegenerate(false);
    setInspectionProgress(null);
    setInspectionRunContext(null);
    setInspectionElapsedSeconds(0);
    setInspectionReport(null);
    setPendingReportScrollTarget(null);
    setRetestingItem(null);
    setIsInspecting(false);
  }, [clearInspectionTimer]);

  const handleToggleSelectedItem = useCallback((categoryId: string, itemId: string) => {
    setSelectedItems((prev) => {
      const next = { ...prev };
      const currentItems = new Set(next[categoryId] ?? []);

      if (currentItems.has(itemId)) {
        currentItems.delete(itemId);
      } else {
        currentItems.add(itemId);
      }

      next[categoryId] = currentItems;
      return next;
    });
  }, []);

  const handleAskAboutIssue = useCallback(
    (issue: InspectionReport['issues'][number]) => {
      if (!inspectionReport) {
        return;
      }

      onOpenConversationWithReport(inspectionReport, robot, {
        focusedIssue: issue,
        selectedEntity: resolveInspectionIssueSelectionTarget(robot, issue),
      });
    },
    [inspectionReport, onOpenConversationWithReport, robot],
  );

  const isSetupView = !inspectionProgress && !inspectionReport;
  const shouldShowRunInspectionPointer =
    isSetupView && showRunInspectionPointer && totalSelectedCount > 0 && !isMinimized;
  const runInspectionPointerKey = `${isOpen}:${isSetupView}:${inspectionSetupMode}:${isMinimized}`;
  const inspectionSetupSummary =
    `${t.inspectionRunSummary}${lang === 'zh' ? '：' : ': '}` +
    `${t.inspectionSelectedChecks.replace('{count}', String(totalSelectedCount))} | ` +
    `${t.inspectionSelectedCategories}: ${selectedCategoryCount} | ` +
    `${t.inspectionWeightedCoverage}: ${selectedWeightPercentage}% | ` +
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

    runInspectionPointerTimerRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        setShowRunInspectionPointer(false);
      }
    }, 2400);

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
                    {t.overallScore}: {inspectionReport.overallScore?.toFixed(1)}
                  </span>
                </div>
              )}
            </>
          )
        }
        className="z-[100] flex flex-col overflow-hidden rounded-2xl border border-border-black bg-panel-bg text-text-primary shadow-xl select-none dark:bg-panel-bg"
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
        minimizeTitle={t.minimize}
        maximizeTitle={t.maximize}
        restoreTitle={t.restore}
        closeTitle={t.close}
        controlButtonClassName="p-1.5 hover:bg-element-hover rounded-md transition-colors"
        closeButtonClassName="p-1.5 text-text-tertiary hover:bg-red-500 hover:text-white rounded-md transition-colors"
        rightResizeHandleClassName="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-system-blue/15 active:bg-system-blue/25 transition-colors z-20"
        bottomResizeHandleClassName="absolute bottom-0 left-0 right-0 h-2 cursor-ns-resize hover:bg-system-blue/15 active:bg-system-blue/25 transition-colors z-20"
        cornerResizeHandleClassName="absolute bottom-0 right-0 w-6 h-6 cursor-nwse-resize hover:bg-system-blue/20 active:bg-system-blue/30 transition-colors z-30 flex items-center justify-center"
        cornerResizeHandle={<div className="w-2 h-2 border-r-2 border-b-2 border-border-strong" />}
      >
        {!isMinimized && (
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            {isSetupView ? (
              inspectionSetupMode === 'advanced' ? (
                <>
                  <InspectionSidebar
                    lang={lang}
                    t={t}
                    isGeneratingAI={isInspecting}
                    readOnly={false}
                    focusedCategoryId={focusedCategoryId}
                    expandedCategories={expandedCategories}
                    selectedItems={selectedItems}
                    setExpandedCategories={setExpandedCategories}
                    setSelectedItems={setSelectedItems}
                    onFocusCategory={setFocusedCategoryId}
                  />

                  <div
                    ref={reportScrollViewportRef}
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-app-bg dark:bg-panel-bg"
                  >
                    <div className="flex flex-1 flex-col p-6">
                      <InspectionSetupView
                        robot={robot}
                        lang={lang}
                        t={t}
                        selectedItems={selectedItems}
                        focusedCategoryId={focusedCategoryId}
                        onToggleItem={handleToggleSelectedItem}
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
                    <InspectionSetupNormalView
                      lang={lang}
                      t={t}
                      selectedItems={selectedItems}
                      setSelectedItems={setSelectedItems}
                      onFocusCategory={setFocusedCategoryId}
                    />
                  </div>
                </div>
              )
            ) : (
              <>
                <InspectionSidebar
                  lang={lang}
                  t={t}
                  isGeneratingAI={isInspecting}
                  readOnly={inspectionSidebarReadOnly}
                  focusedCategoryId={focusedCategoryId}
                  expandedCategories={expandedCategories}
                  selectedItems={selectedItems}
                  setExpandedCategories={setExpandedCategories}
                  setSelectedItems={setSelectedItems}
                  onFocusCategory={setFocusedCategoryId}
                  onNavigateToCategory={
                    inspectionReport ? handleNavigateToReportCategory : undefined
                  }
                  onNavigateToItem={inspectionReport ? handleNavigateToReportItem : undefined}
                />

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
                            robot={robot}
                            lang={lang}
                            t={t}
                            expandedCategories={expandedCategories}
                            retestingItem={retestingItem}
                            isGeneratingAI={isInspecting}
                            onToggleCategory={handleToggleReportCategory}
                            onRetestItem={handleRetestItem}
                            onDownloadPDF={handleDownloadPDF}
                            onSelectItem={onSelectItem}
                            onAskAboutIssue={handleAskAboutIssue}
                          />

                          <div className="flex justify-center">
                            <button
                              onClick={() => onOpenConversationWithReport(inspectionReport, robot)}
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

        {!inspectionProgress && (
          <div className="flex min-h-14 items-center justify-between gap-3 border-t border-border-black bg-element-bg px-4 py-2 shrink-0">
            {inspectionReport ? (
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
        )}

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
        zIndexClassName="z-[130]"
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
