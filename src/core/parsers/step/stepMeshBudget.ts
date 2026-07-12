/**
 * Budget allocation for STEP mesh export.
 *
 * Given a list of meshes with their source triangle counts, allocates a
 * per-mesh triangle budget based on the mode/preset caps and the global
 * 250k total limit. Allocation is deterministic.
 */

import type { StepMeshMode, StepMeshPreset } from './stepMeshTypes';
import {
  STEP_MESH_MIN_BUDGET,
  STEP_MESH_TOTAL_TRIANGLE_LIMIT,
  getStepMeshPresetCap,
} from './stepMeshConfig';

interface BudgetInput {
  id: string;
  triangleCount: number;
}

/**
 * Allocate per-mesh triangle budgets.
 *
 * 1. Cap each mesh by its preset limit.
 * 2. If the capped sum exceeds 250k, reserve min(500, demand) per mesh,
 *    distribute the remainder proportionally, floor, then assign leftover
 *    units in ascending ID order.
 */
export function allocateStepMeshBudgets(
  inputs: BudgetInput[],
  mode: StepMeshMode,
  preset: StepMeshPreset,
): Record<string, number> {
  const presetCap = getStepMeshPresetCap(mode, preset);

  // Step 1: Cap each mesh by preset.
  const capped = inputs.map((m) => ({
    id: m.id,
    demand: Math.min(m.triangleCount, presetCap),
  }));

  const totalCappedDemand = capped.reduce((sum, m) => sum + m.demand, 0);

  // If under total limit, return capped demands as-is.
  if (totalCappedDemand <= STEP_MESH_TOTAL_TRIANGLE_LIMIT) {
    const result: Record<string, number> = {};
    for (const m of capped) result[m.id] = m.demand;
    return result;
  }

  // Step 2: Over budget — proportional reduction.
  // Reserve minimum for each mesh.
  const reserved = capped.map((m) => ({
    id: m.id,
    demand: m.demand,
    reserve: Math.min(STEP_MESH_MIN_BUDGET, m.demand),
  }));

  const totalReserved = reserved.reduce((sum, m) => sum + m.reserve, 0);
  const remaining = Math.max(0, STEP_MESH_TOTAL_TRIANGLE_LIMIT - totalReserved);

  // Distribute remaining proportionally to (demand - reserve).
  const excessDemand = reserved.map((m) => m.demand - m.reserve);
  const totalExcess = excessDemand.reduce((sum, v) => sum + v, 0);

  const allocated = reserved.map((m, i) => {
    const share = totalExcess > 0 ? Math.floor((excessDemand[i] / totalExcess) * remaining) : 0;
    return {
      id: m.id,
      budget: m.reserve + share,
      demand: m.demand,
    };
  });

  // Assign leftover units (from flooring) in ascending ID order.
  const allocatedTotal = allocated.reduce((sum, m) => sum + m.budget, 0);
  let leftover = Math.min(
    STEP_MESH_TOTAL_TRIANGLE_LIMIT - allocatedTotal,
    totalCappedDemand - allocatedTotal,
  );

  if (leftover > 0) {
    const sorted = [...allocated].sort((a, b) => a.id.localeCompare(b.id));
    for (const m of sorted) {
      if (leftover <= 0) break;
      const headroom = m.demand - m.budget;
      if (headroom > 0) {
        m.budget += 1;
        leftover--;
      }
    }
  }

  const result: Record<string, number> = {};
  for (const m of allocated) result[m.id] = m.budget;
  return result;
}
