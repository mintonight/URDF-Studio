import React from 'react';
import { Loader2, MousePointerClick } from 'lucide-react';
import { SegmentedControl } from '@/shared/components/ui';
import { GeometryType, type InteractionSelection } from '@/types';
import type {
  CollisionOptimizationAnalysis,
  CollisionOptimizationCandidate,
  CollisionOptimizationManualMergePair,
  CollisionOptimizationScope,
  CollisionOptimizationSource,
  CollisionTargetRef,
} from '../utils/collisionOptimization';
import {
  CollisionOptimizationCandidateList,
  type CollisionOptimizationCandidateListLabels,
} from './CollisionOptimizationCandidateList';
import {
  CollisionOptimizationPlanarGraph,
  type CollisionOptimizationPlanarGraphConnectionState,
  type CollisionOptimizationPlanarGraphLabels,
} from './CollisionOptimizationPlanarGraph';

type CollisionSelection = InteractionSelection;

export type CollisionOptimizationCandidatesViewMode = 'list' | 'graph';

export interface CollisionOptimizationCandidatesPanelLabels {
  analyzing: string;
  clearAll: string;
  clearManualPairs: string;
  eligible: string;
  noCandidates: string;
  noSelectedCollision: string;
  scopeAll: string;
  scopeMesh: string;
  scopePrimitive: string;
  scopeSelected: string;
  selectAll: string;
  selectedCount: string;
  title: string;
  viewGraph: string;
  viewList: string;
}

export interface CollisionOptimizationCandidatesPanelProps {
  activeCandidateKey?: string | null;
  source: CollisionOptimizationSource;
  analysis: CollisionOptimizationAnalysis | null;
  candidates: CollisionOptimizationCandidate[];
  selection?: CollisionSelection;
  scope: CollisionOptimizationScope;
  viewMode: CollisionOptimizationCandidatesViewMode;
  checkedCandidateKeys: ReadonlySet<string>;
  eligibleCount: number;
  activeSelectionCount: number;
  isAnalyzing: boolean;
  isSelectedScopeWithoutSelection: boolean;
  manualMergePairs: CollisionOptimizationManualMergePair[];
  manualConnection?: CollisionOptimizationPlanarGraphConnectionState | null;
  labels: CollisionOptimizationCandidatesPanelLabels;
  listLabels: CollisionOptimizationCandidateListLabels;
  graphLabels: CollisionOptimizationPlanarGraphLabels;
  formatGeometryType: (type: GeometryType | null | undefined) => string;
  getStatusLabel: (candidate: CollisionOptimizationCandidate) => string;
  canCreateManualPair: (sourceTargetId: string, targetTargetId: string) => boolean;
  onActivateCandidate?: (candidateKey: string, candidate: CollisionOptimizationCandidate) => void;
  onScopeChange: (scope: CollisionOptimizationScope) => void;
  onViewModeChange: (mode: CollisionOptimizationCandidatesViewMode) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
  onClearManualPairs: () => void;
  onToggleCandidate: (candidateKey: string) => void;
  onSelectTarget?: (target: CollisionTargetRef) => void;
  onHoverTarget?: (target: CollisionTargetRef | null) => void;
  onManualConnectionStart?: (target: CollisionTargetRef) => void;
  onManualConnectionMove?: (pointer: { x: number; y: number }) => void;
  onManualConnectionEnd?: (target: CollisionTargetRef | null) => void;
  onManualConnectionCancel?: () => void;
}

function HeaderActionButton({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md px-1.5 py-0.5 text-[9px] font-medium text-text-secondary transition-colors hover:bg-element-hover hover:text-text-primary"
    >
      {children}
    </button>
  );
}

