/**
 * Geometry type conversion utilities.
 * Handles smart dimension/rotation conversion between geometry types,
 * and auto-align computation for cylinders.
 */
import * as THREE from 'three';
import type { RobotState } from '@/types';
import { GeometryType } from '@/types';
import {
  computeAxisAlignmentScore,
  canonicalizeAxis,
  type Point3,
  type PrimitiveFit,
} from './geometry-conversion/primitiveFit';
import type { MeshAnalysis, MeshClearanceObstacle } from './geometry-conversion/meshAnalysis';

export {
  computeMeshAnalysisFromAssets,
  computeMeshBoundsFromAssets,
  type MeshAnalysis,
  type MeshAnalysisOptions,
  type MeshBounds,
  type MeshClearanceObstacle,
  type MeshClearanceObstaclePoint,
} from './geometry-conversion/meshAnalysis';

// Reusable THREE objects - avoid allocation in render/compute paths
const _tempVec3A = new THREE.Vector3();
const _tempVec3B = new THREE.Vector3();
const _tempVec3C = new THREE.Vector3();
const _tempQuat = new THREE.Quaternion();
const _tempQuatB = new THREE.Quaternion();
const _tempEuler = new THREE.Euler(0, 0, 0, 'ZYX');
const _tempEulerB = new THREE.Euler(0, 0, 0, 'ZYX');
const _zAxis = new THREE.Vector3(0, 0, 1);

/**
 * Compute auto-align for a cylinder geometry to match the child joint direction.
 * Returns dimensions and origin to align the cylinder along the joint vector,
 * or null if no child joint exists.
 */
export function computeAutoAlign(robot: RobotState, linkId: string) {
  const childJoint = Object.values(robot.joints).find((j) => j.parentLinkId === linkId);
  if (!childJoint) return null;

  _tempVec3A.set(childJoint.origin.xyz.x, childJoint.origin.xyz.y, childJoint.origin.xyz.z);
  const length = _tempVec3A.length();
  _tempVec3B.copy(_tempVec3A).multiplyScalar(0.5); // midpoint
  _tempVec3C.copy(_tempVec3A).normalize(); // direction

  // Calculate rotation to align Z-axis with the vector
  if (
    Math.abs(_tempVec3C.x) < 1e-8 &&
    Math.abs(_tempVec3C.y) < 1e-8 &&
    Math.abs(_tempVec3C.z + 1) < 1e-8
  ) {
    _tempQuat.setFromAxisAngle(_tempVec3A.set(1, 0, 0), Math.PI);
  } else {
    _tempQuat.setFromUnitVectors(_zAxis, _tempVec3C);
  }

  _tempEuler.setFromQuaternion(_tempQuat, 'ZYX');

  return {
    dimensions: { y: length },
    origin: {
      xyz: { x: _tempVec3B.x, y: _tempVec3B.y, z: _tempVec3B.z },
      rpy: { r: _tempEuler.x, p: _tempEuler.y, y: _tempEuler.z },
    },
  };
}

interface ScalarInterval {
  start: number;
  end: number;
}

interface GeomData {
  type?: GeometryType;
  dimensions?: { x: number; y: number; z: number };
  origin?: {
    xyz: { x: number; y: number; z: number };
    rpy: { r: number; p: number; y: number };
  };
}

interface ConversionResult {
  type: GeometryType;
  dimensions: { x: number; y: number; z: number };
  origin: {
    xyz: { x: number; y: number; z: number };
    rpy: { r: number; p: number; y: number };
  };
}

interface ConversionContext {
  siblingGeometries?: GeomData[];
  meshClearanceObstacles?: MeshClearanceObstacle[];
  fitVolumeWindowRatio?: number;
  overlapAllowanceRatio?: number;
}

const DEFAULT_DIMENSIONS = { x: 0.1, y: 0.5, z: 0.1 };
const DEFAULT_ORIGIN = {
  xyz: { x: 0, y: 0, z: 0 },
  rpy: { r: 0, p: 0, y: 0 },
};

type MeshPrimaryAxis = 'x' | 'y' | 'z';

function toPositive(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }
  return value;
}

function normalizeOrigin(origin: GeomData['origin']): ConversionResult['origin'] {
  return {
    xyz: {
      x: origin?.xyz?.x ?? DEFAULT_ORIGIN.xyz.x,
      y: origin?.xyz?.y ?? DEFAULT_ORIGIN.xyz.y,
      z: origin?.xyz?.z ?? DEFAULT_ORIGIN.xyz.z,
    },
    rpy: {
      r: origin?.rpy?.r ?? DEFAULT_ORIGIN.rpy.r,
      p: origin?.rpy?.p ?? DEFAULT_ORIGIN.rpy.p,
      y: origin?.rpy?.y ?? DEFAULT_ORIGIN.rpy.y,
    },
  };
}

function normalizeDimensions(dimensions: GeomData['dimensions']): {
  x: number;
  y: number;
  z: number;
} {
  return {
    x: toPositive(dimensions?.x, DEFAULT_DIMENSIONS.x),
    y: toPositive(dimensions?.y, DEFAULT_DIMENSIONS.y),
    z: toPositive(dimensions?.z, DEFAULT_DIMENSIONS.z),
  };
}

function getAxisVectorForPrimaryAxis(primaryAxis: MeshPrimaryAxis): Point3 {
  if (primaryAxis === 'x') return { x: 1, y: 0, z: 0 };
  if (primaryAxis === 'y') return { x: 0, y: 1, z: 0 };
  return { x: 0, y: 0, z: 1 };
}

function computeSweepHalfExtent(
  primitiveRadius: number,
  primitiveLength: number,
  newType: GeometryType,
): number {
  if (newType === GeometryType.CAPSULE) {
    return Math.max(toPositive(primitiveLength, 0.1) / 2 - toPositive(primitiveRadius, 0.05), 0);
  }

  return toPositive(primitiveLength, 0.1) / 2;
}

function composePrimitiveLength(
  sweepHalfExtent: number,
  primitiveRadius: number,
  newType: GeometryType,
): number {
  if (newType === GeometryType.CAPSULE) {
    return Math.max(sweepHalfExtent, 0) * 2 + toPositive(primitiveRadius, 0.05) * 2;
  }

  return Math.max(sweepHalfExtent, 0) * 2;
}

function subtractBlockedInterval(
  intervals: ScalarInterval[],
  blockedStart: number,
  blockedEnd: number,
): ScalarInterval[] {
  if (
    !Number.isFinite(blockedStart) ||
    !Number.isFinite(blockedEnd) ||
    blockedEnd <= blockedStart
  ) {
    return intervals;
  }

  const nextIntervals: ScalarInterval[] = [];

  intervals.forEach((interval) => {
    if (blockedEnd <= interval.start || blockedStart >= interval.end) {
      nextIntervals.push(interval);
      return;
    }

    if (blockedStart > interval.start) {
      nextIntervals.push({
        start: interval.start,
        end: Math.min(blockedStart, interval.end),
      });
    }

    if (blockedEnd < interval.end) {
      nextIntervals.push({
        start: Math.max(blockedEnd, interval.start),
        end: interval.end,
      });
    }
  });

  return nextIntervals.filter((interval) => interval.end - interval.start > 1e-8);
}

function mergeIntervals(intervals: ScalarInterval[]): ScalarInterval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: ScalarInterval[] = [{ ...sorted[0] }];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const last = merged[merged.length - 1];

    if (current.start <= last.end + 1e-8) {
      last.end = Math.max(last.end, current.end);
      continue;
    }

    merged.push({ ...current });
  }

  return merged;
}

function choosePreferredInterval(intervals: ScalarInterval[]): ScalarInterval | null {
  if (intervals.length === 0) return null;

  return intervals.reduce<ScalarInterval | null>((best, interval) => {
    if (!best) return interval;

    const intervalLength = interval.end - interval.start;
    const bestLength = best.end - best.start;
    if (intervalLength > bestLength + 1e-8) {
      return interval;
    }

    if (Math.abs(intervalLength - bestLength) <= 1e-8) {
      const intervalMidpoint = Math.abs((interval.start + interval.end) / 2);
      const bestMidpoint = Math.abs((best.start + best.end) / 2);
      if (intervalMidpoint < bestMidpoint - 1e-8) {
        return interval;
      }
    }

    return best;
  }, null);
}

