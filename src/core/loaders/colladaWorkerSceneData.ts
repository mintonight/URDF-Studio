import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';

import { ensureWorkerXmlDomApis } from '@/core/utils/ensureWorkerXmlDomApis';

import { normalizeColladaUpAxis } from './colladaUpAxis';

export interface SerializedColladaSceneData {
  resourcePath: string;
  sceneJson: Record<string, unknown>;
  unitScale?: number | null;
}

interface SerializedSceneImageRecord {
  url?: string | string[];
  uuid?: string;
}

const EXTERNAL_IMAGE_URL_PATTERN = /^(\/\/)|([a-z]+:(\/\/)?)/i;
const COLLADA_UNIT_METER_PATTERN = /<unit\b[^>]*\bmeter=["']([^"']+)["'][^>]*>/i;

export function canSerializeColladaInWorker(_content: string): boolean {
  return true;
}

function parseColladaUnitScale(content: string): number | null {
  const match = content.match(COLLADA_UNIT_METER_PATTERN);
  if (!match) {
    return null;
  }

  const parsed = Number.parseFloat(match[1]);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed === 1) {
    return null;
  }

  return parsed;
}

function captureTextureSourceUrls<T>(run: () => T): {
  capturedImageUrls: Map<string, string>;
  result: T;
} {
  const capturedImageUrls = new Map<string, string>();
  const originalTextureLoad = THREE.TextureLoader.prototype.load;

  THREE.TextureLoader.prototype.load = function patchedTextureLoad(
    url,
    onLoad,
    onProgress,
    onError,
  ) {
    const texture = originalTextureLoad.call(this, url, onLoad, onProgress, onError);
    capturedImageUrls.set(texture.source.uuid, url);
    return texture;
  };

  try {
    return {
      result: run(),
      capturedImageUrls,
    };
  } finally {
    THREE.TextureLoader.prototype.load = originalTextureLoad;
  }
}

function applyCapturedColladaImageUrls(
  sceneJson: Record<string, unknown>,
  capturedImageUrls: Map<string, string>,
): void {
  const images = sceneJson.images;
  if (!Array.isArray(images)) {
    return;
  }

  images.forEach((entry) => {
    const image = entry as SerializedSceneImageRecord;
    if (!image.uuid) {
      return;
    }

    const capturedUrl = capturedImageUrls.get(image.uuid);
    if (!capturedUrl) {
      return;
    }

    image.url = capturedUrl;
  });
}

/**
 * Three.js ColladaLoader has several places where it accesses `.textContent` on
 * the result of `getElementsByTagName(...)[0]` without null-checking the index.
 * Known crash sites in ColladaLoader.js:
 *   - line 1089: `getElementsByTagName(xml, 'init_from')[0].textContent`
 *   - line 3033: `child.getElementsByTagName('param')[0]` then `.textContent`
 *   - line 2788:  `child.getElementsByTagName('max')[0]` / `'min'`
 *
 * Use DOMParser to walk the tree and inject placeholder children where needed
 * so the ColladaLoader doesn't crash.
 */
function sanitizeColladaXmlForThreeJs(content: string): string {
  ensureWorkerXmlDomApis();

  const parser = new DOMParser();
  const doc = parser.parseFromString(content, 'application/xml');

  // Check for parse errors
  const parserError = doc.getElementsByTagName('parsererror');
  if (parserError.length > 0) {
    console.warn('[ColladaSanitize] XML parse error detected, skipping sanitization');
    return content;
  }

  let patched = false;

  const patchMissingChild = (
    parent: Element,
    childLocalName: string,
    placeholderValue: string,
  ): void => {
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i += 1) {
      const child = children[i];
      if (child.nodeType === 1 && child.nodeName === childLocalName) {
        return; // Child exists, no patch needed
      }
    }
    // Child not found — inject placeholder
    const placeholder = doc.createElement(childLocalName);
    placeholder.textContent = placeholderValue;
    parent.appendChild(placeholder);
    patched = true;
  };

  // Fix <image> elements missing <init_from>
  const images = doc.getElementsByTagName('image');
  for (let i = 0; i < images.length; i += 1) {
    patchMissingChild(images[i], 'init_from', '');
  }

  // Fix <limits> elements missing <max> or <min>
  const limits = doc.getElementsByTagName('limits');
  for (let i = 0; i < limits.length; i += 1) {
    patchMissingChild(limits[i], 'max', '0');
    patchMissingChild(limits[i], 'min', '0');
  }

  // Fix <axis> elements missing <param>
  const axes = doc.getElementsByTagName('axis');
  for (let i = 0; i < axes.length; i += 1) {
    patchMissingChild(axes[i], 'param', '');
  }

  if (!patched) {
    return content;
  }

  const serializer = new XMLSerializer();
  return serializer.serializeToString(doc);
}

