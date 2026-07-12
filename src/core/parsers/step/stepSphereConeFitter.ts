/**
 * Sphere and cone surface fitting for CAD-compatible STEP reconstruction.
 */

import type { MeshAnalysis } from './stepMeshAnalysis';
import type { PreparedStepMesh } from './stepMeshTypes';
import type {
  FitQuality,
  ReconstructionTolerances,
  SurfaceParameters,
} from './stepMeshRegionTypes';

interface Vec3 { x: number; y: number; z: number; }

function sub(a: Vec3, b: Vec3): Vec3 { return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }; }
function dot(a: Vec3, b: Vec3): number { return a.x * b.x + a.y * b.y + a.z * b.z; }
function scale(v: Vec3, s: number): Vec3 { return { x: v.x * s, y: v.y * s, z: v.z * s }; }

// ---------------------------------------------------------------------------
// Sphere fitter
// ---------------------------------------------------------------------------

export interface SphereFitResult {
  accepted: boolean;
  parameters: SurfaceParameters;
  quality: FitQuality;
  rejectionReason?: string;
}

/**
 * Fit a sphere to a set of triangles.
 * Strategy: use algebraic least-squares sphere fit.
 * Center = solution to linear system from |p_i - c|^2 = r^2.
 */
export function fitSphere(
  prepared: PreparedStepMesh,
  analysis: MeshAnalysis,
  triangleIds: number[],
  tolerances: ReconstructionTolerances,
): SphereFitResult {
  const vertices = prepared.mesh.vertices;
  const indices = prepared.mesh.indices;

  if (triangleIds.length === 0) {
    return reject('empty-region', 0, 0);
  }

  // Collect unique vertices.
  const vertexSet = new Set<number>();
  let totalArea = 0;

  for (const tId of triangleIds) {
    const face = analysis.faces[tId];
    if (!face) continue;
    totalArea += face.area;
    const a = indices[tId * 3], b = indices[tId * 3 + 1], c = indices[tId * 3 + 2];
    vertexSet.add(a); vertexSet.add(b); vertexSet.add(c);
  }

  if (totalArea < 1e-20 || vertexSet.size < 4) {
    return reject('insufficient-geometry', triangleIds.length, totalArea);
  }

  // Algebraic sphere fit: solve for center c and radius r.
  // For each point p: |p - c|^2 = r^2 → p·p - 2c·p + c·c - r^2 = 0
  // Let s = c·c - r^2. Then: 2c·p - s = p·p.
  // This is linear in [c.x, c.y, c.z, s].
  // Build normal equations A^T A x = A^T b.
  const points: Vec3[] = [];
  for (const vIdx of vertexSet) {
    points.push({ x: vertices[vIdx * 3], y: vertices[vIdx * 3 + 1], z: vertices[vIdx * 3 + 2] });
  }

  // 4x4 normal equations.
  let ata00 = 0, ata01 = 0, ata02 = 0, ata03 = 0;
  let ata11 = 0, ata12 = 0, ata13 = 0;
  let ata22 = 0, ata23 = 0;
  let ata33 = 0;
  let atb0 = 0, atb1 = 0, atb2 = 0, atb3 = 0;

  for (const p of points) {
    const px2 = 2 * p.x, py2 = 2 * p.y, pz2 = 2 * p.z;
    const pp = dot(p, p);
    // Row: [2px, 2py, 2pz, -1] → rhs: pp
    ata00 += px2 * px2; ata01 += px2 * py2; ata02 += px2 * pz2; ata03 += px2 * -1;
    ata11 += py2 * py2; ata12 += py2 * pz2; ata13 += py2 * -1;
    ata22 += pz2 * pz2; ata23 += pz2 * -1;
    ata33 += 1;
    atb0 += px2 * pp; atb1 += py2 * pp; atb2 += pz2 * pp; atb3 += -pp;
  }

  // Solve 4x4 system via Gaussian elimination.
  const mat = [
    [ata00, ata01, ata02, ata03, atb0],
    [ata01, ata11, ata12, ata13, atb1],
    [ata02, ata12, ata22, ata23, atb2],
    [ata03, ata13, ata23, ata33, atb3],
  ];

  const sol = solveLinear4(mat);
  if (!sol) {
    return reject('singular-system', triangleIds.length, totalArea);
  }

  const center: Vec3 = { x: sol[0], y: sol[1], z: sol[2] };
  const s = sol[3]; // c·c - r^2
  const r2 = dot(center, center) - s;
  if (r2 <= 0) {
    return reject('negative-radius-squared', triangleIds.length, totalArea);
  }
  const radius = Math.sqrt(r2);
  if (!Number.isFinite(radius) || radius <= 0) {
    return reject('invalid-radius', triangleIds.length, totalArea);
  }

  // Validate distances.
  let sumDistSq = 0, maxDist = 0, inlierCount = 0;
  for (const p of points) {
    const d = sub(p, center);
    const dist = Math.abs(Math.sqrt(dot(d, d)) - radius);
    sumDistSq += dist * dist;
    if (dist > maxDist) maxDist = dist;
    if (dist <= tolerances.maxDistance) inlierCount++;
  }

  // Validate normal errors: face normals should point radially from center.
  let maxNormalError = 0;
  for (const tId of triangleIds) {
    const face = analysis.faces[tId];
    if (!face) continue;
    const radial = normalizeVec(sub(face.centroid, center));
    const cosAngle = dot(face.normal, radial);
    const angleError = Math.acos(Math.max(-1, Math.min(1, Math.abs(cosAngle))));
    if (angleError > maxNormalError) maxNormalError = angleError;
  }

  const rmsDistance = Math.sqrt(sumDistSq / Math.max(1, points.length));
  const inlierRatio = points.length > 0 ? inlierCount / points.length : 0;

  const quality: FitQuality = {
    rmsDistance, maxDistance: maxDist, maxNormalError, inlierRatio,
    coveredArea: totalArea, triangleCount: triangleIds.length,
  };
  const parameters: SurfaceParameters = { sphereCenter: center, sphereRadius: radius };

  return validateFit(parameters, quality, tolerances);
}

