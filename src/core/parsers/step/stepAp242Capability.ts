/**
 * Immutable AP242 tessellated export capability result.
 *
 * Probed on 2026-07-12 against OCCT 7.4 (opencascade.js 1.1.1). The
 * tessellated geometry bindings (Tessellated_face, Poly_Triangulation → STEP)
 * are incomplete on this build — no constructor produces AP242 tessellated
 * entities, and BRepBuilderAPI_MakeFace overloads that accept wires fail.
 *
 * Therefore AP242 tessellated output is NOT supported. STEP mesh export must
 * use the sewn-shell fallback (BRepBuilderAPI_Sewing + per-triangle faces).
 *
 * Do NOT re-probe at runtime. Update this constant only after a full browser
 * + FreeCAD validation pass confirms the new OCCT build works.
 */

export const STEP_AP242_TESSELLATED_SUPPORTED = false;

export const STEP_AP242_FAILED_CHECKS = [
  'hasTessellatedEntity — no Tessellated_face constructor available',
  'avoidsPerTriangleBrep — cannot produce tessellated output, must use per-triangle BREP',
  'sharedVertexCountPreserved — tessellated output not produced',
  'independentReopen — FreeCAD not available for independent validation',
];

export const STEP_AP242_PROBE_DATE = '2026-07-12';
export const STEP_AP242_OCCT_VERSION = '7.4 (opencascade.js 1.1.1)';