/**
 * Three.js ColladaLoader computes opacity as `color[3] * transparency.float`
 * with the default `A_ONE` opaque mode. When a COLLADA file has
 * `<transparency>0.0</transparency>` (meaning fully opaque), this yields
 * opacity 0 — making the mesh invisible. Gazebo and Blender exports often
 * omit the `opaque` attribute, defaulting to `A_ONE`.
 *
 * Correct the opacity when ColladaLoader produces a transparent material
 * with opacity 0 and no authored alpha map: this is a degenerate case where
 * the intended result is an opaque surface.
 */
function fixDegenerateColladaOpacity(scene: THREE.Object3D): void {
  scene.traverse((child: THREE.Object3D) => {
    if (!(child as THREE.Mesh).isMesh) {
      return;
    }

    const mesh = child as THREE.Mesh;
    const materials: THREE.Material[] = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];

    materials.forEach((material) => {
      if (
        material.transparent &&
        material.opacity === 0 &&
        !(material as THREE.MeshPhongMaterial).alphaMap
      ) {
        material.transparent = false;
        material.opacity = 1;
      }
    });
  });
}

export function parseColladaSceneData(
  content: string,
  assetUrl: string,
): SerializedColladaSceneData {
  ensureWorkerXmlDomApis();
  const { content: normalizedContent } = normalizeColladaUpAxis(content);
  const sanitizedContent = sanitizeColladaXmlForThreeJs(normalizedContent);
  const loader = new ColladaLoader();
  const baseUrl = THREE.LoaderUtils.extractUrlBase(assetUrl);
  const { capturedImageUrls, result: scene } = captureTextureSourceUrls(
    () => loader.parse(sanitizedContent, baseUrl).scene,
  );
  fixDegenerateColladaOpacity(scene);
  const sceneJson = scene.toJSON() as unknown as Record<string, unknown>;
  applyCapturedColladaImageUrls(sceneJson, capturedImageUrls);

  return {
    resourcePath: baseUrl,
    sceneJson,
    unitScale: parseColladaUnitScale(normalizedContent),
  };
}

export function createSceneFromSerializedColladaData(
  data: SerializedColladaSceneData,
  options: { manager?: THREE.LoadingManager } = {},
): THREE.Object3D {
  ensureWorkerXmlDomApis();
  const objectLoader = new THREE.ObjectLoader(options.manager);
  objectLoader.setResourcePath(data.resourcePath);
  const sceneJson = resolveSerializedColladaImageUrls(data, options.manager);
  const scene = objectLoader.parse(sceneJson);

  if (data.unitScale && data.unitScale > 0 && data.unitScale !== 1) {
    scene.scale.multiplyScalar(data.unitScale);
  }

  return scene;
}

function resolveSerializedColladaImageUrl(
  url: string,
  resourcePath: string,
  manager?: THREE.LoadingManager,
): string {
  const resourceUrl = EXTERNAL_IMAGE_URL_PATTERN.test(url) ? url : `${resourcePath}${url}`;

  if (typeof manager?.resolveURL === 'function') {
    return manager.resolveURL(resourceUrl);
  }

  return resourceUrl;
}

function resolveSerializedColladaImageUrls(
  data: SerializedColladaSceneData,
  manager?: THREE.LoadingManager,
): Record<string, unknown> {
  const images = Array.isArray(data.sceneJson.images)
    ? (data.sceneJson.images as SerializedSceneImageRecord[])
    : null;

  if (!images || images.length === 0) {
    return data.sceneJson;
  }

  const resolvedImages = images.map((image) => {
    if (typeof image.url === 'string') {
      return {
        ...image,
        url: resolveSerializedColladaImageUrl(image.url, data.resourcePath, manager),
      };
    }

    if (Array.isArray(image.url)) {
      return {
        ...image,
        url: image.url.map((entry) =>
          typeof entry === 'string'
            ? resolveSerializedColladaImageUrl(entry, data.resourcePath, manager)
            : entry,
        ),
      };
    }

    return image;
  });

  return {
    ...data.sceneJson,
    images: resolvedImages,
  };
}
