# STEP transform runtime fix design

## Scope

Fix the STEP export failure caused by calling `gp_Trsf.SetTransformation_1`
with one argument when the bundled OpenCascade.js binding expects two. Preserve
the existing uncommitted STEP work, including compound-based shape collection,
primitive centering, warnings, and export error propagation.

## Runtime compatibility strategy

The implementation must verify the available `gp_Trsf` overloads against the
actual bundled WASM runtime rather than infer signatures from upstream C++ API
names. The preferred transform construction is:

1. Build a canonical identity `gp_Ax3`.
2. Build the target `gp_Ax3` from the column-major robot world matrix.
3. Call the verified two-argument `SetTransformation_1` overload.
4. Verify transform direction with a non-symmetric fixture containing both a
   90-degree rotation and translation.

If the two-axis-system overload cannot reproduce the input matrix without an
inverse or reflection, use the runtime-verified `SetValues` overload to write
the 3x4 affine matrix explicitly.

## Data and ownership

`stepGenerator.ts` remains responsible for producing column-major world
matrices. `stepOcctWorker.ts` remains responsible for translating those
matrices into OCCT transforms. Temporary OCCT objects created during transform
construction must be deleted symmetrically after the transformed shape has
been obtained.

The fix must not overwrite or discard any existing uncommitted changes in the
STEP exporter.

## Error handling

Unsupported or mismatched OCCT overloads must produce a concise worker error
that identifies the attempted transform API. Invalid matrices must fail before
calling OCCT and report whether values are non-finite or the rotation basis is
degenerate.

## Verification

Verification must include:

- STEP-adjacent unit tests and `typecheck:quality`.
- A production app build or the nearest build stage not blocked by unrelated
  repository failures.
- Browser export of the default primitive robot.
- Browser export of a robot with a translated and 90-degree rotated visual.
- Browser reproduction using the user's failing robot when it is available in
  the workspace or current app session.
- Inspection that a download is produced and that its STEP text contains
  geometry entities rather than merely reporting worker success.
- Cleanup of the dev server and browser automation processes.

## Success criteria

STEP export no longer reports the `SetTransformation_1` argument-count error,
produces a non-empty STEP download, and preserves both translation and rotation
for the transform fixture. No existing user changes are lost or included in an
unrelated commit.
