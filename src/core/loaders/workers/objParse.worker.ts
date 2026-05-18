/// <reference lib="webworker" />

import { collectSerializedObjTransferables } from '../objModelData';
import type { ObjParseWorkerResponse, ParseObjWorkerRequest } from '../objParseWorkerProtocol';
import { parseObjModelDataFromBytes } from '../objWasmParser';

declare const self: DedicatedWorkerGlobalScope;

async function loadObjBytes(assetUrl: string): Promise<ArrayBuffer> {
    const response = await fetch(assetUrl);
    if (!response.ok) {
        throw new Error(`Failed to fetch OBJ asset: ${response.status} ${response.statusText}`);
    }

    return await response.arrayBuffer();
}

self.addEventListener('message', async (event: MessageEvent<ParseObjWorkerRequest>) => {
    const message = event.data;
    if (!message || message.type !== 'parse-obj') {
        return;
    }

    try {
        const objBytes = await loadObjBytes(message.assetUrl);
        const result = await parseObjModelDataFromBytes(objBytes);
        const response: ObjParseWorkerResponse = {
            type: 'parse-obj-result',
            requestId: message.requestId,
            result,
        };
        self.postMessage(response, collectSerializedObjTransferables(result));
    } catch (error) {
        const response: ObjParseWorkerResponse = {
            type: 'parse-obj-error',
            requestId: message.requestId,
            error: error instanceof Error ? error.message : 'OBJ parse worker failed',
        };
        self.postMessage(response);
    }
});

export {};
