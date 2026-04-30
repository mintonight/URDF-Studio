import { Group } from "three";
import { createOriginAxes } from "../../utils/visualizationFactories.ts";

function getLinkPathFromMeshId(meshId) {
    if (!meshId)
        return null;
    const normalized = String(meshId || "").trim();
    if (!normalized)
        return null;
    const marker = ".proto_";
    const markerIndex = normalized.indexOf(marker);
    if (markerIndex > 0) {
        let linkPath = normalized.substring(0, markerIndex);
        if (linkPath.endsWith("/visuals") || linkPath.endsWith("/collisions") || linkPath.endsWith("/collision") || linkPath.endsWith("/colliders") || linkPath.endsWith("/collider")) {
            const parentSlash = linkPath.lastIndexOf("/");
            if (parentSlash > 0)
                linkPath = linkPath.substring(0, parentSlash);
        }
        return linkPath || null;
    }
    const authoredPathMatch = normalized.match(/^(.*?)(?:\/(?:visuals?|coll(?:isions?|iders?)))(?:$|[/.])/i);
    if (authoredPathMatch && authoredPathMatch[1]) {
        return authoredPathMatch[1];
    }
    return null;
}

function normalizeLinkAxesOptions(optionsOrShowLinkAxes) {
    if (typeof optionsOrShowLinkAxes === "boolean") {
        return {
            axisSize: 1,
            overlay: false,
            showLinkAxes: optionsOrShowLinkAxes,
        };
    }
    const options = optionsOrShowLinkAxes && typeof optionsOrShowLinkAxes === "object"
        ? optionsOrShowLinkAxes
        : {};
    const axisSize = Number(options.axisSize);
    return {
        axisSize: Number.isFinite(axisSize) ? Math.max(axisSize, 1e-4) : 1,
        linkFrameResolver: typeof options.linkFrameResolver === "function" ? options.linkFrameResolver : null,
        overlay: options.overlay === true,
        showLinkAxes: options.showLinkAxes === true,
    };
}

function getRepresentativeMeshMatrixForLinkPath(renderInterface, linkPath) {
    if (!renderInterface?.meshes || !linkPath)
        return null;
    const prefix = `${linkPath}/`;
    let preferredVisual = null;
    let fallback = null;
    for (const [meshId, hydraMesh] of Object.entries(renderInterface.meshes)) {
        if (!meshId.startsWith(prefix))
            continue;
        const matrix = hydraMesh?._mesh?.matrix;
        if (!matrix)
            continue;
        if (/\/visuals\.proto_mesh_id0$/i.test(meshId)) {
            return matrix.clone();
        }
        if (/\/visuals\.proto_/i.test(meshId)) {
            if (!preferredVisual)
                preferredVisual = matrix.clone();
            continue;
        }
        if (!fallback)
            fallback = matrix.clone();
    }
    return preferredVisual || fallback || null;
}

function applyOverlayMaterialState(object, overlay) {
    object.traverse((child) => {
        const material = child?.material;
        const materials = Array.isArray(material) ? material : [material];
        for (const entry of materials) {
            if (!entry)
                continue;
            entry.depthTest = !overlay;
            entry.depthWrite = !overlay;
            entry.transparent = overlay ? true : false;
            entry.needsUpdate = true;
        }
        if (child.isMesh) {
            child.renderOrder = overlay ? 10001 : 0;
        }
    });
}

function disposeObject(object) {
    object.traverse((child) => {
        child.geometry?.dispose?.();
        const disposeMaterial = (material) => {
            if (!material)
                return;
            material.map?.dispose?.();
            material.alphaMap?.dispose?.();
            material.dispose?.();
        };
        if (Array.isArray(child.material)) {
            for (const material of child.material)
                disposeMaterial(material);
        }
        else {
            disposeMaterial(child.material);
        }
    });
}

export class LinkAxesController {
    constructor() {
        this.linkAxesGroup = null;
    }
    clear(usdRoot) {
        if (!this.linkAxesGroup)
            return;
        usdRoot.remove(this.linkAxesGroup);
        disposeObject(this.linkAxesGroup);
        this.linkAxesGroup = null;
    }
    rebuild(usdRoot, renderInterface, optionsOrShowLinkAxes) {
        this.clear(usdRoot);
        const options = normalizeLinkAxesOptions(optionsOrShowLinkAxes);
        if (!options.showLinkAxes || !renderInterface?.meshes || !renderInterface.getWorldTransformForPrimPath)
            return;
        const group = new Group();
        group.name = "Link Axes";
        const linkPaths = new Set();
        for (const meshId of Object.keys(renderInterface.meshes)) {
            const linkPath = getLinkPathFromMeshId(meshId);
            if (!linkPath)
                continue;
            linkPaths.add(linkPath);
        }
        const getWorldTransformForLink = (linkPath) => {
            const currentLinkFrameMatrix = options.linkFrameResolver?.(linkPath);
            if (currentLinkFrameMatrix) {
                return currentLinkFrameMatrix.clone?.() || currentLinkFrameMatrix;
            }
            if (typeof renderInterface.getPreferredLinkWorldTransform === "function") {
                const preferred = renderInterface.getPreferredLinkWorldTransform(linkPath);
                if (preferred)
                    return preferred;
            }
            return renderInterface.getWorldTransformForPrimPath?.(linkPath)
                || getRepresentativeMeshMatrixForLinkPath(renderInterface, linkPath)
                || null;
        };
        const sortedPaths = Array.from(linkPaths).sort((left, right) => left.localeCompare(right));
        for (const linkPath of sortedPaths) {
            const matrix = getWorldTransformForLink(linkPath);
            if (!matrix)
                continue;
            const originAxes = createOriginAxes(options.axisSize);
            originAxes.name = `origin:${linkPath}`;
            originAxes.userData = {
                ...originAxes.userData,
                viewerHelperKind: "origin-axes",
                usdLinkPath: linkPath,
            };
            applyOverlayMaterialState(originAxes, options.overlay);
            originAxes.matrixAutoUpdate = false;
            originAxes.matrix.copy(matrix);
            originAxes.updateMatrixWorld(true);
            group.add(originAxes);
        }
        if (group.children.length === 0) {
            disposeObject(group);
            return;
        }
        this.linkAxesGroup = group;
        usdRoot.add(group);
    }
}
