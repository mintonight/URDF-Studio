import type { UrdfVisualMaterial } from '@/types';
import { resolveImportedAssetPath } from '@/core/parsers/meshPathUtils';

export interface GazeboScriptMaterialDefinition extends UrdfVisualMaterial {}

interface ResolveGazeboScriptMaterialOptions {
  allFileContents?: Record<string, string>;
  scriptName?: string;
  scriptUris?: string[];
  sourcePath?: string;
}

const TEXTURE_DIRECTORY_PATTERN = /(?:^|\/)(?:textures?|materials\/textures)(?:\/|$)/i;
const materialScriptCache = new Map<string, Record<string, GazeboScriptMaterialDefinition>>();

function normalizePath(path: string): string {
  const segments = path.replace(/\\/g, '/').split('/');
  const stack: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (stack.length > 0) {
        stack.pop();
      }
      continue;
    }

    stack.push(segment);
  }

  return stack.join('/');
}

function uniquePaths(paths: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(paths.map((path) => normalizePath(String(path || '').trim())).filter(Boolean)),
  );
}

function resolveScriptUriPath(uri: string, sourcePath?: string): string | null {
  const trimmed = uri.trim();
  if (!trimmed) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  if (trimmed.startsWith('file://')) {
    return normalizePath(trimmed.slice('file://'.length));
  }

  return normalizePath(resolveImportedAssetPath(trimmed, sourcePath));
}

function toHexColor(value: string): string | undefined {
  const parts = value.trim().split(/\s+/);
  const numericParts = parts
    .map((part) => Number.parseFloat(part))
    .filter((part) => Number.isFinite(part));

  if (numericParts.length < 3) {
    return undefined;
  }

  const isUnitRange = numericParts.slice(0, 3).every((part) => part >= 0 && part <= 1);
  const toByte = (part: number) => {
    const normalized = isUnitRange ? part * 255 : part;
    return Math.max(0, Math.min(255, Math.round(normalized)));
  };

  return `#${numericParts
    .slice(0, 3)
    .map((part) => toByte(part).toString(16).padStart(2, '0'))
    .join('')}`;
}

function readMaterialBlock(
  text: string,
  openingBraceIndex: number,
): { block: string; endIndex: number } | null {
  let depth = 1;

  for (let index = openingBraceIndex + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return {
          block: text.slice(openingBraceIndex + 1, index),
          endIndex: index + 1,
        };
      }
    }
  }

  return null;
}

function parseMaterialScript(text: string): Record<string, GazeboScriptMaterialDefinition> {
  const cached = materialScriptCache.get(text);
  if (cached) {
    return cached;
  }

  const definitions: Record<string, GazeboScriptMaterialDefinition> = {};
  const materialHeaderPattern = /\bmaterial\s+([^\s{]+)\s*\{/g;
  let match = materialHeaderPattern.exec(text);

  while (match) {
    const materialName = match[1]?.trim();
    const openingBraceIndex = text.indexOf('{', match.index);
    if (!materialName || openingBraceIndex < 0) {
      match = materialHeaderPattern.exec(text);
      continue;
    }

    const blockResult = readMaterialBlock(text, openingBraceIndex);
    if (!blockResult) {
      break;
    }

    const block = blockResult.block;
    const texture = block.match(/\btexture\s+([^\s{}]+)/i)?.[1]?.trim();
    const diffuse = toHexColor(block.match(/\bdiffuse\s+([^\r\n{}]+)/i)?.[1] || '');
    const ambient = toHexColor(block.match(/\bambient\s+([^\r\n{}]+)/i)?.[1] || '');

    definitions[materialName] = {
      name: materialName,
      ...(diffuse || ambient ? { color: diffuse || ambient } : {}),
      ...(texture ? { texture } : {}),
    };

    materialHeaderPattern.lastIndex = blockResult.endIndex;
    match = materialHeaderPattern.exec(text);
  }

  materialScriptCache.set(text, definitions);
  return definitions;
}

function collectMaterialScriptFiles(
  allFileContents: Record<string, string>,
  searchRoots: string[],
): Array<{ path: string; content: string }> {
  const entries = Object.entries(allFileContents)
    .map(([path, content]) => ({ path: normalizePath(path), content }))
    .filter(({ path }) => path.toLowerCase().endsWith('.material'));

  if (searchRoots.length === 0) {
    return entries;
  }

  const filteredEntries = entries.filter(({ path }) =>
    searchRoots.some((root) =>
      root.toLowerCase().endsWith('.material')
        ? path === root
        : path === root || path.startsWith(`${root}/`),
    ),
  );

  return filteredEntries.length > 0 ? filteredEntries : entries;
}

function resolveTexturePath(
  rawTexturePath: string | undefined,
  searchRoots: string[],
  sourcePath?: string,
): string | undefined {
  const trimmed = String(rawTexturePath || '').trim();
  if (!trimmed) {
    return undefined;
  }

  if (/^https?:\/\//i.test(trimmed) || trimmed.startsWith('data:')) {
    return trimmed;
  }

  if (trimmed.startsWith('file://')) {
    return normalizePath(trimmed.slice('file://'.length));
  }

  if (trimmed.startsWith('model://')) {
    return normalizePath(resolveImportedAssetPath(trimmed, sourcePath));
  }

  const sortedRoots = [...searchRoots].sort((left, right) => {
    const leftScore = TEXTURE_DIRECTORY_PATTERN.test(left) ? 0 : 1;
    const rightScore = TEXTURE_DIRECTORY_PATTERN.test(right) ? 0 : 1;
    return leftScore - rightScore;
  });

  for (const root of sortedRoots) {
    const normalizedRoot = normalizePath(root);
    const baseDirectory = normalizedRoot.toLowerCase().endsWith('.material')
      ? normalizedRoot.slice(0, Math.max(0, normalizedRoot.lastIndexOf('/')))
      : normalizedRoot;
    const resolved = normalizePath(
      `${baseDirectory.replace(/\/+$/, '')}/${trimmed.replace(/^\/+/, '')}`,
    );
    if (resolved && resolved !== trimmed) {
      return resolved;
    }
  }

  return normalizePath(resolveImportedAssetPath(trimmed, sourcePath));
}

export function resolveGazeboScriptMaterial({
  allFileContents = {},
  scriptName,
  scriptUris = [],
  sourcePath,
}: ResolveGazeboScriptMaterialOptions): GazeboScriptMaterialDefinition | null {
  const normalizedScriptName = String(scriptName || '').trim();
  if (!normalizedScriptName) {
    return null;
  }

  const searchRoots = uniquePaths(scriptUris.map((uri) => resolveScriptUriPath(uri, sourcePath)));
  const scriptFiles = collectMaterialScriptFiles(allFileContents, searchRoots);

  for (const { content } of scriptFiles) {
    const parsedDefinitions = parseMaterialScript(content);
    const matchedDefinition = parsedDefinitions[normalizedScriptName];
    if (!matchedDefinition) {
      continue;
    }

    return {
      ...matchedDefinition,
      ...(matchedDefinition.texture
        ? {
            texture:
              resolveTexturePath(matchedDefinition.texture, searchRoots, sourcePath) ||
              matchedDefinition.texture,
          }
        : {}),
    };
  }

  return null;
}
