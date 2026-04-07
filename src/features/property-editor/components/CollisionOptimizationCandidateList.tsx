import { ArrowRight } from 'lucide-react';
import { Checkbox } from '@/shared/components/ui';
import { GeometryType, type InteractionSelection } from '@/types';
import type {
  CollisionOptimizationCandidate,
  CollisionTargetRef,
} from '../utils/collisionOptimization';
import { createCollisionOptimizationCandidateKey } from '../utils/collisionOptimization';

type CollisionSelection = InteractionSelection;

export interface CollisionOptimizationCandidateListLabels {
  clearAll: string;
  collisionIndex: string;
  component: string;
  jointPair: string;
  mergeTo: string;
  noCandidates: string;
  selectedCount: string;
}

interface CollisionOptimizationCandidateListProps {
  activeCandidateKey?: string | null;
  candidates: CollisionOptimizationCandidate[];
  checkedCandidateKeys: ReadonlySet<string>;
  selection?: CollisionSelection;
  labels: CollisionOptimizationCandidateListLabels;
  formatGeometryType: (type: GeometryType | null | undefined) => string;
  getStatusLabel: (candidate: CollisionOptimizationCandidate) => string;
  onActivateCandidate?: (candidateKey: string, candidate: CollisionOptimizationCandidate) => void;
  onSelectTarget?: (target: CollisionTargetRef) => void;
  onHoverTarget?: (target: CollisionTargetRef | null) => void;
  onToggleCandidate: (candidateKey: string) => void;
}

function isFocusedTarget(
  selection: CollisionSelection | undefined,
  target: CollisionTargetRef,
): boolean {
  return (
    selection?.type === 'link' &&
    selection.id === target.linkId &&
    selection.subType === 'collision' &&
    (selection.objectIndex ?? 0) === target.objectIndex
  );
}

function getPrimitiveMonogram(type: GeometryType | null | undefined): string {
  switch (type) {
    case GeometryType.CYLINDER:
      return 'CYL';
    case GeometryType.CAPSULE:
      return 'CAP';
    case GeometryType.BOX:
      return 'BOX';
    case GeometryType.PLANE:
      return 'PLN';
    case GeometryType.SPHERE:
      return 'SPH';
    case GeometryType.ELLIPSOID:
      return 'ELP';
    case GeometryType.HFIELD:
      return 'HFD';
    case GeometryType.SDF:
      return 'SDF';
    case GeometryType.MESH:
      return 'MSH';
    default:
      return '—';
  }
}

function getFlowSources(candidate: CollisionOptimizationCandidate): CollisionTargetRef[] {
  return candidate.secondaryTarget
    ? [candidate.target, candidate.secondaryTarget]
    : [candidate.target];
}

