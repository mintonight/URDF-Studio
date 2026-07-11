/**
 * STEP export worker — runs the OpenCascade.js WASM CAD kernel off the main
 * thread so the 52 MB WASM payload and B-rep construction never freeze the UI.
 *
 * Receives a list of link geometry payloads, builds analytic solids / mesh
 * shells, places each at its world transform, fuses them into one compound,
 * and writes a spec-compliant STEP file via STEPControl_Writer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { initOpenCascade } from 'opencascade.js';

export type StepPrimitiveType = 'box' | 'cylinder' | 'sphere' | 'capsule' | 'mesh';

export interface StepShapePayload {
  type: StepPrimitiveType;
  /** Dimensions in meters. For box: {x,y,z} = full size. For cylinder/sphere: {x}=radius, {y}=length. */
  dimensions: { x: number; y: number; z: number };
  /** World-space 4×4 transform (column-major) placing this shape. */
  matrix: number[];
  /** For mesh type: flat triangle vertices [x0,y0,z0, x1,y1,z1, ...]. */
  positions?: number[];
}

export interface StepLinkPayload {
  linkId: string;
  linkName: string;
  shapes: StepShapePayload[];
}

export interface StepWorkerRequest {
  type: 'build';
  links: StepLinkPayload[];
  robotName: string;
}

export interface StepWorkerSuccess {
  type: 'done';
  data: Uint8Array;
  linkCount: number;
  shapeCount: number;
}

export interface StepWorkerFailure {
  type: 'error';
  message: string;
}

export type StepWorkerResponse = StepWorkerSuccess | StepWorkerFailure;

let ocInstance: any = null;

async function getOCCT(): Promise<any> {
  if (ocInstance) return ocInstance;
  ocInstance = await initOpenCascade();
  return ocInstance;
}

/** Apply a column-major 4x4 matrix to an OCCT shape via gp_Trsf. */
function transformShape(oc: any, shape: any, matrix: number[]): any {
  // gp_Trsf only supports affine transforms (translation + rotation + uniform-ish scale).
  // Extract translation + rotation from the matrix.
  const trsf = new oc.gp_Trsf();

  const tx = matrix[12];
  const ty = matrix[13];
  const tz = matrix[14];

  // Build rotation quaternion from the 3x3 upper-left.
  const m00 = matrix[0], m02 = matrix[8];
  const m10 = matrix[1], m12 = matrix[9];
  const m20 = matrix[2], m22 = matrix[10];

  // Use gp_Trsf.SetTransformation with a gp_Ax3 (origin + Z axis + X axis).
  const origin = new oc.gp_Pnt(tx, ty, tz);
  const zAxis = new oc.gp_Dir(m02, m12, m22);
  const xAxis = new oc.gp_Dir(m00, m10, m20);
  const ax3 = new oc.gp_Ax3(origin, zAxis, xAxis);
  trsf.SetTransformation_1(ax3);
  trsf.SetTranslationPart(new oc.gp_Vec(tx, ty, tz));

  const transform = new oc.BRepBuilderAPI_Transform(trsf, true);
  transform.Perform(shape, true);
  return transform.ModifiedShape(shape);
}

/** Build a single OCCT shape from a StepShapePayload. */
function buildShape(oc: any, payload: StepShapePayload): any {
  switch (payload.type) {
    case 'box': {
      const maker = new oc.BRepPrimAPI_MakeBox(
        payload.dimensions.x,
        payload.dimensions.y,
        payload.dimensions.z,
      );
      const shape = maker.Shape();
      maker.delete();
      return shape;
    }
    case 'cylinder':
    case 'capsule': {
      const radius = Math.max(payload.dimensions.x, 1e-6);
      const length = Math.max(payload.dimensions.y, 1e-6);
      // OCCT cylinder is along Z axis by default, matching URDF convention.
      const maker = new oc.BRepPrimAPI_MakeCylinder(radius, length);
      const shape = maker.Shape();
      maker.delete();
      return shape;
    }
    case 'sphere': {
      const radius = Math.max(payload.dimensions.x, 1e-6);
      const maker = new oc.BRepPrimAPI_MakeSphere(radius);
      const shape = maker.Shape();
      maker.delete();
      return shape;
    }
    case 'mesh': {
      return buildMeshShape(oc, payload.positions ?? []);
    }
    default:
      return null;
  }
}

