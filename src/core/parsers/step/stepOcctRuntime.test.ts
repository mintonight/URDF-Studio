/**
 * Real OCCT WASM STEP validity gate.
 *
 * Loads the bundled opencascade.js WASM (not mocked) and asserts that
 * MakeFace_15 produces ADVANCED_FACE entities while wire-only Shape()
 * does not. Also runs a 20× leak/repeat regression.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { loadOcctForNode } from './stepOcctNodeLoader';
import { StepOcctResourceScope } from './stepOcctResourceScope';

/* eslint-disable @typescript-eslint/no-explicit-any */

function countEntities(text: string, name: string): number {
  return (text.match(new RegExp(name, 'g')) ?? []).length;
}

let writeCounter = 0;

/**
 * Write a compound to MEMFS and return STEP text.
 * Handles the opencascade.js 1.1.1 Write filename-corruption quirk by
 * snapshotting new files and renaming when needed.
 */
function writeCompoundToStep(oc: any, compound: any, baseName: string): string {
  const scope = new StepOcctResourceScope();
  let resolvedPath: string | null = null;
  try {
    const writer = scope.own(new oc.STEPControl_Writer_1());
    const retDone = oc.IFSelect_ReturnStatus.IFSelect_RetDone.value;
    assert.equal(writer.Transfer(compound, 0, true).value, retDone);

    // Short unique ASCII basename (avoids corrupted long paths on this binding).
    writeCounter += 1;
    const requested = `/${baseName}${writeCounter}.s`;
    const before = new Set<string>(oc.FS.readdir('/'));
    writer.Write(requested);
    const after = (oc.FS.readdir('/') as string[]).filter(
      (name) => !before.has(name) && name !== '.' && name !== '..',
    );

    if (oc.FS.analyzePath(requested).exists) {
      resolvedPath = requested;
    } else if (after.length >= 1) {
      resolvedPath = `/${after[0]}`;
    } else {
      // Last resort: any non-system file created earlier that looks new.
      const candidates = (oc.FS.readdir('/') as string[]).filter(
        (name) => name !== '.' && name !== '..' && name !== 'tmp' && name !== 'home' && name !== 'dev',
      );
      assert.ok(candidates.length >= 1, `STEP Write produced no MEMFS file (requested=${requested})`);
      resolvedPath = `/${candidates[candidates.length - 1]}`;
    }

    const data = oc.FS.readFile(resolvedPath) as Uint8Array;
    const text = Buffer.from(data).toString('utf8');
    try { oc.FS.unlink(resolvedPath); } catch { /* best-effort */ }
    return text;
  } finally {
    scope.dispose();
  }
}

function writeTriangleFaceStep(oc: any): string {
  const scope = new StepOcctResourceScope();
  try {
    const p1 = scope.own(new oc.gp_Pnt_3(0, 0, 0));
    const p2 = scope.own(new oc.gp_Pnt_3(1, 0, 0));
    const p3 = scope.own(new oc.gp_Pnt_3(0, 1, 0));
    const polygon = scope.own(new oc.BRepBuilderAPI_MakePolygon_1());
    polygon.Add_1(p1);
    polygon.Add_1(p2);
    polygon.Add_1(p3);
    polygon.Close();
    const wire = scope.own(polygon.Wire());
    assert.equal(wire.IsNull(), false);

    const faceMaker = scope.own(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
    assert.equal(faceMaker.IsDone(), true);
    const face = scope.own(faceMaker.Face());
    assert.equal(face.IsNull(), false);

    const builder = scope.own(new oc.BRep_Builder());
    const compound = scope.own(new oc.TopoDS_Compound());
    builder.MakeCompound(compound);
    builder.Add(compound, face);

    return writeCompoundToStep(oc, compound, 'runtime-face');
  } finally {
    scope.dispose();
  }
}

function writeWireOnlyStep(oc: any): string {
  const scope = new StepOcctResourceScope();
  try {
    const p1 = scope.own(new oc.gp_Pnt_3(0, 0, 0));
    const p2 = scope.own(new oc.gp_Pnt_3(1, 0, 0));
    const p3 = scope.own(new oc.gp_Pnt_3(0, 1, 0));
    const polygon = scope.own(new oc.BRepBuilderAPI_MakePolygon_1());
    polygon.Add_1(p1);
    polygon.Add_1(p2);
    polygon.Add_1(p3);
    polygon.Close();
    // Intentionally use polygon.Shape() — a wire, not a face.
    const wireShape = scope.own(polygon.Shape());

    const builder = scope.own(new oc.BRep_Builder());
    const compound = scope.own(new oc.TopoDS_Compound());
    builder.MakeCompound(compound);
    builder.Add(compound, wireShape);

    return writeCompoundToStep(oc, compound, 'runtime-wire');
  } finally {
    scope.dispose();
  }
}

test('real OCCT MakeFace_15 produces ADVANCED_FACE STEP output', async () => {
  const oc = await loadOcctForNode();
  const text = writeTriangleFaceStep(oc);

  assert.match(text, /^ISO-10303-21;/);
  assert.equal(countEntities(text, 'ADVANCED_FACE'), 1);
  assert.ok(countEntities(text, 'EDGE_LOOP') >= 1);
  assert.doesNotMatch(text, /NaN|Infinity/);
  assert.match(text, /END-ISO-10303-21;/);
});

test('wire-only polygon.Shape() produces no ADVANCED_FACE', async () => {
  const oc = await loadOcctForNode();
  const text = writeWireOnlyStep(oc);

  assert.match(text, /^ISO-10303-21;/);
  assert.equal(countEntities(text, 'ADVANCED_FACE'), 0, 'wire-only export must not produce faces');
  assert.doesNotMatch(text, /NaN|Infinity/);
});

test('repeating real face construction 20 times does not throw', async () => {
  // The Emscripten STEPControl_Writer MEMFS path corrupts filenames after a
  // handful of writes on this OCCT binding, so the leak regression stresses
  // face construction + resource-scope dispose rather than repeated Write.
  // STEP write validity is covered by the single-shot tests above.
  const oc = await loadOcctForNode();

  for (let i = 0; i < 20; i++) {
    const scope = new StepOcctResourceScope();
    try {
      const p1 = scope.own(new oc.gp_Pnt_3(0, 0, 0));
      const p2 = scope.own(new oc.gp_Pnt_3(1, 0, i * 0.01));
      const p3 = scope.own(new oc.gp_Pnt_3(0, 1, 0));
      const polygon = scope.own(new oc.BRepBuilderAPI_MakePolygon_1());
      polygon.Add_1(p1);
      polygon.Add_1(p2);
      polygon.Add_1(p3);
      polygon.Close();
      const wire = scope.own(polygon.Wire());
      assert.equal(wire.IsNull(), false);
      const faceMaker = scope.own(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
      assert.equal(faceMaker.IsDone(), true);
      const face = scope.own(faceMaker.Face());
      assert.equal(face.IsNull(), false);
    } finally {
      scope.dispose();
    }
  }
});
