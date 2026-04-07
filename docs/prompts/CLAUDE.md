# URDF-Studio 开发指南

> 单一主 Prompt 上下文。`overview.md`、`URDF_STUDIO_STYLE_GUIDE.md`、`urdf-viewer.md`、`visualizer.md` 只保留轻量入口，避免重复加载同一批信息。

## 1. 最小读取策略

建议按以下顺序读取，控制 token：

1. 先读仓库根目录 `AGENTS.md`。
2. 再读本文件。
3. 仅在任务相关时再看对应轻量入口：
   - UI / 主题 / 可访问性：看本文件第 6 节
   - `Visualizer`（`Editor` 下的拓扑 / 硬件能力）：看本文件第 7 节
   - `URDF Viewer`（`Editor` 下的几何 / 碰撞 / 测量能力）：看本文件第 8 节
   - 架构边界 / 对外库 / runtime fallback 审计：看 `docs/architecture-boundaries.md`、`docs/robot-canvas-lib.md`、`docs/runtime-fallback-audit.md`
4. AI 审阅标准直接读取：
   - `src/features/ai-assistant/config/urdf_inspect_standard_en.md`
   - `src/features/ai-assistant/config/urdf_inspect_stantard_zh.md`
5. 与 AI 对话时，优先给出：
   - 具体的 `Link` / `Joint` 名称
   - 期望的父子关系
   - 当前在 `Editor` 中操作的是拓扑、几何/碰撞、还是硬件相关能力
   - 涉及电机时的力矩 / 传动 / 阻尼约束

若本文件描述与当前 `src/` 真实结构冲突，以仓库现状和 `AGENTS.md` 为准。

## 1.5 Skill-first 路由（减少 prompt / MCP token）

默认思路：

- 先用 skill 压缩“怎么做”的上下文，再决定是否真的需要调用 MCP / 浏览器 / 外部搜索工具。
- skill 主要替代工作流说明、最佳实践和决策开销，不替代真实执行能力本身。
- 若仓库已有现成脚本、测试或 build 命令，优先本地命令，不为了形式统一改走 MCP。

常见路由：

- 浏览器验证 / 联调 / 截图：
  - 优先 `webapp-testing`、`playwright`、`browser-automation`
  - 营销或文档截图优先 `screenshots`
- 3D / R3F / Three.js / WebGL：
  - 优先 `threejs-skills`
- URDF Studio UI / 主题一致性：
  - 优先 `urdf-studio-style`
  - 通用前端设计再补 `frontend-design`
- 调试 / 排障：
  - 优先 `systematic-debugging`、`debugger`
- 测试 / QA：
  - 优先 `testing-qa`
- 最新库文档：
  - 优先 `context7-auto-research`
  - OpenAI 相关优先 `openai-docs`

仍需 MCP / 外部工具的典型情况：

- 真实浏览器交互、DOM 快照、网络面板、trace
- 在线搜索、外部文档抓取、远程资源读取
- Figma / 设计文件 / 其他 MCP 服务侧资源的真实读写

## 2. 项目快照

**URDF Studio** 是一个机器人设计、装配、可视化与导出工作台，核心能力包括：

- 单模式编辑：`Editor`
- 多 URDF 组装与桥接关节
- 多格式导入导出：`URDF` / `MJCF` / `SDF` / `USD` / `Xacro` / `ZIP` / `.usp`
- AI 生成与 AI 审阅
- PDF / CSV 报告导出
- 可复用 `react-robot-canvas` 画布封装与对外发布

**技术栈**

- React 19.2 + TypeScript 5.8
- Three.js + React Three Fiber + `@react-three/drei`
- Vite 6.2
- Tailwind CSS 4.1
- Zustand 5
- Monaco Editor

**源码分层**

