interface ResolveUsdStageMountStateOptions {
  hasUsdSourceFile: boolean;
  active: boolean;
  useUsdOffscreenOnlyRenderer: boolean;
  useUsdOffscreenBootstrap: boolean;
  offscreenBootstrapReady: boolean;
  offscreenBootstrapFailed: boolean;
  interactiveUsdStageReady: boolean;
}

export interface UsdStageMountState {
  useUsdOffscreenBootstrapHandoff: boolean;
  mountUsdOffscreenStage: boolean;
  mountUsdWasmStage: boolean;
  usdOffscreenStageActive: boolean;
  usdWasmStageActive: boolean;
}

export function resolveUsdStageMountState({
  hasUsdSourceFile,
  active,
  useUsdOffscreenOnlyRenderer,
  useUsdOffscreenBootstrap,
  offscreenBootstrapReady,
  offscreenBootstrapFailed,
  interactiveUsdStageReady,
}: ResolveUsdStageMountStateOptions): UsdStageMountState {
  const useUsdOffscreenBootstrapHandoff = useUsdOffscreenBootstrap && !offscreenBootstrapFailed;
  const mountUsdOffscreenStage = Boolean(
    hasUsdSourceFile &&
      (useUsdOffscreenOnlyRenderer ||
        (useUsdOffscreenBootstrapHandoff && !interactiveUsdStageReady)),
  );
  const mountUsdWasmStage = Boolean(
    hasUsdSourceFile &&
      !useUsdOffscreenOnlyRenderer &&
      (!useUsdOffscreenBootstrapHandoff || offscreenBootstrapReady),
  );
  const usdOffscreenStageActive =
    active &&
    (useUsdOffscreenOnlyRenderer ||
      (useUsdOffscreenBootstrapHandoff && !interactiveUsdStageReady));
  const usdWasmStageActive =
    active &&
    !useUsdOffscreenOnlyRenderer &&
    (!useUsdOffscreenBootstrapHandoff || interactiveUsdStageReady);

  return {
    useUsdOffscreenBootstrapHandoff,
    mountUsdOffscreenStage,
    mountUsdWasmStage,
    usdOffscreenStageActive,
    usdWasmStageActive,
  };
}
