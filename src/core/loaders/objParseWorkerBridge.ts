import {
  createObjectFromSerializedObjData,
  createObjectFromSerializedObjDataAsync,
  type SerializedObjModelData,
} from './objModelData';
import type { ObjParseWorkerResponse, ParseObjWorkerRequest } from './objParseWorkerProtocol';
import { parseObjModelDataFromBytes } from './objWasmParser';
import {
  createWorkerPoolClient,
  resolveDefaultWorkerCount,
  type WorkerLike,
} from '@/core/workers/workerPoolClient';

interface CreateObjParseWorkerPoolClientOptions {
  cacheLimit?: number;
  canUseWorker?: () => boolean;
  createWorker?: () => WorkerLike;
  getWorkerCount?: () => number;
}

interface ObjParseWorkerPoolClient {
  clearCache: () => void;
  dispose: (rejectPendingWith?: unknown) => void;
  load: (assetUrl: string) => Promise<SerializedObjModelData>;
}

const DEFAULT_CACHE_LIMIT = 300;
const FAILURE_CACHE_LIMIT = 200;

async function loadSerializedObjModelDataInline(assetUrl: string): Promise<SerializedObjModelData> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch OBJ asset: ${response.status} ${response.statusText}`);
  }

  return await parseObjModelDataFromBytes(await response.arrayBuffer());
}

export function createObjParseWorkerPoolClient({
  cacheLimit = DEFAULT_CACHE_LIMIT,
  canUseWorker = () => typeof Worker !== 'undefined',
  createWorker = () =>
    new Worker(new URL('./workers/objParse.worker.ts', import.meta.url), { type: 'module' }),
  getWorkerCount = resolveDefaultWorkerCount,
}: CreateObjParseWorkerPoolClientOptions = {}): ObjParseWorkerPoolClient {
  const client = createWorkerPoolClient<ObjParseWorkerResponse, SerializedObjModelData>({
    label: 'OBJ parse',
    createWorker,
    canUseWorker,
    poolSize: getWorkerCount,
    cacheLimit,
    getRequestId: (response) => response.requestId,
    isError: (response) => response.type === 'parse-obj-error',
    getError: (response) => (response as { error?: string }).error || 'OBJ parse worker failed',
    getResult: (response) => (response as { result: SerializedObjModelData }).result,
  });

  const pendingLoads = new Map<string, Promise<SerializedObjModelData>>();
  const failureCache = new Map<string, unknown>();

  const rememberFailure = (assetUrl: string, error: unknown): void => {
    if (failureCache.size >= FAILURE_CACHE_LIMIT) {
      const oldestKey = failureCache.keys().next().value;
      if (oldestKey !== undefined) failureCache.delete(oldestKey);
    }
    failureCache.set(assetUrl, error);
  };

  const load = async (assetUrl: string): Promise<SerializedObjModelData> => {
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

    const nextLoad = (
      client.canUseWorker
        ? client.dispatch({ type: 'parse-obj', assetUrl })
        : loadSerializedObjModelDataInline(assetUrl)
    )
      .then((result) => {
        client.setCached(assetUrl, result);
        return result;
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

  return {
    clearCache: () => {
      client.clearCache();
      failureCache.clear();
    },
    dispose: (rejectPendingWith) => client.dispose(rejectPendingWith),
    load,
  };
}

const sharedObjParseWorkerPoolClient = createObjParseWorkerPoolClient();

export async function loadSerializedObjModelData(
  assetUrl: string,
): Promise<SerializedObjModelData> {
  return await sharedObjParseWorkerPoolClient.load(assetUrl);
}

export function clearObjParseWorkerPoolClientCache(): void {
  sharedObjParseWorkerPoolClient.clearCache();
}

export function disposeObjParseWorkerPoolClient(rejectPendingWith?: unknown): void {
  sharedObjParseWorkerPoolClient.dispose(rejectPendingWith);
}

export { createObjectFromSerializedObjData, createObjectFromSerializedObjDataAsync };
