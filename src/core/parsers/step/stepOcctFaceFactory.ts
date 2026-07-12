/**
 * OCCT face factory — constructs verified TopoDS_Face objects from triangle
 * vertex data using BRepBuilderAPI_MakeFace_15. Never uses polygon.Shape().
 *
 * OCCT `any` types are isolated inside this module.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { StepRegionBoundary } from './stepRegionBoundary';

export interface StepOcctFaceResult {
  shape: unknown;
  faceCount: number;
  warnings: string[];
}

/**
 * Build a single real OCCT triangle face from 3 vertices.
 * Uses MakePolygon → Wire → MakeFace_15(wire, true) with full cleanup.
 */
export function buildOcctTriangleFace(
  oc: any,
  coordinates: readonly number[],
): StepOcctFaceResult | null {
  if (coordinates.length < 9) return null;

  let p1: any = null, p2: any = null, p3: any = null;
  let polygon: any = null, wire: any = null, faceMaker: any = null;

  try {
    p1 = new oc.gp_Pnt_3(coordinates[0], coordinates[1], coordinates[2]);
    p2 = new oc.gp_Pnt_3(coordinates[3], coordinates[4], coordinates[5]);
    p3 = new oc.gp_Pnt_3(coordinates[6], coordinates[7], coordinates[8]);
    polygon = new oc.BRepBuilderAPI_MakePolygon_1();
    polygon.Add_1(p1);
    polygon.Add_1(p2);
    polygon.Add_1(p3);
    polygon.Close();
    wire = polygon.Wire();
    if (!wire || wire.IsNull()) return null;

    faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
    if (!faceMaker.IsDone()) return null;

    const face = faceMaker.Face();
    if (!face || face.IsNull()) return null;

    return { shape: face, faceCount: 1, warnings: [] };
  } finally {
    faceMaker?.delete?.();
    wire?.delete?.();
    polygon?.delete?.();
    p3?.delete?.();
    p2?.delete?.();
    p1?.delete?.();
  }
}

/**
 * Build an OCCT planar face from a verified boundary loop.
 * Creates a closed wire from the ordered vertex IDs, then MakeFace_15.
 * If the wire is not planar or MakeFace fails, returns null (caller routes
 * to faceted fallback).
 */
export function buildOcctPlanarRegionFace(
  oc: any,
  vertices: readonly number[],
  boundary: StepRegionBoundary,
): StepOcctFaceResult | null {
  const loop = boundary.outerLoop;
  if (loop.length < 3) return null;

  let polygon: any = null, wire: any = null, faceMaker: any = null;

  try {
    polygon = new oc.BRepBuilderAPI_MakePolygon_1();
    for (const vIdx of loop) {
      const p = new oc.gp_Pnt_3(vertices[vIdx * 3], vertices[vIdx * 3 + 1], vertices[vIdx * 3 + 2]);
      polygon.Add_1(p);
      p.delete();
    }
    polygon.Close();
    wire = polygon.Wire();
    if (!wire || wire.IsNull()) return null;

    faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
    if (!faceMaker.IsDone()) return null;

    const face = faceMaker.Face();
    if (!face || face.IsNull()) return null;

    return { shape: face, faceCount: 1, warnings: [] };
  } finally {
    faceMaker?.delete?.();
    wire?.delete?.();
    polygon?.delete?.();
  }
}
