/**
 * Region growing for analytic surface recognition.
 *
 * Seeds regions from triangles sorted by descending area then ascending ID.
 * Grows regions by checking normal compatibility and edge adjacency.
 * Non-manifold edges are hard boundaries.
 */

import type { MeshAnalysis } from './stepMeshAnalysis';
import type { PreparedStepMesh } from './stepMeshTypes';
import type { ReconstructionTolerances } from './stepMeshRegionTypes';

export interface GrownRegion {
  /** Seed triangle ID. */
  seedId: number;
  /** All triangle IDs in this region (including seed). */
  triangleIds: number[];
}

/**
 * Build face adjacency: for each triangle, which triangles share a manifold edge.
 */
function buildFaceAdjacency(
  prepared: PreparedStepMesh,
): Map<number, number[]> {
  const indices = prepared.mesh.indices;
  const faceCount = indices.length / 3;

  // Map edge → list of face IDs.
  const edgeFaces = new Map<string, number[]>();
  for (let t = 0; t < faceCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const list = edgeFaces.get(key);
      if (list) list.push(t);
      else edgeFaces.set(key, [t]);
    }
  }

  // Build adjacency: only manifold edges (exactly 2 faces) create connections.
  const adjacency = new Map<number, number[]>();
  for (let t = 0; t < faceCount; t++) adjacency.set(t, []);

  for (const [, faceList] of edgeFaces) {
    if (faceList.length !== 2) continue; // boundary or non-manifold
    const [f1, f2] = faceList;
    adjacency.get(f1)!.push(f2);
    adjacency.get(f2)!.push(f1);
  }

  return adjacency;
}

/** Dot product of two normal-like objects. */
function dot3(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number },
): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Grow planar regions from seed triangles.
 *
 * Seeds are sorted by descending area, then ascending ID.
 * A neighbor joins a region if:
 *   - it shares a manifold edge with the region;
 *   - its normal is within normalAngleTolerance of the seed normal.
 *
 * Returns one region per seed (seeds already consumed by earlier regions are
 * skipped). Non-manifold edges are hard boundaries.
 */
export function growPlanarRegions(
  prepared: PreparedStepMesh,
  analysis: MeshAnalysis,
  tolerances: ReconstructionTolerances,
): GrownRegion[] {
  const faceCount = prepared.mesh.indices.length / 3;
  const adjacency = buildFaceAdjacency(prepared);

  // Sort seed candidates: descending area, ascending ID.
  const seedCandidates = Array.from({ length: faceCount }, (_, i) => i);
  seedCandidates.sort((a, b) => {
    const areaDiff = analysis.faces[b].area - analysis.faces[a].area;
    if (Math.abs(areaDiff) > 1e-15) return areaDiff;
    return a - b;
  });

  const assigned = new Uint8Array(faceCount);
  const regions: GrownRegion[] = [];

  for (const seedId of seedCandidates) {
    if (assigned[seedId]) continue;

    const seedNormal = analysis.faces[seedId].normal;
    const regionTriangles: number[] = [seedId];
    assigned[seedId] = 1;

    // BFS growth.
    const queue: number[] = [seedId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacency.get(current) ?? [];

      for (const neighbor of neighbors) {
        if (assigned[neighbor]) continue;

        const neighborNormal = analysis.faces[neighbor].normal;
        const cosAngle = Math.abs(dot3(seedNormal, neighborNormal));
        const angle = Math.acos(Math.max(-1, Math.min(1, cosAngle)));

        if (angle <= tolerances.normalAngleTolerance) {
          assigned[neighbor] = 1;
          regionTriangles.push(neighbor);
          queue.push(neighbor);
        }
      }
    }

    regions.push({ seedId, triangleIds: regionTriangles });
  }

  return regions;
}
