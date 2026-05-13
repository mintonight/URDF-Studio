import { useEffect } from 'react';

/** Delay before activating a plugin, giving layout time to settle. */
const PLUGIN_LAUNCH_DELAY_MS = 600;

/**
 * Reads `?plugin=<key>` from the URL and calls `openTool(key)` once the app
 * is ready.  The parameter is consumed (removed from the URL) immediately so
 * that a page refresh does not re-trigger the tool.
 *
 * @param openTool - The `openTool(key)` function from layout actions.
 *                   Only called when truthy, ensuring layout init is complete.
 */
export function usePluginLaunch(openTool: ((key: string) => void) | undefined): void {
  useEffect(() => {
    if (!openTool) return;

    const params = new URLSearchParams(window.location.search);
    const pluginKey = params.get('plugin');
    if (!pluginKey) return;

    // Remove the parameter from the URL so refreshes don't re-trigger
    params.delete('plugin');
    const remaining = params.toString();
    const newSearch = remaining ? `?${remaining}` : '';
    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${newSearch}${window.location.hash}`,
    );

    const timer = setTimeout(() => {
      try {
        openTool(pluginKey);
      } catch (error) {
        console.error('[plugin-launch] Failed to open tool:', pluginKey, error);
      }
    }, PLUGIN_LAUNCH_DELAY_MS);

    return () => clearTimeout(timer);
  }, [openTool]);
}
