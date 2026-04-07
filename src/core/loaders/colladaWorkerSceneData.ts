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

export function parseColladaSceneData(
  content: string,
  assetUrl: string,
): SerializedColladaSceneData {
  ensureWorkerXmlDomApis();
  const { content: normalizedContent } = normalizeColladaUpAxis(content);
  const loader = new ColladaLoader();
  const baseUrl = THREE.LoaderUtils.extractUrlBase(assetUrl);
  const { capturedImageUrls, result: scene } = captureTextureSourceUrls(
    () => loader.parse(normalizedContent, baseUrl).scene,
  );
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
