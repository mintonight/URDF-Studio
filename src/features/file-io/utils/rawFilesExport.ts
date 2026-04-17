import JSZip from 'jszip';
import type { RobotFile } from '@/types';

export interface RawFilesCollectOptions {
  assets: Record<string, string>;
  availableFiles: RobotFile[];
  allFileContents: Record<string, string>;
  selectedFile: RobotFile | null;
  onProgress?: (completed: number, total: number, label?: string) => void;
}

/**
 * Normalize a file path for consistent ZIP entries.
 * Strips leading `/`, replaces `\` with `/`, collapses `//`.
 */
function normalizePath(p: string): string {
  return p.replace(/^\/+/, '').replace(/\\/g, '/').replace(/\/+/g, '/');
}

/**
 * Fetch a blob URL and return its ArrayBuffer.
 * Returns null if the fetch fails (tolerant behavior).
 */
async function fetchBlobUrl(url: string): Promise<ArrayBuffer | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.arrayBuffer();
  } catch {
    return null;
  }
}

/**
 * Collect all raw workspace files into a lightweight ZIP.
 *
 * Files are gathered from three sources:
 * 1. `assets` — mesh/texture blob URLs keyed by relative path
 * 2. `availableFiles` — robot definition files with `content` or `blobUrl`
 * 3. `allFileContents` — text file contents (e.g. xacro includes)
 *
 * Missing files are skipped with a warning rather than aborting the export.
 */
export async function collectRawFilesZip(options: RawFilesCollectOptions): Promise<Blob> {
  const { assets, availableFiles, allFileContents, onProgress } = options;

  const zip = new JSZip();
  const addedPaths = new Set<string>();
  let completed = 0;

  // Estimate total: assets + availableFiles + allFileContents
  const estimatedTotal =
    Object.keys(assets).length + availableFiles.length + Object.keys(allFileContents).length;

  const reportProgress = (label?: string) => {
    completed += 1;
    onProgress?.(completed, estimatedTotal, label);
  };

  // --- 1. Add mesh/texture assets (blob URLs) ---
  for (const [rawPath, url] of Object.entries(assets)) {
    const path = normalizePath(rawPath);
    if (!path || addedPaths.has(path)) {
      reportProgress(path);
      continue;
    }

    if (!url.startsWith('blob:')) {
      // Data URLs or object URLs that aren't blob: — skip or handle inline
      reportProgress(path);
      continue;
    }

    const buffer = await fetchBlobUrl(url);
    if (buffer !== null) {
      zip.file(path, buffer);
      addedPaths.add(path);
    } else {
      // Tolerant: skip missing mesh/texture with warning
      // eslint-disable-next-line no-console
      console.warn(`[RawFilesExport] Skipping unavailable asset: ${path}`);
    }
    reportProgress(path);
  }

  // --- 2. Add robot definition files ---
  const textFormats = new Set(['urdf', 'mjcf', 'xacro', 'sdf']);

  for (const file of availableFiles) {
    const path = normalizePath(file.name);
    if (!path || addedPaths.has(path)) {
      reportProgress(path);
      continue;
    }

    if (textFormats.has(file.format) && file.content) {
      zip.file(path, file.content);
      addedPaths.add(path);
    } else if (file.blobUrl) {
      // Binary formats (USD, mesh) — fetch the blob
      const buffer = await fetchBlobUrl(file.blobUrl);
      if (buffer !== null) {
        zip.file(path, buffer);
        addedPaths.add(path);
      } else {
        // eslint-disable-next-line no-console
        console.warn(`[RawFilesExport] Skipping unavailable file: ${path}`);
      }
    } else if (file.content) {
      // Fallback: treat content as text
      zip.file(path, file.content);
      addedPaths.add(path);
    }
    reportProgress(path);
  }

  // --- 3. Add text file contents (deduplicated) ---
  for (const [rawPath, content] of Object.entries(allFileContents)) {
    const path = normalizePath(rawPath);
    if (!path || addedPaths.has(path)) {
      reportProgress(path);
      continue;
    }

    zip.file(path, content);
    addedPaths.add(path);
    reportProgress(path);
  }

  return zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });
}
