import test from 'node:test';
import assert from 'node:assert/strict';

import { analyzeMeshTopology } from './stepMeshAnalysis';
import { prepareStepMeshTopology } from './stepMeshTopology';

function prepareFlat(vertices: number[]) {
  return prepareStepMeshTopology({ vertices });
}

test('computes correct face normals for a planar square', () => {
  // Two triangles on the XY plane → normals should be +Z.
  const prepared = prepareFlat([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
  ]);
  const analysis = analyzeMeshTopology(prepared);
  assert.equal(analysis.faces.length, 2);
  for (const face of analysis.faces) {
    assert.ok(Math.abs(face.normal.z - 1) < 1e-6, `normal.z should be 1, got ${face.normal.z}`);
    assert.ok(Math.abs(face.normal.x) < 1e-6);
    assert.ok(Math.abs(face.normal.y) < 1e-6);
  }
});

test('computes correct area for a unit square', () => {
  const prepared = prepareFlat([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
  ]);
  const analysis = analyzeMeshTopology(prepared);
  assert.ok(Math.abs(analysis.totalArea - 1.0) < 1e-6, `area should be 1.0, got ${analysis.totalArea}`);
});

test('computes bounding box diagonal', () => {
  const prepared = prepareFlat([
    0, 0, 0, 3, 0, 0, 0, 4, 0,
  ]);
  const analysis = analyzeMeshTopology(prepared);
  // Bounding box: 0..3 x 0..4 x 0..0 → diagonal = 5
  assert.ok(Math.abs(analysis.diagonal - 5) < 1e-6, `diagonal should be 5, got ${analysis.diagonal}`);
});

test('detects sharp edges in a tetrahedron', () => {
  const prepared = prepareStepMeshTopology({
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    indices: [0, 1, 2, 0, 1, 3, 1, 2, 3, 2, 0, 3],
  });
  const analysis = analyzeMeshTopology(prepared);
  let sharpCount = 0;
  for (const [, curve] of analysis.edgeCurvature) {
    if (curve.isSharp) sharpCount++;
  }
  // A tetrahedron has sharp edges between all faces.
  assert.ok(sharpCount > 0, 'tetrahedron should have sharp edges');
});

test('flat surface has no sharp edges', () => {
  const prepared = prepareFlat([
    0, 0, 0, 1, 0, 0, 1, 1, 0,
    0, 0, 0, 1, 1, 0, 0, 1, 0,
  ]);
  const analysis = analyzeMeshTopology(prepared);
  let sharpCount = 0;
  for (const [, curve] of analysis.edgeCurvature) {
    if (curve.isSharp) sharpCount++;
  }
  // Boundary edges are sharp (dihedral = PI), but the shared interior edge is not.
  // 4 boundary + 1 interior → 4 sharp.
  assert.equal(sharpCount, 4, 'flat square should have 4 sharp boundary edges');
});

test('computes centroids correctly', () => {
  const prepared = prepareFlat([
    0, 0, 0, 3, 0, 0, 0, 3, 0,
  ]);
  const analysis = analyzeMeshTopology(prepared);
  const c = analysis.faces[0].centroid;
  assert.ok(Math.abs(c.x - 1) < 1e-6);
  assert.ok(Math.abs(c.y - 1) < 1e-6);
  assert.ok(Math.abs(c.z) < 1e-6);
});

test('average edge length is positive for non-degenerate mesh', () => {
  const prepared = prepareFlat([
    0, 0, 0, 2, 0, 0, 0, 2, 0,
  ]);
  const analysis = analyzeMeshTopology(prepared);
  assert.ok(analysis.averageEdgeLength > 0, 'should have positive average edge length');
});
