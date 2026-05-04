import {
    type BufferAttribute,
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    type InterleavedBufferAttribute,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    MeshPhongMaterial,
    Points,
    PointsMaterial,
    type Material,
    type Object3D,
} from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';

export const GENERATED_OBJ_MATERIAL_USER_DATA_KEY = '__urdfStudioGeneratedObjMaterial';

export interface SerializedObjAttributeData {
    array: ArrayBuffer;
    itemSize: number;
    normalized?: boolean;
}

export interface SerializedObjGeometryGroup {
    count: number;
    materialIndex: number;
    start: number;
}

export interface SerializedObjGeometryData {
    color?: SerializedObjAttributeData;
    groups: SerializedObjGeometryGroup[];
    normal?: SerializedObjAttributeData;
    position: SerializedObjAttributeData;
    uv?: SerializedObjAttributeData;
}

export interface SerializedObjMaterialData {
    color: number;
    flatShading?: boolean;
    kind: 'mesh-phong' | 'line-basic' | 'points';
    name: string;
    size?: number;
    sizeAttenuation?: boolean;
    vertexColors: boolean;
}

export interface SerializedObjNodeData {
    geometry: SerializedObjGeometryData;
    kind: 'mesh' | 'line-segments' | 'points';
    materials: SerializedObjMaterialData[];
    name: string;
}

export interface SerializedObjModelData {
    children: SerializedObjNodeData[];
    materialLibraries: string[];
}

function extractTransferableBuffer(array: Float32Array): ArrayBuffer {
    if (array.byteOffset === 0 && array.byteLength === array.buffer.byteLength) {
        return array.buffer;
    }

    return array.slice().buffer;
}

function serializeFloat32Attribute(attribute: BufferAttribute | InterleavedBufferAttribute): SerializedObjAttributeData {
    const float32Array = attribute.array instanceof Float32Array
        ? attribute.array
        : new Float32Array(attribute.array as ArrayLike<number>);

    return {
        array: extractTransferableBuffer(float32Array),
        itemSize: attribute.itemSize,
        normalized: attribute.normalized,
    };
}

function serializeObjMaterial(material: Material): SerializedObjMaterialData {
    if ((material as LineBasicMaterial).isLineBasicMaterial) {
        const lineMaterial = material as LineBasicMaterial;
        return {
            kind: 'line-basic',
            name: lineMaterial.name,
            color: lineMaterial.color.getHex(),
            vertexColors: lineMaterial.vertexColors === true,
        };
    }

    if ((material as PointsMaterial).isPointsMaterial) {
        const pointsMaterial = material as PointsMaterial;
        return {
            kind: 'points',
            name: pointsMaterial.name,
            color: pointsMaterial.color.getHex(),
            size: pointsMaterial.size,
            sizeAttenuation: pointsMaterial.sizeAttenuation,
            vertexColors: pointsMaterial.vertexColors === true,
        };
    }

    if ((material as MeshPhongMaterial).isMeshPhongMaterial) {
        const meshMaterial = material as MeshPhongMaterial;
        return {
            kind: 'mesh-phong',
            name: meshMaterial.name,
            color: meshMaterial.color.getHex(),
            flatShading: meshMaterial.flatShading,
            vertexColors: meshMaterial.vertexColors === true,
        };
    }

    throw new Error(`Unsupported OBJ material type: ${material.type}`);
}

function serializeObjNode(node: Object3D): SerializedObjNodeData {
    const geometryOwner = node as Mesh | LineSegments | Points;
    const geometry = geometryOwner.geometry;
    const position = geometry.getAttribute('position');
    if (!position) {
        throw new Error(`OBJ node "${node.name}" is missing a position attribute`);
    }

    const normal = geometry.getAttribute('normal');
    const color = geometry.getAttribute('color');
    const uv = geometry.getAttribute('uv');
    const materials = Array.isArray(geometryOwner.material)
        ? geometryOwner.material
        : [geometryOwner.material];

    let kind: SerializedObjNodeData['kind'] = 'mesh';
    if ((node as LineSegments).isLineSegments) {
        kind = 'line-segments';
    } else if ((node as Points).isPoints) {
        kind = 'points';
    }

    return {
        kind,
        name: node.name,
        materials: materials.map(serializeObjMaterial),
        geometry: {
            position: serializeFloat32Attribute(position),
            normal: normal ? serializeFloat32Attribute(normal) : undefined,
            color: color ? serializeFloat32Attribute(color) : undefined,
            uv: uv ? serializeFloat32Attribute(uv) : undefined,
            groups: geometry.groups.map((group) => ({
                start: group.start,
                count: group.count,
                materialIndex: group.materialIndex,
            })),
        },
    };
}

