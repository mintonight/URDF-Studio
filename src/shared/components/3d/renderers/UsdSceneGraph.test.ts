import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import { DEFAULT_LINK, GeometryType, type RobotData, type UsdSceneSnapshot } from '@/types';
import type { ViewerRobotDataResolution } from '@/features/urdf-viewer/utils/viewerRobotData';
import {
  buildUsdSceneGraphFromResolution,
  raycastUsdSceneGraph,
  updateUsdSceneGraphLinkTransform,
} from './UsdSceneGraph';

function createResolution(): ViewerRobotDataResolution {
  const robotData: RobotData = {
    name: 'usd_robot',
    rootLinkId: 'base_link',
    links: {
      base_link: {
        ...DEFAULT_LINK,
        id: 'base_link',
        name: 'base_link',
        visual: {
          ...DEFAULT_LINK.visual,
          type: GeometryType.MESH,
        },
        collision: {
          ...DEFAULT_LINK.collision,
          type: GeometryType.BOX,
        },
      },
    },
    joints: {},
    materials: {
      painted: {
        color: '#ff0000',
      },
    },
  };

  return {
    robotData,
    stageSourcePath: '/robots/demo.usd',
    linkIdByPath: {
      '/Robot/base_link': 'base_link',
    },
    linkPathById: {
      base_link: '/Robot/base_link',
    },
    jointPathById: {},
    childLinkPathByJointId: {},
    parentLinkPathByJointId: {},
    usdSceneSnapshot: {
      stageSourcePath: '/robots/demo.usd',
    } as UsdSceneSnapshot,
  };
}

test('buildUsdSceneGraphFromResolution preserves RobotData and maps runtime meshes by role', () => {
  const root = new THREE.Group();
  const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const collisionMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  const renderInterface = {
    meshes: {
      '/Robot/base_link/Visuals/mesh_0': { _mesh: visualMesh },
      '/Robot/base_link/Collisions/collider_0': { _mesh: collisionMesh },
    },
    getResolvedVisualTransformPrimPathForMeshId: (meshId: string) =>
      meshId.includes('Visuals') ? '/Robot/base_link/Visuals/mesh_0' : null,
    getResolvedPrimPathForMeshId: (meshId: string) =>
      meshId.includes('Collisions') ? '/Robot/base_link/Collisions/collider_0' : null,
  };

  const sceneGraph = buildUsdSceneGraphFromResolution({
    root,
    renderInterface,
    resolution: createResolution(),
    showVisual: true,
    showCollision: true,
  });

  assert.equal(sceneGraph.robotLinks.base_link?.name, 'base_link');
  assert.equal(sceneGraph.robotJoints && Object.keys(sceneGraph.robotJoints).length, 0);
  assert.equal(sceneGraph.rootLinkId, 'base_link');
  assert.equal(sceneGraph.robotData.materials?.painted?.color, '#ff0000');
  assert.deepEqual(
    [...sceneGraph.linkMeshMap.keys()].sort(),
    ['base_link:collision', 'base_link:visual'],
  );
  assert.equal(visualMesh.userData.parentLinkName, 'base_link');
  assert.equal(visualMesh.userData.usdMeshId, '/Robot/base_link/Visuals/mesh_0');
  assert.equal(visualMesh.userData.usdPrimPath, '/Robot/base_link/Visuals/mesh_0');
  assert.equal(visualMesh.userData.isVisualMesh, true);
  assert.equal(visualMesh.userData.visualObjectIndex, 0);
  assert.equal(collisionMesh.userData.parentLinkName, 'base_link');
  assert.equal(collisionMesh.userData.usdMeshId, '/Robot/base_link/Collisions/collider_0');
  assert.equal(collisionMesh.userData.usdPrimPath, '/Robot/base_link/Collisions/collider_0');
  assert.equal(collisionMesh.userData.isCollisionMesh, true);
  assert.equal(collisionMesh.userData.collisionObjectIndex, 0);
});

test('raycastUsdSceneGraph returns semantic USD hit metadata', () => {
  const root = new THREE.Group();
  const visualMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
  visualMesh.position.set(0, 0, 0);
  root.add(visualMesh);
  root.updateMatrixWorld(true);

  const sceneGraph = buildUsdSceneGraphFromResolution({
    root,
    renderInterface: {
      meshes: {
        '/Robot/base_link/Visuals/mesh_0': { _mesh: visualMesh },
      },
      getResolvedVisualTransformPrimPathForMeshId: () => '/Robot/base_link/Visuals/mesh_0',
    },
    resolution: createResolution(),
    showVisual: true,
    showCollision: true,
  });
  const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));

  const hits = raycastUsdSceneGraph(sceneGraph, { raycaster });

  assert.equal(hits.length, 1);
  assert.equal(hits[0]?.linkId, 'base_link');
  assert.equal(hits[0]?.subType, 'visual');
  assert.equal(hits[0]?.objectIndex, 0);
  assert.equal(hits[0]?.meshId, '/Robot/base_link/Visuals/mesh_0');
  assert.equal(hits[0]?.primPath, '/Robot/base_link/Visuals/mesh_0');
});

test('updateUsdSceneGraphLinkTransform applies matrix to selected USD mesh', () => {
  const root = new THREE.Group();
  const collisionMesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  root.add(collisionMesh);
  root.updateMatrixWorld(true);

  const sceneGraph = buildUsdSceneGraphFromResolution({
    root,
    renderInterface: {
      meshes: {
        '/Robot/base_link/Collisions/collider_0': { _mesh: collisionMesh },
      },
      getResolvedPrimPathForMeshId: () => '/Robot/base_link/Collisions/collider_0',
    },
    resolution: createResolution(),
    showVisual: true,
    showCollision: true,
  });
  const matrix = new THREE.Matrix4().makeTranslation(1, 2, 3);

  const updated = updateUsdSceneGraphLinkTransform(sceneGraph, {
    linkId: 'base_link',
    objectIndex: 0,
    isCollision: true,
    matrix,
  });

  assert.equal(updated, true);
  assert.deepEqual(collisionMesh.position.toArray(), [1, 2, 3]);
});
