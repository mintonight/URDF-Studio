import {
    collisionBaseMaterial,
    resolveCollisionRenderOrder,
    syncCollisionBaseMaterialPriority,
} from "../../utils/materials.ts";

const VISUAL_SEGMENT_PATTERN = /(?:^|\/)visuals?(?:$|[/.])/i;
const COLLISION_SEGMENT_PATTERN = /(?:^|\/)coll(?:isions?|iders?)(?:$|[/.])/i;
function matchesVisualIdentifier(value = "") {
    const source = String(value || "").toLowerCase();
    return VISUAL_SEGMENT_PATTERN.test(source);
}
function matchesCollisionIdentifier(value = "") {
    const source = String(value || "").toLowerCase();
    return COLLISION_SEGMENT_PATTERN.test(source);
}
export function isVisualMeshId(meshId, meshName = "") {
    return matchesVisualIdentifier(meshId) || matchesVisualIdentifier(meshName);
}
export function isCollisionMeshId(meshId, meshName = "") {
    return matchesCollisionIdentifier(meshId) || matchesCollisionIdentifier(meshName);
}
function getMeshMaterials(mesh) {
    if (!mesh?.material)
        return [];
    return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}
function setCollisionMeshStyle(mesh, enabled, alwaysOnTop) {
    const stateKey = "usdViewerCollisionMeshState";
    if (!mesh.userData[stateKey]) {
        mesh.userData[stateKey] = {
            material: mesh.material,
            renderOrder: mesh.renderOrder,
        };
    }

    if (enabled) {
        syncCollisionBaseMaterialPriority(alwaysOnTop);
        mesh.material = collisionBaseMaterial;
        mesh.renderOrder = resolveCollisionRenderOrder(alwaysOnTop);
        return;
    }

    if (mesh.userData[stateKey].material) {
        mesh.material = mesh.userData[stateKey].material;
    }
    mesh.renderOrder = mesh.userData[stateKey].renderOrder;
}
export function applyMeshVisibilityFilters(
    renderInterface,
    showVisualMeshes,
    showCollisionMeshes,
    collisionAlwaysOnTop = true,
) {
    if (!renderInterface?.meshes)
        return;
    for (const [meshId, hydraMesh] of Object.entries(renderInterface.meshes)) {
        const mesh = hydraMesh?._mesh;
        if (!mesh)
            continue;
        const meshName = mesh.name || "";
        if (isCollisionMeshId(meshId, meshName)) {
            mesh.userData = mesh.userData || {};
            mesh.userData.isCollisionMesh = true;
            mesh.userData.geometryRole = "collision";
            mesh.visible = showCollisionMeshes;
            setCollisionMeshStyle(mesh, showCollisionMeshes, collisionAlwaysOnTop);
            continue;
        }
        if (isVisualMeshId(meshId, meshName)) {
            mesh.userData = mesh.userData || {};
            mesh.userData.isVisualMesh = true;
            mesh.userData.geometryRole = "visual";
            mesh.visible = showVisualMeshes;
            continue;
        }
        mesh.userData = mesh.userData || {};
        if (!mesh.userData.geometryRole) {
            mesh.userData.geometryRole = "visual";
        }
        mesh.visible = true;
    }
}
