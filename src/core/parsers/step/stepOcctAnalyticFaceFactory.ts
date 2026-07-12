/**
 * OCCT analytic surface face builders verified against opencascade.js 1.1.1.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { SurfaceRegion } from './stepMeshRegionTypes';
import { StepOcctResourceScope } from './stepOcctResourceScope';
import type { StepOcctFaceResult } from './stepOcctFaceFactory';

interface Vec3 { x: number; y: number; z: number }

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v.x, v.y, v.z);
  if (!Number.isFinite(length) || length < 1e-12) {
    throw new Error('Cylinder axis is degenerate.');
  }
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function subtractProjection(v: Vec3, axis: Vec3): Vec3 {
  const projection = dot(v, axis);
  return {
    x: v.x - projection * axis.x,
    y: v.y - projection * axis.y,
    z: v.z - projection * axis.z,
  };
}

function chooseReferenceDirection(axis: Vec3): Vec3 {
  const candidate = Math.abs(axis.z) < 0.9
    ? { x: 0, y: 0, z: 1 }
    : { x: 1, y: 0, z: 0 };
  return normalize(subtractProjection(candidate, axis));
}

export interface CylinderParameterBounds {
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  angularCoverage: number;
  referenceDirection: Vec3;
}

/**
 * Calculate an unwrapped full-cylinder parameter range.
 * Only near-complete revolutions are accepted; partial patches remain faceted.
 */
export function calculateCylinderParameterBounds(
  vertices: readonly number[],
  indices: readonly number[],
  triangleIds: readonly number[],
  center: Vec3,
  axisInput: Vec3,
): CylinderParameterBounds | null {
  const axis = normalize(axisInput);
  const xDirection = chooseReferenceDirection(axis);
  const yDirection = normalize(cross(axis, xDirection));
  const vertexIds = new Set<number>();
  for (const triangleId of triangleIds) {
    vertexIds.add(indices[triangleId * 3]);
    vertexIds.add(indices[triangleId * 3 + 1]);
    vertexIds.add(indices[triangleId * 3 + 2]);
  }

  const angles: number[] = [];
  let vMin = Number.POSITIVE_INFINITY;
  let vMax = Number.NEGATIVE_INFINITY;
  for (const vertexId of vertexIds) {
    const relative = {
      x: vertices[vertexId * 3] - center.x,
      y: vertices[vertexId * 3 + 1] - center.y,
      z: vertices[vertexId * 3 + 2] - center.z,
    };
    const angle = Math.atan2(dot(relative, yDirection), dot(relative, xDirection));
    angles.push(angle < 0 ? angle + Math.PI * 2 : angle);
    const axial = dot(relative, axis);
    vMin = Math.min(vMin, axial);
    vMax = Math.max(vMax, axial);
  }
  if (angles.length < 6 || !Number.isFinite(vMin) || vMax - vMin < 1e-9) return null;

  angles.sort((a, b) => a - b);
  let largestGap = angles[0] + Math.PI * 2 - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) {
    largestGap = Math.max(largestGap, angles[i] - angles[i - 1]);
  }
  const angularCoverage = Math.PI * 2 - largestGap;
  if (angularCoverage < Math.PI * 1.75) return null;

  return {
    uMin: 0,
    uMax: Math.PI * 2,
    vMin,
    vMax,
    angularCoverage,
    referenceDirection: xDirection,
  };
}

/**
 * Build a native OCCT cylinder for a high-confidence complete revolution.
 * The primitive route is used instead of Geom_CylindricalSurface + MakeFace:
 * that binding reports IsDone but crashes STEPControl_Writer.Transfer in the
 * bundled OCCT 7.4 WASM runtime.
 */
export function buildOcctCylindricalRegionFace(
  oc: any,
  vertices: readonly number[],
  indices: readonly number[],
  region: SurfaceRegion,
  tolerance: number,
): StepOcctFaceResult | null {
  const center = region.parameters.cylinderCenter;
  const axisValue = region.parameters.cylinderAxis;
  const radius = region.parameters.cylinderRadius;
  if (!center || !axisValue || !radius || radius <= 0) return null;

  const bounds = calculateCylinderParameterBounds(
    vertices, indices, region.triangleIds, center, axisValue,
  );
  if (!bounds) return null;

  const axis = normalize(axisValue);
  const scope = new StepOcctResourceScope();
  try {
    const start = {
      x: center.x + axis.x * bounds.vMin,
      y: center.y + axis.y * bounds.vMin,
      z: center.z + axis.z * bounds.vMin,
    };
    const point = scope.own(new oc.gp_Pnt_3(start.x, start.y, start.z));
    const axisXyz = scope.own(new oc.gp_XYZ_2(axis.x, axis.y, axis.z));
    const axisDir = scope.own(new oc.gp_Dir_3(axisXyz));
    const ref = bounds.referenceDirection;
    const refXyz = scope.own(new oc.gp_XYZ_2(ref.x, ref.y, ref.z));
    const refDir = scope.own(new oc.gp_Dir_3(refXyz));
    const ax2 = scope.own(new oc.gp_Ax2_2(point, axisDir, refDir));
    void tolerance;
    // OCCT overload order follows the native constructors:
    // _2(R, H, angle), _3(Ax2, R, H).
    const maker = scope.own(new oc.BRepPrimAPI_MakeCylinder_3(
      ax2,
      radius,
      bounds.vMax - bounds.vMin,
    ));
    const shape = maker.Shape();
    if (!shape || shape.IsNull()) return null;
    scope.release(shape);
    return { shape, faceCount: 3, warnings: [] };
  } catch (error) {
    throw new Error(
      `OCCT cylinder construction failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    scope.dispose();
  }
}
