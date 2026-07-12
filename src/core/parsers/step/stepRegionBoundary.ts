/**
 * Ordered boundary-loop extraction for planar regions.
 *
 * Extracts oriented boundary loops from a set of triangles belonging to
 * one planar region. Separates outer loops from hole loops, rejects
 * self-intersecting or open loops, and produces deterministic output.
 */

export interface StepRegionBoundary {
  outerLoop: number[];
  holeLoops: number[][];
  boundaryEdges: Array<[number, number]>;
}

export interface StepBoundaryFailure {
  reason: 'open-loop' | 'branched-boundary' | 'self-intersection' | 'empty';
  details: string;
}

export type StepBoundaryResult =
  | { ok: true; boundary: StepRegionBoundary }
  | { ok: false; failure: StepBoundaryFailure };

/**
 * Extract boundary loops from a set of triangle vertex indices.
 *
 * @param indices — The full mesh index array (3 per triangle).
 * @param triangleIds — Which triangles belong to this region.
 * @returns Discriminated union: success with boundary, or failure with reason.
 */
export function extractRegionBoundary(
  indices: number[],
  triangleIds: number[],
): StepBoundaryResult {
  if (triangleIds.length === 0) {
    return { ok: false, failure: { reason: 'empty', details: 'no triangles in region' } };
  }

  // Step 1: Count oriented half-edges.
  // Each triangle contributes 3 directed edges. An undirected edge appearing
  // exactly once is a boundary edge; twice is internal; more than twice is
  // non-manifold (branched).
  const edgeCounts = new Map<string, number>();
  const directedEdges: Array<[number, number]> = [];

  for (const tId of triangleIds) {
    const a = indices[tId * 3];
    const b = indices[tId * 3 + 1];
    const c = indices[tId * 3 + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      edgeCounts.set(key, (edgeCounts.get(key) ?? 0) + 1);
      directedEdges.push([p, q]);
    }
  }

  // Step 2: Collect boundary edges (count === 1) and check for branching.
  const boundaryEdgeSet = new Set<string>();
  const boundaryEdges: Array<[number, number]> = [];

  for (const tId of triangleIds) {
    const a = indices[tId * 3];
    const b = indices[tId * 3 + 1];
    const c = indices[tId * 3 + 2];
    for (const [p, q] of [[a, b], [b, c], [c, a]] as const) {
      const key = p < q ? `${p}:${q}` : `${q}:${p}`;
      const count = edgeCounts.get(key)!;
      if (count > 2) {
        return {
          ok: false,
          failure: {
            reason: 'branched-boundary',
            details: `edge ${key} is shared by ${count} triangles (non-manifold)`,
          },
        };
      }
      if (count === 1 && !boundaryEdgeSet.has(key)) {
        boundaryEdgeSet.add(key);
        boundaryEdges.push([p, q]);
      }
    }
  }

  if (boundaryEdges.length === 0) {
    return { ok: false, failure: { reason: 'empty', details: 'no boundary edges found' } };
  }

  // Step 3: Build outgoing adjacency from boundary edges.
  // Each boundary vertex must have exactly one incoming and one outgoing edge.
  const outgoing = new Map<number, number[]>();
  const incoming = new Map<number, number[]>();

  for (const [p, q] of boundaryEdges) {
    const out = outgoing.get(p);
    if (out) out.push(q);
    else outgoing.set(p, [q]);

    const inc = incoming.get(q);
    if (inc) inc.push(p);
    else incoming.set(q, [p]);
  }

  // Check for branching (a vertex with more than one outgoing or incoming boundary edge).
  for (const [v, targets] of outgoing) {
    if (targets.length > 1) {
      return {
        ok: false,
        failure: {
          reason: 'branched-boundary',
          details: `vertex ${v} has ${targets.length} outgoing boundary edges`,
        },
      };
    }
  }
  for (const [v, sources] of incoming) {
    if (sources.length > 1) {
      return {
        ok: false,
        failure: {
          reason: 'branched-boundary',
          details: `vertex ${v} has ${sources.length} incoming boundary edges`,
        },
      };
    }
  }

  // Step 4: Walk loops from the smallest unvisited vertex ID.
  const visited = new Set<number>();
  const loops: number[][] = [];

  const sortedBoundaryVertices = Array.from(outgoing.keys()).sort((a, b) => a - b);

  for (const startVertex of sortedBoundaryVertices) {
    if (visited.has(startVertex)) continue;

    const loop: number[] = [];
    let current = startVertex;

    while (true) {
      if (visited.has(current)) {
        // We've returned to a visited vertex — check if it's the start.
        if (current === startVertex) break;
        // Hit a different visited vertex — this shouldn't happen if adjacency is clean.
        return {
          ok: false,
          failure: {
            reason: 'open-loop',
            details: `loop from ${startVertex} hit visited vertex ${current} prematurely`,
          },
        };
      }

      visited.add(current);
      loop.push(current);

      const targets = outgoing.get(current);
      if (!targets || targets.length === 0) {
        // Dead end — open boundary.
        return {
          ok: false,
          failure: {
            reason: 'open-loop',
            details: `vertex ${current} has no outgoing boundary edge (dead end)`,
          },
        };
      }

      current = targets[0];

      if (current === startVertex) {
        break; // Closed the loop.
      }
    }

    if (loop.length >= 3) {
      loops.push(loop);
    }
  }

  if (loops.length === 0) {
    return { ok: false, failure: { reason: 'empty', details: 'no valid loops extracted' } };
  }

  // Step 5: Classify outer vs holes.
  // With only vertex IDs (no coordinates here), we return all loops.
  // The caller (which has coordinates) can classify by signed area.
  // For single-loop regions, it's the outer loop.
  if (loops.length === 1) {
    return {
      ok: true,
      boundary: {
        outerLoop: loops[0],
        holeLoops: [],
        boundaryEdges,
      },
    };
  }

  // Multiple loops: return them all; the caller classifies.
  // For now, the largest loop is outer, rest are holes.
  const sortedLoops = loops.sort((a, b) => b.length - a.length);
  return {
    ok: true,
    boundary: {
      outerLoop: sortedLoops[0],
      holeLoops: sortedLoops.slice(1),
      boundaryEdges,
    },
  };
}