// ---------------------------------------------------------------------------
// Cone fitter
// ---------------------------------------------------------------------------

export interface ConeFitResult {
  accepted: boolean;
  parameters: SurfaceParameters;
  quality: FitQuality;
  rejectionReason?: string;
}

/**
 * Fit a cone to a set of triangles.
 * Strategy: estimate apex as the point where all face normals' lines converge
 * (least-squares intersection of normal rays), then estimate axis and half-angle.
 */
export function fitCone(
  prepared: PreparedStepMesh,
  analysis: MeshAnalysis,
  triangleIds: number[],
  tolerances: ReconstructionTolerances,
): ConeFitResult {
  const vertices = prepared.mesh.vertices;
  const indices = prepared.mesh.indices;

  if (triangleIds.length === 0) {
    return rejectCone('empty-region', 0, 0);
  }

  // Collect face centroids + normals for cone estimation.
  const faceData: Array<{ centroid: Vec3; normal: Vec3; area: number }> = [];
  let totalArea = 0;

  for (const tId of triangleIds) {
    const face = analysis.faces[tId];
    if (!face) continue;
    faceData.push({ centroid: face.centroid, normal: face.normal, area: face.area });
    totalArea += face.area;
    const a = indices[tId * 3], b = indices[tId * 3 + 1], c = indices[tId * 3 + 2];
    void a; void b; void c; void vertices;
  }

  if (totalArea < 1e-20 || faceData.length < 4) {
    return rejectCone('insufficient-geometry', triangleIds.length, totalArea);
  }

  // The cone axis is approximately the direction of minimum normal variance
  // (same as cylinder). The apex is where normal rays converge.
  // Estimate axis via PCA on normals.
  let sxx = 0, syy = 0, szz = 0, sxy = 0, sxz = 0, syz = 0;
  for (const fd of faceData) {
    const n = fd.normal;
    sxx += n.x * n.x; syy += n.y * n.y; szz += n.z * n.z;
    sxy += n.x * n.y; sxz += n.x * n.z; syz += n.y * n.z;
  }

  // Power iteration for dominant eigenvector (axis is perpendicular to max variance).
  const candidates: Vec3[] = [{ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 }];
  let axis: Vec3 = { x: 0, y: 0, z: 1 };
  let bestVariance = Infinity;

  for (const candidate of candidates) {
    let v = candidate;
    for (let iter = 0; iter < 20; iter++) {
      const newX = sxx * v.x + sxy * v.y + sxz * v.z;
      const newY = sxy * v.x + syy * v.y + syz * v.z;
      const newZ = sxz * v.x + syz * v.y + szz * v.z;
      v = normalizeVec({ x: newX, y: newY, z: newZ });
    }
    const variance = dot(v, {
      x: sxx * v.x + sxy * v.y + sxz * v.z,
      y: sxy * v.x + syy * v.y + syz * v.z,
      z: sxz * v.x + syz * v.y + szz * v.z,
    }) / Math.max(1, faceData.length);
    if (variance < bestVariance) {
      bestVariance = variance;
      axis = v;
    }
  }
  axis = normalizeVec(axis);

  // Estimate apex: project all centroids onto the axis, find the point of
  // minimum axial coordinate (simple heuristic). A proper cone fit would
  // solve for the apex as the intersection of the normal lines.
  // For robustness, use the area-weighted centroid as a reference and
  // estimate the half-angle from the normal-axis relationship.
  let cx = 0, cy = 0, cz = 0;
  for (const fd of faceData) {
    cx += fd.centroid.x * fd.area;
    cy += fd.centroid.y * fd.area;
    cz += fd.centroid.z * fd.area;
  }
  const refCenter: Vec3 = { x: cx / totalArea, y: cy / totalArea, z: cz / totalArea };

  // Estimate half-angle from the average angle between normal and axis.
  let sumHalfAngle = 0;
  for (const fd of faceData) {
    const cosAngle = Math.abs(dot(fd.normal, axis));
    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    sumHalfAngle += Math.PI / 2 - angle;
  }
  const halfAngle = sumHalfAngle / faceData.length;

  if (!Number.isFinite(halfAngle) || Math.abs(halfAngle) < 1e-6 || Math.abs(halfAngle) > Math.PI / 2 - 1e-6) {
    return rejectCone('invalid-half-angle', triangleIds.length, totalArea);
  }

  // Apex: refCenter shifted along -axis by some amount. This is a rough estimate.
  // For a proper fit, we'd solve for the apex position. For now, use refCenter.
  const apex = refCenter;

  // Validate: compute distances from each vertex to the cone surface.
  const vertexSet = new Set<number>();
  for (const tId of triangleIds) {
    const a = indices[tId * 3], b = indices[tId * 3 + 1], c = indices[tId * 3 + 2];
    vertexSet.add(a); vertexSet.add(b); vertexSet.add(c);
  }

  let sumDistSq = 0, maxDist = 0, inlierCount = 0;
  let maxNormalError = 0;

  for (const vIdx of vertexSet) {
    const p: Vec3 = { x: vertices[vIdx * 3], y: vertices[vIdx * 3 + 1], z: vertices[vIdx * 3 + 2] };
    const rel = sub(p, apex);
    const axialDist = dot(rel, axis);
    const radialVec = sub(rel, scale(axis, axialDist));
    const radialDist = Math.sqrt(dot(radialVec, radialVec));
    // Expected radius at this axial position = |axialDist| * tan(halfAngle).
    const expectedRadius = Math.abs(axialDist) * Math.tan(halfAngle);
    const dist = Math.abs(radialDist - expectedRadius);
    sumDistSq += dist * dist;
    if (dist > maxDist) maxDist = dist;
    if (dist <= tolerances.maxDistance) inlierCount++;
  }

  for (const fd of faceData) {
    const cosAngle = Math.abs(dot(fd.normal, axis));
    const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));
    const angleError = Math.abs(Math.PI / 2 - angle - halfAngle);
    if (angleError > maxNormalError) maxNormalError = angleError;
  }

  const rmsDistance = Math.sqrt(sumDistSq / Math.max(1, vertexSet.size));
  const inlierRatio = vertexSet.size > 0 ? inlierCount / vertexSet.size : 0;

  const quality: FitQuality = {
    rmsDistance, maxDistance: maxDist, maxNormalError, inlierRatio,
    coveredArea: totalArea, triangleCount: triangleIds.length,
  };
  const parameters: SurfaceParameters = {
    coneApex: apex, coneAxis: axis, coneHalfAngle: halfAngle,
  };

  // Validation gates.
  if (inlierRatio < 0.95) return { accepted: false, parameters, quality, rejectionReason: `inlier-ratio-${inlierRatio.toFixed(3)}` };
  if (rmsDistance > tolerances.baseDistance) return { accepted: false, parameters, quality, rejectionReason: `rms-above-tolerance` };
  if (maxDist > tolerances.maxDistance) return { accepted: false, parameters, quality, rejectionReason: `max-dist-above-tolerance` };
  if (maxNormalError > tolerances.normalAngleTolerance) return { accepted: false, parameters, quality, rejectionReason: `normal-error-above-tolerance` };
  if (triangleIds.length < tolerances.minRegionTriangles) return { accepted: false, parameters, quality, rejectionReason: `triangles-below-min` };

  return { accepted: true, parameters, quality };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeVec(v: Vec3): Vec3 {
  const len = Math.sqrt(dot(v, v));
  if (len < 1e-20) return { x: 0, y: 0, z: 1 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function validateFit(
  parameters: SurfaceParameters,
  quality: FitQuality,
  tolerances: ReconstructionTolerances,
): SphereFitResult {
  if (quality.inlierRatio < 0.95) return { accepted: false, parameters, quality, rejectionReason: `inlier-ratio-${quality.inlierRatio.toFixed(3)}` };
  if (quality.rmsDistance > tolerances.baseDistance) return { accepted: false, parameters, quality, rejectionReason: 'rms-above-tolerance' };
  if (quality.maxDistance > tolerances.maxDistance) return { accepted: false, parameters, quality, rejectionReason: 'max-dist-above-tolerance' };
  if (quality.maxNormalError > tolerances.normalAngleTolerance) return { accepted: false, parameters, quality, rejectionReason: 'normal-error-above-tolerance' };
  if (quality.triangleCount < tolerances.minRegionTriangles) return { accepted: false, parameters, quality, rejectionReason: 'triangles-below-min' };
  return { accepted: true, parameters, quality };
}

function reject(reason: string, triangleCount: number, area: number): SphereFitResult {
  return {
    accepted: false, parameters: {},
    quality: { rmsDistance: Infinity, maxDistance: Infinity, maxNormalError: Infinity, inlierRatio: 0, coveredArea: area, triangleCount },
    rejectionReason: reason,
  };
}

function rejectCone(reason: string, triangleCount: number, area: number): ConeFitResult {
  return {
    accepted: false, parameters: {},
    quality: { rmsDistance: Infinity, maxDistance: Infinity, maxNormalError: Infinity, inlierRatio: 0, coveredArea: area, triangleCount },
    rejectionReason: reason,
  };
}

/** Solve a 4x4 linear system via Gaussian elimination with partial pivoting. */
function solveLinear4(mat: number[][]): number[] | null {
  const n = 4;
  const a = mat.map((row) => [...row]);

  for (let col = 0; col < n; col++) {
    // Partial pivot.
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(a[row][col]) > Math.abs(a[maxRow][col])) maxRow = row;
    }
    [a[col], a[maxRow]] = [a[maxRow], a[col]];

    if (Math.abs(a[col][col]) < 1e-15) return null;

    for (let row = col + 1; row < n; row++) {
      const factor = a[row][col] / a[col][col];
      for (let j = col; j <= n; j++) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }

  // Back-substitution.
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = a[i][n];
    for (let j = i + 1; j < n; j++) sum -= a[i][j] * x[j];
    x[i] = sum / a[i][i];
  }
  return x;
}
