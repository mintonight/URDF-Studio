import * as THREE from 'three';
import { loadMJCFMeshObject, type MJCFMeshCache } from './mjcfMeshAssetLoader';
import {
  applyMeshAssetTransform,
  createInlineMJCFMeshObject,
  resolveMJCFAssetUrl,
} from './mjcfGeometry';
import type { MJCFModelBody, MJCFModelGeom, ParsedMJCFModel } from './mjcfModel';
import type { MJCFMesh, MJCFMeshInertiaMode } from './mjcfUtils';
import { createMainThreadYieldController } from '@/core/utils/yieldToMainThread';
import {
  disposeTransientObject3D,
  type MJCFLoadAbortSignal,
  throwIfMJCFLoadAborted,
} from './mjcfLoadLifecycle';

const MAX_FIT_POINTS = 4096;

type PrimitiveFitStrategy = 'best-fit' | 'aabb';
type MeshPrimitiveFitStrategy = 'inertia-box' | 'aabb';

interface PrimitivePoint {
  x: number;
  y: number;
  z: number;
}

interface ProjectedPoint {
  t: number;
  u: number;
  v: number;
  radial: number;
}

interface Circle2D {
  cx: number;
  cy: number;
  r: number;
}

interface PrimitiveFitCandidate {
  axis: PrimitivePoint;
  center: PrimitivePoint;
  radius: number;
  length: number;
  volume: number;
}

interface MeshTriangle {
  a: THREE.Vector3;
  b: THREE.Vector3;
  c: THREE.Vector3;
}

interface ProcessedMeshFrame {
  meshPosition: THREE.Vector3;
  meshQuaternion: THREE.Quaternion;
  inertiaBoxHalfSize: THREE.Vector3;
  aabbMin: THREE.Vector3;
  aabbMax: THREE.Vector3;
}

export interface MJCFFittedPrimitive {
  axis: [number, number, number];
  center: [number, number, number];
  radius: number;
  segmentLength: number;
}

interface FitPrimitiveFromMeshAssetParams {
  geomType: 'capsule' | 'cylinder';
  fitStrategy: MeshPrimitiveFitStrategy;
  meshDef: MJCFMesh;
}

interface ResolveMJCFMeshBackedPrimitiveOptions {
  assets: Record<string, string>;
  abortSignal?: MJCFLoadAbortSignal;
  meshCache?: MJCFMeshCache;
  sourceFileDir?: string;
  yieldIfNeeded?: () => Promise<void>;
  fitPrimitiveFromMeshAsset?: (
    params: FitPrimitiveFromMeshAssetParams,
  ) => Promise<MJCFFittedPrimitive | null>;
}

function canonicalizeAxis(axis: PrimitivePoint): PrimitivePoint | null {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  if (!Number.isFinite(length) || length <= 1e-8) {
    return null;
  }

  let normalized = {
    x: axis.x / length,
    y: axis.y / length,
    z: axis.z / length,
  };

  if (
    normalized.x < -1e-8 ||
    (Math.abs(normalized.x) <= 1e-8 && normalized.y < -1e-8) ||
    (Math.abs(normalized.x) <= 1e-8 && Math.abs(normalized.y) <= 1e-8 && normalized.z < 0)
  ) {
    normalized = {
      x: -normalized.x,
      y: -normalized.y,
      z: -normalized.z,
    };
  }

  return normalized;
}

function addCandidateAxis(axes: PrimitivePoint[], axis: PrimitivePoint): void {
  const normalized = canonicalizeAxis(axis);
  if (!normalized) {
    return;
  }

  const isDuplicate = axes.some(
    (existing) =>
      Math.abs(existing.x * normalized.x + existing.y * normalized.y + existing.z * normalized.z) >
      0.999,
  );

  if (!isDuplicate) {
    axes.push(normalized);
  }
}

function computePrincipalAxes(points: PrimitivePoint[]): PrimitivePoint[] {
  if (points.length === 0) {
    return [];
  }

  let meanX = 0;
  let meanY = 0;
  let meanZ = 0;

  for (const point of points) {
    meanX += point.x;
    meanY += point.y;
    meanZ += point.z;
  }

  meanX /= points.length;
  meanY /= points.length;
  meanZ /= points.length;

  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;

  for (const point of points) {
    const dx = point.x - meanX;
    const dy = point.y - meanY;
    const dz = point.z - meanZ;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }

  const invCount = 1 / Math.max(points.length, 1);
  const matrix = [
    [xx * invCount, xy * invCount, xz * invCount],
    [xy * invCount, yy * invCount, yz * invCount],
    [xz * invCount, yz * invCount, zz * invCount],
  ];
  const eigenvectors = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];

  for (let iteration = 0; iteration < 16; iteration += 1) {
    const candidates: Array<[number, number]> = [
      [0, 1],
      [0, 2],
      [1, 2],
    ];
    let pivot: [number, number] = [0, 1];
    let maxValue = 0;

    for (const [row, col] of candidates) {
      const value = Math.abs(matrix[row][col]);
      if (value > maxValue) {
        maxValue = value;
        pivot = [row, col];
      }
    }

    if (maxValue <= 1e-12) {
      break;
    }

    const [row, col] = pivot;
    const diff = matrix[col][col] - matrix[row][row];
    const angle = 0.5 * Math.atan2(2 * matrix[row][col], diff);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rowRow = matrix[row][row];
    const colCol = matrix[col][col];
    const rowCol = matrix[row][col];

    matrix[row][row] = cos * cos * rowRow - 2 * sin * cos * rowCol + sin * sin * colCol;
    matrix[col][col] = sin * sin * rowRow + 2 * sin * cos * rowCol + cos * cos * colCol;
    matrix[row][col] = 0;
    matrix[col][row] = 0;

    for (let index = 0; index < 3; index += 1) {
      if (index === row || index === col) {
        continue;
      }
      const rowValue = matrix[index][row];
      const colValue = matrix[index][col];
      matrix[index][row] = cos * rowValue - sin * colValue;
      matrix[row][index] = matrix[index][row];
      matrix[index][col] = sin * rowValue + cos * colValue;
      matrix[col][index] = matrix[index][col];
    }

    for (let index = 0; index < 3; index += 1) {
      const rowValue = eigenvectors[index][row];
      const colValue = eigenvectors[index][col];
      eigenvectors[index][row] = cos * rowValue - sin * colValue;
      eigenvectors[index][col] = sin * rowValue + cos * colValue;
    }
  }

  return [0, 1, 2]
    .map((index) => ({
      value: matrix[index][index],
      axis: {
        x: eigenvectors[0][index],
        y: eigenvectors[1][index],
        z: eigenvectors[2][index],
      },
    }))
    .sort((left, right) => right.value - left.value)
    .map((entry) => canonicalizeAxis(entry.axis))
    .filter((axis): axis is PrimitivePoint => axis !== null);
}