export function parseObjModelData(text: string): SerializedObjModelData {
    const object = new OBJLoader().parse(text);
    return {
        materialLibraries: [...((object as Group & { materialLibraries?: string[] }).materialLibraries ?? [])],
        children: object.children.map(serializeObjNode),
    };
}

function createFloat32Attribute(data: SerializedObjAttributeData): Float32BufferAttribute {
    return new Float32BufferAttribute(new Float32Array(data.array), data.itemSize, data.normalized);
}

function createGeometryFromSerializedObjNode(node: SerializedObjNodeData): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', createFloat32Attribute(node.geometry.position));

    if (node.geometry.normal) {
        geometry.setAttribute('normal', createFloat32Attribute(node.geometry.normal));
    }

    if (node.geometry.color) {
        geometry.setAttribute('color', createFloat32Attribute(node.geometry.color));
    }

    if (node.geometry.uv) {
        geometry.setAttribute('uv', createFloat32Attribute(node.geometry.uv));
    }

    node.geometry.groups.forEach((group) => {
        geometry.addGroup(group.start, group.count, group.materialIndex);
    });

    return geometry;
}

function createMaterialFromSerializedObjMaterial(
    data: SerializedObjMaterialData,
    options: { forceVertexColors?: boolean } = {},
): Material {
    const vertexColors = data.vertexColors || options.forceVertexColors === true;
    const materialColor = vertexColors ? 0xffffff : data.color;

    if (data.kind === 'line-basic') {
        const material = new LineBasicMaterial({ color: materialColor });
        material.name = data.name;
        material.vertexColors = vertexColors;
        material.toneMapped = vertexColors ? false : material.toneMapped;
        material.userData = {
            ...(material.userData ?? {}),
            [GENERATED_OBJ_MATERIAL_USER_DATA_KEY]: true,
            ...(vertexColors ? { usesVertexColors: true } : {}),
        };
        return material;
    }

    if (data.kind === 'points') {
        const material = new PointsMaterial({
            color: materialColor,
            size: data.size ?? 1,
            sizeAttenuation: data.sizeAttenuation ?? false,
        });
        material.name = data.name;
        material.vertexColors = vertexColors;
        material.toneMapped = vertexColors ? false : material.toneMapped;
        material.userData = {
            ...(material.userData ?? {}),
            [GENERATED_OBJ_MATERIAL_USER_DATA_KEY]: true,
            ...(vertexColors ? { usesVertexColors: true } : {}),
        };
        return material;
    }

    const material = new MeshPhongMaterial({
        color: materialColor,
        flatShading: data.flatShading ?? false,
    });
    material.name = data.name;
    material.vertexColors = vertexColors;
    material.toneMapped = vertexColors ? false : material.toneMapped;
    material.userData = {
        ...(material.userData ?? {}),
        [GENERATED_OBJ_MATERIAL_USER_DATA_KEY]: true,
        ...(vertexColors ? { usesVertexColors: true } : {}),
    };
    return material;
}

function createObjectFromSerializedObjNode(node: SerializedObjNodeData): Object3D {
    const geometry = createGeometryFromSerializedObjNode(node);
    const usesVertexColors = Boolean(node.geometry.color);
    const materials = node.materials.map((material) => (
        createMaterialFromSerializedObjMaterial(material, {
            forceVertexColors: usesVertexColors,
        })
    ));
    const material = materials.length > 1 ? materials : materials[0];
    let object: Object3D;

    if (node.kind === 'line-segments') {
        object = new LineSegments(geometry, material);
    } else if (node.kind === 'points') {
        object = new Points(geometry, material);
    } else {
        object = new Mesh(geometry, material);
    }

    object.name = node.name;
    return object;
}

export function createObjectFromSerializedObjData(data: SerializedObjModelData): Group {
    const container = new Group() as Group & { materialLibraries?: string[] };
    container.materialLibraries = [...data.materialLibraries];

    data.children.forEach((child) => {
        container.add(createObjectFromSerializedObjNode(child));
    });

    return container;
}

export function collectSerializedObjTransferables(data: SerializedObjModelData): ArrayBuffer[] {
    const transferables: ArrayBuffer[] = [];

    data.children.forEach((child) => {
        transferables.push(child.geometry.position.array);
        if (child.geometry.normal) {
            transferables.push(child.geometry.normal.array);
        }
        if (child.geometry.color) {
            transferables.push(child.geometry.color.array);
        }
        if (child.geometry.uv) {
            transferables.push(child.geometry.uv.array);
        }
    });

    return transferables;
}
