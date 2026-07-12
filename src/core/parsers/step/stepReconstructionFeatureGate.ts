/**
 * Feature gate for analytic surface reconstruction in STEP export.
 *
 * Analytic reconstruction (plane/cylinder/sphere/cone recognition) is
 * experimental and disabled by default. It must not be enabled until
 * browser verification and independent CAD reopen confirm validity.
 *
 * Even when enabled, only surface types listed in ENABLED_STEP_ANALYTIC_SURFACES
 * are allowed to produce OCCT faces. All other types route to faceted fallback.
 */

import type { SurfaceType } from './stepMeshRegionTypes';

/**
 * Surface types currently approved for analytic OCCT face construction.
 * Plane and complete-revolution cylinders are enabled. Sphere/cone require
 * verified OCCT builders and independent CAD reopen before being added here.
 */
export const ENABLED_STEP_ANALYTIC_SURFACES: ReadonlySet<SurfaceType> = new Set([
  'plane',
  'cylinder',
]);

/**
 * Returns true only when an explicit experimental flag enables analytic
 * reconstruction. The flag is never derived from meshMode.
 */
export function shouldUseAnalyticReconstruction(
  experimentalEnabled: boolean | undefined,
): boolean {
  return experimentalEnabled === true;
}

/**
 * Returns true when a surface type is safe to use for OCCT face construction.
 * All unrecognized or disabled types must route to faceted fallback.
 */
export function isAnalyticSurfaceEnabled(type: SurfaceType): boolean {
  return ENABLED_STEP_ANALYTIC_SURFACES.has(type);
}
