import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

import {
  applyMeshVisibilityFilters,
  isCollisionMeshId,
} from "./visibility.js";

function createHydraMesh(name) {
  return {
    _mesh: new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()),
    ensureProtoReadyForVisibilityCalls: 0,
    ensureProtoReadyForVisibility() {
      this.ensureProtoReadyForVisibilityCalls += 1;
    },
  };
}

test("USD visibility classifies /colliders library meshes as collision meshes", () => {
  assert.equal(isCollisionMeshId("/colliders/left_hip_pitch_link/mesh"), true);
  assert.equal(isCollisionMeshId("/collider/left_hip_pitch_link/mesh"), true);
  assert.equal(
    isCollisionMeshId("/Robot/left_hip_pitch_link/collisions/left_hip_pitch_link/mesh"),
    true,
  );
});

test("USD visibility shows /colliders meshes in collision-only mode", () => {
  const visualHydraMesh = createHydraMesh("visual");
  const colliderHydraMesh = createHydraMesh("collider");

  const renderInterface = {
    meshes: {
      "/Robot/left_hip_pitch_link/visuals/left_hip_pitch_link/mesh": visualHydraMesh,
      "/colliders/left_hip_pitch_link/left_hip_pitch_link/mesh": colliderHydraMesh,
    },
  };

  applyMeshVisibilityFilters(renderInterface, false, true, true);

  assert.equal(visualHydraMesh._mesh.visible, false);
  assert.equal(colliderHydraMesh._mesh.visible, true);
  assert.equal(colliderHydraMesh._mesh.userData.geometryRole, "collision");
  assert.equal(colliderHydraMesh._mesh.userData.isCollisionMesh, true);
  assert.equal(colliderHydraMesh.ensureProtoReadyForVisibilityCalls, 0);
});

test("USD visibility toggles collision proto meshes without hydrating on click", () => {
  const protoCollisionHydraMesh = createHydraMesh("collision-proto");
  protoCollisionHydraMesh._mesh.visible = false;

  const renderInterface = {
    meshes: {
      "/Robot/base_link/collisions.proto_box_id0": protoCollisionHydraMesh,
    },
  };

  applyMeshVisibilityFilters(renderInterface, false, true, true);

  assert.equal(protoCollisionHydraMesh._mesh.visible, true);
  assert.equal(protoCollisionHydraMesh._mesh.userData.geometryRole, "collision");
  assert.equal(protoCollisionHydraMesh.ensureProtoReadyForVisibilityCalls, 0);
});