function createDeterministicRandom(seed: number): () => number {
  let current = seed >>> 0;
  return () => {
    current = (current + 0x6d2b79f5) >>> 0;
    let value = Math.imul(current ^ (current >>> 15), 1 | current);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleDeterministically<T>(values: T[], seed: number): T[] {
  const shuffled = [...values];
  const random = createDeterministicRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function isPointInsideCircle(point: { x: number; y: number }, circle: Circle2D): boolean {
  const dx = point.x - circle.cx;
  const dy = point.y - circle.cy;
  return dx * dx + dy * dy <= (circle.r + 1e-8) * (circle.r + 1e-8);
}

function createCircleFromDiameter(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
): Circle2D {
  const centerX = (pointA.x + pointB.x) / 2;
  const centerY = (pointA.y + pointB.y) / 2;
  return {
    cx: centerX,
    cy: centerY,
    r: Math.hypot(pointA.x - centerX, pointA.y - centerY),
  };
}

function createCircleFromThreePoints(
  pointA: { x: number; y: number },
  pointB: { x: number; y: number },
  pointC: { x: number; y: number },
): Circle2D | null {
  const determinant =
    2 *
    (pointA.x * (pointB.y - pointC.y) +
      pointB.x * (pointC.y - pointA.y) +
      pointC.x * (pointA.y - pointB.y));

  if (Math.abs(determinant) <= 1e-10) {
    return null;
  }

  const pointASquared = pointA.x * pointA.x + pointA.y * pointA.y;
  const pointBSquared = pointB.x * pointB.x + pointB.y * pointB.y;
  const pointCSquared = pointC.x * pointC.x + pointC.y * pointC.y;

  const centerX =
    (pointASquared * (pointB.y - pointC.y) +
      pointBSquared * (pointC.y - pointA.y) +
      pointCSquared * (pointA.y - pointB.y)) /
    determinant;
  const centerY =
    (pointASquared * (pointC.x - pointB.x) +
      pointBSquared * (pointA.x - pointC.x) +
      pointCSquared * (pointB.x - pointA.x)) /
    determinant;

  return {
    cx: centerX,
    cy: centerY,
    r: Math.hypot(pointA.x - centerX, pointA.y - centerY),
  };
}

function computeMinimumEnclosingCircle(points: Array<{ x: number; y: number }>): Circle2D {
  if (points.length === 0) {
    return { cx: 0, cy: 0, r: 0 };
  }

  const shuffled = shuffleDeterministically(points, 0x9e3779b9);
  let circle: Circle2D = { cx: shuffled[0].x, cy: shuffled[0].y, r: 0 };

  for (let i = 0; i < shuffled.length; i += 1) {
    const pointI = shuffled[i];
    if (isPointInsideCircle(pointI, circle)) {
      continue;
    }

    circle = { cx: pointI.x, cy: pointI.y, r: 0 };

    for (let j = 0; j < i; j += 1) {
      const pointJ = shuffled[j];
      if (isPointInsideCircle(pointJ, circle)) {
        continue;
      }

      circle = createCircleFromDiameter(pointI, pointJ);

      for (let k = 0; k < j; k += 1) {
        const pointK = shuffled[k];
        if (isPointInsideCircle(pointK, circle)) {
          continue;
        }

        const circumcircle = createCircleFromThreePoints(pointI, pointJ, pointK);
        circle = circumcircle ?? circle;
      }
    }
  }

  return circle;
}

function createPerpendicularBasis(axis: PrimitivePoint): {
  axis: THREE.Vector3;
  basisU: THREE.Vector3;
  basisV: THREE.Vector3;
} {
  const axisVector = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
  const reference =
    Math.abs(axisVector.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
  const basisU = new THREE.Vector3().crossVectors(reference, axisVector).normalize();
  const basisV = new THREE.Vector3().crossVectors(axisVector, basisU).normalize();
  return { axis: axisVector, basisU, basisV };
}

function computeCapsuleVolume(totalLength: number, radius: number): number {
  if (totalLength <= 0 || radius <= 0) {
    return 0;
  }
  const clampedRadius = Math.min(radius, totalLength / 2);
  return (
    Math.PI * clampedRadius * clampedRadius * totalLength -
    (2 / 3) * Math.PI * clampedRadius * clampedRadius * clampedRadius
  );
}

function evaluateCapsuleRadius(points: ProjectedPoint[], radius: number) {
  let maxStart = -Infinity;
  let minEnd = Infinity;

  for (const point of points) {
    if (point.radial > radius + 1e-8) {
      return null;
    }

    const slack = Math.sqrt(Math.max(radius * radius - point.radial * point.radial, 0));
    maxStart = Math.max(maxStart, point.t - slack);
    minEnd = Math.min(minEnd, point.t + slack);
  }

  const segmentLength = Math.max(0, maxStart - minEnd);
  const centerT = (maxStart + minEnd) / 2;
  const totalLength = segmentLength + 2 * radius;

  return {
    centerT,
    totalLength,
    volume: computeCapsuleVolume(totalLength, radius),
  };
}

function computeBestCapsuleFit(
  points: ProjectedPoint[],
  axis: THREE.Vector3,
  lineCenter: THREE.Vector3,
  minRadius: number,
): PrimitiveFitCandidate {
  let midpoint = 0;

  if (points.length > 0) {
    let minT = Infinity;
    let maxT = -Infinity;
    for (const point of points) {
      minT = Math.min(minT, point.t);
      maxT = Math.max(maxT, point.t);
    }
    midpoint = (minT + maxT) / 2;
  }

  let upperRadius = minRadius;
  for (const point of points) {
    upperRadius = Math.max(upperRadius, Math.hypot(point.radial, point.t - midpoint));
  }
  upperRadius = Math.max(upperRadius, minRadius + 1e-6);

  let bestRadius = minRadius;
  let bestResult = evaluateCapsuleRadius(points, minRadius);

  if (!bestResult) {
    bestResult = evaluateCapsuleRadius(points, upperRadius);
    bestRadius = upperRadius;
  }

  if (!bestResult) {
    const fallbackRadius = Math.max(minRadius, 0.05);
    return {
      axis: { x: axis.x, y: axis.y, z: axis.z },
      center: { x: lineCenter.x, y: lineCenter.y, z: lineCenter.z },
      radius: fallbackRadius,
      length: Math.max(fallbackRadius * 2, 0.1),
      volume: computeCapsuleVolume(Math.max(fallbackRadius * 2, 0.1), fallbackRadius),
    };
  }

  let searchMin = minRadius;
  let searchMax = upperRadius;

  for (let pass = 0; pass < 3; pass += 1) {
    const samples = pass === 0 ? 24 : 18;
    const span = searchMax - searchMin;
    if (span <= 1e-6) {
      break;
    }

    for (let index = 0; index <= samples; index += 1) {
      const radius = searchMin + (span * index) / samples;
      const result = evaluateCapsuleRadius(points, radius);
      if (!result) {
        continue;
      }
      if (!bestResult || result.volume < bestResult.volume) {
        bestResult = result;
        bestRadius = radius;
      }
    }

    const refineSpan = span / Math.max(samples, 1);
    searchMin = Math.max(minRadius, bestRadius - refineSpan * 1.5);
    searchMax = Math.min(upperRadius, bestRadius + refineSpan * 1.5);
  }

  const center = lineCenter.clone().addScaledVector(axis, bestResult.centerT);

  return {
    axis: { x: axis.x, y: axis.y, z: axis.z },
    center: { x: center.x, y: center.y, z: center.z },
    radius: bestRadius,
    length: bestResult.totalLength,
    volume: bestResult.volume,
  };
}

function computePrimitiveFitsForAxis(
  points: PrimitivePoint[],
  axis: PrimitivePoint,
): { cylinder: PrimitiveFitCandidate; capsule: PrimitiveFitCandidate } | null {
  if (points.length === 0) {
    return null;
  }

  const { axis: axisVector, basisU, basisV } = createPerpendicularBasis(axis);
  const projected = points.map((point) => ({
    t: point.x * axisVector.x + point.y * axisVector.y + point.z * axisVector.z,
    u: point.x * basisU.x + point.y * basisU.y + point.z * basisU.z,
    v: point.x * basisV.x + point.y * basisV.y + point.z * basisV.z,
    radial: 0,
  }));

  const circle = computeMinimumEnclosingCircle(
    projected.map((point) => ({ x: point.u, y: point.v })),
  );
  const lineCenter = new THREE.Vector3()
    .copy(basisU)
    .multiplyScalar(circle.cx)
    .addScaledVector(basisV, circle.cy);

  for (const point of projected) {
    point.radial = Math.hypot(point.u - circle.cx, point.v - circle.cy);
  }

  let minT = Infinity;
  let maxT = -Infinity;
  for (const point of projected) {
    minT = Math.min(minT, point.t);
    maxT = Math.max(maxT, point.t);
  }

  const cylinderLength = Math.max(0, maxT - minT);
  const cylinderCenter = lineCenter.clone().addScaledVector(axisVector, (minT + maxT) / 2);
  const cylinderRadius = Math.max(circle.r, 1e-8);

  return {
    cylinder: {
      axis: { x: axisVector.x, y: axisVector.y, z: axisVector.z },
      center: { x: cylinderCenter.x, y: cylinderCenter.y, z: cylinderCenter.z },
      radius: cylinderRadius,
      length: cylinderLength,
      volume: Math.PI * cylinderRadius * cylinderRadius * cylinderLength,
    },
    capsule: computeBestCapsuleFit(projected, axisVector, lineCenter, cylinderRadius),
  };
}

function computeBestPrimitiveFits(points: PrimitivePoint[]) {
  if (points.length === 0) {
    return undefined;
  }

  const candidateAxes: PrimitivePoint[] = [];
  addCandidateAxis(candidateAxes, { x: 1, y: 0, z: 0 });
  addCandidateAxis(candidateAxes, { x: 0, y: 1, z: 0 });
  addCandidateAxis(candidateAxes, { x: 0, y: 0, z: 1 });
  for (const axis of computePrincipalAxes(points)) {
    addCandidateAxis(candidateAxes, axis);
  }

  let bestCylinder: PrimitiveFitCandidate | undefined;
  let bestCapsule: PrimitiveFitCandidate | undefined;

  for (const axis of candidateAxes) {
    const fit = computePrimitiveFitsForAxis(points, axis);
    if (!fit) {
      continue;
    }

    if (!bestCylinder || fit.cylinder.volume < bestCylinder.volume) {
      bestCylinder = fit.cylinder;
    }
    if (!bestCapsule || fit.capsule.volume < bestCapsule.volume) {
      bestCapsule = fit.capsule;
    }
  }

  return {
    cylinder: bestCylinder,
    capsule: bestCapsule,
  };
}

function computeAabbPrimitiveFitFromBounds(
  mins: PrimitivePoint,
  maxs: PrimitivePoint,
  geomType: 'capsule' | 'cylinder',
): PrimitiveFitCandidate | null {
  const center = {
    x: (mins.x + maxs.x) / 2,
    y: (mins.y + maxs.y) / 2,
    z: (mins.z + maxs.z) / 2,
  };
  const candidates: PrimitiveFitCandidate[] = [];
  const axes: Array<PrimitivePoint> = [
    { x: 1, y: 0, z: 0 },
    { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: 1 },
  ];
  const extents = {
    x: maxs.x - mins.x,
    y: maxs.y - mins.y,
    z: maxs.z - mins.z,
  };

  const pushCandidate = (
    axis: PrimitivePoint,
    axisExtent: number,
    radialExtentA: number,
    radialExtentB: number,
  ): void => {
    const radius = Math.max(radialExtentA, radialExtentB) / 2;
    const axisLength = Math.max(axisExtent, 0);
    const capsuleSegmentLength = Math.max(axisLength - radius * 2, 0);
    const primitiveLength = geomType === 'capsule' ? Math.max(axisLength, radius * 2) : axisLength;
    const volume =
      geomType === 'capsule'
        ? computeCapsuleVolume(primitiveLength, radius)
        : Math.PI * radius * radius * primitiveLength;

    candidates.push({
      axis,
      center,
      radius,
      length: geomType === 'capsule' ? capsuleSegmentLength + radius * 2 : primitiveLength,
      volume,
    });
  };

  pushCandidate(axes[0], extents.x, extents.y, extents.z);
  pushCandidate(axes[1], extents.y, extents.x, extents.z);
  pushCandidate(axes[2], extents.z, extents.x, extents.y);

  return candidates.sort((left, right) => left.volume - right.volume)[0] || null;
}

function computeAabbPrimitiveFit(
  points: PrimitivePoint[],
  geomType: 'capsule' | 'cylinder',
): PrimitiveFitCandidate | null {
  if (points.length === 0) {
    return null;
  }

  const mins = { x: Infinity, y: Infinity, z: Infinity };
  const maxs = { x: -Infinity, y: -Infinity, z: -Infinity };

  for (const point of points) {
    mins.x = Math.min(mins.x, point.x);
    mins.y = Math.min(mins.y, point.y);
    mins.z = Math.min(mins.z, point.z);
    maxs.x = Math.max(maxs.x, point.x);
    maxs.y = Math.max(maxs.y, point.y);
    maxs.z = Math.max(maxs.z, point.z);
  }

  return computeAabbPrimitiveFitFromBounds(mins, maxs, geomType);
}

function tupleToThreeQuaternion(quaternion: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(
    quaternion[1],
    quaternion[2],
    quaternion[3],
    quaternion[0],
  ).normalize();
}

function multiplyQuaternionTuples(
  left: [number, number, number, number],
  right: [number, number, number, number],
): [number, number, number, number] {
  const [lw, lx, ly, lz] = left;
  const [rw, rx, ry, rz] = right;

  return [
    lw * rw - lx * rx - ly * ry - lz * rz,
    lw * rx + lx * rw + ly * rz - lz * ry,
    lw * ry - lx * rz + ly * rw + lz * rx,
    lw * rz + lx * ry - ly * rx + lz * rw,
  ];
}

function normalizeQuaternionTuple(
  quaternion: [number, number, number, number],
): [number, number, number, number] {
  const length = Math.hypot(quaternion[0], quaternion[1], quaternion[2], quaternion[3]);
  if (!Number.isFinite(length) || length <= 1e-12) {
    return [1, 0, 0, 0];
  }

  return [
    quaternion[0] / length,
    quaternion[1] / length,
    quaternion[2] / length,
    quaternion[3] / length,
  ];
}

function quaternionTupleToMatrix3(
  quaternion: [number, number, number, number],
): [number, number, number, number, number, number, number, number, number] {
  const [w, x, y, z] = normalizeQuaternionTuple(quaternion);
  const xx = x * x;
  const yy = y * y;
  const zz = z * z;
  const xy = x * y;
  const xz = x * z;
  const yz = y * z;
  const wx = w * x;
  const wy = w * y;
  const wz = w * z;

  return [
    1 - 2 * (yy + zz),
    2 * (xy - wz),
    2 * (xz + wy),
    2 * (xy + wz),
    1 - 2 * (xx + zz),
    2 * (yz - wx),
    2 * (xz - wy),
    2 * (yz + wx),
    1 - 2 * (xx + yy),
  ];
}

function transposeMatrix3(
  matrix: readonly [number, number, number, number, number, number, number, number, number],
): [number, number, number, number, number, number, number, number, number] {
  return [
    matrix[0],
    matrix[3],
    matrix[6],
    matrix[1],
    matrix[4],
    matrix[7],
    matrix[2],
    matrix[5],
    matrix[8],
  ];
}

function multiplyMatrix3(
  left: readonly [number, number, number, number, number, number, number, number, number],
  right: readonly [number, number, number, number, number, number, number, number, number],
): [number, number, number, number, number, number, number, number, number] {
  return [
    left[0] * right[0] + left[1] * right[3] + left[2] * right[6],
    left[0] * right[1] + left[1] * right[4] + left[2] * right[7],
    left[0] * right[2] + left[1] * right[5] + left[2] * right[8],
    left[3] * right[0] + left[4] * right[3] + left[5] * right[6],
    left[3] * right[1] + left[4] * right[4] + left[5] * right[7],
    left[3] * right[2] + left[4] * right[5] + left[5] * right[8],
    left[6] * right[0] + left[7] * right[3] + left[8] * right[6],
    left[6] * right[1] + left[7] * right[4] + left[8] * right[7],
    left[6] * right[2] + left[7] * right[5] + left[8] * right[8],
  ];
}

function diagonalizeSymmetricMatrixMuJoCo(
  matrix: readonly [number, number, number, number, number, number, number, number, number],
): {
  eigenvalues: [number, number, number];
  quaternion: [number, number, number, number];
} {
  const eigEpsilon = 1e-12;
  let quaternion: [number, number, number, number] = [1, 0, 0, 0];
  let eigenvalues: [number, number, number] = [matrix[0], matrix[4], matrix[8]];

  for (let iteration = 0; iteration < 500; iteration += 1) {
    const eigenvectors = quaternionTupleToMatrix3(quaternion);
    const rotated = multiplyMatrix3(
      multiplyMatrix3(transposeMatrix3(eigenvectors), matrix),
      eigenvectors,
    );

    eigenvalues = [rotated[0], rotated[4], rotated[8]];

    let pivotRow = 1;
    let pivotColumn = 2;
    let rotationAxis = 0;
    let pivotValue = Math.abs(rotated[5]);

    if (Math.abs(rotated[1]) > pivotValue && Math.abs(rotated[1]) > Math.abs(rotated[2])) {
      pivotRow = 0;
      pivotColumn = 1;
      rotationAxis = 2;
      pivotValue = Math.abs(rotated[1]);
    } else if (Math.abs(rotated[2]) > pivotValue) {
      pivotRow = 0;
      pivotColumn = 2;
      rotationAxis = 1;
      pivotValue = Math.abs(rotated[2]);
    }

    if (pivotValue < eigEpsilon) {
      break;
    }

    const diagonalDelta =
      (rotated[4 * pivotColumn] - rotated[4 * pivotRow]) /
      (2 * rotated[3 * pivotRow + pivotColumn]);
    const tangent =
      diagonalDelta >= 0
        ? 1 / (diagonalDelta + Math.sqrt(1 + diagonalDelta * diagonalDelta))
        : -1 / (-diagonalDelta + Math.sqrt(1 + diagonalDelta * diagonalDelta));
    const cosine = 1 / Math.sqrt(1 + tangent * tangent);

    if (cosine > 1 - eigEpsilon) {
      break;
    }

    const rotationMagnitude = Math.sqrt(Math.max(0, 0.5 - 0.5 * cosine));
    const nextRotation: [number, number, number, number] = [0, 0, 0, 0];
    nextRotation[rotationAxis + 1] = diagonalDelta >= 0 ? -rotationMagnitude : rotationMagnitude;
    if (rotationAxis === 1) {
      nextRotation[rotationAxis + 1] = -nextRotation[rotationAxis + 1];
    }
    nextRotation[0] = Math.sqrt(
      Math.max(0, 1 - nextRotation[rotationAxis + 1] * nextRotation[rotationAxis + 1]),
    );
    quaternion = normalizeQuaternionTuple(
      multiplyQuaternionTuples(quaternion, normalizeQuaternionTuple(nextRotation)),
    );
  }

  for (let index = 0; index < 3; index += 1) {
    const leadIndex = index % 2;
    if (eigenvalues[leadIndex] + eigEpsilon < eigenvalues[leadIndex + 1]) {
      [eigenvalues[leadIndex], eigenvalues[leadIndex + 1]] = [
        eigenvalues[leadIndex + 1],
        eigenvalues[leadIndex],
      ];
      const swapRotation: [number, number, number, number] = [0.707106781186548, 0, 0, 0];
      swapRotation[((leadIndex + 2) % 3) + 1] = swapRotation[0];
      quaternion = normalizeQuaternionTuple(multiplyQuaternionTuples(quaternion, swapRotation));
    }
  }

  return { eigenvalues, quaternion };
}

function collectMeshTriangles(object: THREE.Object3D): MeshTriangle[] {
  const triangles: MeshTriangle[] = [];
  const vertexA = new THREE.Vector3();
  const vertexB = new THREE.Vector3();
  const vertexC = new THREE.Vector3();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.attributes?.position as THREE.BufferAttribute | undefined;
    if (!position || position.count < 3) {
      return;
    }

    const index = geometry.getIndex();
    const pushTriangle = (indexA: number, indexB: number, indexC: number) => {
      triangles.push({
        a: vertexA.fromBufferAttribute(position, indexA).clone().applyMatrix4(mesh.matrixWorld),
        b: vertexB.fromBufferAttribute(position, indexB).clone().applyMatrix4(mesh.matrixWorld),
        c: vertexC.fromBufferAttribute(position, indexC).clone().applyMatrix4(mesh.matrixWorld),
      });
    };

    if (index && index.count >= 3) {
      for (let triangleIndex = 0; triangleIndex + 2 < index.count; triangleIndex += 3) {
        pushTriangle(
          index.getX(triangleIndex),
          index.getX(triangleIndex + 1),
          index.getX(triangleIndex + 2),
        );
      }
      return;
    }

    for (let triangleIndex = 0; triangleIndex + 2 < position.count; triangleIndex += 3) {
      pushTriangle(triangleIndex, triangleIndex + 1, triangleIndex + 2);
    }
  });

  return triangles;
}

function collectMeshVertices(object: THREE.Object3D): THREE.Vector3[] {
  const vertices: THREE.Vector3[] = [];
  const vertex = new THREE.Vector3();

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.attributes?.position as THREE.BufferAttribute | undefined;
    if (!position || position.count < 1) {
      return;
    }

    for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
      vertices.push(
        vertex.fromBufferAttribute(position, vertexIndex).clone().applyMatrix4(mesh.matrixWorld),
      );
    }
  });

  return vertices;
}

