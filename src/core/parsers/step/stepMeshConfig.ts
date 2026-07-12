/**
 * Centralized budgets and tolerances for STEP mesh export.
 *
 * All values are intentional and tested. Do not change without updating
 * stepMeshConfig.test.ts.
 */

import type { StepMeshMode, StepMeshPreset } from './stepMeshTypes';

/**
 * Per-mesh triangle budget caps by mode and preset.
 *
 * Mode→preset→maxTriangles. Keys use camelCase to match the wire format.
 */
export const STEP_MESH_PRESETS = {
  lightweight: { small: 5_000, balanced: 15_000, high: 50_000 },
  'cad-repair': { small: 15_000, balanced: 40_000, high: 100_000 },
} as const satisfies Record<StepMeshMode, Record<StepMeshPreset, number>>;

/** Hard ceiling on total triangles across all meshes in one export. */
export const STEP_MESH_TOTAL_TRIANGLE_LIMIT = 250_000;

/** Minimum per-mesh budget when allocating proportionally. */
export const STEP_MESH_MIN_BUDGET = 500;

/** Vertex weld tolerance as a ratio of bounding-box diagonal. */
export const STEP_MESH_WELD_TOLERANCE_RATIO = 1e-7;

/** Clamp bounds for computed weld tolerance. */
export const STEP_MESH_WELD_TOLERANCE_MIN = 1e-9;
export const STEP_MESH_WELD_TOLERANCE_MAX = 1e-4;

/** Sewing multiplier passed to BRepBuilderAPI_Sewing. */
export const STEP_MESH_SEWING_MULTIPLIER = 2;

/** Convert a StepMeshMode to its preset-key form. */
export function getStepMeshPresetCap(
  mode: StepMeshMode,
  preset: StepMeshPreset,
): number {
  return STEP_MESH_PRESETS[mode][preset];
}
