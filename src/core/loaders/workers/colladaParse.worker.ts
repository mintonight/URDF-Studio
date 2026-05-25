/// <reference lib="webworker" />

import { collectSerializedColladaTransferables } from '../colladaWorkerSceneData';
import { parseColladaMeshDataWithWasm } from '../colladaWasmParser';
import { ensureWorkerXmlDomApis } from '../../utils/ensureWorkerXmlDomApis';
import type {
  ColladaParseWorkerResponse,
  ParseColladaWorkerRequest,
} from '../colladaParseWorkerProtocol';

declare const self: DedicatedWorkerGlobalScope;

async function loadColladaBytes(assetUrl: string): Promise<ArrayBuffer> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Collada asset: ${response.status} ${response.statusText}`);
  }

  return await response.arrayBuffer();
}

function extractUrlBase(assetUrl: string): string {
  const queryIndex = assetUrl.search(/[?#]/);
  const cleanUrl = queryIndex >= 0 ? assetUrl.slice(0, queryIndex) : assetUrl;
  const slashIndex = cleanUrl.lastIndexOf('/');
  return slashIndex >= 0 ? assetUrl.slice(0, slashIndex + 1) : '';
}

self.addEventListener('message', async (event: MessageEvent<ParseColladaWorkerRequest>) => {
  const message = event.data;
  if (!message || message.type !== 'parse-collada') {
    return;
  }

  try {
    ensureWorkerXmlDomApis();
    const colladaBytes = await loadColladaBytes(message.assetUrl);
    const result = await parseColladaMeshDataWithWasm(
      colladaBytes,
      extractUrlBase(message.assetUrl),
    );
    const response: ColladaParseWorkerResponse = {
      type: 'parse-collada-result',
      requestId: message.requestId,
      result,
    };
    self.postMessage(response, collectSerializedColladaTransferables(result));
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    console.error(
      `[ColladaParseWorker] Failed to parse "${message.assetUrl}":`,
      normalized,
    );
    const response: ColladaParseWorkerResponse = {
      type: 'parse-collada-error',
      requestId: message.requestId,
      error: normalized.message || 'Collada parse worker failed',
    };
    self.postMessage(response);
  }
});

export {};
