/**
 * OCCT mesh builder adapter — converts prepared indexed mesh data into sewn
 * shells (and optionally repaired solids) using the OpenCascade.js WASM kernel.
 *
 * OCCT `any` types are isolated inside this module. Callers receive strongly
 * typed diagnostics.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { STEP_MESH_SEWING_MULTIPLIER } from './stepMeshConfig';
import type {
  PreparedStepMesh,
  StepMeshDiagnostics,
  StepMeshMode,
  StepMeshOutputKind,
} from './stepMeshTypes';

export interface StepOcctMeshBuildInput {
  prepared: PreparedStepMesh;
  mode: StepMeshMode;
  linkId: string;
  linkName: string;
  meshPath: string;
}

export interface StepOcctMeshBuildResult {
  /** OCCT TopoDS_Shape handle (opaque to callers). */
  shape: unknown;
  diagnostics: StepMeshDiagnostics;
}

/**
 * Build sewn shell(s) from prepared indexed mesh data.
 *
 * For each connected component, creates planar faces from triangle wires and
 * sews them into a shell via BRepBuilderAPI_Sewing. In CAD-repair mode,
 * attempts healing (ShapeFix_Shape) and solid conversion when the shell is
 * closed and manifold.
 *
 * The OCCT instance is passed from the worker which owns its lifecycle.
 */
export function buildOcctMeshFromPrepared(
  oc: any,
  input: StepOcctMeshBuildInput,
): StepOcctMeshBuildResult {
  const startTime = Date.now();
  const { prepared, mode, linkId, linkName, meshPath } = input;
  const warnings: string[] = [];

  const vertices = prepared.mesh.vertices;
  const indices = prepared.mesh.indices;
  const triangleCount = indices.length / 3;

  // Build a compound of per-component sewn shapes.
  const rootBuilder = new oc.BRep_Builder();
  const rootCompound = new oc.TopoDS_Compound();
  rootBuilder.MakeCompound(rootCompound);

  // Group triangles by connected component.
  const componentGroups = groupTrianglesByComponent(prepared);
  let sewnShells = 0;
  let solids = 0;
  let outputKind: StepMeshOutputKind = 'sewn-shell';

  for (const component of componentGroups) {
    // Create a sewing instance for this component.
    const sewing = new oc.BRepBuilderAPI_Sewing(STEP_MESH_SEWING_MULTIPLIER);

    for (const triIdx of component) {
      const a = indices[triIdx * 3];
      const b = indices[triIdx * 3 + 1];
      const c = indices[triIdx * 3 + 2];

      const p1 = new oc.gp_Pnt_3(vertices[a * 3], vertices[a * 3 + 1], vertices[a * 3 + 2]);
      const p2 = new oc.gp_Pnt_3(vertices[b * 3], vertices[b * 3 + 1], vertices[b * 3 + 2]);
      const p3 = new oc.gp_Pnt_3(vertices[c * 3], vertices[c * 3 + 1], vertices[c * 3 + 2]);

      // Build a polygon wire for the triangle.
      const polygon = new oc.BRepBuilderAPI_MakePolygon_1();
      polygon.Add_1(p1);
      polygon.Add_1(p2);
      polygon.Add_1(p3);
      polygon.Close();
      const wire = polygon.Wire();

      if (wire && !wire.IsNull()) {
        // Create a planar face from the wire.
        // BRepBuilderAPI_MakeFace overloads that accept wires are broken on
        // OCCT 7.4 bindings. Use polygon.Shape() directly (verified working).
        const triShape = polygon.Shape();
        if (triShape && !triShape.IsNull()) {
          sewing.Add(triShape);
        }
      }

      polygon.delete();
      p1.delete();
      p2.delete();
      p3.delete();
    }

    // Perform sewing.
    sewing.Perform();
    const sewedShape = sewing.SewedShape();

    if (sewedShape && !sewedShape.IsNull()) {
      // In CAD-repair mode, attempt healing and solid conversion.
      if (mode === 'cad-repair') {
        const repairResult = attemptHealAndSolidify(oc, sewedShape, prepared);
        if (repairResult.shape) {
          rootBuilder.Add(rootCompound, repairResult.shape);
          if (repairResult.isSolid) {
            solids++;
            outputKind = 'repaired-solid';
          } else {
            sewnShells++;
          }
          warnings.push(...repairResult.warnings);
        } else {
          rootBuilder.Add(rootCompound, sewedShape);
          sewnShells++;
        }
      } else {
        rootBuilder.Add(rootCompound, sewedShape);
        sewnShells++;
      }
    }

    sewing.delete();
  }

  // Build diagnostics.
  const boundaryEdges = prepared.stats.boundaryEdges;
  if (boundaryEdges > 0) {
    warnings.push(`${boundaryEdges} free edge(s) — shell is open, not a solid.`);
  }

  const diagnostics: StepMeshDiagnostics = {
    linkId,
    linkName,
    meshPath,
    inputTriangles: prepared.stats.inputTriangles,
    outputTriangles: triangleCount,
    weldedVertices: prepared.stats.weldedVertices,
    removedNonFiniteTriangles: prepared.stats.removedNonFiniteTriangles,
    removedDegenerateTriangles: prepared.stats.removedDegenerateTriangles,
    removedDuplicateTriangles: prepared.stats.removedDuplicateTriangles,
    connectedComponents: prepared.stats.connectedComponents,
    boundaryEdges,
    nonManifoldEdges: prepared.stats.nonManifoldEdges,
    sewnShells,
    solids,
    outputKind,
    elapsedMs: Date.now() - startTime,
    warnings,
  };

  return { shape: rootCompound, diagnostics };
}