function computeTriangleStats(
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
): {
  area: number;
  center: THREE.Vector3;
  normal: THREE.Vector3;
} | null {
  const edgeAB = new THREE.Vector3().subVectors(b, a);
  const edgeAC = new THREE.Vector3().subVectors(c, a);
  const normal = new THREE.Vector3().crossVectors(edgeAB, edgeAC);
  const length = normal.length();
  if (!Number.isFinite(length) || length <= 1e-12) {
    return null;
  }

  return {
    area: length * 0.5,
    center: a
      .clone()
      .add(b)
      .add(c)
      .multiplyScalar(1 / 3),
    normal: normal.multiplyScalar(1 / length),
  };
}

function computeMeshFaceCentroid(triangles: MeshTriangle[]): THREE.Vector3 | null {
  const centroid = new THREE.Vector3();
  let totalArea = 0;

  for (const triangle of triangles) {
    const stats = computeTriangleStats(triangle.a, triangle.b, triangle.c);
    if (!stats) {
      continue;
    }

    centroid.addScaledVector(stats.center, stats.area);
    totalArea += stats.area;
  }

  if (totalArea <= 1e-12) {
    return null;
  }

  return centroid.multiplyScalar(1 / totalArea);
}

function computeVolumeWeightedCenterOfMass(
  triangles: MeshTriangle[],
  faceCentroid: THREE.Vector3,
  inertiaMode: MJCFMeshInertiaMode | undefined,
): {
  centerOfMass: THREE.Vector3;
  measure: number;
} | null {
  const centerOfMass = new THREE.Vector3();
  let totalMeasure = 0;

  for (const triangle of triangles) {
    const stats = computeTriangleStats(triangle.a, triangle.b, triangle.c);
    if (!stats) {
      continue;
    }

    const volume = (stats.center.clone().sub(faceCentroid).dot(stats.normal) * stats.area) / 3;
    const adjustedVolume = inertiaMode === 'legacy' ? Math.abs(volume) : volume;

    totalMeasure += adjustedVolume;
    centerOfMass.addScaledVector(
      stats.center.clone().multiplyScalar(0.75).addScaledVector(faceCentroid, 0.25),
      adjustedVolume,
    );
  }

  if (Math.abs(totalMeasure) <= 1e-12) {
    return null;
  }

  return {
    centerOfMass: centerOfMass.multiplyScalar(1 / totalMeasure),
    measure: totalMeasure,
  };
}

