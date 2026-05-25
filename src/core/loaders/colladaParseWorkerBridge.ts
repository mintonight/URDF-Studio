import * as THREE from 'three';

import {
  canSerializeColladaInWorker,
  createSceneFromSerializedColladaData,
  type SerializedColladaSceneData,
} from './colladaWorkerSceneData';
import type {
  ColladaParseWorkerResponse,
  ParseColladaWorkerRequest,
} from './colladaParseWorkerProtocol';
import {
  createWorkerPoolClient,
  resolveDefaultWorkerCount,
  type WorkerLike,
} from '@/core/workers/workerPoolClient';

interface CreateColladaParseWorkerPoolClientOptions {
  cacheLimit?: number;
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  getWorkerCount?: () => number;
}

interface ColladaParseWorkerPoolClient {
  clearCache: () => void;
  dispose: (rejectPendingWith?: unknown) => void;
  load: (assetUrl: string, manager: THREE.LoadingManager) => Promise<THREE.Object3D>;
  loadSerialized: (assetUrl: string) => Promise<SerializedColladaSceneData>;
}

const DEFAULT_CACHE_LIMIT = 300;
const FAILURE_CACHE_LIMIT = 200;

export function createColladaParseWorkerPoolClient({
  cacheLimit = DEFAULT_CACHE_LIMIT,
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('./workers/colladaParse.worker.ts', import.meta.url), { type: 'module' }),
  getWorkerCount = resolveDefaultWorkerCount,
}: CreateColladaParseWorkerPoolClientOptions = {}): ColladaParseWorkerPoolClient {
  const client = createWorkerPoolClient<ColladaParseWorkerResponse, SerializedColladaSceneData>({
    label: 'Collada parse',
    createWorker,
    canUseWorker,
    poolSize: getWorkerCount,
    cacheLimit,
    getRequestId: (response) => response.requestId,
    isError: (response) => response.type === 'parse-collada-error',
    getError: (response) => (response as { error?: string }).error || 'Collada parse worker failed',
    getResult: (response) => (response as { result: SerializedColladaSceneData }).result,
  });

  const pendingLoads = new Map<string, Promise<SerializedColladaSceneData>>();
  const failureCache = new Map<string, unknown>();

  const rememberFailure = (assetUrl: string, error: unknown): void => {
    if (failureCache.size >= FAILURE_CACHE_LIMIT) {
      const oldestKey = failureCache.keys().next().value;
      if (oldestKey !== undefined) failureCache.delete(oldestKey);
    }
    failureCache.set(assetUrl, error);
  };

  const loadSerialized = async (assetUrl: string): Promise<SerializedColladaSceneData> => {
    const cachedResult = client.getCached(assetUrl);
    if (cachedResult) {
      return cachedResult;
    }

    if (failureCache.has(assetUrl)) {
      throw failureCache.get(assetUrl);
    }

    const pendingLoad = pendingLoads.get(assetUrl);
    if (pendingLoad) {
      return await pendingLoad;
    }

    const nextLoad = client
      .dispatch({ type: 'parse-collada', assetUrl })
      .then((workerResult) => {
        client.setCached(assetUrl, workerResult);
        return workerResult;
      })
      .catch((error) => {
        rememberFailure(assetUrl, error);
        throw error;
      })
      .finally(() => {
        pendingLoads.delete(assetUrl);
      });

    pendingLoads.set(assetUrl, nextLoad);
    return await nextLoad;
  };

  const load = async (assetUrl: string, manager: THREE.LoadingManager): Promise<THREE.Object3D> => {
    const serializedScene = await loadSerialized(assetUrl);
    return createSceneFromSerializedColladaData(serializedScene, { manager });
  };

  return {
    clearCache: () => {
      client.clearCache();
      failureCache.clear();
    },
    dispose: (rejectPendingWith) => client.dispose(rejectPendingWith),
    load,
    loadSerialized,
  };
}

const sharedColladaParseWorkerPoolClient = createColladaParseWorkerPoolClient();

export async function loadColladaScene(
  assetUrl: string,
  manager: THREE.LoadingManager,
): Promise<THREE.Object3D> {
  return await sharedColladaParseWorkerPoolClient.load(assetUrl, manager);
}

export async function loadSerializedColladaSceneData(
  assetUrl: string,
): Promise<SerializedColladaSceneData> {
  return await sharedColladaParseWorkerPoolClient.loadSerialized(assetUrl);
}

export function clearColladaParseWorkerPoolClientCache(): void {
  sharedColladaParseWorkerPoolClient.clearCache();
}

export function disposeColladaParseWorkerPoolClient(rejectPendingWith?: unknown): void {
  sharedColladaParseWorkerPoolClient.dispose(rejectPendingWith);
}

export { canSerializeColladaInWorker };