function FlowSourceChip({
  target,
  labels,
  isFocused,
  onSelectTarget,
  onHoverTarget,
  formatGeometryType,
}: {
  target: CollisionTargetRef;
  labels: CollisionOptimizationCandidateListLabels;
  isFocused: boolean;
  onSelectTarget?: (target: CollisionTargetRef) => void;
  onHoverTarget?: (target: CollisionTargetRef | null) => void;
  formatGeometryType: (type: GeometryType | null | undefined) => string;
}) {
  const toneClass = isFocused
    ? 'border-system-blue/35 bg-system-blue/10'
    : 'border-border-black bg-panel-bg hover:bg-element-hover';
  const slotLabel = target.isPrimary
    ? null
    : `${labels.collisionIndex} ${target.sequenceIndex + 1}`;

  return (
    <button
      type="button"
      onClick={() => onSelectTarget?.(target)}
      onMouseEnter={() => onHoverTarget?.(target)}
      onMouseLeave={() => onHoverTarget?.(null)}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 rounded-md border px-1.25 py-0.75 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30 ${toneClass}`}
    >
      <div className="flex h-5.5 w-5.5 items-center justify-center rounded-md border border-border-black bg-element-bg text-[6.5px] font-semibold tracking-[0.1em] text-text-secondary">
        {getPrimitiveMonogram(target.geometry.type)}
      </div>

      <div className="min-w-0 flex items-center gap-0.75">
        <span className="truncate text-[9px] font-semibold text-text-primary">
          {target.linkName}
        </span>
        {slotLabel ? (
          <span className="shrink-0 rounded-full border border-border-black bg-element-bg px-1.25 py-0.5 text-[6.5px] font-medium text-text-tertiary">
            {slotLabel}
          </span>
        ) : null}
        {target.componentName ? (
          <span className="truncate text-[6.5px] text-text-tertiary">
            {labels.component}: {target.componentName}
          </span>
        ) : null}
      </div>
    </button>
  );
}

export function CollisionOptimizationCandidateList({
  activeCandidateKey = null,
  candidates,
  checkedCandidateKeys,
  selection,
  labels,
  formatGeometryType,
  getStatusLabel,
  onActivateCandidate,
  onSelectTarget,
  onHoverTarget,
  onToggleCandidate,
}: CollisionOptimizationCandidateListProps) {
  if (candidates.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-black bg-panel-bg px-2.5 py-4 text-center text-[10px] leading-relaxed text-text-secondary">
        {labels.noCandidates}
      </div>
    );
  }

  return (
    <div className="space-y-1 pr-0.5">
      {candidates.map((candidate) => {
        const candidateKey = createCollisionOptimizationCandidateKey(candidate);
        const isChecked = checkedCandidateKeys.has(candidateKey);
        const sources = getFlowSources(candidate);
        const effectiveType = candidate.suggestedType ?? candidate.currentType;
        const currentLabel = formatGeometryType(candidate.currentType);
        const targetLabel = formatGeometryType(effectiveType);
        const statusLabel = getStatusLabel(candidate);
        const isFocused = sources.some((target) => isFocusedTarget(selection, target));
        const isActive = activeCandidateKey === candidateKey;
        const toneClass = isActive
          ? 'border-system-blue/35 bg-system-blue/8 ring-1 ring-system-blue/15'
          : isFocused
            ? 'border-system-blue/20 bg-system-blue/6'
            : 'border-border-black bg-panel-bg hover:bg-element-hover';

        return (
          <div
            key={candidateKey}
            className={`rounded-lg border px-1.25 py-0.75 transition-colors ${toneClass}`}
          >
            <div className="flex items-center gap-1.5">
              <Checkbox
                checked={isChecked}
                onChange={() => {
                  if (!candidate.eligible) {
                    return;
                  }
                  onActivateCandidate?.(candidateKey, candidate);
                  onToggleCandidate(candidateKey);
                }}
                disabled={!candidate.eligible}
                ariaLabel={isChecked ? labels.clearAll : labels.selectedCount}
                className="mt-0.5 shrink-0"
              />

              <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                <div className="flex min-w-0 items-center gap-0.75 overflow-hidden">
                  {sources.map((source, index) => (
                    <div
                      key={source.id}
                      className="flex min-w-0 items-center gap-0.75 overflow-hidden"
                    >
                      {index > 0 ? (
                        <span className="shrink-0 text-[8px] font-semibold text-text-tertiary">
                          +
                        </span>
                      ) : null}
                      <FlowSourceChip
                        target={source}
                        labels={labels}
                        isFocused={isFocusedTarget(selection, source)}
                        onSelectTarget={(target) => {
                          onActivateCandidate?.(candidateKey, candidate);
                          onSelectTarget?.(target);
                        }}
                        onHoverTarget={onHoverTarget}
                        formatGeometryType={formatGeometryType}
                      />
                    </div>
                  ))}
                </div>

                <div className="flex shrink-0 items-center gap-1 text-[8px] text-text-tertiary">
                  <span className="whitespace-nowrap">{labels.mergeTo}</span>
                  <ArrowRight className="h-3 w-3" />
                </div>

                <div className="min-w-0 flex-1 rounded-md border border-system-blue/20 bg-system-blue/8 px-1.25 py-1">
                  <button
                    type="button"
                    onClick={() => {
                      onActivateCandidate?.(candidateKey, candidate);
                      onSelectTarget?.(candidate.target);
                    }}
                    onMouseEnter={() => onHoverTarget?.(candidate.target)}
                    onMouseLeave={() => onHoverTarget?.(null)}
                    className="w-full min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-system-blue/30"
                  >
                    <div className="flex min-w-0 items-center justify-between gap-1">
                      <div className="min-w-0 flex items-center gap-1">
                        <span className="inline-flex h-4.5 min-w-4.5 items-center justify-center rounded-md border border-system-blue/25 bg-panel-bg px-0.75 text-[6px] font-semibold tracking-[0.08em] text-system-blue">
                          {getPrimitiveMonogram(effectiveType)}
                        </span>
                        <div className="min-w-0">
                          <div className="truncate text-[9px] font-semibold text-text-primary">
                            <span>{currentLabel}</span>
                            <ArrowRight className="mx-0.5 inline h-2.5 w-2.5 text-text-tertiary" />
                            <span className="text-text-primary">{targetLabel}</span>
                          </div>
                        </div>
                      </div>

                      <span
                        className={`shrink-0 rounded-full border px-1.25 py-0.5 text-[6px] font-medium ${
                          candidate.eligible
                            ? 'border-system-blue/20 bg-panel-bg text-system-blue'
                            : 'border-border-black bg-panel-bg text-text-tertiary'
                        }`}
                      >
                        {candidate.secondaryTarget ? `${sources.length} Links` : statusLabel}
                      </span>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default CollisionOptimizationCandidateList;
