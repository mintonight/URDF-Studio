import { ChevronDown, ChevronRight, RotateCcw, Sparkles } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { TranslationKeys } from '@/shared/i18n'
import type { SelectedInspectionProfiles } from '../utils/inspectionProfileSelection'
import type { NormalInspectionPlan } from '../utils/inspectionNormalPlan'
import { buildInspectionSelectionDeviation } from '../utils/inspectionAdvancedScopeViewModel'

interface InspectionRecommendationBannerProps {
  t: TranslationKeys
  plan: NormalInspectionPlan
  selectedProfiles: SelectedInspectionProfiles
  recommendedProfiles: SelectedInspectionProfiles
  totalItemCount: number
  onRestoreRecommendation: () => void
}

const countSelectedItems = (selectedProfiles: SelectedInspectionProfiles) =>
  Object.values(selectedProfiles).reduce((sum, itemIds) => sum + itemIds.size, 0)

function formatRecommendationReason(reason: string, t: TranslationKeys) {
  if (reason.startsWith('source_format:')) {
    return `${t.inspectionRecommendationSourceFormat}: ${reason
      .slice('source_format:'.length)
      .toUpperCase()}`
  }
  if (reason.startsWith('target:')) {
    return `${t.inspectionRecommendationTarget}: ${reason.slice('target:'.length)}`
  }
  if (reason === 'workflow:assembly') return t.inspectionReasonAssembly
  if (reason === 'workflow:hardware_config') return t.inspectionReasonHardwareConfig
  if (reason === 'workflow:export_preflight') return t.inspectionReasonExportPreflight
  if (reason === 'workflow:collision_authoring') return t.inspectionReasonCollisionAuthoring
  if (reason === 'workflow:inertia_authoring') return t.inspectionReasonInertiaAuthoring
  if (reason.startsWith('purpose:')) {
    return `${t.inspectionPlanPurpose}: ${reason.slice('purpose:'.length)}`
  }
  return reason
}

export function InspectionRecommendationBanner({
  t,
  plan,
  selectedProfiles,
  recommendedProfiles,
  totalItemCount,
  onRestoreRecommendation,
}: InspectionRecommendationBannerProps) {
  const [isReasonExpanded, setIsReasonExpanded] = useState(false)
  const selectedCount = countSelectedItems(selectedProfiles)
  const deviation = useMemo(
    () => buildInspectionSelectionDeviation(selectedProfiles, recommendedProfiles),
    [recommendedProfiles, selectedProfiles],
  )
  const reasons = plan.reasons.map((reason) => formatRecommendationReason(reason, t))
  const reasonSummary =
    reasons.length > 0 ? reasons.join(' · ') : t.inspectionRecommendedPlanDescription
  const deviationSummary = t.inspectionRecommendationDeviationSummary.replace(
    '{count}',
    String(deviation.totalChangedItemCount),
  )

  return (
    <section
      data-inspection-recommendation-banner
      className="rounded-xl border border-system-blue/20 bg-system-blue/5 p-3 shadow-sm"
    >
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-start gap-2">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-system-blue/20 bg-panel-bg text-system-blue">
              <Sparkles className="h-3.5 w-3.5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-text-primary">
                  {t.inspectionRecommendedPlan}
                </h2>
                <span className="rounded-md border border-system-blue/15 bg-panel-bg px-2 py-0.5 text-[10px] font-semibold text-system-blue">
                  {selectedCount}/{totalItemCount}
                </span>
                {deviation.totalChangedItemCount > 0 && (
                  <span
                    data-inspection-recommendation-custom-state="true"
                    className="rounded-md border border-warning-border bg-warning-soft px-2 py-0.5 text-[10px] font-semibold text-warning"
                  >
                    {deviationSummary}
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] leading-5 text-text-secondary">{reasonSummary}</p>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {reasons.length > 0 && (
            <button
              type="button"
              onClick={() => setIsReasonExpanded((current) => !current)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-black bg-panel-bg px-3 text-[11px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-system-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
            >
              {isReasonExpanded ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              {isReasonExpanded
                ? t.inspectionHideRecommendationReasons
                : t.inspectionRecommendationReasons}
            </button>
          )}
          <button
            type="button"
            onClick={onRestoreRecommendation}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-system-blue/25 bg-panel-bg px-3 text-[11px] font-semibold text-system-blue transition-colors hover:bg-system-blue/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t.inspectionRestoreRecommendation}
          </button>
        </div>
      </div>

      {isReasonExpanded && reasons.length > 0 && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {reasons.map((reason) => (
            <div
              key={reason}
              className="rounded-lg border border-border-black bg-panel-bg px-3 py-2 text-[11px] font-medium text-text-secondary"
            >
              {reason}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export default InspectionRecommendationBanner
