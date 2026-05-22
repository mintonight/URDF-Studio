import type { ReactNode } from 'react';
import { AlertCircle, Check, Loader2 } from 'lucide-react';
import type { TranslationKeys } from '@/shared/i18n';
import type { RobotInspectionStage } from '../services/aiService';
import type { InspectionRunContext } from '../utils/inspectionRunContext';

export interface InspectionProgressState {
  stage: RobotInspectionStage;
  selectedCount: number;
}

interface InspectionProgressProps {
  progress: InspectionProgressState;
  elapsedSeconds: number;
  runContext: InspectionRunContext;
  t: TranslationKeys;
}

interface StageDefinition {
  key: RobotInspectionStage;
  label: string;
  description: string;
}

function getStageBadgeLabel(
  stageIndex: number,
  activeStageIndex: number,
  t: TranslationKeys,
): string {
  if (stageIndex < activeStageIndex) {
    return t.inspectionStageCompleted;
  }
  if (stageIndex === activeStageIndex) {
    return t.inspectionStageInProgress;
  }
  return t.inspectionStagePending;
}

function formatElapsedTime(elapsedSeconds: number): string {
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;

  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

interface InspectionStatusTrayProps {
  elapsedSeconds: number;
  isDelayed: boolean;
  runContext: InspectionRunContext;
  t: TranslationKeys;
}

interface InspectionStatusInfoBubbleProps {
  label: string;
  value: string;
  className?: string;
  tone?: 'neutral' | 'accent';
  icon?: ReactNode;
  dataAttribute?: string;
  inlineDetail?: ReactNode;
  detail?: ReactNode;
}

const inspectionStatusBubbleBaseClass =
  'flex min-h-11 items-start gap-2.5 rounded-xl border px-3.5 py-2.5 shadow-sm';
const inspectionStatusBubbleEqualWidthClass = 'basis-72 flex-1';

function InspectionStatusInfoBubble({
  label,
  value,
  className,
  tone = 'neutral',
  icon,
  dataAttribute,
  inlineDetail,
  detail,
}: InspectionStatusInfoBubbleProps) {
  const bubbleProps = dataAttribute ? { [dataAttribute]: 'true' } : {};
  const toneClasses =
    tone === 'accent'
      ? 'border-system-blue/25 bg-system-blue/10'
      : 'border-border-black bg-panel-bg';
  const valueClasses = tone === 'accent' ? 'text-system-blue' : 'text-text-primary';

  return (
    <div
      {...bubbleProps}
      className={`${inspectionStatusBubbleBaseClass} ${toneClasses} ${className ?? ''}`.trim()}
    >
      {icon ? (
        <span
          aria-hidden="true"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-system-blue/12 text-system-blue"
        >
          {icon}
        </span>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-text-tertiary">
          {label}
        </span>
        <div
          data-inspection-info-bubble-primary-row="true"
          className="mt-1 flex min-w-0 items-center gap-2"
        >
          <span
            className={`shrink-0 whitespace-nowrap text-[13px] font-semibold leading-5 ${valueClasses}`}
          >
            {value}
          </span>
          {inlineDetail ? <div className="min-w-0 flex-1">{inlineDetail}</div> : null}
        </div>
        {detail ? <div className="mt-2">{detail}</div> : null}
      </div>
    </div>
  );
}

function InspectionStatusTray({
  elapsedSeconds,
  isDelayed,
  runContext,
  t,
}: InspectionStatusTrayProps) {
  return (
    <div
      data-inspection-status-tray="true"
      className="rounded-2xl border border-system-blue/20 bg-system-blue/5 p-3 shadow-sm"
    >
      <div data-inspection-status-row="true" className="flex flex-wrap items-stretch gap-2.5">
        <InspectionStatusInfoBubble
          dataAttribute="data-inspection-elapsed-badge"
          label={t.inspectionElapsedTime}
          value={formatElapsedTime(elapsedSeconds)}
          className={inspectionStatusBubbleEqualWidthClass}
          inlineDetail={
            isDelayed ? (
              <span
                data-inspection-delayed-indicator="true"
                title={t.inspectionRunDelayed}
                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-lg border border-amber-200/80 bg-amber-50/85 px-2 py-1 text-[11px] font-medium leading-4 text-amber-700 dark:border-amber-900/60 dark:bg-amber-950/45 dark:text-amber-200"
              >
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{t.inspectionRunDelayed}</span>
              </span>
            ) : null
          }
        />

        <InspectionStatusInfoBubble
          dataAttribute="data-inspection-estimated-badge"
          label={t.inspectionEstimatedDuration}
          value={runContext.estimatedDuration.label}
          className={inspectionStatusBubbleEqualWidthClass}
        />
      </div>
    </div>
  );
}

export function InspectionProgress({
  progress,
  elapsedSeconds,
  runContext,
  t,
}: InspectionProgressProps) {
  const stageDefinitions: StageDefinition[] = [
    {
      key: 'preparing-context',
      label: t.inspectionPreparingContext,
      description: t.inspectionPreparingContextDescription,
    },
    {
      key: 'requesting-model',
      label: t.inspectionRequestingModel,
      description: t.inspectionRequestingModelDescription,
    },
    {
      key: 'processing-response',
      label: t.inspectionProcessingResponse,
      description: t.inspectionProcessingResponseDescription,
    },
    {
      key: 'finalizing-report',
      label: t.inspectionFinalizingReport,
      description: t.inspectionFinalizingReportDescription,
    },
  ];
  const activeStageIndex = Math.max(
    stageDefinitions.findIndex((stage) => stage.key === progress.stage),
    0,
  );
  const activeStage = stageDefinitions[activeStageIndex] ?? stageDefinitions[0];
  const isDelayed = elapsedSeconds > runContext.estimatedDuration.maxSeconds;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col justify-center gap-4 py-2">
      <InspectionStatusTray
        elapsedSeconds={elapsedSeconds}
        isDelayed={isDelayed}
        runContext={runContext}
        t={t}
      />

      <div
        data-inspection-current-stage-card="true"
        className="rounded-2xl border border-border-black bg-panel-bg p-5 shadow-sm"
      >
        <div className="flex items-start gap-3">
          <div className="rounded-xl border border-border-black bg-element-bg p-2.5 text-system-blue">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
          <div className="min-w-0 flex-1">
            <div
              data-inspection-current-stage-header="true"
              className="flex flex-wrap items-center gap-2"
            >
              <h2 className="text-xl font-semibold text-text-primary">{activeStage.label}</h2>
              <div
                data-inspection-current-stage-badge="true"
                className="inline-flex items-center gap-2 rounded-lg border border-border-black bg-element-bg px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary"
              >
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-system-blue" />
                {t.inspectionRunStage}
              </div>
            </div>
            <p className="mt-1.5 text-sm leading-6 text-text-secondary">
              {activeStage.description}
            </p>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(280px,0.95fr)]">
        <div className="rounded-2xl border border-border-black bg-panel-bg p-4 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            {t.inspectionRunStage}
          </div>
          <div data-inspection-stage-list="true" className="mt-3 space-y-2.5">
            {stageDefinitions.map((stage, index) => {
              const isActive = index === activeStageIndex;
              const isCompleted = index < activeStageIndex;
              return (
                <div
                  key={stage.key}
                  data-inspection-stage-card={stage.key}
                  data-inspection-active-stage-card={isActive ? 'true' : undefined}
                  className={`rounded-xl border px-3 py-3 transition-colors ${
                    isActive
                      ? 'border-system-blue/30 bg-system-blue/10'
                      : isCompleted
                        ? 'border-emerald-200/80 bg-emerald-50/70 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                        : 'border-border-black bg-element-bg'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold ${
                          isActive
                            ? 'border-system-blue/35 bg-system-blue/15 text-system-blue'
                            : isCompleted
                              ? 'border-emerald-300/80 bg-emerald-100 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-300'
                              : 'border-border-strong bg-panel-bg text-text-tertiary'
                        }`}
                      >
                        {isCompleted ? <Check className="h-3 w-3" /> : index + 1}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text-primary">{stage.label}</div>
                        <div className="mt-1 text-[12px] leading-5 text-text-secondary">
                          {stage.description}
                        </div>
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-lg border px-2 py-0.5 text-[10px] font-semibold ${
                        isActive
                          ? 'border-system-blue/30 bg-system-blue/10 text-system-blue'
                          : isCompleted
                            ? 'border-emerald-200/80 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/50 dark:text-emerald-300'
                            : 'border-border-black bg-panel-bg text-text-tertiary'
                      }`}
                    >
                      {getStageBadgeLabel(index, activeStageIndex, t)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border-black bg-panel-bg p-4 shadow-sm">
          <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            {t.inspectionRunScope}
          </div>
          <div className="mt-2 text-sm font-semibold text-text-primary">{runContext.robotName}</div>
          <div className="mt-1 text-[12px] leading-5 text-text-secondary">
            {runContext.sourceValue}
            {' · '}
            {runContext.linkCount} {t.inspectionLinks}
            {' · '}
            {runContext.jointCount} {t.joints}
          </div>

          <div className="mt-4 rounded-xl border border-border-black bg-element-bg px-3 py-3">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
              {t.inspectionItems}
            </div>
            <div className="mt-1 text-sm font-semibold text-text-primary">
              {t.inspectionSelectedChecks.replace('{count}', String(runContext.selectedCount))}
            </div>
            <div className="mt-1 text-[12px] leading-5 text-text-secondary">
              {t.inspectionSelectedCategories}: {runContext.selectedProfileCount}
            </div>
          </div>

          {runContext.profileSummary.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {runContext.profileSummary.map((profile) => (
                <span
                  key={profile.id}
                  className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary"
                >
                  {profile.name} {profile.selectedCount}/{profile.totalCount}
                </span>
              ))}
            </div>
          )}

          {runContext.evidenceSummary && (
            <div className="mt-4 border-t border-border-black pt-4">
              <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                {runContext.evidenceSummary.title}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {runContext.evidenceSummary.metrics.map((metric) => (
                  <span
                    key={`${metric.label}:${metric.value}`}
                    className="rounded-lg border border-border-black bg-element-bg px-2 py-1 text-[11px] font-medium text-text-secondary"
                  >
                    {metric.label}: {metric.value}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default InspectionProgress;