function computeSurfaceWeightedCenterOfMass(triangles: MeshTriangle[]): {
  centerOfMass: THREE.Vector3;
  measure: number;
} | null {
  const faceCentroid = computeMeshFaceCentroid(triangles);
  if (!faceCentroid) {
    return null;
  }

  const centerOfMass = new THREE.Vector3();
  let surfaceArea = 0;

  for (const triangle of triangles) {
    const stats = computeTriangleStats(triangle.a, triangle.b, triangle.c);
    if (!stats) {
      continue;
    }

    surfaceArea += stats.area;
    centerOfMass.addScaledVector(
      stats.center.clone().multiplyScalar(0.75).addScaledVector(faceCentroid, 0.25),
      stats.area,
    );
  }

  if (surfaceArea <= 1e-12) {
    return null;
  }

  return {
    centerOfMass: centerOfMass.multiplyScalar(1 / surfaceArea),
    measure: surfaceArea,
  };
}

function computeMeshInertiaTensor(
  triangles: MeshTriangle[],
  centerOfMass: THREE.Vector3,
  inertiaMode: MJCFMeshInertiaMode | undefined,
): {
  tensor: [number, number, number, number, number, number, number, number, number];
  measure: number;
} | null {
  const products = [0, 0, 0, 0, 0, 0];
  let totalMeasure = 0;
  const coordinatePairs: Array<[0 | 1 | 2, 0 | 1 | 2]> = [
    [0, 0],
    [1, 1],
    [2, 2],
    [0, 1],
    [0, 2],
    [1, 2],
  ];

  for (const triangle of triangles) {
    const d = triangle.a.clone().sub(centerOfMass);
    const e = triangle.b.clone().sub(centerOfMass);
    const f = triangle.c.clone().sub(centerOfMass);
    const stats = computeTriangleStats(d, e, f);
    if (!stats) {
      continue;
    }

    const measure =
      inertiaMode === 'shell' ? stats.area : (stats.center.dot(stats.normal) * stats.area) / 3;
    const adjustedMeasure = inertiaMode === 'legacy' ? Math.abs(measure) : measure;
    totalMeasure += adjustedMeasure;

    const vertices = [
      [d.x, d.y, d.z],
      [e.x, e.y, e.z],
      [f.x, f.y, f.z],
    ] as const;
    const divisor = inertiaMode === 'shell' ? 12 : 20;

    coordinatePairs.forEach(([leftIndex, rightIndex], productIndex) => {
      const diagonalTerms = vertices.reduce(
        (sum, vertex) => sum + 2 * vertex[leftIndex] * vertex[rightIndex],
        0,
      );
      const crossTerms =
        vertices[0][leftIndex] * vertices[1][rightIndex] +
        vertices[0][rightIndex] * vertices[1][leftIndex] +
        vertices[0][leftIndex] * vertices[2][rightIndex] +
        vertices[0][rightIndex] * vertices[2][leftIndex] +
        vertices[1][leftIndex] * vertices[2][rightIndex] +
        vertices[1][rightIndex] * vertices[2][leftIndex];

      products[productIndex] += (adjustedMeasure * (diagonalTerms + crossTerms)) / divisor;
    });
  }

  if (Math.abs(totalMeasure) <= 1e-12) {
    return null;
  }

  return {
    tensor: [
      products[1] + products[2],
      -products[3],
      -products[4],
      -products[3],
      products[0] + products[2],
      -products[5],
      -products[4],
      -products[5],
      products[0] + products[1],
    ],
    measure: totalMeasure,
  };
}