function rotateLocalVectorByOrigin(
  origin: ConversionResult['origin'],
  localVector: Point3,
): Point3 {
  _tempEuler.set(origin.rpy.r, origin.rpy.p, origin.rpy.y);
  _tempVec3A.set(localVector.x, localVector.y, localVector.z).applyEuler(_tempEuler);
  const axis = canonicalizeAxis({ x: _tempVec3A.x, y: _tempVec3A.y, z: _tempVec3A.z });
  return axis ?? { x: 0, y: 0, z: 1 };
}

function computeOverlapAllowance(
  primitiveRadius: number,
  overlapAllowanceRatio: number | undefined,
): number {
  if (
    !Number.isFinite(overlapAllowanceRatio) ||
    !overlapAllowanceRatio ||
    overlapAllowanceRatio <= 0
  ) {
    return 0;
  }

  const safeRatio = Math.min(Math.max(overlapAllowanceRatio, 0), 0.35);
  return Math.min(Math.max(primitiveRadius * safeRatio, 0), primitiveRadius * 0.35);
}

function computeBroadPhaseRadius(geometry: GeomData): number | null {
  const type = geometry.type ?? GeometryType.NONE;
  const dims = normalizeDimensions(geometry.dimensions);

  switch (type) {
    case GeometryType.SPHERE:
      return toPositive(dims.x, 0.05);
    case GeometryType.ELLIPSOID:
      return Math.max(toPositive(dims.x, 0.05), toPositive(dims.y, 0.05), toPositive(dims.z, 0.05));
    case GeometryType.BOX:
      return Math.hypot(dims.x, dims.y, dims.z) / 2;
    case GeometryType.CYLINDER:
      return Math.hypot(toPositive(dims.x, 0.05), toPositive(dims.y, 0.1) / 2);
    case GeometryType.CAPSULE:
      return Math.max(toPositive(dims.y, 0.1) / 2, toPositive(dims.x, 0.05));
    default:
      return null;
  }
}

function collectSiblingBroadPhaseSpheres(
  siblingGeometries: GeomData[] | undefined,
): { center: THREE.Vector3; radius: number }[] {
  if (!siblingGeometries?.length) {
    return [];
  }

  return siblingGeometries
    .map((geometry) => {
      const radius = computeBroadPhaseRadius(geometry);
      if (!radius || radius <= 1e-8) {
        return null;
      }

      const origin = normalizeOrigin(geometry.origin);
      return {
        center: new THREE.Vector3(origin.xyz.x, origin.xyz.y, origin.xyz.z),
        radius,
      };
    })
    .filter((sphere): sphere is { center: THREE.Vector3; radius: number } => sphere !== null);
}

function buildBlockedCenterIntervals(
  candidateCenter: THREE.Vector3,
  axisVector: THREE.Vector3,
  primitiveRadius: number,
  siblingSpheres: { center: THREE.Vector3; radius: number }[],
  clearance: number,
): ScalarInterval[] {
  const blockedIntervals: ScalarInterval[] = [];

  siblingSpheres.forEach((sibling) => {
    _tempVec3A.copy(sibling.center).sub(candidateCenter);
    const projection = _tempVec3A.dot(axisVector);
    _tempVec3B.copy(axisVector).multiplyScalar(projection);
    _tempVec3C.copy(_tempVec3A).sub(_tempVec3B);

    const radialDistance = _tempVec3C.length();
    const combinedRadius = primitiveRadius + sibling.radius + clearance;
    if (radialDistance >= combinedRadius) {
      return;
    }

    const axialPadding = Math.sqrt(
      Math.max(combinedRadius * combinedRadius - radialDistance * radialDistance, 0),
    );
    blockedIntervals.push({
      start: projection - axialPadding,
      end: projection + axialPadding,
    });
  });

  return mergeIntervals(blockedIntervals);
}

function findNearestSafeCenterShift(
  candidateCenter: THREE.Vector3,
  axisVector: THREE.Vector3,
  primitiveRadius: number,
  siblingSpheres: { center: THREE.Vector3; radius: number }[],
  clearance: number,
): number {
  const blockedIntervals = buildBlockedCenterIntervals(
    candidateCenter,
    axisVector,
    primitiveRadius,
    siblingSpheres,
    clearance,
  );

  const blockingInterval = blockedIntervals.find(
    (interval) => interval.start <= 0 + 1e-8 && interval.end >= 0 - 1e-8,
  );

  if (!blockingInterval) {
    return 0;
  }

  const leftMagnitude = Math.abs(blockingInterval.start);
  const rightMagnitude = Math.abs(blockingInterval.end);

  if (leftMagnitude < rightMagnitude - 1e-8) {
    return blockingInterval.start;
  }

  if (rightMagnitude < leftMagnitude - 1e-8) {
    return blockingInterval.end;
  }

  return blockingInterval.end;
}

function resolveAvailableSweepInterval(
  candidateCenter: THREE.Vector3,
  axisVector: THREE.Vector3,
  sweepHalfExtent: number,
  primitiveRadius: number,
  siblingSpheres: { center: THREE.Vector3; radius: number }[],
  clearance: number,
): { centerShift: number; sweepHalfExtent: number } | null {
  if (sweepHalfExtent <= 1e-8) {
    const hasOverlapAtCenter = siblingSpheres.some((sibling) => {
      _tempVec3A.copy(sibling.center).sub(candidateCenter);
      const projection = _tempVec3A.dot(axisVector);
      _tempVec3B.copy(axisVector).multiplyScalar(projection);
      _tempVec3C.copy(_tempVec3A).sub(_tempVec3B);
      const radialDistance = _tempVec3C.length();
      return (
        radialDistance + 1e-8 < primitiveRadius + sibling.radius + clearance &&
        Math.abs(projection) <= 1e-8
      );
    });

    return hasOverlapAtCenter
      ? null
      : {
          centerShift: 0,
          sweepHalfExtent: 0,
        };
  }

  let intervals: ScalarInterval[] = [{ start: -sweepHalfExtent, end: sweepHalfExtent }];

  siblingSpheres.forEach((sibling) => {
    _tempVec3A.copy(sibling.center).sub(candidateCenter);
    const projection = _tempVec3A.dot(axisVector);
    _tempVec3B.copy(axisVector).multiplyScalar(projection);
    _tempVec3C.copy(_tempVec3A).sub(_tempVec3B);

    const radialDistance = _tempVec3C.length();
    const combinedRadius = primitiveRadius + sibling.radius + clearance;
    if (radialDistance >= combinedRadius) {
      return;
    }

    const axialPadding = Math.sqrt(
      Math.max(combinedRadius * combinedRadius - radialDistance * radialDistance, 0),
    );
    intervals = subtractBlockedInterval(
      intervals,
      projection - axialPadding,
      projection + axialPadding,
    );
  });

  const preferredInterval = choosePreferredInterval(intervals);
  if (!preferredInterval) {
    return null;
  }

  return {
    centerShift: (preferredInterval.start + preferredInterval.end) / 2,
    sweepHalfExtent: Math.max((preferredInterval.end - preferredInterval.start) / 2, 0),
  };
}

function collectRadiusCandidates(
  primitiveRadius: number,
  candidateCenter: THREE.Vector3,
  axisVector: THREE.Vector3,
  siblingSpheres: { center: THREE.Vector3; radius: number }[],
  clearance: number,
  minRadius: number,
): number[] {
  const candidates = new Set<number>([primitiveRadius, minRadius]);

  siblingSpheres.forEach((sibling) => {
    _tempVec3A.copy(sibling.center).sub(candidateCenter);
    const projection = _tempVec3A.dot(axisVector);
    _tempVec3B.copy(axisVector).multiplyScalar(projection);
    _tempVec3C.copy(_tempVec3A).sub(_tempVec3B);

    const radialDistance = _tempVec3C.length();
    candidates.add(Math.max(radialDistance - sibling.radius - clearance, minRadius));
  });

  return Array.from(candidates)
    .filter((value) => Number.isFinite(value) && value >= minRadius)
    .sort((left, right) => right - left);
}