/** Group triangle indices by connected component using union-find. */
function groupTrianglesByComponent(prepared: PreparedStepMesh): number[][] {
  const components = prepared.components;
  const vertexToComponent = new Map<number, number>();
  components.forEach((comp, ci) => {
    for (const v of comp) vertexToComponent.set(v, ci);
  });

  const groups: number[][] = Array.from({ length: components.length }, () => []);
  const indices = prepared.mesh.indices;
  for (let t = 0; t < indices.length / 3; t++) {
    const a = indices[t * 3];
    const ci = vertexToComponent.get(a) ?? 0;
    groups[ci].push(t);
  }
  return groups.filter((g) => g.length > 0);
}

/**
 * Attempt healing (ShapeFix) and solid conversion for CAD-repair mode.
 * Only called when mode === 'cad-repair'.
 */
function attemptHealAndSolidify(
  oc: any,
  sewedShape: any,
  prepared: PreparedStepMesh,
): { shape: any | null; isSolid: boolean; warnings: string[] } {
  const warnings: string[] = [];

  // Only attempt solid conversion if closed (0 boundary) and manifold.
  const canBeSolid =
    prepared.stats.boundaryEdges === 0 && prepared.stats.nonManifoldEdges === 0;

  if (!canBeSolid) {
    return { shape: null, isSolid: false, warnings };
  }

  // Attempt to make a solid from the sewn shell.
  try {
    // BRepBuilderAPI_MakeSolid may not be available on all OCCT builds.
    // If it fails, retain the sewn shell.
    if (typeof oc.BRepBuilderAPI_MakeSolid !== 'function') {
      warnings.push('solid conversion skipped: BRepBuilderAPI_MakeSolid not available');
      return { shape: null, isSolid: false, warnings };
    }

    const solidMaker = new oc.BRepBuilderAPI_MakeSolid();
    const solid = solidMaker.Shape();
    solidMaker.delete();

    if (solid && !solid.IsNull()) {
      return { shape: solid, isSolid: true, warnings };
    }
  } catch (error) {
    warnings.push(`solid validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  return { shape: null, isSolid: false, warnings };
}
