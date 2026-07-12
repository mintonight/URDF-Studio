/**
 * STEP export worker — runs the OpenCascade.js WASM CAD kernel off the main
 * thread. Receives link geometry payloads, builds analytic solids and mesh
 * shells, places each at its full world transform (rotation + translation),
 * collects them into a TopoDS_Compound (no boolean fuses), and writes a
 * spec-compliant STEP file via STEPControl_Writer.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Import the Emscripten glue and the WASM binary URL directly from the dist
// folder with an explicit `?url` suffix so Vite serves the binary as a static
// asset. Going through opencascade.js/index.js triggers Vite's unsupported ESM
// WASM integration handling.
import openCascadeFactory from 'opencascade.js/dist/opencascade.wasm.js';
import openCascadeWasmUrl from 'opencascade.js/dist/opencascade.wasm.wasm?url';

import { isDegenerateTriangle } from './stepOcctUtils';
import { shouldUseAnalyticReconstruction, isAnalyticSurfaceEnabled } from './stepReconstructionFeatureGate';

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
  /** Experimental flag — never derived from meshMode. Defaults to false. */
  experimentalAnalyticReconstruction?: boolean;
}

export interface StepWorkerSuccess {
  type: 'done';
  data: Uint8Array;
  linkCount: number;
  shapeCount: number;
  warnings: string[];
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

// ---------------------------------------------------------------------------
// Verified OCCT constructor helpers (discovered via runtime probing).
// ---------------------------------------------------------------------------

function makePnt(oc: any, x: number, y: number, z: number): any {
  return new oc.gp_Pnt_3(x, y, z);
}

function makeVec(oc: any, x: number, y: number, z: number): any {
  const xyz = new oc.gp_XYZ_2(x, y, z);
  try {
    return new oc.gp_Vec_3(xyz);
  } finally {
    xyz.delete();
  }
}

// ---------------------------------------------------------------------------
// Transform: full rotation + translation from a column-major 4×4 matrix.
// ---------------------------------------------------------------------------

/**
 * Apply a column-major 4×4 rigid transform to an OCCT shape.
 */
function transformShape(oc: any, shape: any, matrix: number[]): any {
  validateRigidTransform(matrix);
  const trsf = new oc.gp_Trsf_1();
  try {
    // SetValues accepts the three matrix rows (12 scalar arguments). The
    // payload is column-major, so transpose the storage indexing here.
    trsf.SetValues(
      matrix[0], matrix[4], matrix[8], matrix[12],
      matrix[1], matrix[5], matrix[9], matrix[13],
      matrix[2], matrix[6], matrix[10], matrix[14],
    );
    const transform = new oc.BRepBuilderAPI_Transform_2(shape, trsf, true);
    try {
      return transform.ModifiedShape(shape);
    } finally {
      transform.delete();
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`OpenCascade shape transform failed for a 3x4 transform: ${detail}`);
  } finally {
    trsf.delete();
  }
}

function validateRigidTransform(matrix: number[]): void {
  if (matrix.length !== 16 || matrix.some((value) => !Number.isFinite(value))) {
    throw new Error('STEP shape transform must contain exactly 16 finite numbers.');
  }
  const epsilon = 1e-6;
  if (
    Math.abs(matrix[3]) > epsilon ||
    Math.abs(matrix[7]) > epsilon ||
    Math.abs(matrix[11]) > epsilon ||
    Math.abs(matrix[15] - 1) > epsilon
  ) {
    throw new Error('STEP shape transform must be affine with bottom row [0, 0, 0, 1].');
  }

  const columns = [
    [matrix[0], matrix[1], matrix[2]],
    [matrix[4], matrix[5], matrix[6]],
    [matrix[8], matrix[9], matrix[10]],
  ];
  const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (
    columns.some((column) => Math.abs(dot(column, column) - 1) > epsilon) ||
    Math.abs(dot(columns[0], columns[1])) > epsilon ||
    Math.abs(dot(columns[0], columns[2])) > epsilon ||
    Math.abs(dot(columns[1], columns[2])) > epsilon
  ) {
    throw new Error('STEP shape transform rotation must be orthonormal (scale and shear are unsupported).');
  }
  const determinant =
    columns[0][0] * (columns[1][1] * columns[2][2] - columns[1][2] * columns[2][1]) -
    columns[1][0] * (columns[0][1] * columns[2][2] - columns[0][2] * columns[2][1]) +
    columns[2][0] * (columns[0][1] * columns[1][2] - columns[0][2] * columns[1][1]);
  if (Math.abs(determinant - 1) > epsilon) {
    throw new Error('STEP shape transform rotation must be right-handed with determinant 1.');
  }
}

// ---------------------------------------------------------------------------
// Primitive builders — each returns a TopoDS_Shape centered at the URDF origin.
// ---------------------------------------------------------------------------

/** Build a box centered at origin with full dimensions (dx, dy, dz). */
function buildBox(oc: any, dx: number, dy: number, dz: number): any {
  // BRepPrimAPI_MakeBox_1(dx,dy,dz) builds a box with one corner at origin.
  const maker = new oc.BRepPrimAPI_MakeBox_1(dx, dy, dz);
  let shape: any = null;
  let centerTrsf: any = null;
  let centerTransform: any = null;
  let offset: any = null;
  try {
    shape = maker.Shape();
    centerTrsf = new oc.gp_Trsf_1();
    offset = makeVec(oc, -dx / 2, -dy / 2, -dz / 2);
    centerTrsf.SetTranslationPart(offset);
    centerTransform = new oc.BRepBuilderAPI_Transform_2(shape, centerTrsf, true);
    return centerTransform.ModifiedShape(shape);
  } finally {
    offset?.delete?.();
    centerTransform?.delete?.();
    centerTrsf?.delete?.();
    shape?.delete?.();
    maker.delete();
  }
}

/** Build a cylinder centered at origin, axis along Z, full length. */
function buildCylinder(oc: any, radius: number, length: number): any {
  // BRepPrimAPI_MakeCylinder_1(R,H) — base at z=0, extends +Z.
  const maker = new oc.BRepPrimAPI_MakeCylinder_1(radius, length);
  let shape: any = null;
  let centerTrsf: any = null;
  let centerTransform: any = null;
  let offset: any = null;
  try {
    shape = maker.Shape();
    centerTrsf = new oc.gp_Trsf_1();
    offset = makeVec(oc, 0, 0, -length / 2);
    centerTrsf.SetTranslationPart(offset);
    centerTransform = new oc.BRepBuilderAPI_Transform_2(shape, centerTrsf, true);
    return centerTransform.ModifiedShape(shape);
  } finally {
    offset?.delete?.();
    centerTransform?.delete?.();
    centerTrsf?.delete?.();
    shape?.delete?.();
    maker.delete();
  }
}

/** Build a sphere centered at origin. */
function buildSphere(oc: any, radius: number): any {
  // BRepPrimAPI_MakeSphere_1(R) — already centered at origin.
  const maker = new oc.BRepPrimAPI_MakeSphere_1(radius);
  try {
    return maker.Shape();
  } finally {
    maker.delete();
  }
}

// ---------------------------------------------------------------------------
// Mesh shell builder — each triangle becomes a real face.
// ---------------------------------------------------------------------------

/**
 * Build a compound of closed-polygon shapes from triangle vertex data.
 * BRepBuilderAPI_MakeFace is unavailable on this OCCT build, so each closed
 * 3-point polygon's .Shape() is used directly — it produces a wire-based shape
 * that STEPControl_Writer can serialize. Degenerate triangles are skipped.
 */
function buildMeshShape(oc: any, positions: number[]): { shape: any; skipped: number } | null {
  const triangleCount = Math.floor(positions.length / 9);
  if (triangleCount === 0) return null;

  let builder: any = null;
  let compound: any = null;
  let keepCompound = false;
  try {
    builder = new oc.BRep_Builder();
    compound = new oc.TopoDS_Compound();
    builder.MakeCompound(compound);
    let valid = 0;
    let skipped = 0;

    for (let t = 0; t < triangleCount; t++) {
      const base = t * 9;
      const coordinates = positions.slice(base, base + 9);
      if (isDegenerateTriangle(coordinates)) {
        skipped++;
        continue;
      }

      const points: any[] = [];
      let polygon: any = null;
      let wire: any = null;
      let faceMaker: any = null;
      let triangleShape: any = null;
      try {
        for (let point = 0; point < 3; point++) {
          const offset = point * 3;
          points.push(makePnt(
            oc,
            coordinates[offset],
            coordinates[offset + 1],
            coordinates[offset + 2],
          ));
        }
        polygon = new oc.BRepBuilderAPI_MakePolygon_1();
        points.forEach((point) => polygon.Add_1(point));
        polygon.Close();
        wire = polygon.Wire();
        // _15 is BRepBuilderAPI_MakeFace(const TopoDS_Wire&, OnlyPlane).
        // Each triangle must be a real face; exporting the closed wire alone
        // produces only STEP edges and loses the mesh surface.
        faceMaker = new oc.BRepBuilderAPI_MakeFace_15(wire, true);
        if (!faceMaker.IsDone()) continue;
        triangleShape = faceMaker.Face();
        if (triangleShape && !triangleShape.IsNull()) {
          builder.Add(compound, triangleShape);
          valid++;
        }
      } finally {
        triangleShape?.delete?.();
        faceMaker?.delete?.();
        wire?.delete?.();
        polygon?.delete?.();
        points.forEach((point) => point.delete?.());
      }
    }

    if (valid === 0) return null;
    keepCompound = true;
    return { shape: compound, skipped };
  } finally {
    builder?.delete?.();
    if (!keepCompound) compound?.delete?.();
  }
}

// ---------------------------------------------------------------------------
// Main build: collect all shapes into one TopoDS_Compound, write STEP.
// ---------------------------------------------------------------------------

async function handleBuild(
  request: StepWorkerRequest,
): Promise<StepWorkerSuccess> {
  const oc = await getOCCT();
  const warnings: string[] = [];

  // Root compound collects every link's shapes — no boolean fuses.
  let rootBuilder: any = null;
  let rootCompound: any = null;
  let writer: any = null;
  let tempFile: string | null = null;
  const newMemfsPaths: string[] = [];
  let shapeCount = 0;
  let linkCount = 0;
  try {
    rootBuilder = new oc.BRep_Builder();
    rootCompound = new oc.TopoDS_Compound();
    rootBuilder.MakeCompound(rootCompound);

  for (const link of request.links) {
    if (link.shapes.length === 0) continue;

    let linkAddedAny = false;
    for (const shapePayload of link.shapes) {
      let rawShape: any = null;
      switch (shapePayload.type) {
        case 'box':
          rawShape = buildBox(oc, shapePayload.dimensions.x, shapePayload.dimensions.y, shapePayload.dimensions.z);
          break;
        case 'cylinder':
        case 'capsule': {
          const radius = Math.max(shapePayload.dimensions.x, 1e-6);
          const length = Math.max(shapePayload.dimensions.y, 1e-6);
          rawShape = buildCylinder(oc, radius, length);
          if (shapePayload.type === 'capsule') {
            warnings.push(`Link "${link.linkName}" has a capsule visual; exported as cylinder (hemispherical caps not supported).`);
          }
          break;
        }
        case 'sphere': {
          const radius = Math.max(shapePayload.dimensions.x, 1e-6);
          rawShape = buildSphere(oc, radius);
          break;
        }
        case 'mesh': {
          const positions = shapePayload.positions ?? [];

          if (shouldUseAnalyticReconstruction(request.experimentalAnalyticReconstruction)) {
            // Analytic reconstruction path. The feature gate only admits OCCT
            // builders that have passed real STEP transfer tests; all other
            // surfaces retain the bounded faceted fallback.
            const { prepareStepMeshTopology } = await import('./stepMeshTopology');
            const { analyzeMeshTopology } = await import('./stepMeshAnalysis');
            const { checkResourceLimits } = await import('./stepFallbackBudget');
            const { computeTolerances } = await import('./stepMeshRegionTypes');
            const { growPlanarRegions } = await import('./stepRegionGrowing');
            const { reconstructSurfaces } = await import('./stepSurfaceReconstruction');
            const { extractRegionBoundary } = await import('./stepRegionBoundary');
            const { buildOcctPlanarRegionFace, buildOcctTriangleFace } = await import('./stepOcctFaceFactory');
            const { buildOcctCylindricalRegionFace } = await import('./stepOcctAnalyticFaceFactory');
            const { allocateFallbackBudget } = await import('./stepFallbackBudget');
            const { simplifyStepMesh } = await import('./stepMeshSimplifier');

            const prepared = prepareStepMeshTopology({ vertices: positions });
            if (prepared.mesh.indices.length === 0) {
              warnings.push(`Link "${link.linkName}" mesh had no valid triangles after cleanup; skipped.`);
              continue;
            }

            const triangleCount = prepared.mesh.indices.length / 3;
            // Resource limit violations throw — never fall back to raw mesh export.
            checkResourceLimits({ inputTriangles: triangleCount, candidateRegions: 1 });

            const analysis = analyzeMeshTopology(prepared);
            const tolerances = computeTolerances(analysis.diagonal);
            const grown = growPlanarRegions(prepared, analysis, tolerances);
            const regions = reconstructSurfaces(prepared, analysis, grown, tolerances);

            // Separate verified analytic surfaces from fallback regions.
            const analyticRegions = regions.filter(
              (r) => r.accepted && isAnalyticSurfaceEnabled(r.type),
            );
            const fallbackRegions = regions.filter(
              (r) => !r.accepted || !isAnalyticSurfaceEnabled(r.type),
            );

            // Allocate fallback budget. Omitted regions fail closed — never export
            // an incomplete mesh silently.
            const fallbackInfos = fallbackRegions.map((r) => ({
              regionId: r.id,
              triangleCount: r.triangleIds.length,
              area: r.quality.coveredArea,
            }));
            const budgetResult = allocateFallbackBudget(fallbackInfos);
            if (budgetResult.omittedRegions.length > 0) {
              throw new Error(
                `STEP faceted fallback cannot retain all regions within 5000 triangles; omitted regions: ${budgetResult.omittedRegions.join(', ')}`,
              );
            }
            const budget = budgetResult.budgets;

            // Build OCCT faces.
            const meshBuilder = new oc.BRep_Builder();
            const meshCompound = new oc.TopoDS_Compound();
            meshBuilder.MakeCompound(meshCompound);

            let analyticCount = 0;
            let fallbackCount = 0;

            // Accepted analytic regions: build one verified OCCT face when the
            // corresponding factory can preserve the source region safely.
            for (const region of analyticRegions) {
              if (region.type === 'cylinder') {
                const cylinderFace = buildOcctCylindricalRegionFace(
                  oc,
                  prepared.mesh.vertices,
                  prepared.mesh.indices,
                  region,
                  tolerances.baseDistance,
                );
                if (cylinderFace) {
                  meshBuilder.Add(meshCompound, cylinderFace.shape);
                  (cylinderFace.shape as { delete?: () => void }).delete?.();
                  analyticCount++;
                  continue;
                }
                // Unsafe partial cylinders fall back to real triangle faces;
                // they must never be passed to the planar boundary factory.
                for (const tId of region.triangleIds) {
                  const a = prepared.mesh.indices[tId * 3] * 3;
                  const b = prepared.mesh.indices[tId * 3 + 1] * 3;
                  const c = prepared.mesh.indices[tId * 3 + 2] * 3;
                  const fallbackFace = buildOcctTriangleFace(oc, [
                    prepared.mesh.vertices[a], prepared.mesh.vertices[a + 1], prepared.mesh.vertices[a + 2],
                    prepared.mesh.vertices[b], prepared.mesh.vertices[b + 1], prepared.mesh.vertices[b + 2],
                    prepared.mesh.vertices[c], prepared.mesh.vertices[c + 1], prepared.mesh.vertices[c + 2],
                  ]);
                  if (fallbackFace) {
                    meshBuilder.Add(meshCompound, fallbackFace.shape);
                    (fallbackFace.shape as { delete?: () => void }).delete?.();
                    fallbackCount++;
                  }
                }
                continue;
              }
              const boundaryResult = extractRegionBoundary(
                prepared.mesh.indices,
                region.triangleIds,
              );
              if (!boundaryResult.ok) {
                // Boundary extraction failed — route entire region to faceted fallback.
                for (const tId of region.triangleIds) {
                  const a = prepared.mesh.indices[tId * 3] * 3;
                  const b = prepared.mesh.indices[tId * 3 + 1] * 3;
                  const c = prepared.mesh.indices[tId * 3 + 2] * 3;
                  const faceResult = buildOcctTriangleFace(oc, [
                    prepared.mesh.vertices[a], prepared.mesh.vertices[a + 1], prepared.mesh.vertices[a + 2],
                    prepared.mesh.vertices[b], prepared.mesh.vertices[b + 1], prepared.mesh.vertices[b + 2],
                    prepared.mesh.vertices[c], prepared.mesh.vertices[c + 1], prepared.mesh.vertices[c + 2],
                  ]);
                  if (faceResult) {
                    meshBuilder.Add(meshCompound, faceResult.shape);
                    fallbackCount++;
                  }
                }
                continue;
              }

              const faceResult = buildOcctPlanarRegionFace(
                oc,
                prepared.mesh.vertices,
                boundaryResult.boundary,
              );
              if (faceResult) {
                meshBuilder.Add(meshCompound, faceResult.shape);
                analyticCount++;
              } else {
                // Face construction failed — route to faceted fallback.
                for (const tId of region.triangleIds) {
                  const a = prepared.mesh.indices[tId * 3] * 3;
                  const b = prepared.mesh.indices[tId * 3 + 1] * 3;
                  const c = prepared.mesh.indices[tId * 3 + 2] * 3;
                  const faceResult2 = buildOcctTriangleFace(oc, [
                    prepared.mesh.vertices[a], prepared.mesh.vertices[a + 1], prepared.mesh.vertices[a + 2],
                    prepared.mesh.vertices[b], prepared.mesh.vertices[b + 1], prepared.mesh.vertices[b + 2],
                    prepared.mesh.vertices[c], prepared.mesh.vertices[c + 1], prepared.mesh.vertices[c + 2],
                  ]);
                  if (faceResult2) {
                    meshBuilder.Add(meshCompound, faceResult2.shape);
                    fallbackCount++;
                  }
                }
              }
            }

            // Fallback regions: simplify to budget, then per-triangle faces.
            for (const region of fallbackRegions) {
              const regionBudget = budget[region.id];
              if (regionBudget === undefined || regionBudget <= 0) continue;

              // Build a sub-mesh for this region (indexed).
              const regionVertices: number[] = [];
              const regionIndices: number[] = [];
              const vertexMap = new Map<number, number>();
              for (const tId of region.triangleIds) {
                for (let j = 0; j < 3; j++) {
                  const srcIdx = prepared.mesh.indices[tId * 3 + j];
                  let newIdx = vertexMap.get(srcIdx);
                  if (newIdx === undefined) {
                    newIdx = regionVertices.length / 3;
                    vertexMap.set(srcIdx, newIdx);
                    regionVertices.push(
                      prepared.mesh.vertices[srcIdx * 3],
                      prepared.mesh.vertices[srcIdx * 3 + 1],
                      prepared.mesh.vertices[srcIdx * 3 + 2],
                    );
                  }
                  regionIndices.push(newIdx);
                }
              }

              let regionPrepared = prepareStepMeshTopology({
                vertices: regionVertices,
                indices: regionIndices,
              });
              if (regionPrepared.mesh.indices.length / 3 > regionBudget) {
                const simplified = simplifyStepMesh(regionPrepared, regionBudget);
                regionPrepared = simplified.mesh;
              }

              for (let t = 0; t < regionPrepared.mesh.indices.length / 3; t++) {
                const a = regionPrepared.mesh.indices[t * 3] * 3;
                const b = regionPrepared.mesh.indices[t * 3 + 1] * 3;
                const c = regionPrepared.mesh.indices[t * 3 + 2] * 3;
                const faceResult = buildOcctTriangleFace(oc, [
                  regionPrepared.mesh.vertices[a], regionPrepared.mesh.vertices[a + 1], regionPrepared.mesh.vertices[a + 2],
                  regionPrepared.mesh.vertices[b], regionPrepared.mesh.vertices[b + 1], regionPrepared.mesh.vertices[b + 2],
                  regionPrepared.mesh.vertices[c], regionPrepared.mesh.vertices[c + 1], regionPrepared.mesh.vertices[c + 2],
                ]);
                if (faceResult) {
                  meshBuilder.Add(meshCompound, faceResult.shape);
                  fallbackCount++;
                }
              }
            }

            if (analyticCount > 0 || fallbackCount > 0) {
              warnings.push(
                `Link "${link.linkName}" reconstructed ${analyticCount} analytic face(s), ${fallbackCount} faceted fallback triangle(s).`,
              );
            }
            rawShape = meshCompound;
          } else {
            // Default verified path: per-triangle faces via BRepBuilderAPI_MakeFace_15.
            const meshResult = buildMeshShape(oc, positions);
            if (!meshResult) {
              warnings.push(`Link "${link.linkName}" mesh had no valid triangles; skipped.`);
              continue;
            }
            if (meshResult.skipped > 0) {
              warnings.push(`Link "${link.linkName}" mesh skipped ${meshResult.skipped} degenerate triangle(s).`);
            }
            rawShape = meshResult.shape;
          }
          break;
        }
        default:
          break;
      }

      if (!rawShape || rawShape.IsNull?.()) {
        rawShape?.delete?.();
        continue;
      }

      let placedShape: any = null;
      try {
        placedShape = transformShape(oc, rawShape, shapePayload.matrix);
        rootBuilder.Add(rootCompound, placedShape);
        shapeCount++;
        linkAddedAny = true;
      } finally {
        placedShape?.delete?.();
        rawShape.delete?.();
      }
    }

    if (linkAddedAny) {
      linkCount++;
    }
  }

  if (shapeCount === 0) {
    throw new Error('No geometry shapes were generated for STEP export.');
  }

  // Write STEP file into the Emscripten virtual filesystem.
  writer = new oc.STEPControl_Writer_1();
  // Both calls return an embind IFSelect_ReturnStatus enum object. A successful
  // operation is IFSelect_RetDone (value 1), not value 0 (IFSelect_RetVoid).
  const retDone = oc.IFSelect_ReturnStatus.IFSelect_RetDone.value;
  const transferStatus = writer.Transfer(rootCompound, 0, true);
  if (transferStatus?.value !== retDone) {
    throw new Error(`STEP Transfer failed with IFSelect status ${String(transferStatus?.value)}.`);
  }

  tempFile = `/${request.robotName || 'robot'}.step`;
  // opencascade.js autobind 1.1.1 incorrectly reinterpret_casts Write's
  // Standard_CString parameter to std::string instead of forwarding c_str().
  // The call succeeds but may create a file with a corrupted name. Snapshot
  // MEMFS so that exact newly-created file can be normalized afterwards.
  const filesBeforeWrite = new Set<string>(oc.FS.readdir('/'));
  const writeStatus = writer.Write(tempFile);
  if (writeStatus?.value !== retDone) {
    throw new Error(`STEP Write failed with IFSelect status ${String(writeStatus?.value)}.`);
  }

  newMemfsPaths.push(...(oc.FS.readdir('/') as string[])
    .filter((name) => !filesBeforeWrite.has(name) && name !== '.' && name !== '..')
    .map((name) => `/${name}`));

  if (!oc.FS.analyzePath(tempFile).exists) {
    if (newMemfsPaths.length !== 1) {
      throw new Error(
        `STEP Write returned Done but did not create the expected MEMFS file; found ${newMemfsPaths.length} new files.`,
      );
    }
    oc.FS.rename(newMemfsPaths[0], tempFile);
    newMemfsPaths[0] = tempFile;
  }

  const data = oc.FS.readFile(tempFile) as Uint8Array;

  return {
    type: 'done',
    data,
    linkCount,
    shapeCount,
    warnings,
  };
  } finally {
    if (tempFile && oc.FS.analyzePath(tempFile).exists) {
      try {
        oc.FS.unlink(tempFile);
      } catch {
        // Best-effort cleanup after preserving the primary export error.
      }
    }
    for (const path of newMemfsPaths) {
      if (path !== tempFile && oc.FS.analyzePath(path).exists) {
        try {
          oc.FS.unlink(path);
        } catch {
          // Best-effort cleanup after preserving the primary export error.
        }
      }
    }
    writer?.delete?.();
    rootCompound?.delete?.();
    rootBuilder?.delete?.();
  }
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
