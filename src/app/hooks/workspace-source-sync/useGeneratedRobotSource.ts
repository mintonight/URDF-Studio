import { useEffect, useRef, useState, type MutableRefObject } from 'react';

import { scheduleFailFastInDev } from '@/core/utils/runtimeDiagnostics';
import type { GenerateEditableRobotSourceOptions } from '@/app/utils/generateEditableRobotSource';

import { generateEditableRobotSourceWithWorker } from '../robotImportWorkerBridge';
import { getGeneratedSourceFromCache, storeGeneratedSourceInCache } from './sourceGenerationCache';

interface UseGeneratedRobotSourceParams {
  cache: MutableRefObject<Map<string, string>>;
  cacheKey: string | null;
  options: GenerateEditableRobotSourceOptions | null;
  scope: string;
}

export function useGeneratedRobotSource({
  cache,
  cacheKey,
  options,
  scope,
}: UseGeneratedRobotSourceParams): string | null {
  const [content, setContent] = useState<string | null>(() => {
    if (!cacheKey) {
      return null;
    }

    return getGeneratedSourceFromCache(cache.current, cacheKey);
  });
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    if (!cacheKey || !options) {
      setContent(null);
      return;
    }

    const cachedContent = getGeneratedSourceFromCache(cache.current, cacheKey);
    if (cachedContent !== null) {
      setContent(cachedContent);
      return;
    }

    void generateEditableRobotSourceWithWorker(options)
      .then((nextContent) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        storeGeneratedSourceInCache(cache.current, cacheKey, nextContent);
        setContent(nextContent);
      })
      .catch((error) => {
        if (requestId !== requestIdRef.current) {
          return;
        }

        setContent(null);
        scheduleFailFastInDev(
          scope,
          new Error(`Failed to generate editable ${options.format.toUpperCase()} source.`, {
            cause: error,
          }),
        );
      });
  }, [cache, cacheKey, options, scope]);

  useEffect(
    () => () => {
      requestIdRef.current += 1;
    },
    [],
  );

  return content;
}
