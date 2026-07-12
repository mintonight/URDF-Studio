/**
 * Multi-surface reconstruction orchestrator.
 *
 * For each grown region, attempts fitting in the fixed order plane → cylinder
 * → sphere → cone. Regions rejected by one type remain eligible for later
 * types. When multiple candidates overlap, resolves deterministically by:
 * 1. lower normalized maximum error;
 * 2. higher inlier count;
 * 3. simpler surface type (plane < cylinder < sphere < cone);
 * 4. lower seed triangle ID.
 */

import type { MeshAnalysis } from './stepMeshAnalysis';
import type { PreparedStepMesh } from './stepMeshTypes';
import type {
  ReconstructionTolerances,
  SurfaceRegion,
  SurfaceType,
} from './stepMeshRegionTypes';
import type { GrownRegion } from './stepRegionGrowing';
import { fitPlane } from './stepPlaneFitter';
import { fitCylinder } from './stepCylinderFitter';
import { fitSphere, fitCone } from './stepSphereConeFitter';

/** Surface type complexity rank (lower = simpler, preferred). */
const SURFACE_TYPE_RANK: Record<SurfaceType, number> = {
  plane: 0,
  cylinder: 1,
  sphere: 2,
  cone: 3,
  fallback: 4,
};

/** Candidate result from one fit attempt. */
interface FitCandidate {
  region: SurfaceRegion;
  type: SurfaceType;
  maxError: number;
  inlierCount: number;
  seedId: number;
}

/**
 * Reconstruct analytic surfaces from grown regions.
 *
 * For each region, tries plane → cylinder → sphere → cone in order.
 * The first accepted fit wins for that region. Unmatched regions become
 * fallback candidates.
 *
 * Returns the final list of accepted SurfaceRegions.
 */
export function reconstructSurfaces(
  prepared: PreparedStepMesh,
  analysis: MeshAnalysis,
  grownRegions: GrownRegion[],
  tolerances: ReconstructionTolerances,
): SurfaceRegion[] {
  const candidates: FitCandidate[] = [];
  const fallbackTriangleIds: number[] = [];
  let regionId = 0;

  for (const grown of grownRegions) {
    const triangleIds = grown.triangleIds;
    let accepted = false;

    // Try plane first.
    const planeResult = fitPlane(prepared, analysis, triangleIds, tolerances);
    if (planeResult.accepted) {
      const region: SurfaceRegion = {
        id: regionId++,
        type: 'plane',
        triangleIds,
        parameters: planeResult.parameters,
        quality: planeResult.quality,
        accepted: true,
      };
      candidates.push({
        region,
        type: 'plane',
        maxError: planeResult.quality.maxDistance,
        inlierCount: Math.round(planeResult.quality.inlierRatio * triangleIds.length),
        seedId: grown.seedId,
      });
      accepted = true;
    }

    if (!accepted) {
      const cylResult = fitCylinder(prepared, analysis, triangleIds, tolerances);
      if (cylResult.accepted) {
        const region: SurfaceRegion = {
          id: regionId++,
          type: 'cylinder',
          triangleIds,
          parameters: cylResult.parameters,
          quality: cylResult.quality,
          accepted: true,
        };
        candidates.push({
          region,
          type: 'cylinder',
          maxError: cylResult.quality.maxDistance,
          inlierCount: Math.round(cylResult.quality.inlierRatio * triangleIds.length),
          seedId: grown.seedId,
        });
        accepted = true;
      }
    }

    if (!accepted) {
      const sphereResult = fitSphere(prepared, analysis, triangleIds, tolerances);
      if (sphereResult.accepted) {
        const region: SurfaceRegion = {
          id: regionId++,
          type: 'sphere',
          triangleIds,
          parameters: sphereResult.parameters,
          quality: sphereResult.quality,
          accepted: true,
        };
        candidates.push({
          region,
          type: 'sphere',
          maxError: sphereResult.quality.maxDistance,
          inlierCount: Math.round(sphereResult.quality.inlierRatio * triangleIds.length),
          seedId: grown.seedId,
        });
        accepted = true;
      }
    }

    if (!accepted) {
      const coneResult = fitCone(prepared, analysis, triangleIds, tolerances);
      if (coneResult.accepted) {
        const region: SurfaceRegion = {
          id: regionId++,
          type: 'cone',
          triangleIds,
          parameters: coneResult.parameters,
          quality: coneResult.quality,
          accepted: true,
        };
        candidates.push({
          region,
          type: 'cone',
          maxError: coneResult.quality.maxDistance,
          inlierCount: Math.round(coneResult.quality.inlierRatio * triangleIds.length),
          seedId: grown.seedId,
        });
        accepted = true;
      }
    }

    if (!accepted) {
      fallbackTriangleIds.push(...triangleIds);
    }
  }

  // Resolve overlaps: if two candidates share triangles, keep the better one.
  // Since each region is tried independently and regions from growPlanarRegions
  // don't overlap by construction (each triangle is assigned to exactly one
  // region), this step is mostly a safety net for future multi-pass growing.
  const resolved = resolveOverlaps(candidates);

  // Planar region growing intentionally splits curved surfaces into narrow
  // normal-compatible bands. Give the union of all still-unmatched bands one
  // second analytic fit so a complete cylinder/sphere/cone can be recovered.
  if (fallbackTriangleIds.length >= tolerances.minRegionTriangles) {
    const secondPass = [
      { type: 'cylinder' as const, result: fitCylinder(prepared, analysis, fallbackTriangleIds, tolerances) },
      { type: 'sphere' as const, result: fitSphere(prepared, analysis, fallbackTriangleIds, tolerances) },
      { type: 'cone' as const, result: fitCone(prepared, analysis, fallbackTriangleIds, tolerances) },
    ].find((candidate) => candidate.result.accepted);
    if (secondPass) {
      resolved.push({
        id: regionId++,
        type: secondPass.type,
        triangleIds: [...fallbackTriangleIds],
        parameters: secondPass.result.parameters,
        quality: secondPass.result.quality,
        accepted: true,
      });
      fallbackTriangleIds.length = 0;
    }
  }

  // Add fallback region for unmatched triangles.
  if (fallbackTriangleIds.length > 0) {
    resolved.push({
      id: regionId++,
      type: 'fallback',
      triangleIds: fallbackTriangleIds,
      parameters: {},
      quality: {
        rmsDistance: 0,
        maxDistance: 0,
        maxNormalError: 0,
        inlierRatio: 1,
        coveredArea: 0,
        triangleCount: fallbackTriangleIds.length,
      },
      accepted: false,
      rejectionReason: 'no-analytic-surface-matched',
    });
  }

  return resolved;
}

