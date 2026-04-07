# URDF Viewer 模块入口

本文件改为轻量入口，完整上下文已并入 `docs/prompts/CLAUDE.md` 第 8 节。

## 快速定位

- 主组件：`src/features/urdf-viewer/components/URDFViewer.tsx`
- 场景编排：`src/features/urdf-viewer/components/URDFViewerScene.tsx`
- 面板编排：`src/features/urdf-viewer/components/URDFViewerPanels.tsx`
- 画布层：`src/features/urdf-viewer/components/URDFViewerCanvas.tsx`
- 工具条：`src/features/urdf-viewer/components/ViewerToolbar.tsx`
- Loading HUD：`src/features/urdf-viewer/components/ViewerLoadingHud.tsx`
- USD 嵌入入口：`src/features/urdf-viewer/components/UsdWasmStage.tsx`
- Offscreen 宿主：`src/features/urdf-viewer/components/UsdOffscreenStage.tsx`
- 共享关节面板：`src/shared/components/Panel/JointsPanel.tsx`
- Runtime 上游说明：`src/features/urdf-viewer/runtime/UPSTREAM.md`
- Runtime 类型：`src/features/urdf-viewer/runtime/types/*`
- Runtime vendor：`src/features/urdf-viewer/runtime/vendor/usd-text-parser/*`
- Viewer 数据形态：`src/features/urdf-viewer/utils/viewerRobotData.ts`
- 资源域：`src/features/urdf-viewer/utils/viewerResourceScope.ts`
- 导出缓存：`src/features/urdf-viewer/utils/usdExportBundle.ts`
- Hydration：`src/features/urdf-viewer/utils/usdRuntimeRobotHydration.ts`
- Scene resolution：`src/features/urdf-viewer/utils/usdSceneRobotResolution.ts`
- Viewer adapter：`src/features/urdf-viewer/utils/usdViewerRobotAdapter.ts`
- Runtime metadata：`src/features/urdf-viewer/utils/runtimeSceneMetadata.ts`
- Offscreen worker client：`src/features/urdf-viewer/utils/usdOffscreenViewerWorkerClient.ts`
- Stage open / prepared export：`src/features/urdf-viewer/utils/usdStageOpenPreparationWorkerBridge.ts`、`src/features/urdf-viewer/utils/usdPreparedExportCacheWorkerBridge.ts`
- Worker 入口：`src/features/urdf-viewer/workers/usdOffscreenViewer.worker.ts`、`src/features/urdf-viewer/workers/usdStageOpenPreparation.worker.ts`、`src/features/urdf-viewer/workers/usdPreparedExportCache.worker.ts`
- 材质：`src/features/urdf-viewer/utils/materials.ts` / `urdfMaterials.ts`
- 可视化工厂：`src/features/urdf-viewer/utils/visualizationFactories.ts`
- 资源清理：`src/features/urdf-viewer/utils/dispose.ts`

## 关键约束

- 优先复用共享材质
- `src/app/components/unified-viewer/*` 负责统一 viewer 宿主、mode 切换与 joints panel 适配；不要把 app 级 preview / overlay / forced session 状态塞回 `urdf-viewer` feature
- 切换 / 卸载 / reload / hydration rollback 时必须清理 THREE 资源
- 共享类型统一放在 `src/features/urdf-viewer/types.ts`
- 不在组件内部散落临时材质与未释放几何体
- `runtime/*` 是 vendored `usd-viewer` runtime，不要在 `core/parsers/usd/*` 重复实现同层职责
- Stage open、prepared export、offscreen viewer 这三条链路优先修 `utils/*WorkerBridge.ts` / `workers/*.worker.ts`，不要在 UI 层补丁式兜底
- `public/usd/bindings/*` 必须保留在静态资源目录，供浏览器运行时 fetch