/** Build a shell from triangle vertex data using BRepBuilderAPI_MakePolygon. */
function buildMeshShape(oc: any, positions: number[]): any {
  const triangleCount = Math.floor(positions.length / 9);
  if (triangleCount === 0) return null;

  const builder = new oc.BRep_Builder();
  const compound = new oc.TopoDS_Compound();
  builder.MakeCompounding(compound);

  for (let t = 0; t < triangleCount; t++) {
    const base = t * 9;
    const polygon = new oc.BRepBuilderAPI_MakePolygon();
    polygon.Add(new oc.gp_Pnt(positions[base], positions[base + 1], positions[base + 2]));
    polygon.Add(new oc.gp_Pnt(positions[base + 3], positions[base + 4], positions[base + 5]));
    polygon.Add(new oc.gp_Pnt(positions[base + 6], positions[base + 7], positions[base + 8]));
    polygon.Close();
    const wire = polygon.Wire();
    if (wire && !wire.IsNull()) {
      const faceMaker = new oc.BRepBuilderAPI_MakeFace_2(wire, false);
      const face = faceMaker.Face();
      if (face && !face.IsNull()) {
        builder.Add(compound, face);
      }
      faceMaker.delete();
    }
    polygon.delete();
  }

  return compound;
}

/** Fuse two shapes into one; returns the first if the second is null. */
function fuseShapes(oc: any, acc: any, shape: any): any {
  if (!acc) return shape;
  if (!shape) return acc;
  const fuse = new oc.BRepAlgoAPI_Fuse(acc, shape);
  const result = fuse.Shape();
  fuse.delete();
  return result;
}

async function handleBuild(
  request: StepWorkerRequest,
): Promise<StepWorkerSuccess> {
  const oc = await getOCCT();

  let rootShape: any = null;
  let shapeCount = 0;
  let linkCount = 0;

  for (const link of request.links) {
    if (link.shapes.length === 0) continue;

    let linkShape: any = null;
    for (const shapePayload of link.shapes) {
      const rawShape = buildShape(oc, shapePayload);
      if (!rawShape || rawShape.IsNull?.()) continue;
      const placedShape = transformShape(oc, rawShape, shapePayload.matrix);
      linkShape = fuseShapes(oc, linkShape, placedShape);
      shapeCount++;
    }

    if (linkShape && !linkShape.IsNull?.()) {
      rootShape = fuseShapes(oc, rootShape, linkShape);
      linkCount++;
    }
  }

  if (!rootShape || rootShape.IsNull?.()) {
    throw new Error('No geometry shapes were generated for STEP export.');
  }

  // Write STEP file into the Emscripten virtual filesystem.
  const writer = new oc.STEPControl_Writer();
  const transferMode = oc.STEPControl_AsIs;
  writer.Transfer(rootShape, transferMode);

  const tempFile = `/tmp/${request.robotName || 'robot'}.step`;
  writer.Write(tempFile);
  writer.delete();

  const data = oc.FS.readFile(tempFile) as Uint8Array;
  try {
    oc.FS.unlink(tempFile);
  } catch {
    // Ignore cleanup errors.
  }

  return {
    type: 'done',
    data,
    linkCount,
    shapeCount,
  };
}

self.addEventListener('message', async (event: MessageEvent<StepWorkerRequest>) => {
  const request = event.data;
  if (!request || request.type !== 'build') return;

  try {
    const result = await handleBuild(request);
    (self as any).postMessage(result, { transfer: [result.data.buffer] });
  } catch (error) {
    const response: StepWorkerFailure = {
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    };
    (self as any).postMessage(response);
  }
});

export {};