function computeProcessedMeshFrame(
  object: THREE.Object3D,
  inertiaMode: MJCFMeshInertiaMode | undefined,
): ProcessedMeshFrame | null {
  const triangles = collectMeshTriangles(object);
  const vertices = collectMeshVertices(object);
  if (triangles.length === 0) {
    return null;
  }

  const faceCentroid = computeMeshFaceCentroid(triangles);
  if (!faceCentroid) {
    return null;
  }

  const centerOfMassResult =
    inertiaMode === 'shell'
      ? computeSurfaceWeightedCenterOfMass(triangles)
      : computeVolumeWeightedCenterOfMass(triangles, faceCentroid, inertiaMode);
  if (!centerOfMassResult) {
    return null;
  }

  const inertiaTensor = computeMeshInertiaTensor(
    triangles,
    centerOfMassResult.centerOfMass,
    inertiaMode,
  );
  if (!inertiaTensor) {
    return null;
  }

  const { eigenvalues, quaternion } = diagonalizeSymmetricMatrixMuJoCo(inertiaTensor.tensor);
  const volumeReference = Math.abs(inertiaTensor.measure);
  if (volumeReference <= 1e-12) {
    return null;
  }

  const meshQuaternion = tupleToThreeQuaternion(quaternion);
  const inverseQuaternion = meshQuaternion.clone().conjugate();
  const aabbMin = new THREE.Vector3(Infinity, Infinity, Infinity);
  const aabbMax = new THREE.Vector3(-Infinity, -Infinity, -Infinity);

  const updateBounds = (vertex: THREE.Vector3) => {
    const rotatedVertex = vertex
      .clone()
      .sub(centerOfMassResult.centerOfMass)
      .applyQuaternion(inverseQuaternion);
    aabbMin.min(rotatedVertex);
    aabbMax.max(rotatedVertex);
  };

  // MuJoCo updates the fitted AABB from all transformed mesh vertices after
  // reorientation, not only the vertices referenced by triangle faces.
  for (const vertex of vertices) {
    updateBounds(vertex);
  }

  if (!Number.isFinite(aabbMin.x) || !Number.isFinite(aabbMax.x)) {
    return null;
  }

  const inertiaBoxHalfSize = new THREE.Vector3(
    0.5 *
      Math.sqrt(
        Math.max(0, (6 * (eigenvalues[1] + eigenvalues[2] - eigenvalues[0])) / volumeReference),
      ),
    0.5 *
      Math.sqrt(
        Math.max(0, (6 * (eigenvalues[0] + eigenvalues[2] - eigenvalues[1])) / volumeReference),
      ),
    0.5 *
      Math.sqrt(
        Math.max(0, (6 * (eigenvalues[0] + eigenvalues[1] - eigenvalues[2])) / volumeReference),
      ),
  );

  return {
    meshPosition: centerOfMassResult.centerOfMass,
    meshQuaternion,
    inertiaBoxHalfSize,
    aabbMin,
    aabbMax,
  };
}