- `src/app`：应用编排层，负责 App shell、viewer 组合、导入导出、workspace/source sync、USD hydration/roundtrip 协调；重点子树为 `components/unified-viewer/*`、`components/header/*`、`components/settings/*`、`hooks/file-export/*`
- `src/features`：业务功能模块
- `src/store`：Zustand 状态层
- `src/shared`：共享组件、3D 基础设施、hooks、i18n、数据、调试桥接、workers、通用工具
- `src/core`：纯逻辑、解析器、robot core、mesh loaders、parse workers、runtime diagnostics
- `src/lib`：对外复用的 `RobotCanvas` 封装、类型与样式入口
- `src/types`：跨模块类型定义
- `src/styles/index.css`：全局语义 token

补充目录：

- `docs/`：Agent 上下文、架构边界、runtime 审计与库文档
- `scripts/`：schema、预览、导入导出验证与回归辅助脚本；高频子树包括 `regression/`、`versioning/`、`mujoco/`
- `packages/react-robot-canvas/`：对外发布包工作区
- `public/usd/bindings/*`：USD WASM bindings，必须保持浏览器运行时可 fetch
- `output/`：用户可见导出结果与需要保留的回归产物
- `tmp/`：截图、trace、临时调试与中间产物
- `test/`：大型 fixture 与浏览器回归样本

结构热区：

- `src/app/components/unified-viewer/*`：统一 viewer 的 overlay、scene root、mode module loader、raycast interactivity
- `src/app/hooks/file-export/*`：应用级导出 helper 子树，`useFileExport.ts` 为入口
- `src/features/robot-tree/components/tree-editor/*` 与 `tree-node/*`：文件浏览器与结构树 UI 的细分子树
- `src/features/property-editor/utils/geometry-conversion/*`：几何转换、mesh analysis 与 primitive fit 底层
- `src/features/urdf-viewer/runtime/*`：vendored usd-viewer runtime、Hydra delegate 与 worker 相关适配
- `src/shared/components/3d/*`：双 viewer 共享的画布、渲染器、lighting、snapshot 与 transform controls 基础设施
- `src/shared/components/3d/workspace/*`：共享 `WorkspaceCanvas` 宿主、renderer cleanup 与 WebGL 检查
- `src/shared/workers/*` 与 `src/core/loaders/workers/*`：共享 preview worker 与 mesh parse worker

## 3. 架构红线

### 依赖方向

```text
app -> features -> store -> shared -> core -> types
```

必须遵守：

- 不新增反向依赖
- `features` 之间优先通过 `store` 通信
- `core/` 保持纯函数，不引入 React / UI / Feature 依赖
- 使用 `@/` 指向 `src/`
- `src/lib/` 只收稳定、通用、与应用壳无关的能力
- 应用内部不要把 `src/lib/` 当业务逻辑 source of truth

### 当前存量例外

- `src/shared/components/Panel/JointControlItem.tsx` 依赖 `@/store/robotStore`
- `src/shared/hooks/useEffectiveTheme.ts` 依赖 `@/store/uiStore`
- `src/features/ai-assistant/utils/pdfExport.ts` 依赖 `@/features/file-io/components/InspectionReportTemplate`

### 工程判断原则：符合 Linux 哲学与 Linus taste

默认工程取向：

- 优先简单直接的数据流与控制流，不为“理论优雅”引入额外抽象层
- 优先解决真实问题，不为未来也许会出现的场景预埋复杂框架
- 优先把复杂度消灭在设计里，而不是把复杂度包进 `manager`、`factory`、`coordinator` 之类命名里
- 若一个设计需要靠大量解释才能看懂，通常说明设计本身不够好

必须遵循：

- 小而清晰的接口优先。函数、hook、store action、worker message shape 尽量只表达一件事
- 优先组合现有稳定模块，不轻易新增“万能层”“统一抽象层”“Base\*”或过度泛化的中间封装
- 优先通过更好的数据结构消灭特殊情况，而不是继续堆 `if/else`
- 命名必须直白，优先描述真实语义、所有权、生命周期和失败路径
- 不要把坏状态悄悄修平；异常时优先暴露不变量被破坏的位置
- 新逻辑默认先问“能不能删掉特殊情况”，再问“要不要新增分支”
- 新抽象必须证明它真的降低了整体复杂度；如果只是搬运复杂度，就不要抽
- 公共层不要为单一业务特例污染接口；特例优先留在边界层
- 性能优化以真实热点为目标，避免投机性缓存、记忆化和多态分发
- 错误处理保持锋利边界，不要为了“调用方省心”吞掉上下文和失败条件

