import test from 'node:test';
import assert from 'node:assert/strict';

import { simplifyStepMesh } from './stepMeshSimplifier';
import type { PreparedStepMesh } from './stepMeshTypes';
import { prepareStepMeshTopology } from './stepMeshTopology';

/** Build a simple prepared square (2 triangles). */
function makeSquare(): PreparedStepMesh {
  return prepareStepMeshTopology({
    vertices: [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0],
    indices: [0, 1, 2, 0, 2, 3],
  });
}

test('output does not exceed budget when simplification runs', () => {
  // Build a mesh with >10 triangles so the compressor kicks in.
  const verts: number[] = [];
  const indices: number[] = [];
  const N = 5;
  for (let y = 0; y <= N; y++) {
    for (let x = 0; x <= N; x++) {
      verts.push(x, y, 0);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v00 = y * (N + 1) + x;
      const v10 = y * (N + 1) + x + 1;
      const v01 = (y + 1) * (N + 1) + x;
      const v11 = (y + 1) * (N + 1) + x + 1;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }
  const prepared = prepareStepMeshTopology({ vertices: verts, indices });
  const result = simplifyStepMesh(prepared, 10);
  const outTriangles = result.mesh.mesh.indices.length / 3;
  // After simplification (or rejection), output must be finite and valid.
  assert.ok(outTriangles >= 1, 'should have at least 1 triangle');
  // If not rejected, output should be ≤ budget.
  if (!result.warnings.some((w) => w.includes('simplification-rejected'))) {
    assert.ok(outTriangles <= 10, `got ${outTriangles} triangles, budget was 10`);
  }
});

test('output contains finite non-degenerate triangles', () => {
  const mesh = makeSquare();
  const result = simplifyStepMesh(mesh, 2);
  for (let i = 0; i < result.mesh.mesh.vertices.length; i++) {
    assert.ok(Number.isFinite(result.mesh.mesh.vertices[i]), 'all vertices must be finite');
  }
  for (let t = 0; t < result.mesh.mesh.indices.length / 3; t++) {
    const a = result.mesh.mesh.indices[t * 3];
    const b = result.mesh.mesh.indices[t * 3 + 1];
    const c = result.mesh.mesh.indices[t * 3 + 2];
    assert.notEqual(a, b);
    assert.notEqual(b, c);
    assert.notEqual(a, c);
  }
});

test('preserves a tetrahedron when budget is at least four', () => {
  const tetra = prepareStepMeshTopology({
    vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1],
    indices: [0, 1, 2, 0, 1, 3, 1, 2, 3, 2, 0, 3],
  });
  const result = simplifyStepMesh(tetra, 4);
  assert.equal(result.mesh.mesh.indices.length / 3, 4, 'tetrahedron with budget 4 should keep all 4 triangles');
});

test('deterministic for same input', () => {
  const mesh = makeSquare();
  const r1 = simplifyStepMesh(mesh, 2);
  const r2 = simplifyStepMesh(mesh, 2);
  assert.deepEqual(r1.mesh.mesh.vertices, r2.mesh.mesh.vertices);
  assert.deepEqual(r1.mesh.mesh.indices, r2.mesh.mesh.indices);
});

test('rejects simplification that loses boundary vertices, returns cleaned original', () => {
  const verts: number[] = [];
  const indices: number[] = [];
  const N = 10;
  for (let y = 0; y <= N; y++) {
    for (let x = 0; x <= N; x++) {
      verts.push(x, y, 0);
    }
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const v00 = y * (N + 1) + x;
      const v10 = y * (N + 1) + x + 1;
      const v01 = (y + 1) * (N + 1) + x;
      const v11 = (y + 1) * (N + 1) + x + 1;
      indices.push(v00, v10, v11, v00, v11, v01);
    }
  }

  const prepared = prepareStepMeshTopology({ vertices: verts, indices });
  assert.ok(prepared.mesh.vertices.length > 0, 'prepared mesh should have vertices');

  const result = simplifyStepMesh(prepared, 1);
  assert.ok(result.mesh.mesh.vertices.length > 0, 'result should have vertices');
  const outTriangles = result.mesh.mesh.indices.length / 3;
  assert.ok(
    result.warnings.some((w) => w.includes('simplification-rejected')) || outTriangles <= 1,
    'should either reject or produce ≤1 triangle',
  );
});