function fitPrimitiveFromProcessedMeshFrame(
  processedMesh: ProcessedMeshFrame,
  geomType: 'capsule' | 'cylinder',
  fitStrategy: MeshPrimitiveFitStrategy,
): MJCFFittedPrimitive | null {
  const localCenter =
    fitStrategy === 'aabb'
      ? processedMesh.aabbMin.clone().add(processedMesh.aabbMax).multiplyScalar(0.5)
      : new THREE.Vector3(0, 0, 0);
  const halfExtents =
    fitStrategy === 'aabb'
      ? processedMesh.aabbMax.clone().sub(processedMesh.aabbMin).multiplyScalar(0.5)
      : processedMesh.inertiaBoxHalfSize.clone();

  let radius: number;
  let halfHeight: number;

  if (fitStrategy === 'aabb') {
    radius = Math.max(halfExtents.x, halfExtents.y);
    halfHeight = geomType === 'capsule' ? Math.max(halfExtents.z - radius, 0) : halfExtents.z;
  } else {
    radius = (halfExtents.x + halfExtents.y) / 2;
    halfHeight = geomType === 'capsule' ? Math.max(halfExtents.z - radius / 2, 0) : halfExtents.z;
  }

  if (!Number.isFinite(radius) || !Number.isFinite(halfHeight)) {
    return null;
  }

  const center = localCenter
    .applyQuaternion(processedMesh.meshQuaternion)
    .add(processedMesh.meshPosition);
  const axis = new THREE.Vector3(0, 0, -1)
    .applyQuaternion(processedMesh.meshQuaternion)
    .normalize();

  return {
    axis: [axis.x, axis.y, axis.z],
    center: [center.x, center.y, center.z],
    radius,
    segmentLength: Math.max(halfHeight * 2, 0),
  };
}

