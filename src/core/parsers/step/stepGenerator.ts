/**
 * STEP (ISO 10303-21) generator entry point.
 *
 * Delegates to the OpenCascade.js WASM kernel running in a Web Worker. This
 * module prepares the robot's visual geometry into link payloads (primitive
 * dimensions + world transforms, or mesh triangle data), then the worker
 * builds analytic B-rep solids and writes a spec-compliant STEP file.
 */

import * as THREE from 'three';

import { GeometryType } from '@/types';
import type { RobotData, UrdfVisual } from '@/types';
import { computeLinkWorldMatrices, createOriginMatrix } from '@/core/robot/kinematics';
import { getVisualGeometryEntries } from '@/core/robot/visualBodies';

import type { StepLinkPayload, StepShapePayload } from './stepOcctWorker';
import { exportStepWithWorker } from './stepOcctWorkerBridge';

export interface StepGeometryPayload {
  /** Triangles as flat vertex triples [x0,y0,z0, x1,y1,z1, ...] in link-local space. */
  positions: number[];
}

export interface StepGeometryProvider {
  /**
   * Load tessellated geometry for a mesh visual. Return null to skip the mesh.
   * The provider is responsible for applying any mesh-local scale stored on
   * the visual.
   */
  loadMeshGeometry: (visual: UrdfVisual, linkId: string) => Promise<StepGeometryPayload | null>;
}

export interface GenerateStepOptions {
  provider?: StepGeometryProvider;
  /** When false, skip MESH visuals entirely (only export primitives). Defaults to true. */
  includeMeshes?: boolean;
}

export interface StepExportResult {
  /** The raw STEP bytes. */
  content: string;
  /** Number of link products written. */
  linkCount: number;
  /** Number of geometry shapes written (primitives + mesh shells). */
  shapeCount: number;
}

/** Extract a column-major 4x4 matrix array from a THREE.Matrix4. */
function matrixToArray(matrix: THREE.Matrix4): number[] {
  const elements = matrix.elements;
  // THREE.Matrix4 stores elements in column-major order already.
  return Array.from(elements);
}

/**
 * Generate a complete STEP file for the robot's visual geometry via the OCCT
 * WASM kernel.
 */
export async function generateSTEP(
  robot: RobotData,
  options: GenerateStepOptions = {},
): Promise<StepExportResult> {
  const { provider, includeMeshes = true } = options;
  const linkWorldMatrices = computeLinkWorldMatrices(robot);
  const linkPayloads: StepLinkPayload[] = [];
  let shapeCount = 0;

  for (const link of Object.values(robot.links)) {
    const entries = getVisualGeometryEntries(link);
    if (entries.length === 0) continue;

    const linkWorld = linkWorldMatrices[link.id] ?? new THREE.Matrix4();
    const shapes: StepShapePayload[] = [];

    for (const entry of entries) {
      const visual = entry.geometry;
      const localMatrix = createOriginMatrix(visual.origin);
      const fullMatrix = new THREE.Matrix4().multiplyMatrices(linkWorld, localMatrix);

      switch (visual.type) {
        case GeometryType.BOX:
          shapes.push({
            type: 'box',
            dimensions: { ...visual.dimensions },
            matrix: matrixToArray(fullMatrix),
          });
          shapeCount++;
          break;
        case GeometryType.CYLINDER:
          shapes.push({
            type: 'cylinder',
            dimensions: { ...visual.dimensions },
            matrix: matrixToArray(fullMatrix),
          });
          shapeCount++;
          break;
        case GeometryType.SPHERE:
          shapes.push({
            type: 'sphere',
            dimensions: { ...visual.dimensions },
            matrix: matrixToArray(fullMatrix),
          });
          shapeCount++;
          break;
        case GeometryType.CAPSULE:
          shapes.push({
            type: 'capsule',
            dimensions: { ...visual.dimensions },
            matrix: matrixToArray(fullMatrix),
          });
          shapeCount++;
          break;
        case GeometryType.MESH:
          if (includeMeshes && provider) {
            const payload = await provider.loadMeshGeometry(visual, link.id);
            if (payload && payload.positions.length >= 9) {
              shapes.push({
                type: 'mesh',
                dimensions: { ...visual.dimensions },
                matrix: matrixToArray(fullMatrix),
                positions: payload.positions,
              });
              shapeCount++;
            }
          }
          break;
        default:
          // PLANE, ELLIPSOID, HFIELD, POLYLINE, SDF, NONE — skipped.
          break;
      }
    }

    if (shapes.length === 0) continue;

    linkPayloads.push({
      linkId: link.id,
      linkName: link.name || link.id,
      shapes,
    });
  }

  const result = await exportStepWithWorker({
    robotName: robot.name || 'robot',
    links: linkPayloads,
  });

  // Decode the STEP bytes to a string for the download pipeline (which expects
  // a string content for consistency with other generators).
  const decoder = new TextDecoder('utf-8');

  return {
    content: decoder.decode(result.data),
    linkCount: result.linkCount,
    shapeCount: shapeCount,
  };
}
