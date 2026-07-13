/**
 * Region types for analytic surface recognition during STEP mesh-to-CAD
 * reconstruction.
 */

export type SurfaceType = 'plane' | 'cylinder' | 'sphere' | 'cone' | 'fallback';

/** A candidate surface region grown from mesh triangles. */
export interface SurfaceRegion {
  /** Stable region ID. */
  id: number;
  /** Surface hypothesis for this region. */
  type: SurfaceType;
  /** Source triangle IDs belonging to this region. */
  triangleIds: number[];
  /** Fitted surface parameters (type-specific). */
  parameters: SurfaceParameters;
  /** Fit quality metrics. */
  quality: FitQuality;
  /** Whether this region was accepted after validation. */
  accepted: boolean;
  /** Rejection reason if not accepted. */
  rejectionReason?: string;
}

/** Type-specific fitted parameters. */
export interface SurfaceParameters {
  // Plane
  planeNormal?: { x: number; y: number; z: number };
  planePoint?: { x: number; y: number; z: number };
  // Cylinder
  cylinderAxis?: { x: number; y: number; z: number };
  cylinderCenter?: { x: number; y: number; z: number };
  cylinderRadius?: number;
  // Sphere
  sphereCenter?: { x: number; y: number; z: number };
  sphereRadius?: number;
  // Cone
  coneApex?: { x: number; y: number; z: number };
  coneAxis?: { x: number; y: number; z: number };
  coneHalfAngle?: number;
}

/** Fit quality metrics for a candidate region. */
export interface FitQuality {
  rmsDistance: number;
  maxDistance: number;
  maxNormalError: number;
  inlierRatio: number;
  coveredArea: number;
  triangleCount: number;
}

/** Default tolerances derived from bounding-box diagonal D. */
export interface ReconstructionTolerances {
  /** Base distance tolerance: max(D * 1e-4, 1e-6). */
  baseDistance: number;
  /** Maximum accepted point distance: 2 * baseDistance. */
  maxDistance: number;
  /** Normal angle tolerance in radians (3 degrees). */
  normalAngleTolerance: number;
  /** Vertex weld tolerance (clamped D * 1e-7). */
  weldTolerance: number;
  /** Minimum region triangle count (20). */
  minRegionTriangles: number;
  /** Minimum region area as fraction of total (0.05%). */
  minRegionAreaFraction: number;
}

/** Compute tolerances from bounding-box diagonal. */
export function computeTolerances(diagonal: number): ReconstructionTolerances {
  return {
    baseDistance: Math.max(diagonal * 1e-4, 1e-6),
    maxDistance: 2 * Math.max(diagonal * 1e-4, 1e-6),
    normalAngleTolerance: 3 * Math.PI / 180,
    weldTolerance: Math.min(1e-4, Math.max(1e-9, diagonal * 1e-7)),
    minRegionTriangles: 20,
    minRegionAreaFraction: 0.0005,
  };
}

/** Resource limits for CAD-compatible reconstruction. */
export const RECONSTRUCTION_LIMITS = {
  maxInputTriangles: 100_000,
  maxRegionTriangles: 30_000,
  maxCandidateRegions: 200,
  maxFallbackTriangles: 120,
  maxFallbackRegionTriangles: 40,
  maxWorkerMemoryMB: 512,
  maxProcessingTimeMs: 5 * 60 * 1000,
} as const;
