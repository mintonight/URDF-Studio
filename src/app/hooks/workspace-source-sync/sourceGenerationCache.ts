const GENERATED_SOURCE_CACHE_LIMIT = 64;

function touchGeneratedSourceCacheEntry(
  cache: Map<string, string>,
  cacheKey: string,
  content: string,
): string {
  cache.delete(cacheKey);
  cache.set(cacheKey, content);

  while (cache.size > GENERATED_SOURCE_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) {
      break;
    }
    cache.delete(oldestKey);
  }

  return content;
}

export function getGeneratedSourceFromCache(
  cache: Map<string, string>,
  cacheKey: string,
): string | null {
  const cachedSource = cache.get(cacheKey);
  if (cachedSource === undefined) {
    return null;
  }

  return touchGeneratedSourceCacheEntry(cache, cacheKey, cachedSource);
}

export function storeGeneratedSourceInCache(
  cache: Map<string, string>,
  cacheKey: string,
  content: string,
): string {
  return touchGeneratedSourceCacheEntry(cache, cacheKey, content);
}

export function readGeneratedSourceFromCache(
  cache: Map<string, string>,
  cacheKey: string,
  buildSource: () => string,
): string {
  const cachedSource = getGeneratedSourceFromCache(cache, cacheKey);
  if (cachedSource !== null) {
    return cachedSource;
  }

  return storeGeneratedSourceInCache(cache, cacheKey, buildSource());
}