export function collectMeshPrimitiveFitPoints(
  object: THREE.Object3D,
  maxPoints: number = MAX_FIT_POINTS,
): PrimitivePoint[] {
  const meshEntries: Array<{
    mesh: THREE.Mesh;
    position: THREE.BufferAttribute;
    vertexCount: number;
  }> = [];
  let totalVertexCount = 0;

  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) {
      return;
    }

    const geometry = mesh.geometry as THREE.BufferGeometry | undefined;
    const position = geometry?.attributes?.position as THREE.BufferAttribute | undefined;
    if (!position || position.count <= 0) {
      return;
    }

    meshEntries.push({
      mesh,
      position,
      vertexCount: position.count,
    });
    totalVertexCount += position.count;
  });

  if (meshEntries.length === 0 || totalVertexCount === 0) {
    return [];
  }

  const points: PrimitivePoint[] = [];
  const vertex = new THREE.Vector3();
  const pushVertex = (mesh: THREE.Mesh, position: THREE.BufferAttribute, vertexIndex: number) => {
    vertex.fromBufferAttribute(position, vertexIndex).applyMatrix4(mesh.matrixWorld);
    points.push({ x: vertex.x, y: vertex.y, z: vertex.z });
  };

  if (totalVertexCount <= maxPoints) {
    for (const entry of meshEntries) {
      for (let index = 0; index < entry.vertexCount; index += 1) {
        pushVertex(entry.mesh, entry.position, index);
      }
    }
    return points;
  }

  let remainingBudget = maxPoints;
  let remainingVertexCount = totalVertexCount;

  meshEntries.forEach((entry, meshIndex) => {
    if (remainingBudget <= 0 || remainingVertexCount <= 0) {
      remainingVertexCount -= entry.vertexCount;
      return;
    }

    const isLastMesh = meshIndex === meshEntries.length - 1;
    const quota = isLastMesh
      ? Math.min(remainingBudget, entry.vertexCount)
      : Math.max(
          1,
          Math.min(
            entry.vertexCount,
            Math.round((entry.vertexCount / remainingVertexCount) * remainingBudget),
          ),
        );

    if (quota >= entry.vertexCount) {
      for (let index = 0; index < entry.vertexCount; index += 1) {
        pushVertex(entry.mesh, entry.position, index);
      }
    } else if (quota === 1) {
      pushVertex(entry.mesh, entry.position, Math.floor((entry.vertexCount - 1) / 2));
    } else {
      for (let sampleIndex = 0; sampleIndex < quota; sampleIndex += 1) {
        const vertexIndex = Math.min(
          Math.round((sampleIndex * (entry.vertexCount - 1)) / (quota - 1)),
          entry.vertexCount - 1,
        );
        pushVertex(entry.mesh, entry.position, vertexIndex);
      }
    }

    remainingBudget -= quota;
    remainingVertexCount -= entry.vertexCount;
  });

  return points;
}

export function fitPrimitiveFromPoints(
  points: PrimitivePoint[],
  geomType: 'capsule' | 'cylinder',
  fitStrategy: PrimitiveFitStrategy = 'best-fit',
): MJCFFittedPrimitive | null {
  const candidate =
    fitStrategy === 'aabb'
      ? computeAabbPrimitiveFit(points, geomType)
      : (() => {
          const fits = computeBestPrimitiveFits(points);
          return geomType === 'capsule' ? fits?.capsule : fits?.cylinder;
        })();
  if (!candidate) {
    return null;
  }

  const axis = canonicalizeAxis(candidate.axis);
  if (!axis) {
    return null;
  }

  const segmentLength =
    geomType === 'capsule'
      ? Math.max(candidate.length - candidate.radius * 2, 0)
      : Math.max(candidate.length, 0);

  return {
    axis: [axis.x, axis.y, axis.z],
    center: [candidate.center.x, candidate.center.y, candidate.center.z],
    radius: candidate.radius,
    segmentLength,
  };
}

async function fitPrimitiveFromMeshAssetViaUrl(
  geomType: 'capsule' | 'cylinder',
  fitStrategy: MeshPrimitiveFitStrategy,
  meshDef: MJCFMesh,
  assets: Record<string, string>,
  sourceFileDir: string,
  meshCache: MJCFMeshCache,
  abortSignal?: MJCFLoadAbortSignal,
): Promise<MJCFFittedPrimitive | null> {
  throwIfMJCFLoadAborted(abortSignal);
  if (meshDef.vertices?.length) {
    const inlineObject = createInlineMJCFMeshObject(meshDef);
    if (!inlineObject) {
      return null;
    }

    const transformed = applyMeshAssetTransform(inlineObject, meshDef);
    try {
      throwIfMJCFLoadAborted(abortSignal);
      const fit = fitPrimitiveFromObject3D(transformed, geomType, {
        fitaabb: fitStrategy === 'aabb',
        inertia: meshDef.inertia,
      });
      throwIfMJCFLoadAborted(abortSignal);
      return fit;
    } finally {
      disposeTransientObject3D(transformed);
    }
  }

  if (!meshDef.file) {
    return null;
  }

  const assetUrl = resolveMJCFAssetUrl(meshDef.file, assets, sourceFileDir);
  if (!assetUrl) {
    return null;
  }

  const loadedObject = await loadMJCFMeshObject(assetUrl, meshDef.file, meshCache, abortSignal);
  if (!loadedObject) {
    return null;
  }

  if (abortSignal?.aborted) {
    disposeTransientObject3D(loadedObject);
    throwIfMJCFLoadAborted(abortSignal);
  }

  const transformed = applyMeshAssetTransform(loadedObject, meshDef);
  try {
    throwIfMJCFLoadAborted(abortSignal);
    const fit = fitPrimitiveFromObject3D(transformed, geomType, {
      fitaabb: fitStrategy === 'aabb',
      inertia: meshDef.inertia,
    });
    throwIfMJCFLoadAborted(abortSignal);
    return fit;
  } finally {
    disposeTransientObject3D(transformed);
  }
}