function collectMeshObstaclePoints(
  meshClearanceObstacles: MeshClearanceObstacle[] | undefined,
): Point3[] {
  if (!meshClearanceObstacles?.length) {
    return [];
  }

  const points: Point3[] = [];
  meshClearanceObstacles.forEach((obstacle) => {
    obstacle.points.forEach((point) => {
      points.push({ x: point.x, y: point.y, z: point.z });
    });
  });

  return points;
}

function resolveAvailableSweepIntervalFromBlockedIntervals(
  sweepHalfExtent: number,
  blockedIntervals: ScalarInterval[],
): { centerShift: number; sweepHalfExtent: number } | null {
  if (sweepHalfExtent <= 1e-8) {
    const blockingInterval = blockedIntervals.find(
      (interval) => interval.start <= 0 + 1e-8 && interval.end >= 0 - 1e-8,
    );

    return blockingInterval
      ? null
      : {
          centerShift: 0,
          sweepHalfExtent: 0,
        };
  }

  let intervals: ScalarInterval[] = [{ start: -sweepHalfExtent, end: sweepHalfExtent }];
  blockedIntervals.forEach((interval) => {
    intervals = subtractBlockedInterval(intervals, interval.start, interval.end);
  });

  const preferredInterval = choosePreferredInterval(intervals);
  if (!preferredInterval) {
    return null;
  }

  return {
    centerShift: (preferredInterval.start + preferredInterval.end) / 2,
    sweepHalfExtent: Math.max((preferredInterval.end - preferredInterval.start) / 2, 0),
  };
}

function findNearestSafeCenterShiftFromBlockedIntervals(
  blockedIntervals: ScalarInterval[],
): number {
  const blockingInterval = blockedIntervals.find(
    (interval) => interval.start <= 0 + 1e-8 && interval.end >= 0 - 1e-8,
  );

  if (!blockingInterval) {
    return 0;
  }

  const leftMagnitude = Math.abs(blockingInterval.start);
  const rightMagnitude = Math.abs(blockingInterval.end);

  if (leftMagnitude < rightMagnitude - 1e-8) {
    return blockingInterval.start;
  }

  if (rightMagnitude < leftMagnitude - 1e-8) {
    return blockingInterval.end;
  }

  return blockingInterval.end;
}

function buildMeshPointBlockedIntervals(
  candidateCenter: THREE.Vector3,
  axisVector: THREE.Vector3,
  sweepHalfExtent: number,
  primitiveRadius: number,
  meshObstaclePoints: Point3[],
  clearance: number,
  newType: GeometryType,
): ScalarInterval[] {
  const blockedIntervals: ScalarInterval[] = [];
  const radialLimit = primitiveRadius + clearance;

  meshObstaclePoints.forEach((point) => {
    _tempVec3A.set(point.x, point.y, point.z).sub(candidateCenter);
    const projection = _tempVec3A.dot(axisVector);
    _tempVec3B.copy(axisVector).multiplyScalar(projection);
    _tempVec3C.copy(_tempVec3A).sub(_tempVec3B);

    const radialDistance = _tempVec3C.length();
    if (radialDistance >= radialLimit) {
      return;
    }

    const axialPadding =
      newType === GeometryType.CAPSULE
        ? Math.sqrt(Math.max(radialLimit * radialLimit - radialDistance * radialDistance, 0))
        : 0;

    blockedIntervals.push({
      start: projection - sweepHalfExtent - axialPadding,
      end: projection + sweepHalfExtent + axialPadding,
    });
  });

  return mergeIntervals(blockedIntervals);
}

function collectRadiusCandidatesFromMeshPoints(
  primitiveRadius: number,
  candidateCenter: THREE.Vector3,
  axisVector: THREE.Vector3,
  meshObstaclePoints: Point3[],
  clearance: number,
  minRadius: number,
): number[] {
  const candidates = new Set<number>([primitiveRadius, minRadius]);

  meshObstaclePoints.forEach((point) => {
    _tempVec3A.set(point.x, point.y, point.z).sub(candidateCenter);
    const projection = _tempVec3A.dot(axisVector);
    _tempVec3B.copy(axisVector).multiplyScalar(projection);
    _tempVec3C.copy(_tempVec3A).sub(_tempVec3B);
    const radialDistance = _tempVec3C.length();
    candidates.add(Math.max(radialDistance - clearance, minRadius));
  });

  return Array.from(candidates)
    .filter((value) => Number.isFinite(value) && value >= minRadius)
    .sort((left, right) => right - left);
}

function applyMeshPointCollisionClearance(
  primitiveRadius: number,
  primitiveLength: number,
  axisInLinkSpace: Point3,
  newType: GeometryType,
  meshClearanceObstacles: MeshClearanceObstacle[] | undefined,
  centerOrigin: ConversionResult['origin'],
  overlapAllowanceRatio?: number,
): { radius: number; length: number; centerShift: number } {
  if (
    (newType !== GeometryType.CYLINDER && newType !== GeometryType.CAPSULE) ||
    !meshClearanceObstacles?.length
  ) {
    return {
      radius: primitiveRadius,
      length: primitiveLength,
      centerShift: 0,
    };
  }

  const axis = canonicalizeAxis(axisInLinkSpace);
  if (!axis) {
    return {
      radius: primitiveRadius,
      length: primitiveLength,
      centerShift: 0,
    };
  }

  const meshObstaclePoints = collectMeshObstaclePoints(meshClearanceObstacles);
  if (meshObstaclePoints.length === 0) {
    return {
      radius: primitiveRadius,
      length: primitiveLength,
      centerShift: 0,
    };
  }

  const candidateCenter = new THREE.Vector3(
    centerOrigin.xyz.x,
    centerOrigin.xyz.y,
    centerOrigin.xyz.z,
  );
  const axisVector = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
  const radius = toPositive(primitiveRadius, 0.05);
  const minSize = 1e-4;
  const baseClearance = Math.min(Math.max(radius * 0.05, 0.002), 0.01);
  const clearance = baseClearance - computeOverlapAllowance(radius, overlapAllowanceRatio);
  const minRadius = Math.min(Math.max(radius * 0.15, minSize), radius);
  const radiusCandidates = collectRadiusCandidatesFromMeshPoints(
    radius,
    candidateCenter,
    axisVector,
    meshObstaclePoints,
    clearance,
    minRadius,
  );

  let bestCandidate: {
    radius: number;
    sweepHalfExtent: number;
    centerShift: number;
    volume: number;
  } | null = null;

  radiusCandidates.forEach((radiusCandidate) => {
    const sweepHalfExtent = computeSweepHalfExtent(radiusCandidate, primitiveLength, newType);
    const blockedIntervals = buildMeshPointBlockedIntervals(
      candidateCenter,
      axisVector,
      sweepHalfExtent,
      radiusCandidate,
      meshObstaclePoints,
      clearance,
      newType,
    );
    const safeInterval = resolveAvailableSweepIntervalFromBlockedIntervals(
      sweepHalfExtent,
      blockedIntervals,
    );

    if (!safeInterval) {
      return;
    }

    const length = composePrimitiveLength(safeInterval.sweepHalfExtent, radiusCandidate, newType);
    const volume = computePrimitiveVolume(newType, radiusCandidate, length);
    if (!Number.isFinite(volume) || volume <= 0) {
      return;
    }

    const nextCandidate = {
      radius: radiusCandidate,
      sweepHalfExtent: safeInterval.sweepHalfExtent,
      centerShift: safeInterval.centerShift,
      volume,
    };

    if (!bestCandidate) {
      bestCandidate = nextCandidate;
      return;
    }

    const volumeTolerance = Math.max(bestCandidate.volume * 0.01, 1e-8);
    if (nextCandidate.volume > bestCandidate.volume + volumeTolerance) {
      bestCandidate = nextCandidate;
      return;
    }

    if (Math.abs(nextCandidate.volume - bestCandidate.volume) <= volumeTolerance) {
      if (nextCandidate.sweepHalfExtent > bestCandidate.sweepHalfExtent + 1e-8) {
        bestCandidate = nextCandidate;
        return;
      }

      if (
        Math.abs(nextCandidate.sweepHalfExtent - bestCandidate.sweepHalfExtent) <= 1e-8 &&
        Math.abs(nextCandidate.centerShift) < Math.abs(bestCandidate.centerShift) - 1e-8
      ) {
        bestCandidate = nextCandidate;
      }
    }
  });

  if (bestCandidate) {
    return {
      radius: bestCandidate.radius,
      length: composePrimitiveLength(bestCandidate.sweepHalfExtent, bestCandidate.radius, newType),
      centerShift: bestCandidate.centerShift,
    };
  }

  let fallbackCandidate: {
    radius: number;
    length: number;
    centerShift: number;
    volume: number;
  } | null = null;

  radiusCandidates.forEach((radiusCandidate) => {
    const fallbackHalfExtent = computeSweepHalfExtent(
      radiusCandidate,
      newType === GeometryType.CAPSULE ? radiusCandidate * 2 : minSize,
      newType,
    );
    const blockedIntervals = buildMeshPointBlockedIntervals(
      candidateCenter,
      axisVector,
      fallbackHalfExtent,
      radiusCandidate,
      meshObstaclePoints,
      clearance,
      newType,
    );
    const centerShift = findNearestSafeCenterShiftFromBlockedIntervals(blockedIntervals);
    const length = composePrimitiveLength(fallbackHalfExtent, radiusCandidate, newType);
    const volume = computePrimitiveVolume(newType, radiusCandidate, length);
    if (!Number.isFinite(volume) || volume <= 0) {
      return;
    }

    const nextCandidate = {
      radius: radiusCandidate,
      length,
      centerShift,
      volume,
    };

    if (!fallbackCandidate) {
      fallbackCandidate = nextCandidate;
      return;
    }

    const shiftDelta =
      Math.abs(nextCandidate.centerShift) - Math.abs(fallbackCandidate.centerShift);
    if (shiftDelta < -1e-8) {
      fallbackCandidate = nextCandidate;
      return;
    }

    if (Math.abs(shiftDelta) <= 1e-8) {
      const volumeTolerance = Math.max(fallbackCandidate.volume * 0.01, 1e-8);
      if (nextCandidate.volume > fallbackCandidate.volume + volumeTolerance) {
        fallbackCandidate = nextCandidate;
      }
    }
  });

  if (fallbackCandidate) {
    return {
      radius: fallbackCandidate.radius,
      length: fallbackCandidate.length,
      centerShift: fallbackCandidate.centerShift,
    };
  }

  return {
    radius,
    length: composePrimitiveLength(
      newType === GeometryType.CAPSULE ? 0 : minSize / 2,
      radius,
      newType,
    ),
    centerShift: 0,
  };
}

