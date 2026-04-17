/// <reference lib="webworker" />

import { parseColladaSceneData } from '../colladaWorkerSceneData';
import type {
  ColladaParseWorkerResponse,
  ParseColladaWorkerRequest,
} from '../colladaParseWorkerProtocol';

declare const self: DedicatedWorkerGlobalScope;

async function loadColladaText(assetUrl: string): Promise<string> {
  const response = await fetch(assetUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch Collada asset: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

self.addEventListener('message', async (event: MessageEvent<ParseColladaWorkerRequest>) => {
  const message = event.data;
  if (!message || message.type !== 'parse-collada') {
    return;
  }

  try {
    const colladaText = await loadColladaText(message.assetUrl);
    const result = parseColladaSceneData(colladaText, message.assetUrl);
    const response: ColladaParseWorkerResponse = {
      type: 'parse-collada-result',
      requestId: message.requestId,
      result,
    };
    self.postMessage(response);
  } catch (error) {
    const response: ColladaParseWorkerResponse = {
      type: 'parse-collada-error',
      requestId: message.requestId,
      error: error instanceof Error ? error.message : 'Collada parse worker failed',
    };
    self.postMessage(response);
  }
});

export {};
