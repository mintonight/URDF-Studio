# Editor / Viewer 子域

> 最后更新：2026-04-15 | 覆盖源码：`src/features/editor/`、`src/features/urdf-viewer/`、`src/app/components/unified-viewer/`、`src/shared/components/3d/`
> 交叉引用：[architecture.md](architecture.md)、[file-io.md](file-io.md)、[style-guide.md](style-guide.md)

## 1. 单模式 Editor

URDF Studio 只有 `Editor` 一个编辑模式，统一承载三个子域：

| 子域               | 典型任务                                       |
| ------------------ | ---------------------------------------------- |
| 拓扑               | Link / Joint 增删、拓扑编辑、关节参数          |
| 几何 / 碰撞 / 测量 | Visual / Collision、mesh、材质、纹理、碰撞变换 |
| 硬件配置           | 电机型号、传动比、阻尼、摩擦                   |

新增功能前，先判断属于哪类子能力，避免跨子系统逻辑缠绕。

快速映射：

- 统一公开入口：`features/editor/index.ts`
- 具体实现：`features/urdf-viewer/`（包含拓扑/硬件与几何/碰撞/测量）
- 跨子域共享交互：`app/` 编排层 或 `shared/components/3d/`

## 2. 目录结构

```
features/editor/
  index.ts                    # 统一 Editor 公开入口

features/urdf-viewer/
  components/                 # React 组件层
    ViewerCanvas.tsx          # viewer 画布层与共享 canvas 适配
    ViewerToolbar.tsx         # 顶部工具条
    ViewerLoadingHud.tsx      # loading 状态 HUD
    UsdWasmStage.tsx          # WASM stage 嵌入入口
    UsdOffscreenStage.tsx     # offscreen canvas + worker 模式宿主
  hooks/                      # React hooks
  utils/                      # 适配层 & 工具
  types.ts                    # 共享类型收口
  runtime/                    # vendored usd-viewer runtime
    embed/                    # 嵌入适配
    hydra/                    # Hydra render delegate
    types/                    # runtime 类型
    vendor/                   # 第三方 vendor 代码
    viewer/                   # viewer 核心
    UPSTREAM.md               # 上游来源说明
  workers/                    # Web Workers
```

## 3. 核心 hooks / 能力

- `useViewerController`：viewer 控制器
- `useMouseInteraction`：鼠标交互处理
- `useHoverDetection`：悬停检测
- `useVisualizationEffects`：惯性、质心、原点等辅助可视化
- `useRobotLoader`：模型加载
- `useHighlightManager`：高亮管理

工具模式：`select | translate | rotate | universal | view | face | measure`

## 4. 实现约束

- 新能力优先放入 hooks 或新增组件，不要恢复双壳并存
- 保持 `RobotNode <-> JointNode` 交替递归渲染模式
- 材质必须通过 `materials.ts` / `urdfMaterials.ts` 复用，不在高频路径直接 `new`
- 使用 `RobotState` 等共享类型，避免 `any`
- TransformControls 引用注册必须完整、可追踪
- Props 与共享类型统一收口到 `types.ts`
- 可视化扩展通过 `visualizationFactories.ts`
- 共享关节面板位于 `src/shared/components/Panel/JointsPanel.tsx`

## 5. USD runtime 边界

- `runtime/*` 是 vendored usd-viewer runtime，不要在 `core/parsers/usd/*` 重复实现 viewer runtime 职责
- URDF Studio 应把 runtime 输出适配到 `ViewerRobotDataResolution` / `RobotData`
- `public/usd/bindings/*` 必须保留在静态资源目录，供浏览器运行时 fetch

## 6. USD worker / metadata 链路约束

适用范围：`runtime/hydra/render-delegate/*`、`workers/*`、`utils/usd*`、`app/hooks/useFile*.ts` 中消费 worker 结果的 USD 工作流

必须遵循：

- USD stage preparation、runtime metadata、robot hydration、prepared export cache、roundtrip archive 的修复，默认优先放在 worker/runtime 链路完成，不要搬到主线程 adapter 或 debug bridge
- `runtime/hydra/render-delegate/*` 产出的 metadata snapshot 是该链路的 source of truth；缺字段应修 worker/runtime 生成逻辑
- 禁止新增"worker 结果缺失 -> 主线程重建 metadata -> 静默继续"的 fallback
- 对 folded fixed link、collision-only semantic child link 的推断只能基于 stage/truth 中的明确证据，不做纯命名猜测
- `visual_*` / `collision_*` / `group_*` / `xform_*` / `scene` / `root` 这类 roundtrip 容器 prim 不是 link identity；runtime metadata 不得把它们提升为 synthetic link 或 fixed joint

验证要求：

- 改动上述链路时，必须跑 `test/unitree_model` 整套 USD 浏览器验证
- 至少覆盖 `Go2 + B2 + H1-2`
- 浏览器验证产物写入 `tmp/regression/`

## 7. USD offscreen / runtime 生命周期约束

适用范围：`UsdOffscreenStage.tsx`、`usdOffscreenViewer.worker.ts`、`runtime/hydra/render-delegate/*`、`shared/utils/three/dispose.ts`

必须遵循：

- 主线程宿主只负责 handoff、尺寸同步与错误透传；不要重建 runtime truth
- teardown 必须完整释放 observer、DOM/worker 事件监听、RAF/timer、OffscreenCanvas 关联 runtime、scene graph 与 driver 引用
- runtime 全局 handler/registry/active owner 必须提供对称的 unregister/reset
- worker 侧创建的 `ImageBitmap`、object URL、临时 geometry/material/texture 必须显式释放
- 禁止通过全局单例把旧实例挂死

## 8. 关键 utils 职责速查

| 文件                                     | 职责                                      |
| ---------------------------------------- | ----------------------------------------- |
| `viewerRobotData.ts`                     | 统一 viewer 层消费的数据形态              |
| `viewerResourceScope.ts`                 | source file / assets / robot links 资源域 |
| `usdExportBundle.ts`                     | USD 场景快照与导出缓存协调                |
| `usdRuntimeRobotHydration.ts`            | runtime -> RobotData hydration            |
| `usdSceneRobotResolution.ts`             | 场景级 robot resolution                   |
| `usdViewerRobotAdapter.ts`               | viewer runtime / snapshot 到应用数据适配  |
| `usdOffscreenViewerWorkerClient.ts`      | 主线程对 offscreen worker 请求封装        |
| `usdStageOpenPreparationWorkerBridge.ts` | prepared-open 链路 worker bridge          |
| `usdPreparedExportCacheWorkerBridge.ts`  | prepared-export 链路 worker bridge        |
| `runtimeSceneMetadata.ts`                | runtime scene metadata 标准化读模型       |
| `visualizationFactories.ts`              | 辅助可视化对象创建                        |
| `dispose.ts`                             | THREE 资源清理                            |
