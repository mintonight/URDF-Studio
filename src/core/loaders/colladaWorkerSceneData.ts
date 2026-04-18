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

function stripColladaImagesWithoutInitFrom(content: string): string {
  const parser = new DOMParser();
  const xml = parser.parseFromString(content, 'application/xml');
  const imageNodes = Array.from(xml.getElementsByTagName('image'));
  const invalidImageIds = new Set<string>();
  let mutated = false;

  imageNodes.forEach((imageNode) => {
    const imageId = imageNode.getAttribute('id')?.trim();
    const hasConcreteInitFrom = Array.from(imageNode.getElementsByTagName('init_from')).some(
      (initFromNode) => Boolean(initFromNode.textContent?.trim()),
    );

    if (hasConcreteInitFrom) {
      return;
    }

    if (imageId) {
      invalidImageIds.add(imageId);
    }

    imageNode.parentNode?.removeChild(imageNode);
    mutated = true;
  });

  if (invalidImageIds.size > 0) {
    Array.from(xml.getElementsByTagName('effect')).forEach((effectNode) => {
      const profileNode = effectNode.getElementsByTagName('profile_COMMON')[0];
      if (!profileNode) {
        return;
      }

      const surfaceNodesBySid = new Map<string, Element>();
      const surfaceImageIdsBySid = new Map<string, string>();
      const samplerNodesBySid = new Map<string, Element>();
      const samplerSourceBySid = new Map<string, string>();

      Array.from(profileNode.getElementsByTagName('newparam')).forEach((newparamNode) => {
        const sid = newparamNode.getAttribute('sid')?.trim();
        if (!sid) {
          return;
        }

        const surfaceNode = newparamNode.getElementsByTagName('surface')[0];
        if (surfaceNode) {
          surfaceNodesBySid.set(sid, newparamNode);
          const initFrom = getTrimmedNodeText(surfaceNode, 'init_from');
          if (initFrom) {
            surfaceImageIdsBySid.set(sid, initFrom);
          }
        }

        const samplerNode = newparamNode.getElementsByTagName('sampler2D')[0];
        if (samplerNode) {
          samplerNodesBySid.set(sid, newparamNode);
          const source = getTrimmedNodeText(samplerNode, 'source');
          if (source) {
            samplerSourceBySid.set(sid, source);
          }
        }
      });

      const invalidSurfaceSids = new Set<string>();
      surfaceNodesBySid.forEach((_node, sid) => {
        const imageId = surfaceImageIdsBySid.get(sid);
        if (!imageId || invalidImageIds.has(imageId)) {
          invalidSurfaceSids.add(sid);
        }
      });

      const invalidSamplerSids = new Set<string>();
      samplerNodesBySid.forEach((_node, sid) => {
        const source = samplerSourceBySid.get(sid);
        if (!source || invalidSurfaceSids.has(source)) {
          invalidSamplerSids.add(sid);
        }
      });

      invalidSurfaceSids.forEach((sid) => {
        surfaceNodesBySid.get(sid)?.parentNode?.removeChild(surfaceNodesBySid.get(sid)!);
        mutated = true;
      });

      invalidSamplerSids.forEach((sid) => {
        samplerNodesBySid.get(sid)?.parentNode?.removeChild(samplerNodesBySid.get(sid)!);
        mutated = true;
      });

      Array.from(profileNode.getElementsByTagName('texture')).forEach((textureNode) => {
        const textureId = textureNode.getAttribute('texture')?.trim();
        if (
          textureId &&
          (invalidImageIds.has(textureId) ||
            invalidSurfaceSids.has(textureId) ||
            invalidSamplerSids.has(textureId))
        ) {
          textureNode.parentNode?.removeChild(textureNode);
          mutated = true;
        }
      });
    });
  }

  if (!mutated) {
    return content;
  }

  return new XMLSerializer().serializeToString(xml);
}

function getTrimmedNodeText(node: Element, tagName: string): string | null {
  return (
    Array.from(node.getElementsByTagName(tagName))
      .map((entry) => entry.textContent?.trim() ?? '')
      .find((value) => value.length > 0) ?? null
  );
}

function normalizeColladaTextureSamplerBindings(content: string): string {
  const parser = new DOMParser();
  const xml = parser.parseFromString(content, 'application/xml');
  const effectNodes = Array.from(xml.getElementsByTagName('effect'));
  let mutated = false;

  effectNodes.forEach((effectNode) => {
    const profileNode = effectNode.getElementsByTagName('profile_COMMON')[0];
    if (!profileNode) {
      return;
    }

    const surfaceInitFromBySid = new Map<string, string>();
    const samplerSourceBySid = new Map<string, string>();

    Array.from(profileNode.getElementsByTagName('newparam')).forEach((newparamNode) => {
      const sid = newparamNode.getAttribute('sid')?.trim();
      if (!sid) {
        return;
      }

      const surfaceNode = newparamNode.getElementsByTagName('surface')[0];
      if (surfaceNode) {
        const initFrom = getTrimmedNodeText(surfaceNode, 'init_from');
        if (initFrom) {
          surfaceInitFromBySid.set(sid, initFrom);
        }
      }

      const samplerNode = newparamNode.getElementsByTagName('sampler2D')[0];
      if (samplerNode) {
        const source = getTrimmedNodeText(samplerNode, 'source');
        if (source) {
          samplerSourceBySid.set(sid, source);
        }
      }
    });

    if (samplerSourceBySid.size === 0 || surfaceInitFromBySid.size === 0) {
      return;
    }

    const samplerIdsByImageId = new Map<string, string[]>();
    samplerSourceBySid.forEach((surfaceSid, samplerSid) => {
      const imageId = surfaceInitFromBySid.get(surfaceSid);
      if (!imageId) {
        return;
      }

      const samplerIds = samplerIdsByImageId.get(imageId) ?? [];
      samplerIds.push(samplerSid);
      samplerIdsByImageId.set(imageId, samplerIds);
    });

    Array.from(profileNode.getElementsByTagName('texture')).forEach((textureNode) => {
      const textureId = textureNode.getAttribute('texture')?.trim();
      if (!textureId || samplerSourceBySid.has(textureId)) {
        return;
      }

      const samplerIds = samplerIdsByImageId.get(textureId) ?? [];
      if (samplerIds.length === 0) {
        return;
      }

      const conventionalSamplerId = `${textureId}-sampler`;
      const nextTextureId =
        samplerIds.find((samplerId) => samplerId === conventionalSamplerId) ??
        (samplerIds.length === 1 ? samplerIds[0] : null);

      if (!nextTextureId || nextTextureId === textureId) {
        return;
      }

      textureNode.setAttribute('texture', nextTextureId);
      mutated = true;
    });
  });

  if (!mutated) {
    return content;
  }

  return new XMLSerializer().serializeToString(xml);
}

export function parseColladaSceneData(
  content: string,
  assetUrl: string,
): SerializedColladaSceneData {
  ensureWorkerXmlDomApis();
  const { content: upAxisNormalizedContent } = normalizeColladaUpAxis(content);
  const normalizedContent = normalizeColladaTextureSamplerBindings(
    stripColladaImagesWithoutInitFrom(upAxisNormalizedContent),
  );
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

  scene.userData = {
    ...(scene.userData ?? {}),
    colladaUnitScale: data.unitScale ?? null,
  };

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
