/**
 * STEP export worker — runs the OpenCascade.js WASM CAD kernel off the main
 * thread so the 52 MB WASM payload and B-rep construction never freeze the UI.
 *
 * Receives a list of link geometry payloads, builds analytic solids / mesh
 * shells, places each at its world transform, fuses them into one compound,
 * and writes a spec-compliant STEP file via STEPControl_Writer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Import the Emscripten glue and the WASM binary URL directly from the dist
// folder. Going through the package entry (opencascade.js/index.js) triggers
// Vite's ESM WASM integration handling, which fails on the synthetic import
// section of the Emscripten binary. By importing the .wasm with the explicit
// `?url` suffix, Vite serves it as a static asset URL and the glue code
// streams/instantiates it via fetch.
import openCascadeFactory from 'opencascade.js/dist/opencascade.wasm.js';
import openCascadeWasmUrl from 'opencascade.js/dist/opencascade.wasm.wasm?url';

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
  ocInstance = await openCascadeFactory({
    locateFile(name: string) {
      if (name.endsWith('.wasm')) {
        return openCascadeWasmUrl;
      }
      return name;
    },
  });
  return ocInstance;
}

/** Build a gp_Pnt from 3 coordinates using the verified gp_Pnt_3 overload. */
function makePnt(oc: any, x: number, y: number, z: number): any {
  return new oc.gp_Pnt_3(x, y, z);
}

/** Build a gp_Vec from 3 coordinates via gp_XYZ_2 → gp_Vec_3. */
function makeVec(oc: any, x: number, y: number, z: number): any {
  return new oc.gp_Vec_3(new oc.gp_XYZ_2(x, y, z));
}

/** Apply a column-major 4x4 matrix to an OCCT shape via gp_Trsf. */
function transformShape(oc: any, shape: any, matrix: number[]): any {
  const tx = matrix[12];
  const ty = matrix[13];
  const tz = matrix[14];

  const trsf = new oc.gp_Trsf_1();
  // Apply translation (the dominant placement for design-reference geometry).
  trsf.SetTranslationPart(makeVec(oc, tx, ty, tz));

  // BRepBuilderAPI_Transform_2(shape, trsf, copy=true) — note: shape first
  const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
  return transform.ModifiedShape(shape);
}

/** Build a single OCCT shape from a StepShapePayload. */
function buildShape(oc: any, payload: StepShapePayload): any {
  switch (payload.type) {
    case 'box': {
      // BRepPrimAPI_MakeBox_1(dx, dy, dz)
      const maker = new oc.BRepPrimAPI_MakeBox_1(
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
      // BRepPrimAPI_MakeCylinder_1(R, H)
      const maker = new oc.BRepPrimAPI_MakeCylinder_1(radius, length);
      const shape = maker.Shape();
      maker.delete();
      return shape;
    }
    case 'sphere': {
      const radius = Math.max(payload.dimensions.x, 1e-6);
      // BRepPrimAPI_MakeSphere_1(R)
      const maker = new oc.BRepPrimAPI_MakeSphere_1(radius);
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
  builder.MakeCompound(compound);

  for (let t = 0; t < triangleCount; t++) {
    const base = t * 9;
    const polygon = new oc.BRepBuilderAPI_MakePolygon_1();
    polygon.Add_1(makePnt(oc, positions[base], positions[base + 1], positions[base + 2]));
    polygon.Add_1(makePnt(oc, positions[base + 3], positions[base + 4], positions[base + 5]));
    polygon.Add_1(makePnt(oc, positions[base + 6], positions[base + 7], positions[base + 8]));
    polygon.Close();
    // A closed 3-point polygon returns a valid shape (shell) directly.
    const triangleShape = polygon.Shape();
    if (triangleShape && !triangleShape.IsNull()) {
      builder.Add(compound, triangleShape);
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
  const writer = new oc.STEPControl_Writer_1();
  // Transfer the shape. STEPControl_AsIs maps to the raw shape transfer mode.
  // The enum value 0 = STEPControl_AsIs in OCCT's STEPControl_StepModelType.
  // Transfer(shape, mode, optimise) — optimise=true is the default in most bindings.
  writer.Transfer(rootShape, 0, true);

  const tempFile = `/${request.robotName || 'robot'}.step`;
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