function buildBoxPointBlockedIntervals(
  points: Point3[],
  center: THREE.Vector3,
  inverseRotation: THREE.Quaternion,
  majorAxis: MeshPrimaryAxis,
  halfMajor: number,
  halfCrossA: number,
  halfCrossB: number,
  clearance: number,
): ScalarInterval[] {
  const blockedIntervals: ScalarInterval[] = [];

  points.forEach((point) => {
    _tempVec3A.set(point.x, point.y, point.z).sub(center).applyQuaternion(inverseRotation);
    const majorCoord =
      majorAxis === 'x' ? _tempVec3A.x : majorAxis === 'y' ? _tempVec3A.y : _tempVec3A.z;
    const crossA =
      majorAxis === 'x' ? _tempVec3A.y : majorAxis === 'y' ? _tempVec3A.x : _tempVec3A.x;
    const crossB =
      majorAxis === 'x' ? _tempVec3A.z : majorAxis === 'y' ? _tempVec3A.z : _tempVec3A.y;

    if (Math.abs(crossA) >= halfCrossA + clearance || Math.abs(crossB) >= halfCrossB + clearance) {
      return;
    }

    blockedIntervals.push({
      start: majorCoord - halfMajor - clearance,
      end: majorCoord + halfMajor + clearance,
    });
  });

  return mergeIntervals(blockedIntervals);
}

function applyMeshPointBoxClearance(
  boxDimensions: { x: number; y: number; z: number },
  origin: ConversionResult['origin'],
  meshClearanceObstacles: MeshClearanceObstacle[] | undefined,
): { dimensions: { x: number; y: number; z: number }; origin: ConversionResult['origin'] } {
  if (!meshClearanceObstacles?.length) {
    return {
      dimensions: boxDimensions,
      origin,
    };
  }

  const points = collectMeshObstaclePoints(meshClearanceObstacles);
  if (points.length === 0) {
    return {
      dimensions: boxDimensions,
      origin,
    };
  }

  const majorAxis = getPrimaryAxis(boxDimensions);
  const localAxis = getAxisVectorForPrimaryAxis(majorAxis);
  const halfMajor = Math.max(
    (majorAxis === 'x' ? boxDimensions.x : majorAxis === 'y' ? boxDimensions.y : boxDimensions.z) /
      2,
    1e-4,
  );
  const halfCrossA =
    majorAxis === 'x'
      ? boxDimensions.y / 2
      : majorAxis === 'y'
        ? boxDimensions.x / 2
        : boxDimensions.x / 2;
  const halfCrossB =
    majorAxis === 'x'
      ? boxDimensions.z / 2
      : majorAxis === 'y'
        ? boxDimensions.z / 2
        : boxDimensions.y / 2;
  const boxRadius = Math.hypot(boxDimensions.x, boxDimensions.y, boxDimensions.z) / 2;
  const clearance = Math.min(Math.max(boxRadius * 0.05, 0.002), 0.01);
  const center = new THREE.Vector3(origin.xyz.x, origin.xyz.y, origin.xyz.z);
  const inverseRotation = new THREE.Quaternion()
    .setFromEuler(new THREE.Euler(origin.rpy.r, origin.rpy.p, origin.rpy.y, 'ZYX'))
    .invert();
  const blockedIntervals = buildBoxPointBlockedIntervals(
    points,
    center,
    inverseRotation,
    majorAxis,
    halfMajor,
    halfCrossA,
    halfCrossB,
    clearance,
  );
  const safeInterval = resolveAvailableSweepIntervalFromBlockedIntervals(
    halfMajor,
    blockedIntervals,
  );

  if (safeInterval) {
    const nextOrigin =
      Math.abs(safeInterval.centerShift) > 1e-8
        ? offsetOriginByLocalVector(origin, {
            x: localAxis.x * safeInterval.centerShift,
            y: localAxis.y * safeInterval.centerShift,
            z: localAxis.z * safeInterval.centerShift,
          })
        : origin;
    const nextDimensions = { ...boxDimensions };
    const nextMajorSize = Math.max(safeInterval.sweepHalfExtent * 2, 1e-4);

    if (majorAxis === 'x') {
      nextDimensions.x = nextMajorSize;
    } else if (majorAxis === 'y') {
      nextDimensions.y = nextMajorSize;
    } else {
      nextDimensions.z = nextMajorSize;
    }

    return {
      dimensions: nextDimensions,
      origin: nextOrigin,
    };
  }

  const fallbackHalfExtent = 5e-5;
  const fallbackBlockedIntervals = buildBoxPointBlockedIntervals(
    points,
    center,
    inverseRotation,
    majorAxis,
    fallbackHalfExtent,
    halfCrossA,
    halfCrossB,
    clearance,
  );
  const fallbackShift = findNearestSafeCenterShiftFromBlockedIntervals(fallbackBlockedIntervals);
  const fallbackOrigin =
    Math.abs(fallbackShift) > 1e-8
      ? offsetOriginByLocalVector(origin, {
          x: localAxis.x * fallbackShift,
          y: localAxis.y * fallbackShift,
          z: localAxis.z * fallbackShift,
        })
      : origin;
  const fallbackDimensions = { ...boxDimensions };

  if (majorAxis === 'x') {
    fallbackDimensions.x = 1e-4;
  } else if (majorAxis === 'y') {
    fallbackDimensions.y = 1e-4;
  } else {
    fallbackDimensions.z = 1e-4;
  }

  return {
    dimensions: fallbackDimensions,
    origin: fallbackOrigin,
  };
}