/**
 * Resolve overlapping candidates deterministically.
 * Prefer: lower max error → higher inlier count → simpler type → lower seed.
 */
function resolveOverlaps(candidates: FitCandidate[]): SurfaceRegion[] {
  if (candidates.length === 0) return [];

  // Build triangle → candidate index map.
  const triangleToCandidates = new Map<number, FitCandidate[]>();
  for (const candidate of candidates) {
    for (const tId of candidate.region.triangleIds) {
      const list = triangleToCandidates.get(tId);
      if (list) list.push(candidate);
      else triangleToCandidates.set(tId, [candidate]);
    }
  }

  // Find triangles claimed by more than one candidate.
  const contestedTriangles = new Set<number>();
  for (const [tId, list] of triangleToCandidates) {
    if (list.length > 1) contestedTriangles.add(tId);
  }

  if (contestedTriangles.size === 0) {
    return candidates.map((c) => c.region);
  }

  // Sort candidates by preference: lower error, higher inliers, simpler type, lower seed.
  const sorted = [...candidates].sort((a, b) => {
    if (Math.abs(a.maxError - b.maxError) > 1e-15) return a.maxError - b.maxError;
    if (a.inlierCount !== b.inlierCount) return b.inlierCount - a.inlierCount;
    const typeDiff = SURFACE_TYPE_RANK[a.type] - SURFACE_TYPE_RANK[b.type];
    if (typeDiff !== 0) return typeDiff;
    return a.seedId - b.seedId;
  });

  // Assign contested triangles to the best candidate; remove from others.
  const assigned = new Set<number>();
  const result: SurfaceRegion[] = [];

  for (const candidate of sorted) {
    const remaining = candidate.region.triangleIds.filter((t) => !assigned.has(t));
    for (const t of candidate.region.triangleIds) assigned.add(t);

    if (remaining.length > 0) {
      result.push({
        ...candidate.region,
        triangleIds: remaining,
        quality: { ...candidate.region.quality, triangleCount: remaining.length },
      });
    }
  }

  return result;
}
