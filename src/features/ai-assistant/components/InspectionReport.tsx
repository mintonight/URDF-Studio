import {
  AlertCircle,
  AlertTriangle,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Crosshair,
  FileText,
  Info,
  LayoutGrid,
  Loader2,
  MessageCircle,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { InspectionReport, RobotState } from '@/types';
import { translations, type Language, type TranslationKeys } from '@/shared/i18n';
import { buildInspectionEvidenceSummary } from '@/shared/utils/inspectionEvidenceSummary';
import { getInspectionItem, INSPECTION_CRITERIA } from '../utils/inspectionCriteria';
import {
  resolveInspectionIssueRelatedEntities,
  resolveInspectionIssueSelectionTarget,
} from '../utils/inspectionSelectionTargets';
import { getScoreBgColor, getScoreColor } from '../utils/scoreHelpers';
import { getInspectionCategoryIcon } from './inspectionCategoryIcon';

interface RetestingItemState {
  categoryId: string;
  itemId: string;
}

interface InspectionReportProps {
  report: InspectionReport;
  robot: RobotState;
  lang: Language;
  t: TranslationKeys;
  expandedCategories: Set<string>;
  retestingItem: RetestingItemState | null;
  isGeneratingAI: boolean;
  onToggleCategory: (categoryId: string) => void;
  onRetestItem: (categoryId: string, itemId: string) => void;
  onDownloadPDF: () => void;
  onSelectItem: (type: 'link' | 'joint', id: string) => void;
  onAskAboutIssue: (issue: InspectionReport['issues'][number]) => void;
}

const ISSUE_PRIORITY: Record<string, number> = {
  error: 0,
  warning: 1,
  suggestion: 2,
  pass: 3,
};

interface InspectionItemGroup {
  key: string;
  itemId: string | null;
  title: string;
  description: string | null;
  issues: InspectionReport['issues'];
  hasProblems: boolean;
  nonPassCount: number;
  anchorId: string | null;
  primaryIssueType: string;
}

export function buildInspectionCategoryAnchorId(categoryId: string) {
  return `inspection-category-${categoryId}`;
}

export function buildInspectionItemAnchorId(categoryId: string, itemId: string) {
  return `inspection-item-${categoryId}-${itemId}`;
}

function compareIssuesByPriority(
  a: InspectionReport['issues'][number],
  b: InspectionReport['issues'][number],
) {
  const priorityDelta = (ISSUE_PRIORITY[a.type] ?? 99) - (ISSUE_PRIORITY[b.type] ?? 99);
  if (priorityDelta !== 0) {
    return priorityDelta;
  }

  return (a.score ?? 10) - (b.score ?? 10);
}

function getIssueMeta(issueType: string, lang: Language) {
  const t = translations[lang];
  if (issueType === 'error') {
    return {
      Icon: AlertCircle,
      label: t.issueError,
      rowClass: 'border-red-200/80 dark:border-red-900/60',
      stripeClass: 'bg-red-500',
      iconClass:
        'text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-950/60 border-red-200/80 dark:border-red-900/60',
      badgeClass:
        'text-red-700 dark:text-red-300 bg-red-50/80 dark:bg-red-950/50 border-red-200 dark:border-red-900/70',
    };
  }

  if (issueType === 'warning') {
    return {
      Icon: AlertTriangle,
      label: t.issueWarning,
      rowClass: 'border-amber-200/80 dark:border-amber-900/60',
      stripeClass: 'bg-amber-500',
      iconClass:
        'text-amber-600 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/60 border-amber-200/80 dark:border-amber-900/60',
      badgeClass:
        'text-amber-700 dark:text-amber-300 bg-amber-50/80 dark:bg-amber-950/50 border-amber-200 dark:border-amber-900/70',
    };
  }

  if (issueType === 'suggestion') {
    return {
      Icon: Sparkles,
      label: t.issueSuggestion,
      rowClass: 'border-system-blue/30 dark:border-system-blue/35',
      stripeClass: 'bg-system-blue',
      iconClass:
        'text-system-blue bg-system-blue/10 dark:bg-system-blue/20 border-system-blue/30 dark:border-system-blue/35',
      badgeClass:
        'text-system-blue bg-system-blue/10 dark:bg-system-blue/20 border-system-blue/30 dark:border-system-blue/35',
    };
  }

  if (issueType === 'pass') {
    return {
      Icon: Check,
      label: t.issuePass,
      rowClass: 'border-emerald-200/80 dark:border-emerald-900/60',
      stripeClass: 'bg-emerald-500',
      iconClass:
        'text-emerald-600 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200/80 dark:border-emerald-900/60',
      badgeClass:
        'text-emerald-700 dark:text-emerald-300 bg-emerald-50/80 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900/70',
    };
  }

  return {
    Icon: Info,
    label: t.issueInfo,
    rowClass: 'border-border-black',
    stripeClass: 'bg-border-strong',
    iconClass: 'text-text-tertiary bg-element-bg border-border-black',
    badgeClass: 'text-text-secondary bg-element-bg border-border-black',
  };
}

function buildInspectionItemGroups(
  categoryId: string,
  categoryIssues: InspectionReport['issues'],
  lang: Language,
): InspectionItemGroup[] {
  const groupedIssues = new Map<string, InspectionReport['issues']>();
  const unmappedGroups: InspectionItemGroup[] = [];

  categoryIssues.forEach((issue, index) => {
    if (!issue.itemId) {
      unmappedGroups.push({
        key: `unmapped-${index}`,
        itemId: null,
        title: issue.title,
        description: null,
        issues: [issue],
        hasProblems: issue.type !== 'pass',
        nonPassCount: issue.type === 'pass' ? 0 : 1,
        anchorId: null,
        primaryIssueType: issue.type,
      });
      return;
    }

    const existingIssues = groupedIssues.get(issue.itemId) ?? [];
    existingIssues.push(issue);
    groupedIssues.set(issue.itemId, existingIssues);
  });

  const itemGroups: InspectionItemGroup[] = [];
  const category = INSPECTION_CRITERIA.find((entry) => entry.id === categoryId);

  category?.items.forEach((item) => {
    const groupedItemIssues = groupedIssues.get(item.id);
    if (!groupedItemIssues?.length) {
      return;
    }

    const orderedIssues = [...groupedItemIssues].sort(compareIssuesByPriority);
    const nonPassCount = orderedIssues.filter((issue) => issue.type !== 'pass').length;

    itemGroups.push({
      key: item.id,
      itemId: item.id,
      title: lang === 'zh' ? item.nameZh : item.name,
      description: lang === 'zh' ? item.descriptionZh : item.description,
      issues: orderedIssues,
      hasProblems: nonPassCount > 0,
      nonPassCount,
      anchorId: buildInspectionItemAnchorId(categoryId, item.id),
      primaryIssueType: orderedIssues[0]?.type ?? 'pass',
    });

    groupedIssues.delete(item.id);
  });

  Array.from(groupedIssues.entries())
    .sort(([leftItemId], [rightItemId]) => leftItemId.localeCompare(rightItemId))
    .forEach(([itemId, groupedItemIssues]) => {
      const orderedIssues = [...groupedItemIssues].sort(compareIssuesByPriority);
      const nonPassCount = orderedIssues.filter((issue) => issue.type !== 'pass').length;
      const criteriaItem = getInspectionItem(categoryId, itemId);

      itemGroups.push({
        key: itemId,
        itemId,
        title: criteriaItem && lang === 'zh' ? criteriaItem.nameZh : (criteriaItem?.name ?? itemId),
        description:
          criteriaItem && lang === 'zh'
            ? criteriaItem.descriptionZh
            : (criteriaItem?.description ?? null),
        issues: orderedIssues,
        hasProblems: nonPassCount > 0,
        nonPassCount,
        anchorId: buildInspectionItemAnchorId(categoryId, itemId),
        primaryIssueType: orderedIssues[0]?.type ?? 'pass',
      });
    });

  return [...itemGroups, ...unmappedGroups];
}

export function InspectionReportView({
  report,
  robot,
  lang,
  t,
  expandedCategories,
  retestingItem,
  isGeneratingAI,
  onToggleCategory,
  onRetestItem,
  onDownloadPDF,
  onSelectItem,
  onAskAboutIssue,
}: InspectionReportProps) {
  const overallScore = report.overallScore ?? 0;
  const maxScore = report.maxScore ?? 100;
  const scorePercentage = maxScore > 0 ? (overallScore / maxScore) * 100 : 0;

  const issuesByCategory: Record<string, typeof report.issues> = {};
  const defaultCategoryId = INSPECTION_CRITERIA[0]?.id || 'spec';
  INSPECTION_CRITERIA.forEach((category) => {
    issuesByCategory[category.id] = [];
  });

  report.issues.forEach((issue) => {
    const categoryId = issue.category || defaultCategoryId;
    if (!issuesByCategory[categoryId]) {
      issuesByCategory[categoryId] = [];
    }
    issuesByCategory[categoryId].push(issue);
  });

  const issueStats = report.issues.reduce(
    (acc, issue) => {
      if (issue.type === 'error') acc.error += 1;
      else if (issue.type === 'warning') acc.warning += 1;
      else if (issue.type === 'suggestion') acc.suggestion += 1;
      else if (issue.type === 'pass') acc.pass += 1;
      return acc;
    },
    { error: 0, warning: 0, suggestion: 0, pass: 0 },
  );
  const categorySections = INSPECTION_CRITERIA.map((category) => {
    const itemGroups = buildInspectionItemGroups(
      category.id,
      issuesByCategory[category.id] || [],
      lang,
    );
    const hasProblems = itemGroups.some((itemGroup) => itemGroup.hasProblems);
    const attentionItemCount = itemGroups.filter((itemGroup) => itemGroup.hasProblems).length;

    return {
      category,
      categoryName: lang === 'zh' ? category.nameZh : category.name,
      categoryScore: report.categoryScores?.[category.id] ?? 10,
      itemGroups,
      hasProblems,
      attentionItemCount,
      anchorId: buildInspectionCategoryAnchorId(category.id),
    };
  }).filter((section) => section.itemGroups.length > 0);

  const scoreBand =
    scorePercentage >= 90
      ? {
          label: t.inspectionStable,
          className:
            'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-900/60',
        }
      : scorePercentage >= 70
        ? {
            label: t.inspectionAttention,
            className:
              'bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200/80 dark:border-amber-900/60',
          }
        : {
            label: t.inspectionHighRisk,
            className:
              'bg-red-50 dark:bg-red-950/60 text-red-700 dark:text-red-300 border-red-200/80 dark:border-red-900/60',
          };

  const summaryMetrics = [
    {
      key: 'error',
      label: t.issueErrors,
      value: issueStats.error,
      className: 'text-red-600 dark:text-red-300 border-red-200/80 dark:border-red-900/60',
    },
    {
      key: 'warning',
      label: t.issueWarnings,
      value: issueStats.warning,
      className: 'text-amber-600 dark:text-amber-300 border-amber-200/80 dark:border-amber-900/60',
    },
    {
      key: 'suggestion',
      label: t.issueSuggestions,
      value: issueStats.suggestion,
      className: 'text-system-blue border-system-blue/30 dark:border-system-blue/35',
    },
    {
      key: 'pass',
      label: t.issuePassed,
      value: issueStats.pass,
      className:
        'text-emerald-600 dark:text-emerald-300 border-emerald-200/80 dark:border-emerald-900/60',
    },
  ];
  const evidenceSummary = buildInspectionEvidenceSummary(robot.inspectionContext, lang);
  const topBlockers = report.issues
    .filter((issue) => issue.type !== 'pass')
    .sort(compareIssuesByPriority)
    .slice(0, 3);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden bg-panel-bg rounded-xl p-5 border border-border-black shadow-sm">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-5">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-text-secondary">
              <div className="w-1.5 h-1.5 rounded-full bg-system-blue" />
              <span className="text-[10px] font-medium tracking-wide">{t.inspectorSummary}</span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-text-primary">
              {t.inspectionResultTitle}
            </h2>
            <p className="text-sm text-text-secondary max-w-xl leading-relaxed">{report.summary}</p>

            {evidenceSummary && (
              <div className="mt-4 rounded-lg border border-border-black bg-element-bg px-3 py-3">
                <div className="text-[10px] font-medium tracking-wide text-text-tertiary">
                  {evidenceSummary.title}
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {evidenceSummary.metrics.map((metric) => (
                    <div
                      key={`${metric.label}:${metric.value}`}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border-black bg-panel-bg px-2 py-1"
                    >
                      <span className="text-[10px] font-medium text-text-tertiary">
                        {metric.label}
                      </span>
                      <span className="text-[10px] font-semibold text-text-primary">
                        {metric.value}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="rounded-lg border border-border-black bg-element-bg px-3 py-2 min-w-[110px] text-right">
              <div className="text-[10px] text-text-tertiary font-medium tracking-wide mb-1">
                {t.overallScore}
              </div>
              <div className="flex items-baseline justify-end gap-1">
                <span
                  className={`text-3xl font-semibold tracking-tight ${getScoreColor(overallScore, maxScore)}`}
                >
                  {Math.round(scorePercentage)}%
                </span>
              </div>
              <div
                className={`inline-flex mt-1 px-1.5 py-0.5 rounded border text-[10px] font-medium ${scoreBand.className}`}
              >
                {scoreBand.label}
              </div>
            </div>
            <button
              onClick={onDownloadPDF}
              className="w-9 h-9 flex items-center justify-center bg-element-bg hover:bg-element-hover text-text-secondary rounded-lg transition-colors border border-border-black"
              title={t.downloadReport}
            >
              <FileText className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="mt-6 relative h-1.5 w-full bg-element-bg rounded-full overflow-hidden">
          <div
            className={`absolute top-0 left-0 h-full transition-all duration-1000 ease-out rounded-full ${getScoreBgColor(
              overallScore,
              maxScore,
            )}`}
            style={{ width: `${scorePercentage}%` }}
          />
        </div>

        <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-2.5">
          {summaryMetrics.map((metric) => (
            <div
              key={metric.key}
              className={`rounded-lg border bg-element-bg dark:bg-element-bg px-2.5 py-2 ${metric.className}`}
            >
              <div className="text-[10px] font-medium tracking-wide text-text-tertiary">
                {metric.label}
              </div>
              <div className="text-base font-semibold leading-tight mt-1">{metric.value}</div>
            </div>
          ))}
        </div>
      </div>

      {topBlockers.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border-black bg-panel-bg shadow-sm">
          <div className="border-b border-border-black bg-element-bg px-5 py-4">
            <div className="text-[10px] font-medium tracking-wide text-text-tertiary">
              {t.actionable}
            </div>
            <h3 className="mt-1 text-base font-semibold text-text-primary">{t.topBlockersTitle}</h3>
            <p className="mt-1 text-xs leading-relaxed text-text-secondary">
              {t.topBlockersSubtitle}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 p-4">
            {topBlockers.map((issue, index) => {
              const meta = getIssueMeta(issue.type, lang);
              const Icon = meta.Icon;
              const relatedEntities = resolveInspectionIssueRelatedEntities(robot, issue);
              const selectionTarget = resolveInspectionIssueSelectionTarget(robot, issue);
              const hasSingleLocatableTarget =
                relatedEntities.length === 1 && Boolean(relatedEntities[0]?.target);

              return (
                <div
                  key={`top-blocker-${issue.category || 'unknown'}-${issue.itemId || index}-${index}`}
                  className={`rounded-xl border bg-white dark:bg-panel-bg ${meta.rowClass}`}
                >
                  <div className={`h-0.5 ${meta.stripeClass}`} />
                  <div className="space-y-3 p-4">
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 rounded-lg border p-2 ${meta.iconClass}`}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-text-primary">{issue.title}</h4>
                          <span
                            className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                          >
                            {meta.label}
                          </span>
                          {issue.score !== undefined && (
                            <span className="rounded border border-border-black bg-element-bg px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                              {issue.score.toFixed(1)}
                            </span>
                          )}
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-text-secondary">
                          {issue.description}
                        </p>
                      </div>
                    </div>

                    {relatedEntities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {relatedEntities.map((entity) =>
                          entity.target && !hasSingleLocatableTarget ? (
                            <button
                              key={`${issue.title}:${entity.target.type}:${entity.id}`}
                              type="button"
                              onClick={() => onSelectItem(entity.target.type, entity.target.id)}
                              className="inline-flex items-center gap-1.5 rounded-md border border-border-black bg-element-bg px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue"
                            >
                              <Crosshair className="h-3 w-3" />
                              {entity.name}
                            </button>
                          ) : (
                            <span
                              key={`${issue.title}:${entity.id}`}
                              className="rounded-md border border-border-black bg-element-bg px-2 py-1 text-[10px] font-medium text-text-secondary"
                            >
                              {entity.name}
                            </span>
                          ),
                        )}
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onAskAboutIssue(issue)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border-black bg-panel-bg px-3 py-1.5 text-[11px] font-medium text-system-blue transition-colors hover:bg-element-bg dark:bg-element-bg"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        {t.askAboutThisIssue}
                      </button>
                      {selectionTarget && hasSingleLocatableTarget && (
                        <button
                          type="button"
                          onClick={() => onSelectItem(selectionTarget.type, selectionTarget.id)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-border-black bg-element-bg px-3 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-element-hover"
                        >
                          <Crosshair className="h-3.5 w-3.5" />
                          {t.locateInModel}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4">
        {categorySections.map(
          ({
            category,
            categoryName,
            categoryScore,
            itemGroups,
            hasProblems,
            attentionItemCount,
            anchorId,
          }) => {
            const isExpanded = expandedCategories.has(category.id);
            const CategoryIcon = getInspectionCategoryIcon(category.id);

            return (
              <div
                key={category.id}
                id={anchorId}
                data-inspection-anchor-id={anchorId}
                className={`group scroll-mt-4 overflow-hidden rounded-xl border transition-colors duration-200 ${
                  isExpanded
                    ? 'border-border-black bg-panel-bg shadow-sm'
                    : 'border-transparent bg-element-bg hover:border-border-black'
                }`}
              >
                <button
                  onClick={() => onToggleCategory(category.id)}
                  className="flex w-full items-center justify-between p-3.5 text-left"
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <div
                      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors ${
                        hasProblems
                          ? 'border-amber-200/80 bg-amber-50 text-amber-600 dark:border-amber-900/60 dark:bg-amber-950/60 dark:text-amber-300'
                          : 'border-emerald-200/80 bg-emerald-50 text-emerald-600 dark:border-emerald-900/60 dark:bg-emerald-950/60 dark:text-emerald-300'
                      }`}
                    >
                      <CategoryIcon className="h-[18px] w-[18px]" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-text-primary">
                          {categoryName}
                        </span>
                        <span className="text-[10px] font-medium tracking-wide text-text-tertiary">
                          {t.weight} {category.weight * 100}%
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-medium text-text-tertiary">
                        {t.checksCount.replace('{count}', String(itemGroups.length))}
                        {hasProblems ? (
                          <span className="rounded border border-amber-200/80 px-1.5 py-0.5 text-amber-700 dark:border-amber-900/60 dark:text-amber-300">
                            {t.itemsNeedAttention.replace('{count}', String(attentionItemCount))}
                          </span>
                        ) : (
                          <span className="rounded border border-emerald-200/80 px-1.5 py-0.5 text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300">
                            {t.allPassedShort}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-4 pl-3">
                    <div className="hidden min-w-[84px] flex-col items-end gap-1 sm:flex">
                      <div className={`text-sm font-medium ${getScoreColor(categoryScore)}`}>
                        {categoryScore.toFixed(1)}/10
                      </div>
                      <div className="h-1 w-20 overflow-hidden rounded-full bg-element-bg">
                        <div
                          className={`h-full ${getScoreBgColor(categoryScore)}`}
                          style={{ width: `${(categoryScore / 10) * 100}%` }}
                        />
                      </div>
                    </div>
                    <div
                      className={`rounded-md p-1.5 transition-colors ${
                        isExpanded
                          ? 'bg-element-hover text-text-secondary'
                          : 'text-text-tertiary group-hover:text-text-secondary'
                      }`}
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </div>
                  </div>
                </button>

                {isExpanded && (
                  <div className="animate-in fade-in slide-in-from-top-2 space-y-3 p-4 pt-0 duration-300">
                    {itemGroups.map((itemGroup) => {
                      const itemMeta = getIssueMeta(itemGroup.primaryIssueType, lang);
                      const isRetesting =
                        itemGroup.itemId !== null &&
                        retestingItem?.categoryId === category.id &&
                        retestingItem?.itemId === itemGroup.itemId;
                      const showRetestButton =
                        itemGroup.itemId !== null &&
                        itemGroup.issues.some((issue) => issue.type !== 'pass');

                      return (
                        <div
                          key={`${category.id}-${itemGroup.key}`}
                          id={itemGroup.anchorId ?? undefined}
                          data-inspection-anchor-id={itemGroup.anchorId ?? undefined}
                          className="scroll-mt-4 overflow-hidden rounded-xl border border-border-black bg-element-bg"
                        >
                          <div className="border-b border-border-black/80 px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <span
                                    aria-hidden="true"
                                    className={`h-2 w-2 shrink-0 rounded-full ${itemMeta.stripeClass}`}
                                  />
                                  <h4 className="truncate text-sm font-semibold text-text-primary">
                                    {itemGroup.title}
                                  </h4>
                                  {itemGroup.hasProblems ? (
                                    <span
                                      className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${itemMeta.badgeClass}`}
                                    >
                                      {itemMeta.label}
                                    </span>
                                  ) : (
                                    <span className="rounded border border-emerald-200/80 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:border-emerald-900/60 dark:text-emerald-300">
                                      {t.allPassedShort}
                                    </span>
                                  )}
                                  {itemGroup.hasProblems && itemGroup.nonPassCount > 1 && (
                                    <span className="rounded border border-border-black bg-panel-bg px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
                                      {itemGroup.nonPassCount}
                                    </span>
                                  )}
                                </div>
                                {itemGroup.description && (
                                  <p className="mt-1 text-[11px] leading-5 text-text-secondary">
                                    {itemGroup.description}
                                  </p>
                                )}
                              </div>

                              {showRetestButton && itemGroup.itemId && (
                                <button
                                  type="button"
                                  onClick={() => onRetestItem(category.id, itemGroup.itemId!)}
                                  disabled={isRetesting || isGeneratingAI}
                                  className="rounded-lg border border-border-black bg-panel-bg p-1.5 text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue disabled:opacity-30"
                                  title={t.retestThisItem}
                                >
                                  {isRetesting ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <RefreshCw className="h-3.5 w-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          <div className="space-y-3 p-3">
                            {itemGroup.issues.map((issue, idx) => {
                              const issueScore = issue.score ?? 10;
                              const relatedEntities = resolveInspectionIssueRelatedEntities(
                                robot,
                                issue,
                              );
                              const meta = getIssueMeta(issue.type, lang);
                              const Icon = meta.Icon;

                              return (
                                <div
                                  key={`${issue.category || 'unknown'}-${itemGroup.key}-${idx}`}
                                  className={`rounded-lg border bg-white transition-colors dark:bg-panel-bg ${meta.rowClass}`}
                                >
                                  <div className={`h-0.5 ${meta.stripeClass}`} />
                                  <div className="p-4">
                                    <div className="flex gap-3">
                                      <div
                                        className={`shrink-0 rounded-lg border p-2 ${meta.iconClass}`}
                                      >
                                        <Icon className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="mb-1 flex items-start justify-between gap-4">
                                          <div className="min-w-0">
                                            <div className="flex min-w-0 items-center gap-2">
                                              <h5 className="truncate text-sm font-semibold text-text-primary">
                                                {issue.title}
                                              </h5>
                                              <span
                                                className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${meta.badgeClass}`}
                                              >
                                                {meta.label}
                                              </span>
                                            </div>
                                          </div>
                                          <div className="flex shrink-0 items-center gap-2">
                                            <div
                                              className={`text-xs font-semibold ${getScoreColor(issueScore)}`}
                                            >
                                              {issueScore.toFixed(1)}
                                            </div>
                                            {issue.type !== 'pass' && (
                                              <button
                                                type="button"
                                                onClick={() => onAskAboutIssue(issue)}
                                                className="rounded-lg border border-border-black bg-element-bg p-1.5 transition-colors hover:bg-element-hover hover:text-system-blue"
                                                title={t.askAboutThisIssue}
                                              >
                                                <MessageCircle className="h-3.5 w-3.5" />
                                              </button>
                                            )}
                                          </div>
                                        </div>
                                        <p className="mb-3 text-xs font-medium leading-relaxed text-text-secondary">
                                          {issue.description}
                                        </p>

                                        {relatedEntities.length > 0 && (
                                          <div className="flex flex-wrap gap-1.5">
                                            {relatedEntities.map((entity) =>
                                              entity.target ? (
                                                <button
                                                  key={`${entity.target.type}:${entity.id}`}
                                                  type="button"
                                                  onClick={() => {
                                                    onSelectItem(
                                                      entity.target.type,
                                                      entity.target.id,
                                                    );
                                                  }}
                                                  className="rounded-md border border-border-black bg-element-bg px-2 py-1 text-[10px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue"
                                                >
                                                  {entity.name}
                                                </button>
                                              ) : (
                                                <span
                                                  key={entity.id}
                                                  className="rounded-md border border-border-black bg-element-bg px-2 py-1 text-[10px] font-medium text-text-secondary"
                                                >
                                                  {entity.name}
                                                </span>
                                              ),
                                            )}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          },
        )}
      </div>
    </div>
  );
}

export default InspectionReportView;