function applySiblingCollisionClearance(
  primitiveRadius: number,
  primitiveLength: number,
  axisInLinkSpace: Point3,
  newType: GeometryType,
  siblingGeometries: GeomData[] | undefined,
  centerOrigin: ConversionResult['origin'],
  overlapAllowanceRatio?: number,
): { radius: number; length: number; centerShift: number } {
  if (
    (newType !== GeometryType.CYLINDER && newType !== GeometryType.CAPSULE) ||
    !siblingGeometries?.length
  ) {
    return {
      radius: primitiveRadius,
      length: primitiveLength,
      centerShift: 0,
    };
  }

  const axis = canonicalizeAxis(axisInLinkSpace);
  if (!axis) {
    return {
      radius: primitiveRadius,
      length: primitiveLength,
      centerShift: 0,
    };
  }

  const siblingSpheres = collectSiblingBroadPhaseSpheres(siblingGeometries);
  if (siblingSpheres.length === 0) {
    return {
      radius: primitiveRadius,
      length: primitiveLength,
      centerShift: 0,
    };
  }

  const candidateCenter = new THREE.Vector3(
    centerOrigin.xyz.x,
    centerOrigin.xyz.y,
    centerOrigin.xyz.z,
  );
  const axisVector = new THREE.Vector3(axis.x, axis.y, axis.z).normalize();
  const radius = toPositive(primitiveRadius, 0.05);
  const minSize = 1e-4;
  const baseClearance = Math.min(Math.max(radius * 0.05, 0.002), 0.01);
  const clearance = baseClearance - computeOverlapAllowance(radius, overlapAllowanceRatio);
  const minRadius = Math.min(Math.max(radius * 0.15, minSize), radius);
  const radiusCandidates = collectRadiusCandidates(
    radius,
    candidateCenter,
    axisVector,
    siblingSpheres,
    clearance,
    minRadius,
  );

  let bestCandidate: {
    radius: number;
    sweepHalfExtent: number;
    centerShift: number;
    volume: number;
  } | null = null;

  radiusCandidates.forEach((radiusCandidate) => {
    const sweepHalfExtent = computeSweepHalfExtent(radiusCandidate, primitiveLength, newType);
    const safeInterval = resolveAvailableSweepInterval(
      candidateCenter,
      axisVector,
      sweepHalfExtent,
      radiusCandidate,
      siblingSpheres,
      clearance,
    );

    if (!safeInterval) {
      return;
    }

    const length = composePrimitiveLength(safeInterval.sweepHalfExtent, radiusCandidate, newType);
    const volume = computePrimitiveVolume(newType, radiusCandidate, length);
    if (!Number.isFinite(volume) || volume <= 0) {
      return;
    }

    const nextCandidate = {
      radius: radiusCandidate,
      sweepHalfExtent: safeInterval.sweepHalfExtent,
      centerShift: safeInterval.centerShift,
      volume,
    };

    if (!bestCandidate) {
      bestCandidate = nextCandidate;
      return;
    }

    const volumeTolerance = Math.max(bestCandidate.volume * 0.01, 1e-8);
    if (nextCandidate.volume > bestCandidate.volume + volumeTolerance) {
      bestCandidate = nextCandidate;
      return;
    }

    if (Math.abs(nextCandidate.volume - bestCandidate.volume) <= volumeTolerance) {
      if (nextCandidate.sweepHalfExtent > bestCandidate.sweepHalfExtent + 1e-8) {
        bestCandidate = nextCandidate;
        return;
      }

      if (
        Math.abs(nextCandidate.sweepHalfExtent - bestCandidate.sweepHalfExtent) <= 1e-8 &&
        Math.abs(nextCandidate.centerShift) < Math.abs(bestCandidate.centerShift) - 1e-8
      ) {
        bestCandidate = nextCandidate;
      }
    }
  });

  if (bestCandidate) {
    return {
      radius: bestCandidate.radius,
      length: composePrimitiveLength(bestCandidate.sweepHalfExtent, bestCandidate.radius, newType),
      centerShift: bestCandidate.centerShift,
    };
  }

  let fallbackCandidate: {
    radius: number;
    length: number;
    centerShift: number;
    volume: number;
  } | null = null;

  radiusCandidates.forEach((radiusCandidate) => {
    const centerShift = findNearestSafeCenterShift(
      candidateCenter,
      axisVector,
      radiusCandidate,
      siblingSpheres,
      clearance,
    );
    const length = composePrimitiveLength(
      newType === GeometryType.CAPSULE ? 0 : minSize / 2,
      radiusCandidate,
      newType,
    );
    const volume = computePrimitiveVolume(newType, radiusCandidate, length);
    if (!Number.isFinite(volume) || volume <= 0) {
      return;
    }

    const nextCandidate = {
      radius: radiusCandidate,
      length,
      centerShift,
      volume,
    };

    if (!fallbackCandidate) {
      fallbackCandidate = nextCandidate;
      return;
    }

    const shiftDelta =
      Math.abs(nextCandidate.centerShift) - Math.abs(fallbackCandidate.centerShift);
    if (shiftDelta < -1e-8) {
      fallbackCandidate = nextCandidate;
      return;
    }

    if (Math.abs(shiftDelta) <= 1e-8) {
      const volumeTolerance = Math.max(fallbackCandidate.volume * 0.01, 1e-8);
      if (nextCandidate.volume > fallbackCandidate.volume + volumeTolerance) {
        fallbackCandidate = nextCandidate;
      }
    }
  });

  if (fallbackCandidate) {
    return {
      radius: fallbackCandidate.radius,
      length: fallbackCandidate.length,
      centerShift: fallbackCandidate.centerShift,
    };
  }

  return {
    radius,
    length: composePrimitiveLength(
      newType === GeometryType.CAPSULE ? 0 : minSize / 2,
      radius,
      newType,
    ),
    centerShift: 0,
  };
}

function applySiblingBoxClearance(
  boxDimensions: { x: number; y: number; z: number },
  origin: ConversionResult['origin'],
  siblingGeometries: GeomData[] | undefined,
): ConversionResult['origin'] {
  if (!siblingGeometries?.length) {
    return origin;
  }

  const siblingSpheres = collectSiblingBroadPhaseSpheres(siblingGeometries);
  if (siblingSpheres.length === 0) {
    return origin;
  }

  const boxRadius = computeBroadPhaseRadius({
    type: GeometryType.BOX,
    dimensions: boxDimensions,
    origin,
  });
  if (!boxRadius || boxRadius <= 1e-8) {
    return origin;
  }

  const center = new THREE.Vector3(origin.xyz.x, origin.xyz.y, origin.xyz.z);
  const clearance = Math.min(Math.max(boxRadius * 0.05, 0.002), 0.01);
  const axisPriority = [
    { axis: 'x' as const, size: boxDimensions.x },
    { axis: 'y' as const, size: boxDimensions.y },
    { axis: 'z' as const, size: boxDimensions.z },
  ].sort((left, right) => right.size - left.size);

  let bestShift: { localAxis: Point3; centerShift: number } | null = null;

  axisPriority.forEach(({ axis }) => {
    const localAxis = getAxisVectorForPrimaryAxis(axis);
    const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
    const centerShift = findNearestSafeCenterShift(
      center,
      _tempVec3A.set(axisInLinkSpace.x, axisInLinkSpace.y, axisInLinkSpace.z).normalize(),
      boxRadius,
      siblingSpheres,
      clearance,
    );

    if (!bestShift) {
      bestShift = { localAxis, centerShift };
      return;
    }

    const nextShiftMagnitude = Math.abs(centerShift);
    const bestShiftMagnitude = Math.abs(bestShift.centerShift);
    if (nextShiftMagnitude < bestShiftMagnitude - 1e-8) {
      bestShift = { localAxis, centerShift };
      return;
    }

    if (
      Math.abs(nextShiftMagnitude - bestShiftMagnitude) <= 1e-8 &&
      axis === axisPriority[0].axis
    ) {
      bestShift = { localAxis, centerShift };
    }
  });

  if (!bestShift || Math.abs(bestShift.centerShift) <= 1e-8) {
    return origin;
  }

  return offsetOriginByLocalVector(origin, {
    x: bestShift.localAxis.x * bestShift.centerShift,
    y: bestShift.localAxis.y * bestShift.centerShift,
    z: bestShift.localAxis.z * bestShift.centerShift,
  });
}

