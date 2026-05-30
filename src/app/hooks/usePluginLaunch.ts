import { useEffect } from 'react';
import { logRegressionError } from '@/shared/debug/consoleDiagnostics';

/**
 * Reads `?plugin=<key>` from the URL and calls `openTool(key)` once the app
 * is ready.  The parameter is consumed (removed from the URL) immediately so
 * that a page refresh does not re-trigger the tool.
 *
 * Uses requestAnimationFrame double-buffer to wait for layout settlement
 * instead of a hardcoded setTimeout.
 */
export function usePluginLaunch(openTool: ((key: string) => void) | undefined): void {
  useEffect(() => {
    if (!openTool) return;

    const params = new URLSearchParams(window.location.search);
    const pluginKey = params.get('plugin');
    if (!pluginKey) return;

    params.delete('plugin');
    const remaining = params.toString();
    const newSearch = remaining ? `?${remaining}` : '';
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${newSearch}${window.location.hash}`,
    );

    let cancelled = false;
    const raf1 = requestAnimationFrame(() => {
      if (cancelled) return;
      const raf2 = requestAnimationFrame(() => {
        if (cancelled) return;
        try {
          openTool(pluginKey);
        } catch (error) {
          logRegressionError('[plugin-launch] Failed to open tool:', pluginKey, error);
        }
      });
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
    };
  }, [openTool]);
}