自检问题：

- 这个改动是否减少了特殊情况，而不是重新包装特殊情况？
- 这个接口是否能让调用方一眼看懂，而不需要追三层抽象？
- 这个状态或生命周期的 owner 是否唯一且明确？
- 这段逻辑是否在解决真实需求，而不是为了架构好看？
- 如果以后要删掉这段代码，边界是否清楚、代价是否可控？

明确不鼓励：

- 为了“模式统一”引入仓库当前并不需要的架构层
- 过度 OO、过度继承、过度配置化、过度泛型化
- 把复杂交互拆成大量弱关联小文件，导致阅读路径碎片化
- 用 silent fallback、隐式同步、魔法默认值维持表面整洁
- 为避免修改旧代码而额外包一层适配器，结果使主路径更难理解

### 状态管理

- `robotStore`：机器人模型 CRUD、Undo/Redo、派生计算、闭环约束
- `uiStore`：模式、主题、语言、侧栏、面板、显示选项
- `selectionStore`：选中、悬停、pulse、focus
- `assetsStore`：mesh、texture、robot files、motor library、USD scene snapshot、prepared export cache
- `assemblyStore`：多 URDF 组装、BridgeJoint、组件管理、组装历史
- `assemblySelectionStore`：workspace 中组件 / bridge / source file 的选区作用域
- `collisionTransformStore`：碰撞 gizmo 的瞬时 pending transform
- `jointInteractionPreviewStore`：跨 viewer 的关节交互预览与瞬时状态

### 国际化

- 文案位于 `src/shared/i18n/locales/en.ts` 与 `src/shared/i18n/locales/zh.ts`
- 新增界面文本时，必须同步双语

## 4. 单模式 `Editor`

| 子能力             | 主模块        | 典型任务                                       |
| ------------------ | ------------- | ---------------------------------------------- |
| 拓扑编辑           | `Visualizer`  | Link / Joint 增删、拓扑编辑、关节参数          |
| 几何 / 碰撞 / 测量 | `URDF Viewer` | Visual / Collision、网格、材质、纹理、碰撞变换 |
| 硬件配置           | `Visualizer`  | 电机型号、传动比、阻尼、摩擦                   |

新增功能前，先判断属于 `Editor` 下哪类子能力，避免跨子系统逻辑缠绕。

共享交互优先落在：

- `src/app/*` 编排层
- `src/shared/components/3d/*` 共享画布基础设施

## 5. App、Workspace、导入导出与装配

### App 编排入口

- `src/app/App.tsx`：根组件，装配 Providers、懒加载模态框、全局导入导出入口、debug bridge
- `src/app/AppLayout.tsx`：应用壳、Header、TreeEditor、PropertyEditor、UnifiedViewer 主编排
- `src/app/components/UnifiedViewer.tsx`：统一组合 `Visualizer` / `URDF Viewer`
- `src/app/components/WorkspaceCanvas.tsx`：应用层对共享画布入口的 re-export；底层 runtime 在 `src/shared/components/3d/workspace/*`
- `src/app/components/AppLayoutOverlays.tsx`：延迟加载桥接创建、碰撞优化等浮层
- `src/app/components/ConnectedDocumentLoadingOverlay.tsx` / `src/app/components/DocumentLoadingOverlay.tsx` / `src/app/components/ImportPreparationOverlay.tsx`：导入准备与文档加载反馈
- `src/app/components/unified-viewer/*`：统一 viewer 的 scene root、overlay、derived state、joints panel 适配
- `src/app/components/header/*` / `src/app/components/settings/*`：Header 菜单与设置子页

### 当前 app hooks 重点

