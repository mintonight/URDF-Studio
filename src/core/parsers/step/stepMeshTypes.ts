/**
 * STEP mesh export types shared between the provider, generator, worker, and UI.
 */

export type StepMeshMode = 'lightweight' | 'cad-repair';
export type StepMeshPreset = 'small' | 'balanced' | 'high';
export type StepMeshOutputKind = 'ap242-tessellated' | 'sewn-shell' | 'repaired-solid';

/** Indexed mesh geometry: flat vertex array + triangle index array. */
export interface StepIndexedMesh {
  vertices: number[];
  indices: number[];
}

/** Per-mesh diagnostics reported back to the UI. */
export interface StepMeshDiagnostics {
  linkId: string;
  linkName: string;
  meshPath: string;
  inputTriangles: number;
  outputTriangles: number;
  weldedVertices: number;
  removedNonFiniteTriangles: number;
  removedDegenerateTriangles: number;
  removedDuplicateTriangles: number;
  connectedComponents: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  sewnShells: number;
  solids: number;
  outputKind: StepMeshOutputKind;
  elapsedMs: number;
  warnings: string[];
}
