import test from 'node:test';
import assert from 'node:assert/strict';

import type { StepOcctMeshBuildInput, StepOcctMeshBuildResult } from './stepOcctMeshBuilder';
import type { StepMeshDiagnostics, StepMeshOutputKind } from './stepMeshTypes';

test('StepOcctMeshBuildInput has required fields', () => {
  const input: StepOcctMeshBuildInput = {
    prepared: {
      mesh: { vertices: [], indices: [] },
      components: [],
      boundaryVertices: [],
      weldTolerance: 1e-7,
      stats: {
        inputTriangles: 0,
        weldedVertices: 0,
        removedNonFiniteTriangles: 0,
        removedDegenerateTriangles: 0,
        removedDuplicateTriangles: 0,
        connectedComponents: 0,
        boundaryEdges: 0,
        nonManifoldEdges: 0,
      },
    },
    mode: 'lightweight',
    linkId: 'base',
    linkName: 'base',
    meshPath: 'meshes/base.stl',
  };
  assert.equal(input.mode, 'lightweight');
  assert.equal(input.linkId, 'base');
});

test('StepMeshDiagnostics covers all required fields', () => {
  const diag: StepMeshDiagnostics = {
    linkId: 'base',
    linkName: 'base',
    meshPath: 'test.stl',
    inputTriangles: 100,
    outputTriangles: 50,
    weldedVertices: 30,
    removedNonFiniteTriangles: 1,
    removedDegenerateTriangles: 2,
    removedDuplicateTriangles: 3,
    connectedComponents: 1,
    boundaryEdges: 0,
    nonManifoldEdges: 0,
    sewnShells: 1,
    solids: 0,
    outputKind: 'sewn-shell' as StepMeshOutputKind,
    elapsedMs: 42,
    warnings: [],
  };
  assert.equal(diag.outputKind, 'sewn-shell');
  assert.equal(diag.inputTriangles, 100);
  assert.equal(diag.outputTriangles, 50);
});

test('StepOcctMeshBuildResult exposes shape and diagnostics', () => {
  const result: StepOcctMeshBuildResult = {
    shape: null,
    diagnostics: {
      linkId: 'base',
      linkName: 'base',
      meshPath: 'test.stl',
      inputTriangles: 0,
      outputTriangles: 0,
      weldedVertices: 0,
      removedNonFiniteTriangles: 0,
      removedDegenerateTriangles: 0,
      removedDuplicateTriangles: 0,
      connectedComponents: 0,
      boundaryEdges: 0,
      nonManifoldEdges: 0,
      sewnShells: 0,
      solids: 0,
      outputKind: 'sewn-shell',
      elapsedMs: 0,
      warnings: [],
    },
  };
  assert.equal(result.shape, null);
  assert.equal(result.diagnostics.linkId, 'base');
});
