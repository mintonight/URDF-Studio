import assert from 'node:assert/strict';
import test from 'node:test';

import { calculateCylinderParameterBounds } from './stepOcctAnalyticFaceFactory';
import { buildOcctCylindricalRegionFace } from './stepOcctAnalyticFaceFactory';
import { loadOcctForNode } from './stepOcctNodeLoader';

function makeCylinderSegments(segments: number) {
  const vertices: number[] = [];
  for (let z = 0; z <= 1; z++) {
    for (let i = 0; i < segments; i++) {
      const angle = i * Math.PI * 2 / segments;
      vertices.push(Math.cos(angle), Math.sin(angle), z);
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices.push(i, next, segments + next, i, segments + next, segments + i);
  }
  return { vertices, indices, triangleIds: Array.from({ length: segments * 2 }, (_, i) => i) };
}

test('accepts a near-complete cylindrical revolution', () => {
  const mesh = makeCylinderSegments(32);
  const bounds = calculateCylinderParameterBounds(
    mesh.vertices, mesh.indices, mesh.triangleIds,
    { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
  );
  assert.ok(bounds);
  assert.ok(bounds.angularCoverage > Math.PI * 1.75);
  assert.ok(Math.abs(bounds.vMin) < 1e-12);
  assert.ok(Math.abs(bounds.vMax - 1) < 1e-12);
});

test('rejects a partial cylindrical patch', () => {
  const mesh = makeCylinderSegments(32);
  const quarter = mesh.triangleIds.slice(0, 16);
  assert.equal(calculateCylinderParameterBounds(
    mesh.vertices, mesh.indices, quarter,
    { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 },
  ), null);
});

test('real OCCT writes a cylindrical analytic face to STEP', async () => {
  const oc = await loadOcctForNode();
  const mesh = makeCylinderSegments(32);
  const result = buildOcctCylindricalRegionFace(
    oc,
    mesh.vertices,
    mesh.indices,
    {
      id: 1,
      type: 'cylinder',
      triangleIds: mesh.triangleIds,
      parameters: {
        cylinderCenter: { x: 0, y: 0, z: 0 },
        cylinderAxis: { x: 0, y: 0, z: 1 },
        cylinderRadius: 1,
      },
      quality: {
        rmsDistance: 0,
        maxDistance: 0,
        maxNormalError: 0,
        inlierRatio: 1,
        coveredArea: Math.PI * 2,
        triangleCount: mesh.triangleIds.length,
      },
      accepted: true,
    },
    1e-7,
  );
  assert.ok(result);
  const builder = new oc.BRep_Builder();
  const compound = new oc.TopoDS_Compound();
  const writer = new oc.STEPControl_Writer_1();
  let path: string | null = null;
  try {
    builder.MakeCompound(compound);
    builder.Add(compound, result.shape);
    const done = oc.IFSelect_ReturnStatus.IFSelect_RetDone.value;
    assert.equal(writer.Transfer(compound, 0, true).value, done);
    const before = new Set<string>(oc.FS.readdir('/'));
    writer.Write('/cyl.s');
    const created = (oc.FS.readdir('/') as string[]).filter(
      (name) => !before.has(name) && name !== '.' && name !== '..',
    );
    path = oc.FS.analyzePath('/cyl.s').exists ? '/cyl.s' : `/${created[0]}`;
    const text = Buffer.from(oc.FS.readFile(path) as Uint8Array).toString('utf8');
    assert.match(text, /ADVANCED_FACE/);
    assert.match(text, /CYLINDRICAL_SURFACE/);
  } finally {
    if (path && oc.FS.analyzePath(path).exists) oc.FS.unlink(path);
    writer.delete();
    compound.delete();
    builder.delete();
    (result.shape as { delete?: () => void }).delete?.();
  }
});
