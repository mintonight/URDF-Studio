import test from 'node:test';
import assert from 'node:assert/strict';

import { prepareStepMeshTopology } from './stepMeshTopology';

/** Helper: flat vertices → PreparedStepMesh. */
function prepareFlat(vertices: number[]) {
  return prepareStepMeshTopology({ vertices, indices: undefined });
}

test('welds duplicated vertices and rebuilds indices', () => {
  // Two triangles sharing an edge, with duplicated vertices.
  // Square: (0,0,0) (1,0,0) (1,1,0) (0,1,0)
  // Tri1: 0,1,2   Tri2: 0,2,3  — but each vertex listed twice (8 unique slots, 4 unique positions)
  const vertices = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, // tri1
    0, 0, 0, 1, 1, 0, 0, 1, 0, // tri2 (dup of 0, 2, 3)
  ];
  const result = prepareFlat(vertices);
  assert.equal(result.stats.inputTriangles, 2);
  assert.equal(result.stats.weldedVertices, 4, 'should weld 8 slots → 4 unique vertices');
  assert.equal(result.mesh.vertices.length, 4 * 3, '4 vertices × 3 coords');
  assert.equal(result.mesh.indices.length, 6, '2 triangles × 3 indices');
});

test('removes duplicate faces (forward and reverse)', () => {
  const vertices = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, // tri1
    0, 0, 0, 1, 0, 0, 1, 1, 0, // exact duplicate
    1, 1, 0, 1, 0, 0, 0, 0, 0, // reverse duplicate
  ];
  const result = prepareFlat(vertices);
  assert.equal(result.stats.inputTriangles, 3);
  assert.equal(result.stats.removedDuplicateTriangles, 2);
  assert.equal(result.mesh.indices.length / 3, 1, 'only 1 unique triangle remains');
});

test('rejects collinear (degenerate) triangle', () => {
  const vertices = [
    0, 0, 0, 1, 0, 0, 2, 0, 0, // collinear
    0, 0, 0, 1, 0, 0, 0, 1, 0, // valid
  ];
  const result = prepareFlat(vertices);
  assert.equal(result.stats.removedDegenerateTriangles, 1);
  assert.equal(result.mesh.indices.length / 3, 1, '1 valid triangle');
});

test('rejects NaN in every coordinate slot', () => {
  const base = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  for (let i = 0; i < 9; i++) {
    const verts = [...base];
    verts[i] = Number.NaN;
    const result = prepareFlat([
      ...verts,
      0, 0, 0, 1, 0, 0, 0, 1, 0, // valid
    ]);
    assert.equal(result.stats.removedNonFiniteTriangles, 1, `slot ${i} should reject`);
    assert.equal(result.mesh.indices.length / 3, 1);
  }
});

test('rejects Infinity in every coordinate slot', () => {
  const base = [0, 0, 0, 1, 0, 0, 0, 1, 0];
  for (let i = 0; i < 9; i++) {
    const verts = [...base];
    verts[i] = Number.POSITIVE_INFINITY;
    const result = prepareFlat([
      ...verts,
      0, 0, 0, 1, 0, 0, 0, 1, 0,
    ]);
    assert.equal(result.stats.removedNonFiniteTriangles, 1, `slot ${i} should reject`);
  }
});

test('closed tetrahedron: 4 triangles, 0 boundary edges, 1 component', () => {
  // Tetrahedron: 4 vertices, 4 triangular faces, all edges shared → 0 boundary
  const verts = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, // 4 vertices
  ];
  const indices = [
    0, 1, 2, // base
    0, 1, 3,
    1, 2, 3,
    2, 0, 3,
  ];
  const result = prepareStepMeshTopology({ vertices: verts, indices });
  assert.equal(result.stats.inputTriangles, 4);
  assert.equal(result.stats.boundaryEdges, 0, 'closed surface has no boundary edges');
  assert.equal(result.stats.connectedComponents, 1);
  assert.equal(result.stats.nonManifoldEdges, 0);
});

test('open two-triangle square: 4 boundary edges, 1 component', () => {
  const verts = [
    0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, // 4 vertices, planar square
  ];
  const indices = [
    0, 1, 2,
    0, 2, 3,
  ];
  const result = prepareStepMeshTopology({ vertices: verts, indices });
  assert.equal(result.stats.inputTriangles, 2);
  assert.equal(result.stats.boundaryEdges, 4, 'square has 4 boundary edges');
  assert.equal(result.stats.connectedComponents, 1);
});

test('three faces sharing one edge: detects non-manifold', () => {
  // Three triangles share edge 0-1 with different third vertices → non-manifold
  const verts5 = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, // 5 vertices
  ];
  const indices5 = [
    0, 1, 2, // edge 0-1
    0, 1, 3, // edge 0-1
    0, 1, 4, // edge 0-1 — different sorted triple [0,1,4]
  ];
  const result = prepareStepMeshTopology({ vertices: verts5, indices: indices5 });
  assert.ok(result.stats.nonManifoldEdges >= 1, 'edge shared by 3 faces is non-manifold');
});

test('two disconnected components', () => {
  const verts = [
    0, 0, 0, 1, 0, 0, 0, 1, 0, // component 1: one triangle at origin
    10, 0, 0, 11, 0, 0, 10, 1, 0, // component 2: one triangle far away
  ];
  const result = prepareFlat(verts);
  assert.equal(result.stats.inputTriangles, 2);
  assert.equal(result.stats.connectedComponents, 2);
  assert.equal(result.stats.boundaryEdges, 6, '2 separate triangles → 6 boundary edges');
});

test('deterministic: same input produces same output', () => {
  const verts = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
  const indices = [0, 1, 2, 0, 2, 3];
  const r1 = prepareStepMeshTopology({ vertices: verts, indices });
  const r2 = prepareStepMeshTopology({ vertices: verts, indices });
  assert.deepEqual(r1.mesh.vertices, r2.mesh.vertices);
  assert.deepEqual(r1.mesh.indices, r2.mesh.indices);
  assert.deepEqual(r1.stats, r2.stats);
});
