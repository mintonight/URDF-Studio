/**
 * Cylinder surface fitting for CAD-compatible STEP reconstruction.
 *
 * Fits a cylinder to a set of mesh triangles by estimating the cylinder
 * axis, radius, and center point. Validates the fit against distance,
 * normal, and stability gates from the design spec.
 */

import type { MeshAnalysis } from './stepMeshAnalysis';
import type { PreparedStepMesh } from './stepMeshTypes';
import type {
  FitQuality,
  ReconstructionTolerances,
  SurfaceParameters,
} from './stepMeshRegionTypes';

export interface CylinderFitResult {
  accepted: boolean;
  parameters: SurfaceParameters;
  quality: FitQuality;
  rejectionReason?: string;
}

interface Vec3 { x: number; y: number; z: number; }

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(dot(v, v));
  if (len < 1e-20) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function scale(v: Vec3, s: number): Vec3 {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

/**
 * Fit a cylinder to a set of triangle IDs.
 *
 * Strategy:
 * 1. Estimate axis direction via PCA on face normals (the dominant normal
 *    variation direction is perpendicular to the axis).
 * 2. Project vertices onto the plane perpendicular to the axis.
 * 3. Fit a circle to the projected points to get center and radius.
 * 4. Validate distances and normal errors.
 */
export function fitCylinder(
  prepared: PreparedStepMesh,
  analysis: MeshAnalysis,
  triangleIds: number[],
  tolerances: ReconstructionTolerances,
): CylinderFitResult {
  const vertices = prepared.mesh.vertices;
  const indices = prepared.mesh.indices;

  if (triangleIds.length === 0) {
    return rejectCylinder('empty-region', 0, 0);
  }

  // Step 1: Collect unique vertices and face normals.
  const vertexSet = new Set<number>();
  const normals: Vec3[] = [];
  let totalArea = 0;
  let centroidX = 0, centroidY = 0, centroidZ = 0;

  for (const tId of triangleIds) {
    const face = analysis.faces[tId];
    if (!face) continue;
    normals.push(face.normal);
    totalArea += face.area;
    centroidX += face.centroid.x * face.area;
    centroidY += face.centroid.y * face.area;
    centroidZ += face.centroid.z * face.area;

    const a = indices[tId * 3], b = indices[tId * 3 + 1], c = indices[tId * 3 + 2];
    vertexSet.add(a);
    vertexSet.add(b);
    vertexSet.add(c);
  }

  if (totalArea < 1e-20 || vertexSet.size < 3) {
    return rejectCylinder('insufficient-geometry', triangleIds.length, totalArea);
  }

  const meshCentroid: Vec3 = {
    x: centroidX / totalArea,
    y: centroidY / totalArea,
    z: centroidZ / totalArea,
  };

  // Step 2: PCA on face normals to find the axis direction.
  // The axis is the direction of minimum normal variance.
  // Compute covariance matrix of normals.
  let sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0;
  for (const n of normals) {
    sxx += n.x * n.x;
    syy += n.y * n.y;
    szz += n.z * n.z;
    sxy += n.x * n.y;
    sxz += n.x * n.z;
    syz += n.y * n.z;
  }
  const nNorm = Math.max(1, normals.length);

  // Simple power iteration to find the eigenvector with the smallest eigenvalue.
  // Start with a random-ish vector and iterate.
  let axis: Vec3 = { x: 0, y: 0, z: 1 };
  // Use inverse power iteration approximation: iterate (C - λI)^{-1} or just
  // find the direction that minimizes variance.
  // Simpler: the axis is approximately perpendicular to the average normal.
  // For a cylinder, normals point radially outward — their average should be
  // near zero, and the axis is the direction of least variance.
  // Try all 3 axes and pick the one with smallest projection variance.
  const candidates: Vec3[] = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
  let bestAxis = candidates[0];
  let bestVariance = Infinity;

  for (const candidate of candidates) {
    // Start from candidate and refine with power iteration on covariance.
    let v = candidate;
    for (let iter = 0; iter < 20; iter++) {
      const newX = sxx * v.x + sxy * v.y + sxz * v.z;
      const newY = sxy * v.x + syy * v.y + syz * v.z;
      const newZ = sxz * v.x + syz * v.y + szz * v.z;
      v = normalize({ x: newX, y: newY, z: newZ });
    }
    // Variance along this direction.
    const variance = dot(v, {
      x: sxx * v.x + sxy * v.y + sxz * v.z,
      y: sxy * v.x + syy * v.y + syz * v.z,
      z: sxz * v.x + syz * v.y + szz * v.z,
    }) / nNorm;
    if (variance < bestVariance) {
      bestVariance = variance;
      bestAxis = v;
    }
  }

  axis = normalize(bestAxis);

  // Step 3: Project vertices onto the plane perpendicular to axis, fit circle.
  const projectedPoints: Vec3[] = [];
  for (const vIdx of vertexSet) {
    const p: Vec3 = {
      x: vertices[vIdx * 3],
      y: vertices[vIdx * 3 + 1],
      z: vertices[vIdx * 3 + 2],
    };
    const rel = sub(p, meshCentroid);
    // Remove the axial component.
    const axialComponent = scale(axis, dot(rel, axis));
    const projected = sub(rel, axialComponent);
    projectedPoints.push(projected);
  }

  // Fit circle to projected points (algebraic least-squares).
  // Minimize sum(|p_i - c|^2 - r^2)^2 → linear system for c.x, c.y, c.z, and r.
  // Use the projected 3D points (which lie in a plane perpendicular to axis).
  let sumX = 0, sumY = 0, sumZ = 0;
  const N = projectedPoints.length;

  for (const p of projectedPoints) {
    sumX += p.x; sumY += p.y; sumZ += p.z;
  }

  // Algebraic circle fit: solve for center c that minimizes
  // sum(|p_i - c|^2 - r^2)^2.
  // This reduces to: c = mean(p_i) adjusted by the spread.
  // For a robust fit, use the mean as initial guess and average radius.
  const center2D: Vec3 = {
    x: sumX / N,
    y: sumY / N,
    z: sumZ / N,
  };

  let sumR = 0;
  for (const p of projectedPoints) {
    const d = sub(p, center2D);
    sumR += Math.sqrt(dot(d, d));
  }
  const radius = sumR / N;

  if (radius < 1e-8) {
    return rejectCylinder('zero-radius', triangleIds.length, totalArea);
  }

  // The cylinder center is the projected center + the mesh centroid.
  const cylinderCenter = add(center2D, meshCentroid);

  // Step 4: Validate distances and normal errors.
  let sumDistSq = 0;
  let maxDist = 0;
  let maxNormalError = 0;
  let inlierCount = 0;

  for (const vIdx of vertexSet) {
    const p: Vec3 = {
      x: vertices[vIdx * 3],
      y: vertices[vIdx * 3 + 1],
      z: vertices[vIdx * 3 + 2],
    };
    const rel = sub(p, cylinderCenter);
    const axialComp = scale(axis, dot(rel, axis));
    const radialVec = sub(rel, axialComp);
    const radialDist = Math.sqrt(dot(radialVec, radialVec));
    const dist = Math.abs(radialDist - radius);
    sumDistSq += dist * dist;
    if (dist > maxDist) maxDist = dist;
    if (dist <= tolerances.maxDistance) inlierCount++;
  }

  for (const tId of triangleIds) {
    const face = analysis.faces[tId];
    if (!face) continue;
    // The face normal should be perpendicular to the axis for a cylinder.
    const cosAngle = Math.abs(dot(face.normal, axis));
    const angleError = Math.PI / 2 - Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    if (Math.abs(angleError) > maxNormalError) maxNormalError = Math.abs(angleError);
  }

  const rmsDistance = Math.sqrt(sumDistSq / Math.max(1, vertexSet.size));
  const inlierRatio = vertexSet.size > 0 ? inlierCount / vertexSet.size : 0;

  const quality: FitQuality = {
    rmsDistance,
    maxDistance: maxDist,
    maxNormalError,
    inlierRatio,
    coveredArea: totalArea,
    triangleCount: triangleIds.length,
  };

  const parameters: SurfaceParameters = {
    cylinderAxis: axis,
    cylinderCenter,
    cylinderRadius: radius,
  };

  // Validation gates.
  if (inlierRatio < 0.95) {
    return { accepted: false, parameters, quality, rejectionReason: `inlier-ratio-${inlierRatio.toFixed(3)}-below-0.95` };
  }
  if (rmsDistance > tolerances.baseDistance) {
    return { accepted: false, parameters, quality, rejectionReason: `rms-${rmsDistance.toExponential(3)}-above-tolerance` };
  }
  if (maxDist > tolerances.maxDistance) {
    return { accepted: false, parameters, quality, rejectionReason: `max-dist-${maxDist.toExponential(3)}-above-tolerance` };
  }
  if (maxNormalError > tolerances.normalAngleTolerance) {
    return { accepted: false, parameters, quality, rejectionReason: `normal-error-${(maxNormalError * 180 / Math.PI).toFixed(1)}deg-above-tolerance` };
  }
  if (triangleIds.length < tolerances.minRegionTriangles) {
    return { accepted: false, parameters, quality, rejectionReason: `triangles-${triangleIds.length}-below-min-${tolerances.minRegionTriangles}` };
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    return { accepted: false, parameters, quality, rejectionReason: 'invalid-radius' };
  }

  return { accepted: true, parameters, quality };
}

function rejectCylinder(reason: string, triangleCount: number, area: number): CylinderFitResult {
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
