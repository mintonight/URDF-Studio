import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveUsdStageMountState } from './usdStageMountState.ts';

test('keeps the offscreen bootstrap visible until the main USD stage is ready', () => {
  assert.deepEqual(
    resolveUsdStageMountState({
      hasUsdSourceFile: true,
      active: true,
      useUsdOffscreenOnlyRenderer: false,
      useUsdOffscreenBootstrap: true,
      offscreenBootstrapReady: false,
      offscreenBootstrapFailed: false,
      interactiveUsdStageReady: false,
    }),
    {
      useUsdOffscreenBootstrapHandoff: true,
      mountUsdOffscreenStage: true,
      mountUsdWasmStage: false,
      usdOffscreenStageActive: true,
      usdWasmStageActive: false,
    },
  );

  assert.deepEqual(
    resolveUsdStageMountState({
      hasUsdSourceFile: true,
      active: true,
      useUsdOffscreenOnlyRenderer: false,
      useUsdOffscreenBootstrap: true,
      offscreenBootstrapReady: true,
      offscreenBootstrapFailed: false,
      interactiveUsdStageReady: false,
    }),
    {
      useUsdOffscreenBootstrapHandoff: true,
      mountUsdOffscreenStage: true,
      mountUsdWasmStage: true,
      usdOffscreenStageActive: true,
      usdWasmStageActive: false,
    },
  );

  assert.deepEqual(
    resolveUsdStageMountState({
      hasUsdSourceFile: true,
      active: true,
      useUsdOffscreenOnlyRenderer: false,
      useUsdOffscreenBootstrap: true,
      offscreenBootstrapReady: true,
      offscreenBootstrapFailed: false,
      interactiveUsdStageReady: true,
    }),
    {
      useUsdOffscreenBootstrapHandoff: true,
      mountUsdOffscreenStage: false,
      mountUsdWasmStage: true,
      usdOffscreenStageActive: false,
      usdWasmStageActive: true,
    },
  );
});

test('falls back to the main USD stage when offscreen bootstrap fails before ready', () => {
  assert.deepEqual(
    resolveUsdStageMountState({
      hasUsdSourceFile: true,
      active: true,
      useUsdOffscreenOnlyRenderer: false,
      useUsdOffscreenBootstrap: true,
      offscreenBootstrapReady: false,
      offscreenBootstrapFailed: true,
      interactiveUsdStageReady: false,
    }),
    {
      useUsdOffscreenBootstrapHandoff: false,
      mountUsdOffscreenStage: false,
      mountUsdWasmStage: true,
      usdOffscreenStageActive: false,
      usdWasmStageActive: true,
    },
  );
});