- `useAppShellState.ts` / `useAppEffects.ts` / `useAppLayoutEffects.ts` / `useAppState.ts`：App shell、panel、mode 与副作用编排
- `useViewerOrchestration.ts`：selection / hover / pulse / focus / transform pending 协调
- `useFileImport.ts`：应用级导入流程
- `useFileExport.ts`：应用级导出流程入口
- `src/app/hooks/file-export/*`：导出 helper 子树，当前主要包含 `src/app/hooks/file-export/assemblyHistory.ts`、`src/app/hooks/file-export/progress.ts`、`src/app/hooks/file-export/projectExport.ts`、`src/app/hooks/file-export/usdExport.ts`
- `useWorkspaceSourceSync.ts`：workspace 与 source code 同步
- `useWorkspaceMutations.ts`：workspace 级变更编排
- `useLibraryFileActions.ts`：library 文件动作
- `src/app/hooks/useWorkspaceModeTransitions.ts` / `src/app/hooks/useWorkspaceOverlayActions.ts`：workspace 模式切换与浮层动作
- `src/app/hooks/usePreparedUsdViewerAssets.ts` / `src/app/hooks/useAnimatedWorkspaceViewerRobotData.ts` / `src/app/hooks/useSourceCodeEditorWarmup.ts`：viewer 资产、workspace 动画数据与编辑器预热
- `src/app/hooks/useImportInputBinding.ts` / `usePendingHistoryCoordinator.ts`：导入输入绑定与 pending history 生命周期协调
- `src/app/hooks/useEditableSourcePatches.ts` / `src/app/hooks/useUnsavedChangesPrompt.ts`：源码 patch 生命周期与离开保护
- `useCollisionOptimizationWorkflow.ts`：碰撞优化 UI 流程

### File I/O 真实边界

- `src/features/file-io/` 负责底层文件能力：
  - 格式检测
  - project archive / import
  - USD / SDF export
  - BOM
  - `ExportDialog` / `ExportProgressDialog`
  - PDF / snapshot hooks
- 应用工作流 source of truth 在：
  - `src/app/hooks/useFileImport.ts`
  - `src/app/hooks/useFileExport.ts`
  - `src/app/hooks/file-export/*`

说明：

- 旧的 `features/file-io/hooks/useFileExport.ts` 已移除。
- `.usp` project import/export、USD prepared export cache、live USD roundtrip archive 已进入主工作流。
- `projectImport.worker.ts` 已纳入 project archive 导入链路，project import 问题优先在 worker/bridge 修复。
- `DisconnectedWorkspaceUrdfExportDialog.tsx` 用于 workspace 断联 URDF 导出特例；不要把这类入口混回通用导出对话框。
- 导出相关新 helper 默认补到 `src/app/hooks/file-export/*`，不要继续把 `useFileExport.ts` 堆成单体入口。

### 多 URDF 组装

- 每个组件导入后需要命名空间前缀，避免 `Link` / `Joint` 冲突
- 组件之间通过 `BridgeJoint` 连接
- 合并逻辑位于 `assemblyStore` 与 `core/robot/assemblyMerger.ts`
- 改动组装功能时，重点检查：
  - 命名空间冲突
  - `BridgeJoint` 合法性
  - 合并导出一致性
  - workspace 与 structure 视图切换时的 source file / selected file 同步

### Workspace 交互

- `structure`：简单文件树
- `workspace`：素材库 + 组装树
- `src/features/robot-tree/components/tree-editor/*`：文件浏览器与 section/header
- `src/features/robot-tree/components/tree-node/*`：结构树节点与分支渲染
- 文件加入组装的入口：
  - 右键菜单“添加”
  - 文件行右侧绿色按钮
- 单击文件会直接加入组装；右键菜单与文件行右侧按钮保留快捷操作入口

## 6. UI / 样式 / 可访问性

### 关键入口

- 语义 token：`src/styles/index.css`
- 主题状态：`src/store/uiStore.ts`
- 系统主题监听：`src/app/hooks/useAppEffects.ts`

### 必须遵守

- 使用语义色 token，不散落硬编码 `#RRGGBB`
- 所有组件在 `light + dark + prefers-contrast: more` 下都应可读
- 暗色界面使用 `base / surface / elevated` 层级，避免纯黑硬切
- 状态表达不能只依赖颜色，补充图标、文案或形态差异
- Focus 态必须可见，建议统一 `ring-system-blue/30`
- 小字号文本避免低对比度颜色

