/**
 * Faceted fallback budget allocation and resource limit enforcement
 * for CAD-compatible STEP reconstruction.
 *
 * All fallback regions share one global budget of 600 triangles and each
 * region is capped at 120 triangles.
 * Budget allocation is proportional to region area with a minimum of
 * 20 triangles per non-empty region when possible.
 *
 * Resource limits are checked before expensive fitting. Exceeding any
 * limit produces a structured error, not a giant faceted STEP.
 */

import { RECONSTRUCTION_LIMITS } from './stepMeshRegionTypes';

/** Structured resource-limit error. */
export class ResourceLimitError extends Error {
  readonly limitType: string;
  readonly limitValue: number;
  readonly actualValue: number;

  constructor(limitType: string, limitValue: number, actualValue: number) {
    super(`Resource limit exceeded: ${limitType} = ${actualValue} (max ${limitValue})`);
    this.name = 'ResourceLimitError';
    this.limitType = limitType;
    this.limitValue = limitValue;
    this.actualValue = actualValue;
  }
}

interface FallbackRegionInfo {
  regionId: number;
  triangleCount: number;
  area: number;
}

export interface FallbackBudgetResult {
  /** Region ID → allocated triangle budget. */
  budgets: Record<number, number>;
  /** Regions that could not be retained (omitted). */
  omittedRegions: number[];
}

/**
 * Allocate the global fallback triangle budget across fallback regions.
 *
 * - Proportional to area, with a minimum of 8 per non-empty region.
 * - If budget cannot retain every region, export fails (caller checks omittedRegions).
 * - Total never exceeds 600.
 */
export function allocateFallbackBudget(
  regions: FallbackRegionInfo[],
): FallbackBudgetResult {
  const MAX = RECONSTRUCTION_LIMITS.maxFallbackTriangles;
  const MIN = 8;

  if (regions.length === 0) {
    return { budgets: {}, omittedRegions: [] };
  }

  // First: try to give each region its full triangle count.
  const totalDemand = regions.reduce(
    (sum, r) => sum + Math.min(r.triangleCount, RECONSTRUCTION_LIMITS.maxFallbackRegionTriangles),
    0,
  );
  if (totalDemand <= MAX) {
    const budgets: Record<number, number> = {};
    for (const r of regions) {
      budgets[r.regionId] = Math.min(r.triangleCount, RECONSTRUCTION_LIMITS.maxFallbackRegionTriangles);
    }
    return { budgets, omittedRegions: [] };
  }

  // Over budget: allocate proportionally by area, with minimum.
  const totalArea = regions.reduce((sum, r) => sum + r.area, 0);
  const minTotal = regions.length * MIN;

  if (minTotal > MAX) {
    // Cannot even give minimum to every region — omit the smallest ones.
    const sorted = [...regions].sort((a, b) => b.area - a.area);
    const kept = sorted.filter((_, i) => i * MIN < MAX);
    const omitted = sorted.slice(kept.length).map((r) => r.regionId);
    const budgets: Record<number, number> = {};
    for (const r of kept) budgets[r.regionId] = MIN;
    // Distribute remaining to kept regions proportionally.
    const remaining = MAX - kept.length * MIN;
    const keptArea = kept.reduce((sum, r) => sum + r.area, 0);
    for (const r of kept) {
      const extra = keptArea > 0 ? Math.floor((r.area / keptArea) * remaining) : 0;
      budgets[r.regionId] = MIN + extra;
    }
    return { budgets, omittedRegions: omitted };
  }

  // Enough for minimums: distribute proportionally.
  const remaining = MAX - minTotal;
  const budgets: Record<number, number> = {};
  let allocated = 0;

  for (const r of regions) {
    const share = totalArea > 0 ? Math.floor((r.area / totalArea) * remaining) : 0;
    const budget = MIN + share;
    budgets[r.regionId] = Math.min(
      budget,
      r.triangleCount,
      RECONSTRUCTION_LIMITS.maxFallbackRegionTriangles,
    );
    allocated += budgets[r.regionId];
  }

  // Distribute leftover from flooring in ascending region ID order.
  let leftover = Math.min(MAX - allocated, totalDemand - allocated);
  if (leftover > 0) {
    const sorted = [...regions].sort((a, b) => a.regionId - b.regionId);
    for (const r of sorted) {
      if (leftover <= 0) break;
      const headroom = Math.min(
        r.triangleCount,
        RECONSTRUCTION_LIMITS.maxFallbackRegionTriangles,
      ) - budgets[r.regionId];
      if (headroom > 0) {
        budgets[r.regionId] += 1;
        leftover--;
      }
    }
  }

  return { budgets, omittedRegions: [] };
}

/**
 * Check resource limits before expensive reconstruction.
 * Throws ResourceLimitError on violation.
 */
export function checkResourceLimits(params: {
  inputTriangles: number;
  candidateRegions: number;
  estimatedMemoryMB?: number;
}): void {
  if (params.inputTriangles > RECONSTRUCTION_LIMITS.maxInputTriangles) {
    throw new ResourceLimitError(
      'inputTriangles',
      RECONSTRUCTION_LIMITS.maxInputTriangles,
      params.inputTriangles,
    );
  }
  if (params.candidateRegions > RECONSTRUCTION_LIMITS.maxCandidateRegions) {
    throw new ResourceLimitError(
      'candidateRegions',
      RECONSTRUCTION_LIMITS.maxCandidateRegions,
      params.candidateRegions,
    );
  }
  if (
    params.estimatedMemoryMB !== undefined &&
    params.estimatedMemoryMB > RECONSTRUCTION_LIMITS.maxWorkerMemoryMB
  ) {
    throw new ResourceLimitError(
      'workerMemoryMB',
      RECONSTRUCTION_LIMITS.maxWorkerMemoryMB,
      params.estimatedMemoryMB,
    );
  }
}