function HeaderBadge({
  children,
  active = false,
}: {
  children: React.ReactNode;
  active?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] ${
        active
          ? 'border-system-blue/20 bg-system-blue/10 text-system-blue'
          : 'border-border-black bg-element-bg text-text-tertiary'
      }`}
    >
      {children}
    </span>
  );
}

export function CollisionOptimizationCandidatesPanel({
  activeCandidateKey = null,
  source,
  analysis,
  candidates,
  selection,
  scope,
  viewMode,
  checkedCandidateKeys,
  eligibleCount,
  activeSelectionCount,
  isAnalyzing,
  isSelectedScopeWithoutSelection,
  manualMergePairs,
  manualConnection = null,
  labels,
  listLabels,
  graphLabels,
  formatGeometryType,
  getStatusLabel,
  canCreateManualPair,
  onActivateCandidate,
  onScopeChange,
  onViewModeChange,
  onSelectAll,
  onClearAll,
  onClearManualPairs,
  onToggleCandidate,
  onSelectTarget,
  onHoverTarget,
  onManualConnectionStart,
  onManualConnectionMove,
  onManualConnectionEnd,
  onManualConnectionCancel,
}: CollisionOptimizationCandidatesPanelProps) {
  return (
    <div className="min-h-0 flex flex-col overflow-hidden rounded-lg border border-border-black bg-element-bg">
      <div className="shrink-0 border-b border-border-black bg-panel-bg px-1.75 py-1.25">
        <div className="space-y-1.25">
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="min-w-0 flex flex-wrap items-center gap-1.5">
              <div className="text-[10px] font-semibold text-text-primary">{labels.title}</div>
              <HeaderBadge>
                {labels.eligible} {eligibleCount}
              </HeaderBadge>
              <HeaderBadge active={activeSelectionCount > 0}>
                {labels.selectedCount} {activeSelectionCount}
              </HeaderBadge>
              {manualMergePairs.length > 0 ? (
                <HeaderBadge>
                  {labels.clearManualPairs} {manualMergePairs.length}
                </HeaderBadge>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-1">
              <HeaderActionButton onClick={onSelectAll}>{labels.selectAll}</HeaderActionButton>
              <HeaderActionButton onClick={onClearAll}>{labels.clearAll}</HeaderActionButton>
              {manualMergePairs.length > 0 ? (
                <HeaderActionButton onClick={onClearManualPairs}>
                  {labels.clearManualPairs}
                </HeaderActionButton>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.25">
            <SegmentedControl<CollisionOptimizationScope>
              size="xs"
              value={scope}
              onChange={onScopeChange}
              className="min-w-[16rem] max-w-full"
              options={[
                { value: 'all', label: labels.scopeAll },
                { value: 'mesh', label: labels.scopeMesh },
                { value: 'primitive', label: labels.scopePrimitive },
                { value: 'selected', label: labels.scopeSelected },
              ]}
            />

            <SegmentedControl<CollisionOptimizationCandidatesViewMode>
              size="xs"
              value={viewMode}
              onChange={onViewModeChange}
              className="min-w-[9rem]"
              options={[
                { value: 'list', label: labels.viewList },
                { value: 'graph', label: labels.viewGraph },
              ]}
            />
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-0.75">
        {isAnalyzing ? (
          <div className="flex h-full flex-col items-center justify-center gap-1.5 text-[10px] text-text-tertiary">
            <Loader2 className="h-4.5 w-4.5 animate-spin" />
            <span>{labels.analyzing}</span>
          </div>
        ) : isSelectedScopeWithoutSelection ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg border border-dashed border-border-black bg-panel-bg px-2 py-3 text-center text-[9px] leading-relaxed text-text-secondary">
              <MousePointerClick className="mx-auto mb-1.5 h-4.5 w-4.5 text-text-tertiary" />
              {labels.noSelectedCollision}
            </div>
          </div>
        ) : candidates.length === 0 || !analysis ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg border border-dashed border-border-black bg-panel-bg px-2 py-3 text-center text-[9px] leading-relaxed text-text-secondary">
              {labels.noCandidates}
            </div>
          </div>
        ) : viewMode === 'graph' ? (
          <CollisionOptimizationPlanarGraph
            source={source}
            analysis={analysis}
            candidates={candidates}
            selection={selection}
            checkedCandidateKeys={checkedCandidateKeys}
            manualMergePairs={manualMergePairs}
            manualConnection={manualConnection}
            labels={graphLabels}
            formatGeometryType={formatGeometryType}
            canCreateManualPair={canCreateManualPair}
            onToggleCandidate={onToggleCandidate}
            onSelectTarget={onSelectTarget}
            onManualConnectionStart={onManualConnectionStart}
            onManualConnectionMove={onManualConnectionMove}
            onManualConnectionEnd={onManualConnectionEnd}
            onManualConnectionCancel={onManualConnectionCancel}
          />
        ) : (
          <div className="h-full overflow-y-auto">
            <CollisionOptimizationCandidateList
              activeCandidateKey={activeCandidateKey}
              candidates={candidates}
              checkedCandidateKeys={checkedCandidateKeys}
              selection={selection}
              labels={listLabels}
              formatGeometryType={formatGeometryType}
              getStatusLabel={getStatusLabel}
              onActivateCandidate={onActivateCandidate}
              onSelectTarget={onSelectTarget}
              onHoverTarget={onHoverTarget}
              onToggleCandidate={onToggleCandidate}
            />
          </div>
        )}
      </div>
    </div>
  );
}

export default CollisionOptimizationCandidatesPanel;
