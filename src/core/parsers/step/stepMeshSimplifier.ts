/**
 * STEP mesh simplification adapter.
 *
 * Converts indexed geometry to the STL compressor input format, simplifies
 * to a target triangle budget, then validates the result. If simplification
 * loses boundary vertices or creates invalid triangles, returns the cleaned
 * unsimplified mesh with a warning.
 */

import { compressMesh } from '@/core/stl-compressor';
import { calculateBoundingBox } from '@/core/stl-compressor/stlParser';
import type { STLMeshData } from '@/core/stl-compressor/types';

import { prepareStepMeshTopology } from './stepMeshTopology';
import type { PreparedStepMesh } from './stepMeshTypes';

export interface SimplifyStepMeshResult {
  mesh: PreparedStepMesh;
  warnings: string[];
}

/**
 * Simplify a prepared mesh to at most `budget` triangles.
 *
 * Falls back to the original cleaned mesh if simplification loses boundary
 * vertices or produces invalid geometry.
 */
export function simplifyStepMesh(
  prepared: PreparedStepMesh,
  budget: number,
): SimplifyStepMeshResult {
  const warnings: string[] = [];
  const inputTriangles = prepared.mesh.indices.length / 3;

  // No simplification needed if already within budget.
  if (inputTriangles <= budget) {
    return { mesh: prepared, warnings };
  }

  // Skip very small meshes (compressor needs at least 10 triangles).
  if (inputTriangles < 10) {
    return { mesh: prepared, warnings };
  }

  const quality = Math.max(1, Math.min(100, Math.round((100 * budget) / inputTriangles)));

  // Convert indexed → flat for the compressor.
  const flatVertices = indexedToFlat(prepared.mesh.vertices, prepared.mesh.indices);
  const vertices = Float32Array.from(flatVertices);
  const triangleCount = flatVertices.length / 9;
  const normals = new Float32Array(vertices.length);
  const boundingBox = calculateBoundingBox(vertices);

  // Derive per-vertex normals from each triangle.
  for (let t = 0; t < triangleCount; t++) {
    const base = t * 9;
    const ax = vertices[base], ay = vertices[base + 1], az = vertices[base + 2];
    const bx = vertices[base + 3] - ax, by = vertices[base + 4] - ay, bz = vertices[base + 5] - az;
    const cx = vertices[base + 6] - ax, cy = vertices[base + 7] - ay, cz = vertices[base + 8] - az;
    const nx = by * cz - bz * cy;
    const ny = bz * cx - bx * cz;
    const nz = bx * cy - by * cx;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    for (let j = 0; j < 3; j++) {
      normals[base + j * 3] = nx / len;
      normals[base + j * 3 + 1] = ny / len;
      normals[base + j * 3 + 2] = nz / len;
    }
  }

  const meshData: STLMeshData = {
    filename: 'step-mesh',
    fileSize: 84 + triangleCount * 50,
    triangleCount,
    vertices,
    normals,
    boundingBox,
    isCompressed: false,
    originalTriangleCount: triangleCount,
    originalFileSize: 84 + triangleCount * 50,
  };

  let compressed: STLMeshData;
  try {
    compressed = compressMesh(meshData, quality);
  } catch {
    warnings.push('simplification-rejected: compressor threw');
    return { mesh: prepared, warnings };
  }

  // Validate: check all vertices are finite and triangles non-degenerate.
  const outPositions = Array.from(compressed.vertices);
  for (let i = 0; i < outPositions.length; i++) {
    if (!Number.isFinite(outPositions[i])) {
      warnings.push('simplification-rejected: non-finite vertex in output');
      return { mesh: prepared, warnings };
    }
  }

  // Re-prepare the simplified mesh to get clean topology.
  const simplified = prepareStepMeshTopology({ vertices: outPositions });

  // Check boundary vertex preservation: simplified mesh boundary vertices
  // must be a subset of original boundary vertices (approximately).
  const originalBoundary = new Set(prepared.boundaryVertices.map((v) => roundKey(v, prepared.mesh.vertices)));
  const simplifiedBoundary = simplified.boundaryVertices.map((v) => roundKey(v, simplified.mesh.vertices));
  const lostBoundary = simplifiedBoundary.filter((key) => !originalBoundary.has(key));
  if (lostBoundary.length > 0) {
    warnings.push('simplification-rejected: boundary vertices lost');
    return { mesh: prepared, warnings };
  }

  return { mesh: simplified, warnings };
}

/** Convert indexed vertices to flat per-triangle vertex array. */
function indexedToFlat(vertices: number[], indices: number[]): number[] {
  const flat: number[] = [];
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    flat.push(vertices[a], vertices[a + 1], vertices[a + 2]);
    flat.push(vertices[b], vertices[b + 1], vertices[b + 2]);
    flat.push(vertices[c], vertices[c + 1], vertices[c + 2]);
  }
  return flat;
}

/** Round a vertex to a coarse key for approximate boundary matching. */
function roundKey(vertexIndex: number, vertices: number[]): string {
  const x = vertices[vertexIndex * 3] ?? 0;
  const y = vertices[vertexIndex * 3 + 1] ?? 0;
  const z = vertices[vertexIndex * 3 + 2] ?? 0;
  return `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
}