### 当前高频语义色

- `app-bg`
- `panel-bg`
- `element-bg`
- `element-hover`
- `border-black`
- `text-primary` / `text-secondary` / `text-tertiary`
- `system-blue`
- `system-blue-solid`
- `slider-accent`

### 蓝色使用强约束

- `#0088FF` 仅用于 `slider-accent`、进度线、细线型高亮
- `#0088FF` 禁止用于：
  - 主按钮实底
  - 小字号正文链接
  - 大面积背景填充
- 语义映射：
  - 线性高亮 -> `slider-accent`
  - 主按钮 -> `system-blue-solid`
  - 文本 / 图标强调 -> `system-blue`

### UI 验收

- `Light / Dark / 高对比` 三种场景均可读
- Hover / Active / Focus 行为一致且可感知
- 不新增分散硬编码色值

## 7. Visualizer（Editor 子能力：拓扑 / 硬件）

### 当前结构

- `src/features/visualizer/components/Visualizer.tsx`
- `src/features/visualizer/components/VisualizerScene.tsx`
- `src/features/visualizer/components/VisualizerPanels.tsx`
- `src/features/visualizer/components/VisualizerCanvas.tsx`
- `src/features/visualizer/components/VisualizerHoverController.tsx`
- `src/features/visualizer/components/nodes/*`
- `src/features/visualizer/components/controls/*`
- `src/features/visualizer/components/constraints/*`
- `src/features/visualizer/hooks/*`
- `src/features/visualizer/hooks/useVisualizerState.ts`
- `src/features/visualizer/hooks/useCollisionMeshPrewarm.ts`
- `src/features/visualizer/utils/mergedVisualizerSceneMode.ts`
- `src/features/visualizer/utils/mergedVisualizerLayout.ts`
- `src/features/visualizer/utils/materialCache.ts`
- 共享面板在 `src/shared/components/Panel/*`

### 核心模式

```text
RobotNode (Link) -> JointNode (Joint) -> RobotNode (child Link)
```

关键 hooks / 能力：

- `useJointPivots`
- `useCollisionRefs`
- `useClosedLoopDragSync`
- `useTransformControls`
- `useVisualizerController`

### 实现约束

- 新能力优先放入 hooks 或新组件，不继续增厚 `Visualizer.tsx`
- 材质必须通过 `materialCache` 复用，不在高频路径直接 `new` 材质
- 统一使用 `RobotState` 等共享类型，避免 `any`
- TransformControls 依赖的引用注册必须完整、可追踪
- 保持 `RobotNode <-> JointNode` 交替递归模式
- 涉及 THREE 资源时注意释放，避免材质 / 几何体泄漏

## 8. URDF Viewer（Editor 子能力：几何 / 碰撞 / 测量）

### 当前结构

- React 层：
  - `src/features/urdf-viewer/components/*`
  - `src/features/urdf-viewer/hooks/*`
  - `src/features/urdf-viewer/types.ts`
- Runtime / embed 层：
  - `src/features/urdf-viewer/runtime/embed/*`
  - `src/features/urdf-viewer/runtime/hydra/*`
  - `src/features/urdf-viewer/runtime/types/*`
  - `src/features/urdf-viewer/runtime/vendor/*`
  - `src/features/urdf-viewer/runtime/viewer/*`
  - `src/features/urdf-viewer/runtime/UPSTREAM.md`
- Adapter / utils 层：
  - `src/features/urdf-viewer/utils/*`
- Worker 层：
  - `src/features/urdf-viewer/workers/*`

### 当前关键边界

- `runtime/*` 是 vendored `usd-viewer` runtime。
- URDF Studio 应适配 runtime 输出到自己的 `ViewerRobotDataResolution` / `RobotData`。
- 不要在 `src/core/parsers/usd/*` 里重复实现 viewer runtime 的职责。
- `public/usd/bindings/*` 必须保留在静态资源目录，供浏览器运行时 fetch。

### 核心文件

