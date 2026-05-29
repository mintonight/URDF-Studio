import JSZip from 'jszip';

import type { ProjectArchiveEntryData } from './projectArchiveWorkerTransfer.ts';

export interface BuildProjectArchiveBlobOptions {
  compressionLevel?: number;
  onProgress?: (progress: {
    completed: number;
    total: number;
    label?: string;
  }) => void;
}

function normalizeProjectArchiveEntryForZip(entry: ProjectArchiveEntryData): ProjectArchiveEntryData | Promise<ArrayBuffer> {
  if (entry instanceof Blob) {
    return entry.arrayBuffer();
  }

  return entry;
}

export function appendProjectArchiveEntriesToZip(
  zip: JSZip,
  entries: Map<string, ProjectArchiveEntryData>,
): void {
  entries.forEach((entry, path) => {
    zip.file(path, normalizeProjectArchiveEntryForZip(entry));
  });
}

export async function buildProjectArchiveBlob(
  entries: Map<string, ProjectArchiveEntryData>,
  {
    compressionLevel = 6,
    onProgress,
  }: BuildProjectArchiveBlobOptions = {},
): Promise<Blob> {
  const zip = new JSZip();
  appendProjectArchiveEntriesToZip(zip, entries);

  return await zip.generateAsync(
    {
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: compressionLevel },
    },
    (metadata) => {
      onProgress?.({
        completed: Math.round(metadata.percent),
        total: 100,
        label: metadata.currentFile ?? undefined,
      });
    },
  );
}