function offsetOriginByLocalVector(
  origin: ConversionResult['origin'],
  localOffset: { x: number; y: number; z: number },
): ConversionResult['origin'] {
  _tempEuler.set(origin.rpy.r, origin.rpy.p, origin.rpy.y);
  _tempVec3A.set(localOffset.x, localOffset.y, localOffset.z).applyEuler(_tempEuler);

  return {
    xyz: {
      x: origin.xyz.x + _tempVec3A.x,
      y: origin.xyz.y + _tempVec3A.y,
      z: origin.xyz.z + _tempVec3A.z,
    },
    rpy: {
      r: origin.rpy.r,
      p: origin.rpy.p,
      y: origin.rpy.y,
    },
  };
}

function getPrimaryAxis(bounds: { x: number; y: number; z: number }): MeshPrimaryAxis {
  if (bounds.x >= bounds.y && bounds.x >= bounds.z) return 'x';
  if (bounds.y >= bounds.x && bounds.y >= bounds.z) return 'y';
  return 'z';
}

function getAxisAlignmentQuaternion(axis: MeshPrimaryAxis): THREE.Quaternion {
  _tempQuatB.identity();

  if (axis === 'x') {
    _tempQuatB.setFromAxisAngle(_tempVec3A.set(0, 1, 0), Math.PI / 2);
  } else if (axis === 'y') {
    _tempQuatB.setFromAxisAngle(_tempVec3A.set(1, 0, 0), -Math.PI / 2);
  }

  return _tempQuatB;
}

function getDirectionalAlignmentQuaternion(axis: Point3): THREE.Quaternion {
  const normalizedAxis = canonicalizeAxis(axis);
  if (!normalizedAxis) {
    _tempQuatB.identity();
    return _tempQuatB;
  }

  _tempQuatB.setFromUnitVectors(
    _zAxis,
    _tempVec3A.set(normalizedAxis.x, normalizedAxis.y, normalizedAxis.z),
  );
  return _tempQuatB;
}

function alignOriginToPrimaryAxis(
  origin: ConversionResult['origin'],
  primaryAxis: MeshPrimaryAxis,
): ConversionResult['origin'] {
  if (primaryAxis === 'z') {
    return origin;
  }

  _tempEuler.set(origin.rpy.r, origin.rpy.p, origin.rpy.y);
  _tempQuat.setFromEuler(_tempEuler);
  _tempQuat.multiply(getAxisAlignmentQuaternion(primaryAxis));
  _tempEulerB.setFromQuaternion(_tempQuat, 'ZYX');

  return {
    xyz: {
      x: origin.xyz.x,
      y: origin.xyz.y,
      z: origin.xyz.z,
    },
    rpy: {
      r: _tempEulerB.x,
      p: _tempEulerB.y,
      y: _tempEulerB.z,
    },
  };
}

function alignOriginToAxis(
  origin: ConversionResult['origin'],
  axis: Point3,
): ConversionResult['origin'] {
  _tempEuler.set(origin.rpy.r, origin.rpy.p, origin.rpy.y);
  _tempQuat.setFromEuler(_tempEuler);
  _tempQuat.multiply(getDirectionalAlignmentQuaternion(axis));
  _tempEulerB.setFromQuaternion(_tempQuat, 'ZYX');

  return {
    xyz: {
      x: origin.xyz.x,
      y: origin.xyz.y,
      z: origin.xyz.z,
    },
    rpy: {
      r: _tempEulerB.x,
      p: _tempEulerB.y,
      y: _tempEulerB.z,
    },
  };
}

function getCrossSectionDimensions(
  bounds: { x: number; y: number; z: number },
  primaryAxis: MeshPrimaryAxis,
): { length: number; crossA: number; crossB: number } {
  if (primaryAxis === 'x') {
    return { length: bounds.x, crossA: bounds.y, crossB: bounds.z };
  }
  if (primaryAxis === 'y') {
    return { length: bounds.y, crossA: bounds.x, crossB: bounds.z };
  }
  return { length: bounds.z, crossA: bounds.x, crossB: bounds.y };
}

function computeBoxVolume(bounds: { x: number; y: number; z: number }): number {
  return Math.max(bounds.x, 1e-8) * Math.max(bounds.y, 1e-8) * Math.max(bounds.z, 1e-8);
}

function computeEquivalentSphereRadius(targetVolume: number): number {
  return Math.cbrt((3 * Math.max(targetVolume, 1e-8)) / (4 * Math.PI));
}

function computeEquivalentCylinderRadius(length: number, targetVolume: number): number {
  if (!Number.isFinite(length) || length <= 1e-8) {
    return 0;
  }
  return Math.sqrt(Math.max(targetVolume, 1e-8) / (Math.PI * length));
}

function computeCapsuleVolume(totalLength: number, radius: number): number {
  if (totalLength <= 0 || radius <= 0) return 0;
  const clampedRadius = Math.min(radius, totalLength / 2);
  return (
    Math.PI * clampedRadius * clampedRadius * totalLength -
    (2 / 3) * Math.PI * clampedRadius * clampedRadius * clampedRadius
  );
}

function computePrimitiveVolume(type: GeometryType, radius: number, length: number): number {
  if (type === GeometryType.CYLINDER) {
    return Math.PI * radius * radius * Math.max(length, 0);
  }
  if (type === GeometryType.CAPSULE) {
    return computeCapsuleVolume(length, radius);
  }
  return Number.POSITIVE_INFINITY;
}