- `src/features/urdf-viewer/components/URDFViewerCanvas.tsx`
- `src/features/urdf-viewer/components/ViewerToolbar.tsx`
- `src/features/urdf-viewer/components/ViewerLoadingHud.tsx`
- `src/features/urdf-viewer/components/UsdWasmStage.tsx`
- `src/features/urdf-viewer/components/UsdOffscreenStage.tsx`
- `src/features/urdf-viewer/utils/viewerRobotData.ts`
- `src/features/urdf-viewer/utils/viewerResourceScope.ts`
- `src/features/urdf-viewer/utils/usdExportBundle.ts`
- `src/features/urdf-viewer/utils/usdRuntimeRobotHydration.ts`
- `src/features/urdf-viewer/utils/usdSceneRobotResolution.ts`
- `src/features/urdf-viewer/utils/usdViewerRobotAdapter.ts`
- `src/features/urdf-viewer/utils/runtimeSceneMetadata.ts`
- `src/features/urdf-viewer/utils/usdOffscreenViewerWorkerClient.ts`
- `src/features/urdf-viewer/utils/usdStageOpenPreparationWorkerBridge.ts`
- `src/features/urdf-viewer/utils/usdPreparedExportCacheWorkerBridge.ts`
- `src/features/urdf-viewer/utils/visualizationFactories.ts`
- `src/features/urdf-viewer/utils/dispose.ts`

### 工具与职责

- 工具模式：`select | translate | rotate | universal | view | face | measure`
- `useRobotLoader`：模型加载
- `useHighlightManager` / `useHoverDetection`：高亮与悬停
- `useMouseInteraction` / `JointInteraction`：交互处理
- `useVisualizationEffects`：惯性、质心、原点等辅助可视化

### 实现约束

- 优先复用 `materials.ts`、`urdfMaterials.ts`、`dispose.ts`
- 卸载 / 切换 / reload / hydration rollback 时必须清理 THREE 资源
- Props 与共享类型统一收口到 `types.ts`
- 可视化扩展通过 `visualizationFactories.ts`
- 避免在组件里散落临时材质、临时几何体、未释放纹理
- Stage open、prepared export、offscreen viewer 这三条链路优先修 `utils/*WorkerBridge.ts` / `workers/*.worker.ts`，不要在 UI 层补丁式兜底
- 共享关节面板仍位于 `src/shared/components/Panel/JointsPanel.tsx`

## 9. AI 功能

### 环境变量

```env
VITE_OPENAI_API_KEY=your_key
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
VITE_OPENAI_MODEL=deepseek-v3
```

### 审阅输入

- `src/features/ai-assistant/config/urdf_inspect_standard_en.md`
- `src/features/ai-assistant/config/urdf_inspect_stantard_zh.md`

说明：

- 中文文件名当前仓库拼写为 `stantard`，属现状，不要擅自改名。

## 10. 常用检查命令

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
npm run preview
npm run verify:fast
npm run verify:full

# 结构和依赖方向
find src -maxdepth 3 -type d | sort
find src/app src/features -maxdepth 2 -type f | sort | sed -n '1,240p'
rg -n "from ['\"]@/features/" src/core src/shared src/store
rg -n "from ['\"]@/features/" src/features
rg -n "from ['\"]@/store/" src/shared

# 样式检查
rg -n "#[0-9A-Fa-f]{3,8}" src
rg -n "#0088FF|#0088ff" src | rg -v "Slider.tsx|styles/index.css"

# fixture / 浏览器回归入口
npm run test:unit:app-hooks
npm run test:fixtures:imports
npm run test:fixtures:unitree-usd
npm run test:fixtures:unitree-ros-urdfs
npm run test:fixtures:unitree-ros-usda
```

## 11. 临时产物与浏览器验证

- 浏览器截图、trace、快照、临时调试日志默认写入 `tmp/`
- `output/` 只放用户可见导出或明确要保留的结果
- 截图前优先关闭会遮挡主体内容的侧栏与面板
- 验证完成后关闭多余浏览器标签页、DevTools、Playwright 会话与临时进程