export function fitPrimitiveFromObject3D(
  object: THREE.Object3D,
  geomType: 'capsule' | 'cylinder',
  options?: { fitaabb?: boolean; inertia?: MJCFMeshInertiaMode },
): MJCFFittedPrimitive | null {
  object.updateMatrixWorld(true);
  const processedMesh = computeProcessedMeshFrame(object, options?.inertia ?? 'legacy');
  if (!processedMesh) {
    return null;
  }

  return fitPrimitiveFromProcessedMeshFrame(
    processedMesh,
    geomType,
    options?.fitaabb ? 'aabb' : 'inertia-box',
  );
}

function shouldResolveMeshBackedPrimitive(geom: MJCFModelGeom): geom is MJCFModelGeom & {
  mesh: string;
  type: 'capsule' | 'cylinder';
} {
  return Boolean(
    geom.mesh &&
    !geom.fromto &&
    (!geom.size || geom.size.length === 0) &&
    (geom.type === 'capsule' || geom.type === 'cylinder'),
  );
}

function transformFittedPrimitiveIntoBodySpace(
  fit: MJCFFittedPrimitive,
  geom: MJCFModelGeom,
): MJCFFittedPrimitive {
  const quaternion = geom.quat
    ? new THREE.Quaternion(geom.quat[1], geom.quat[2], geom.quat[3], geom.quat[0])
    : new THREE.Quaternion();
  const position = new THREE.Vector3(geom.pos?.[0] ?? 0, geom.pos?.[1] ?? 0, geom.pos?.[2] ?? 0);
  const center = new THREE.Vector3(fit.center[0], fit.center[1], fit.center[2])
    .applyQuaternion(quaternion)
    .add(position);
  const axis = new THREE.Vector3(fit.axis[0], fit.axis[1], fit.axis[2])
    .applyQuaternion(quaternion)
    .normalize();

  return {
    axis: [axis.x, axis.y, axis.z],
    center: [center.x, center.y, center.z],
    radius: fit.radius,
    segmentLength: fit.segmentLength,
  };
}

function applyFittedPrimitiveToGeom(geom: MJCFModelGeom, fit: MJCFFittedPrimitive): void {
  const center = new THREE.Vector3(fit.center[0], fit.center[1], fit.center[2]);
  const axis = new THREE.Vector3(fit.axis[0], fit.axis[1], fit.axis[2]).normalize();
  const halfSegment = fit.segmentLength / 2;
  const from = center.clone().addScaledVector(axis, -halfSegment);
  const to = center.clone().addScaledVector(axis, halfSegment);

  geom.size = [fit.radius];
  geom.fromto = [from.x, from.y, from.z, to.x, to.y, to.z];
  geom.mesh = undefined;
  geom.pos = undefined;
  geom.quat = undefined;
}

function createDefaultMeshPrimitiveFitter(
  assets: Record<string, string>,
  sourceFileDir: string,
  meshCache: MJCFMeshCache,
  abortSignal?: MJCFLoadAbortSignal,
) {
  const meshSpaceFitCache = new Map<string, Promise<MJCFFittedPrimitive | null>>();

  return async ({
    geomType,
    fitStrategy,
    meshDef,
  }: FitPrimitiveFromMeshAssetParams): Promise<MJCFFittedPrimitive | null> => {
    const cacheKey = [
      fitStrategy,
      geomType,
      meshDef.name,
      meshDef.file || '',
      meshDef.vertices?.join(',') || '',
      meshDef.scale?.join(',') || '',
      meshDef.refpos?.join(',') || '',
      meshDef.refquat?.join(',') || '',
    ].join('|');

    if (!meshSpaceFitCache.has(cacheKey)) {
      meshSpaceFitCache.set(
        cacheKey,
        fitPrimitiveFromMeshAssetViaUrl(
          geomType,
          fitStrategy,
          meshDef,
          assets,
          sourceFileDir,
          meshCache,
          abortSignal,
        ),
      );
    }

    return meshSpaceFitCache.get(cacheKey)!;
  };
}

async function resolveBodyMeshBackedPrimitives(
  body: MJCFModelBody,
  parsedModel: ParsedMJCFModel,
  yieldIfNeeded: () => Promise<void>,
  abortSignal: MJCFLoadAbortSignal | undefined,
  fitPrimitiveFromMeshAsset: (
    params: FitPrimitiveFromMeshAssetParams,
  ) => Promise<MJCFFittedPrimitive | null>,
): Promise<number> {
  let resolvedCount = 0;

  throwIfMJCFLoadAborted(abortSignal);

  for (const geom of body.geoms) {
    throwIfMJCFLoadAborted(abortSignal);
    if (!shouldResolveMeshBackedPrimitive(geom)) {
      continue;
    }

    const meshDef = parsedModel.meshMap.get(geom.mesh);
    if (!meshDef) {
      continue;
    }

    const fit = await fitPrimitiveFromMeshAsset({
      geomType: geom.type,
      fitStrategy: parsedModel.compilerSettings.fitaabb ? 'aabb' : 'inertia-box',
      meshDef,
    });

    if (!fit) {
      await yieldIfNeeded();
      continue;
    }

    applyFittedPrimitiveToGeom(geom, transformFittedPrimitiveIntoBodySpace(fit, geom));
    resolvedCount += 1;
    await yieldIfNeeded();
  }

  for (const child of body.children) {
    throwIfMJCFLoadAborted(abortSignal);
    resolvedCount += await resolveBodyMeshBackedPrimitives(
      child,
      parsedModel,
      yieldIfNeeded,
      abortSignal,
      fitPrimitiveFromMeshAsset,
    );
    await yieldIfNeeded();
  }

  return resolvedCount;
}

export async function resolveMJCFMeshBackedPrimitiveGeoms(
  parsedModel: ParsedMJCFModel,
  {
    assets,
    abortSignal,
    meshCache = new Map(),
    sourceFileDir = '',
    yieldIfNeeded = createMainThreadYieldController(),
    fitPrimitiveFromMeshAsset = createDefaultMeshPrimitiveFitter(
      assets,
      sourceFileDir,
      meshCache,
      abortSignal,
    ),
  }: ResolveMJCFMeshBackedPrimitiveOptions,
): Promise<number> {
  return await resolveBodyMeshBackedPrimitives(
    parsedModel.worldBody,
    parsedModel,
    yieldIfNeeded,
    abortSignal,
    fitPrimitiveFromMeshAsset,
  );
}