function selectBestPrimitiveFitCandidate(
  primitiveFits: MeshAnalysis['primitiveFits'] | undefined,
  newType: GeometryType,
  origin: ConversionResult['origin'],
  context?: ConversionContext,
  preferredAxis?: Point3,
): {
  fit: PrimitiveFit;
  centeredOrigin: ConversionResult['origin'];
  radius: number;
  length: number;
} | null {
  const candidates =
    newType === GeometryType.CYLINDER
      ? (primitiveFits?.cylinderCandidates ??
        (primitiveFits?.cylinder ? [primitiveFits.cylinder] : []))
      : newType === GeometryType.CAPSULE
        ? (primitiveFits?.capsuleCandidates ??
          (primitiveFits?.capsule ? [primitiveFits.capsule] : []))
        : [];

  if (candidates.length === 0) {
    return null;
  }

  const axisPreferredCandidates = preferredAxis
    ? (() => {
        let bestAlignmentScore = Number.NEGATIVE_INFINITY;
        const scoredCandidates = candidates.map((fit) => {
          const alignmentScore = computeAxisAlignmentScore(fit.axis, preferredAxis);
          if (alignmentScore > bestAlignmentScore) {
            bestAlignmentScore = alignmentScore;
          }
          return { fit, alignmentScore };
        });

        return scoredCandidates
          .filter(({ alignmentScore }) => alignmentScore >= bestAlignmentScore - 1e-6)
          .map(({ fit }) => fit);
      })()
    : candidates;

  const resolvedCandidates =
    axisPreferredCandidates.length > 0 ? axisPreferredCandidates : candidates;

  const evaluated = resolvedCandidates
    .map((fit) => {
      const centeredOrigin = offsetOriginByLocalVector(origin, fit.center);
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, fit.axis);
      const clearanceAdjustedSize = applySiblingCollisionClearance(
        fit.radius,
        fit.length,
        axisInLinkSpace,
        newType,
        context?.siblingGeometries,
        centeredOrigin,
        context?.overlapAllowanceRatio,
      );
      const siblingShiftedOrigin =
        Math.abs(clearanceAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(centeredOrigin, {
              x: fit.axis.x * clearanceAdjustedSize.centerShift,
              y: fit.axis.y * clearanceAdjustedSize.centerShift,
              z: fit.axis.z * clearanceAdjustedSize.centerShift,
            })
          : centeredOrigin;
      const meshAdjustedSize = applyMeshPointCollisionClearance(
        clearanceAdjustedSize.radius,
        clearanceAdjustedSize.length,
        axisInLinkSpace,
        newType,
        context?.meshClearanceObstacles,
        siblingShiftedOrigin,
        context?.overlapAllowanceRatio,
      );
      const shiftedOrigin =
        Math.abs(meshAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(siblingShiftedOrigin, {
              x: fit.axis.x * meshAdjustedSize.centerShift,
              y: fit.axis.y * meshAdjustedSize.centerShift,
              z: fit.axis.z * meshAdjustedSize.centerShift,
            })
          : siblingShiftedOrigin;
      const radius = toPositive(meshAdjustedSize.radius, 0.05);
      const length = toPositive(
        newType === GeometryType.CAPSULE
          ? Math.max(meshAdjustedSize.length, radius * 2)
          : meshAdjustedSize.length,
        0.1,
      );

      return {
        fit,
        centeredOrigin: shiftedOrigin,
        radius,
        length,
        adjustedVolume: computePrimitiveVolume(newType, radius, length),
        centerShiftMagnitude: Math.abs(
          clearanceAdjustedSize.centerShift + meshAdjustedSize.centerShift,
        ),
      };
    })
    .filter(
      (candidate) => Number.isFinite(candidate.adjustedVolume) && candidate.adjustedVolume > 0,
    );

  if (evaluated.length === 0) {
    return null;
  }

  const minFitVolume = evaluated.reduce(
    (minVolume, candidate) => Math.min(minVolume, candidate.fit.volume),
    Number.POSITIVE_INFINITY,
  );
  const fitVolumeWindowRatio = Math.max(context?.fitVolumeWindowRatio ?? 1.25, 1);
  const finalists = evaluated
    .filter((candidate) => candidate.fit.volume <= minFitVolume * fitVolumeWindowRatio + 1e-8)
    .sort(
      (left, right) =>
        right.adjustedVolume - left.adjustedVolume ||
        left.centerShiftMagnitude - right.centerShiftMagnitude ||
        left.fit.volume - right.fit.volume ||
        left.length - right.length ||
        left.radius - right.radius,
    );

  const best = finalists[0] ?? evaluated[0];
  return best ?? null;
}

function computeEquivalentCapsuleRadius(totalLength: number, targetVolume: number): number {
  if (!Number.isFinite(totalLength) || totalLength <= 1e-8) {
    return 0;
  }

  const safeVolume = Math.max(targetVolume, 1e-8);
  const maxRadius = totalLength / 2;
  const maxAchievableVolume = computeCapsuleVolume(totalLength, maxRadius);

  if (safeVolume >= maxAchievableVolume) {
    return maxRadius;
  }

  let low = 0;
  let high = maxRadius;

  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (computeCapsuleVolume(totalLength, mid) < safeVolume) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return (low + high) / 2;
}

/**
 * Convert geometry dimensions when switching between geometry types.
 * Uses stable, deterministic mapping and preserves origin rotation.
 * When meshBounds is supplied (from mesh bounding box), uses it for
 * smart sizing when converting FROM a mesh geometry.
 */
export function convertGeometryType(
  geomData: GeomData,
  newType: GeometryType,
  meshAnalysis?: MeshAnalysis,
  context?: ConversionContext,
): ConversionResult {
  const currentType = geomData.type;
  const currentDims = normalizeDimensions(geomData.dimensions);
  const origin = normalizeOrigin(geomData.origin);

  // ── Smart conversion FROM mesh using actual bounding box ──────────────────
  if (currentType === GeometryType.MESH && meshAnalysis?.bounds) {
    const preservedLocalAxis = getAxisVectorForPrimaryAxis('z');
    const fittedPrimitive = selectBestPrimitiveFitCandidate(
      meshAnalysis.primitiveFits,
      newType,
      origin,
      context,
      preservedLocalAxis,
    );

    if (fittedPrimitive) {
      return {
        type: newType,
        dimensions: {
          x: fittedPrimitive.radius,
          y: fittedPrimitive.length,
          z: fittedPrimitive.radius,
        },
        origin: fittedPrimitive.centeredOrigin,
      };
    }

    const { x: bx, y: by, z: bz, cx, cy, cz } = meshAnalysis.bounds;
    const centeredOrigin = offsetOriginByLocalVector(origin, { x: cx, y: cy, z: cz });
    const targetVolume = computeBoxVolume(meshAnalysis.bounds);

    if (newType === GeometryType.BOX) {
      const siblingAdjustedOrigin = context?.siblingGeometries?.length
        ? applySiblingBoxClearance(
            {
              x: toPositive(bx, DEFAULT_DIMENSIONS.x),
              y: toPositive(by, DEFAULT_DIMENSIONS.y),
              z: toPositive(bz, DEFAULT_DIMENSIONS.z),
            },
            centeredOrigin,
            context.siblingGeometries,
          )
        : centeredOrigin;
      const meshAdjustedBox = applyMeshPointBoxClearance(
        {
          x: toPositive(bx, DEFAULT_DIMENSIONS.x),
          y: toPositive(by, DEFAULT_DIMENSIONS.y),
          z: toPositive(bz, DEFAULT_DIMENSIONS.z),
        },
        siblingAdjustedOrigin,
        context?.meshClearanceObstacles,
      );

      return {
        type: newType,
        dimensions: meshAdjustedBox.dimensions,
        origin: meshAdjustedBox.origin,
      };
    }

    if (newType === GeometryType.ELLIPSOID) {
      return {
        type: newType,
        dimensions: {
          x: toPositive(bx / 2, DEFAULT_DIMENSIONS.x / 2),
          y: toPositive(by / 2, DEFAULT_DIMENSIONS.y / 2),
          z: toPositive(bz / 2, DEFAULT_DIMENSIONS.z / 2),
        },
        origin: centeredOrigin,
      };
    }

    if (newType === GeometryType.SPHERE) {
      const sphereRadius = toPositive(computeEquivalentSphereRadius(targetVolume), 0.1);
      return {
        type: newType,
        dimensions: { x: sphereRadius, y: sphereRadius, z: sphereRadius },
        origin: centeredOrigin,
      };
    }

    if (newType === GeometryType.CYLINDER) {
      const localAxis = preservedLocalAxis;
      const { length } = getCrossSectionDimensions(meshAnalysis.bounds, 'z');
      const rawRadius = computeEquivalentCylinderRadius(length, targetVolume);
      const radius = toPositive(rawRadius, 0.05);
      const safeLength = toPositive(length, 0.5);
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
      const clearanceAdjustedSize = applySiblingCollisionClearance(
        radius,
        safeLength,
        axisInLinkSpace,
        newType,
        context?.siblingGeometries,
        centeredOrigin,
        context?.overlapAllowanceRatio,
      );
      const siblingShiftedOrigin =
        Math.abs(clearanceAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(centeredOrigin, {
              x: localAxis.x * clearanceAdjustedSize.centerShift,
              y: localAxis.y * clearanceAdjustedSize.centerShift,
              z: localAxis.z * clearanceAdjustedSize.centerShift,
            })
          : centeredOrigin;
      const meshAdjustedSize = applyMeshPointCollisionClearance(
        clearanceAdjustedSize.radius,
        clearanceAdjustedSize.length,
        axisInLinkSpace,
        newType,
        context?.meshClearanceObstacles,
        siblingShiftedOrigin,
        context?.overlapAllowanceRatio,
      );
      const shiftedOrigin =
        Math.abs(meshAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(siblingShiftedOrigin, {
              x: localAxis.x * meshAdjustedSize.centerShift,
              y: localAxis.y * meshAdjustedSize.centerShift,
              z: localAxis.z * meshAdjustedSize.centerShift,
            })
          : siblingShiftedOrigin;

      return {
        type: newType,
        dimensions: {
          x: meshAdjustedSize.radius,
          y: meshAdjustedSize.length,
          z: meshAdjustedSize.radius,
        },
        origin: shiftedOrigin,
      };
    }

    if (newType === GeometryType.CAPSULE) {
      const localAxis = preservedLocalAxis;
      const { length } = getCrossSectionDimensions(meshAnalysis.bounds, 'z');
      const safeLength = toPositive(length, 0.5);
      const rawRadius = computeEquivalentCapsuleRadius(safeLength, targetVolume);
      const radius = toPositive(rawRadius, 0.05);
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
      const clearanceAdjustedSize = applySiblingCollisionClearance(
        radius,
        Math.max(safeLength, radius * 2),
        axisInLinkSpace,
        newType,
        context?.siblingGeometries,
        centeredOrigin,
        context?.overlapAllowanceRatio,
      );
      const siblingShiftedOrigin =
        Math.abs(clearanceAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(centeredOrigin, {
              x: localAxis.x * clearanceAdjustedSize.centerShift,
              y: localAxis.y * clearanceAdjustedSize.centerShift,
              z: localAxis.z * clearanceAdjustedSize.centerShift,
            })
          : centeredOrigin;
      const meshAdjustedSize = applyMeshPointCollisionClearance(
        clearanceAdjustedSize.radius,
        Math.max(clearanceAdjustedSize.length, clearanceAdjustedSize.radius * 2),
        axisInLinkSpace,
        newType,
        context?.meshClearanceObstacles,
        siblingShiftedOrigin,
        context?.overlapAllowanceRatio,
      );
      const shiftedOrigin =
        Math.abs(meshAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(siblingShiftedOrigin, {
              x: localAxis.x * meshAdjustedSize.centerShift,
              y: localAxis.y * meshAdjustedSize.centerShift,
              z: localAxis.z * meshAdjustedSize.centerShift,
            })
          : siblingShiftedOrigin;

      return {
        type: newType,
        dimensions: {
          x: meshAdjustedSize.radius,
          y: Math.max(meshAdjustedSize.length, meshAdjustedSize.radius * 2),
          z: meshAdjustedSize.radius,
        },
        origin: shiftedOrigin,
      };
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  if (newType === GeometryType.CYLINDER || newType === GeometryType.CAPSULE) {
    let radius = 0.05;
    let length = 0.5;
    let localAxis: Point3 = { x: 0, y: 0, z: 1 };
    let nextOrigin = origin;
    let primaryAxis: MeshPrimaryAxis | null = null;

    if (currentType === GeometryType.CYLINDER || currentType === GeometryType.CAPSULE) {
      radius = toPositive(currentDims.x, 0.05);
      length = toPositive(currentDims.y, 0.5);
    } else if (currentType === GeometryType.BOX) {
      primaryAxis = getPrimaryAxis(currentDims);
      localAxis = getAxisVectorForPrimaryAxis(primaryAxis);
      const crossSection = getCrossSectionDimensions(currentDims, primaryAxis);
      radius = toPositive(Math.max(crossSection.crossA, crossSection.crossB) / 2, 0.05);
      length = toPositive(crossSection.length, 0.5);
    } else if (currentType === GeometryType.ELLIPSOID) {
      const ellipsoidDiameters = {
        x: currentDims.x * 2,
        y: currentDims.y * 2,
        z: currentDims.z * 2,
      };
      primaryAxis = getPrimaryAxis(ellipsoidDiameters);
      localAxis = getAxisVectorForPrimaryAxis(primaryAxis);
      const crossSection = getCrossSectionDimensions(ellipsoidDiameters, primaryAxis);
      radius = toPositive(Math.max(crossSection.crossA, crossSection.crossB) / 2, 0.05);
      length = toPositive(crossSection.length, 0.5);
    } else if (currentType === GeometryType.SPHERE) {
      radius = toPositive(currentDims.x, 0.05);
      length = radius * 2;
    }

    if (context?.siblingGeometries?.length) {
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
      const clearanceAdjustedSize = applySiblingCollisionClearance(
        radius,
        length,
        axisInLinkSpace,
        newType,
        context.siblingGeometries,
        origin,
        context?.overlapAllowanceRatio,
      );
      radius = clearanceAdjustedSize.radius;
      length = clearanceAdjustedSize.length;
      nextOrigin =
        Math.abs(clearanceAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(origin, {
              x: localAxis.x * clearanceAdjustedSize.centerShift,
              y: localAxis.y * clearanceAdjustedSize.centerShift,
              z: localAxis.z * clearanceAdjustedSize.centerShift,
            })
          : origin;
    }

    if (context?.meshClearanceObstacles?.length) {
      const axisInLinkSpace = rotateLocalVectorByOrigin(origin, localAxis);
      const meshAdjustedSize = applyMeshPointCollisionClearance(
        radius,
        length,
        axisInLinkSpace,
        newType,
        context.meshClearanceObstacles,
        nextOrigin,
        context?.overlapAllowanceRatio,
      );
      radius = meshAdjustedSize.radius;
      length = meshAdjustedSize.length;
      nextOrigin =
        Math.abs(meshAdjustedSize.centerShift) > 1e-8
          ? offsetOriginByLocalVector(nextOrigin, {
              x: localAxis.x * meshAdjustedSize.centerShift,
              y: localAxis.y * meshAdjustedSize.centerShift,
              z: localAxis.z * meshAdjustedSize.centerShift,
            })
          : nextOrigin;
    }

    if (primaryAxis) {
      nextOrigin = alignOriginToPrimaryAxis(nextOrigin, primaryAxis);
    }

    return {
      type: newType,
      dimensions: {
        x: radius,
        y: newType === GeometryType.CAPSULE ? Math.max(length, radius * 2) : length,
        z: radius,
      },
      origin: nextOrigin,
    };
  }

  if (newType === GeometryType.SPHERE) {
    let sphereRadius = 0.1;
    if (currentType === GeometryType.CYLINDER || currentType === GeometryType.CAPSULE) {
      sphereRadius = Math.max(currentDims.x, currentDims.y / 2);
    } else if (currentType === GeometryType.BOX) {
      sphereRadius = Math.max(currentDims.x, currentDims.y, currentDims.z) / 2;
    } else if (currentType === GeometryType.ELLIPSOID) {
      sphereRadius = Math.max(currentDims.x, currentDims.y, currentDims.z);
    } else {
      sphereRadius = currentDims.x;
    }
    sphereRadius = toPositive(sphereRadius, 0.1);

    return {
      type: newType,
      dimensions: { x: sphereRadius, y: sphereRadius, z: sphereRadius },
      origin,
    };
  }

  if (newType === GeometryType.ELLIPSOID) {
    let newDims = { x: 0.1, y: 0.1, z: 0.1 };

    if (currentType === GeometryType.CYLINDER || currentType === GeometryType.CAPSULE) {
      newDims = {
        x: currentDims.x,
        y: currentDims.x,
        z: Math.max(currentDims.y / 2, currentDims.x),
      };
    } else if (currentType === GeometryType.BOX) {
      newDims = {
        x: currentDims.x / 2,
        y: currentDims.y / 2,
        z: currentDims.z / 2,
      };
    } else if (currentType === GeometryType.SPHERE) {
      newDims = {
        x: currentDims.x,
        y: currentDims.x,
        z: currentDims.x,
      };
    } else if (currentType === GeometryType.ELLIPSOID) {
      newDims = { ...currentDims };
    }

    return {
      type: newType,
      dimensions: {
        x: toPositive(newDims.x, 0.1),
        y: toPositive(newDims.y, 0.1),
        z: toPositive(newDims.z, 0.1),
      },
      origin,
    };
  }

  if (newType === GeometryType.BOX) {
    let newDims = { ...currentDims };
    let nextOrigin = origin;
    if (currentType === GeometryType.CYLINDER || currentType === GeometryType.CAPSULE) {
      newDims = { x: currentDims.x * 2, y: currentDims.x * 2, z: currentDims.y };
    } else if (currentType === GeometryType.ELLIPSOID) {
      newDims = { x: currentDims.x * 2, y: currentDims.y * 2, z: currentDims.z * 2 };
    } else if (currentType === GeometryType.SPHERE) {
      const diameter = currentDims.x * 2;
      newDims = { x: diameter, y: diameter, z: diameter };
    }
    if (context?.siblingGeometries?.length) {
      nextOrigin = applySiblingBoxClearance(newDims, origin, context.siblingGeometries);
    }
    const meshAdjustedBox = applyMeshPointBoxClearance(
      newDims,
      nextOrigin,
      context?.meshClearanceObstacles,
    );
    return {
      type: newType,
      dimensions: meshAdjustedBox.dimensions,
      origin: meshAdjustedBox.origin,
    };
  }

  if (newType === GeometryType.MESH) {
    return {
      type: newType,
      dimensions: currentType === GeometryType.MESH ? currentDims : { x: 1, y: 1, z: 1 },
      origin,
    };
  }

  // NONE, or any other type
  return {
    type: newType,
    dimensions: currentDims,
    origin,
  };
}
