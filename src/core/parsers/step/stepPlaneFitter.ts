/**
 * Plane surface fitting for CAD-compatible STEP reconstruction.
 *
 * Fits a plane to a set of mesh triangles and validates the fit against
 * distance, normal, and stability gates. Returns accepted/rejected status
 * with machine-readable reasons.
 */

import type { MeshAnalysis } from './stepMeshAnalysis';
import type { PreparedStepMesh } from './stepMeshTypes';
import type {
  FitQuality,
  ReconstructionTolerances,
  SurfaceParameters,
} from './stepMeshRegionTypes';

export interface PlaneFitResult {
  accepted: boolean;
  parameters: SurfaceParameters;
  quality: FitQuality;
  rejectionReason?: string;
}

/** Dot product helper. */
function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Distance from a point to a plane defined by normal + point. */
function pointToPlaneDistance(
  point: { x: number; y: number; z: number },
  normal: { x: number; y: number; z: number },
  planePoint: { x: number; y: number; z: number },
): number {
  const d = dot(normal, { x: point.x - planePoint.x, y: point.y - planePoint.y, z: point.z - planePoint.z });
  return Math.abs(d);
}

/**
 * Fit a plane to a set of triangle IDs and validate the fit.
 *
 * Uses the area-weighted average normal and the centroid as the plane point.
 * Validates using distance, normal, and stability gates from the design spec.
 */
export function fitPlane(
  prepared: PreparedStepMesh,
  analysis: MeshAnalysis,
  triangleIds: number[],
  tolerances: ReconstructionTolerances,
): PlaneFitResult {
  const vertices = prepared.mesh.vertices;
  const indices = prepared.mesh.indices;

  if (triangleIds.length === 0) {
    return {
      accepted: false,
      parameters: {},
      quality: {
        rmsDistance: Infinity,
        maxDistance: Infinity,
        maxNormalError: Infinity,
        inlierRatio: 0,
        coveredArea: 0,
        triangleCount: 0,
      },
      rejectionReason: 'empty-region',
    };
  }

  // Compute area-weighted average normal.
  let totalArea = 0;
  let awNormalX = 0, awNormalY = 0, awNormalZ = 0;
  let centroidX = 0, centroidY = 0, centroidZ = 0;

  for (const tId of triangleIds) {
    const face = analysis.faces[tId];
    if (!face) continue;
    awNormalX += face.normal.x * face.area;
    awNormalY += face.normal.y * face.area;
    awNormalZ += face.normal.z * face.area;
    centroidX += face.centroid.x * face.area;
    centroidY += face.centroid.y * face.area;
    centroidZ += face.centroid.z * face.area;
    totalArea += face.area;
  }

  if (totalArea < 1e-20) {
    return rejectFit('zero-area-region', triangleIds.length, totalArea);
  }

  const awLen = Math.sqrt(awNormalX * awNormalX + awNormalY * awNormalY + awNormalZ * awNormalZ);
  if (awLen < 1e-20) {
    return rejectFit('degenerate-normal', triangleIds.length, totalArea);
  }

  const planeNormal = {
    x: awNormalX / awLen,
    y: awNormalY / awLen,
    z: awNormalZ / awLen,
  };
  const planePoint = {
    x: centroidX / totalArea,
    y: centroidY / totalArea,
    z: centroidZ / totalArea,
  };

  // Collect all unique vertex positions from the region's triangles.
  const vertexSet = new Set<number>();
  for (const tId of triangleIds) {
    const a = indices[tId * 3], b = indices[tId * 3 + 1], c = indices[tId * 3 + 2];
    vertexSet.add(a);
    vertexSet.add(b);
    vertexSet.add(c);
  }

  // Compute distances and normal errors.
  let sumDistSq = 0;
  let maxDist = 0;
  let maxNormalError = 0;
  let inlierCount = 0;
  const totalVertices = vertexSet.size;

  for (const vIdx of vertexSet) {
    const point = {
      x: vertices[vIdx * 3],
      y: vertices[vIdx * 3 + 1],
      z: vertices[vIdx * 3 + 2],
    };
    const dist = pointToPlaneDistance(point, planeNormal, planePoint);
    sumDistSq += dist * dist;
    if (dist > maxDist) maxDist = dist;
    if (dist <= tolerances.maxDistance) inlierCount++;
  }

  for (const tId of triangleIds) {
    const face = analysis.faces[tId];
    if (!face) continue;
    const cosAngle = Math.abs(dot(face.normal, planeNormal));
    const angleError = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    if (angleError > maxNormalError) maxNormalError = angleError;
  }

  const rmsDistance = Math.sqrt(sumDistSq / Math.max(1, totalVertices));
  const inlierRatio = totalVertices > 0 ? inlierCount / totalVertices : 0;

  const quality: FitQuality = {
    rmsDistance,
    maxDistance: maxDist,
    maxNormalError,
    inlierRatio,
    coveredArea: totalArea,
    triangleCount: triangleIds.length,
  };

  const parameters: SurfaceParameters = {
    planeNormal,
    planePoint,
  };

  // Validation gates.
  if (inlierRatio < 0.95) {
    return { accepted: false, parameters, quality, rejectionReason: `inlier-ratio-${inlierRatio.toFixed(3)}-below-0.95` };
  }
  if (rmsDistance > tolerances.baseDistance) {
    return { accepted: false, parameters, quality, rejectionReason: `rms-${rmsDistance.toExponential(3)}-above-${tolerances.baseDistance.toExponential(3)}` };
  }
  if (maxDist > tolerances.maxDistance) {
    return { accepted: false, parameters, quality, rejectionReason: `max-dist-${maxDist.toExponential(3)}-above-${tolerances.maxDistance.toExponential(3)}` };
  }
  if (maxNormalError > tolerances.normalAngleTolerance) {
    return { accepted: false, parameters, quality, rejectionReason: `normal-error-${(maxNormalError * 180 / Math.PI).toFixed(1)}deg-above-${(tolerances.normalAngleTolerance * 180 / Math.PI).toFixed(1)}deg` };
  }
  if (triangleIds.length < tolerances.minRegionTriangles) {
    return { accepted: false, parameters, quality, rejectionReason: `triangles-${triangleIds.length}-below-min-${tolerances.minRegionTriangles}` };
  }

  return { accepted: true, parameters, quality };
}

function rejectFit(reason: string, triangleCount: number, area: number): PlaneFitResult {
  return {
    accepted: false,
    parameters: {},
    quality: {
      rmsDistance: Infinity,
      maxDistance: Infinity,
      maxNormalError: Infinity,
      inlierRatio: 0,
      coveredArea: area,
      triangleCount,
    },
    rejectionReason: reason,
  };
}
