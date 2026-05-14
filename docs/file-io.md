# 导入导出与 Workspace 链路

> 最后更新：2026-05-13 | 覆盖源码：`src/app/hooks/`、`src/app/utils/`、`src/app/workers/`、`src/features/file-io/`、`src/features/robot-tree/`、`src/features/assembly/`、`src/features/property-editor/`
> 交叉引用：[viewer.md](viewer.md)、[architecture.md](architecture.md)

## 1. 职责拆分

| 层级 | 职责 | 入口 |
|------|------|------|
| `features/file-io/` | 底层文件能力：格式检测、BOM、project import/export、archive/asset registry、USD/SDF export、ExportDialog/ExportProgressDialog、snapshot/pdf hooks、导入导出 worker bridge | `src/features/file-io/index.ts` |
| `app/hooks/useFileImport.ts` | 应用级导入工作流（source of truth） | — |
| `app/hooks/useFileExport.ts` | 应用级导出工作流（source of truth） | — |
| `app/hooks/file-export/*` | 导出 workflow 子模块 helper | `assemblyHistory.ts`、`progress.ts`、`projectExport.ts`、`usdExport.ts` |
| `features/robot-tree/` | structure/workspace 文件树、树编辑器、上下文菜单 | `tree-editor/*`、`tree-node/*` |
| `features/assembly/` | 桥接组件创建与组装入口 | — |
| `features/property-editor/` | 属性编辑、几何编辑、碰撞优化 | `geometry-conversion/*`、`workers/*` |

## 2. 当前工作流事实

- `features/file-io/hooks/useFileExport.ts` 已移除，应用导出 source of truth 在 `app/hooks/useFileExport.ts`
- 应用导入 source of truth 在 `app/hooks/useFileImport.ts`，不要在 `features/file-io` 恢复旧导入 hook
- 新增导出辅助逻辑时，优先补到 `app/hooks/file-export/*`，不要把 `useFileExport.ts` 堆成大而全单文件
- `.usp` project import/export、USD prepared export cache、live USD roundtrip archive 已进入主工作流
- `projectArchive.worker.ts`、`usdExport.worker.ts`、`usdBinaryArchive.worker.ts` 已进入主导出链路；大型归档或序列化任务优先走 worker/transfer
- `projectImport.worker.ts` 已进入 project import 链路；问题优先在 worker/bridge 修
- `DisconnectedWorkspaceUrdfExportDialog.tsx` 是 workspace 断联导出特例，不要塞回通用导出弹层
- `ExportProgressDialog.tsx` / `ExportProgressView.tsx` 是长时导出反馈的统一 UI，不要重新发明导出进度弹层

## 3. App 编排层

### 关键组件

- `App.tsx`：根组件，装配 Providers、懒加载模态框、全局导入导出入口、debug bridge
- `AppLayout.tsx`：应用壳、Header、TreeEditor、PropertyEditor、UnifiedViewer 主编排
- `UnifiedViewer.tsx`：组合 Editor 两个子域场景，统一 selection/hover/preview/tool mode
- `WorkspaceCanvas.tsx`：应用层 re-export；底层 runtime 在 `shared/components/3d/workspace/*`
- `AppLayoutOverlays.tsx` + `utils/overlayLoaders.ts`：懒加载业务浮层
- `SnapshotDialog.tsx`：统一快照导出与预览弹层
- `unified-viewer/*`：统一 viewer 的 scene root、overlay、derived state、mode module loader

### 关键 hooks

- `useAppShellState` / `useAppEffects` / `useAppLayoutEffects` / `useAppState`：App shell 与 layout 编排
- `useViewerOrchestration`：selection / hover / pulse / focus / transform pending 协调
- `useFileImport` / `useFileExport`：导入导出编排入口
- `useWorkspaceSourceSync` / `useWorkspaceMutations` / `useLibraryFileActions`：workspace 与 source 同步
- `useWorkspaceModeTransitions` / `useWorkspaceOverlayActions`：workspace 视图切换与浮层动作
- `usePreparedUsdViewerAssets` / `useAnimatedWorkspaceViewerRobotData`：viewer 资产与动画数据
- `useImportInputBinding`：App 级文件输入绑定
- `useEditableSourcePatches` / `useUnsavedChangesPrompt`：源码 patch 与离开保护
- `useCollisionOptimizationWorkflow`：碰撞优化 UI 流程
- `usePendingHistoryCoordinator`：pending history 生命周期协调
- `useToolItems`：工具箱注册表（新增工具唯一需要改的文件）
- `usePluginLaunch`：读取 `?plugin=<key>` URL 参数并调用 `openTool(key)` 激活插件工具，参数消费后从 URL 移除

### app/utils/ 重点

- USD/roundtrip/hydration：`usdExportContext.ts`、`usdHydrationPersistence.ts`、`usdStageHydration.ts`
- 导出辅助：`exportArchiveAssets.ts`、`usdBinaryArchive.ts`、`urdfSourceExportUtils.ts`、`currentUsdExportMode.ts`
- 历史与缓存：`pendingHistory.ts`、`pendingUsdCache.ts`
- 导入准备：`documentLoadFlow.ts`、`importPreparation.ts`、`importPreparationTransfer.ts`
- Unified viewer 状态：`unifiedViewer*.ts`、`viewerViewportHandoff.ts`
- Worker payload：`robotImportWorkerPayload.ts`、`usdBinaryArchiveWorkerTransfer.ts`

### app/workers/

- `importPreparation.worker.ts`
- `robotImport.worker.ts`
- `usdBinaryArchive.worker.ts`

### 约束

- 逻辑横跨多个 store / feature / viewer 状态时优先放 `app`
- 单一 feature 内闭环逻辑不要硬塞 `app`
- `app` deep import feature 内部 `utils/*` 是历史遗留；新增长期编排能力优先通过 feature `index.ts` 或 facade 暴露稳定入口

## 4. 多 URDF 组装

- 每个组件导入后需要命名空间前缀，避免 Link / Joint 冲突
- 组件之间通过 `BridgeJoint` 连接
- 合并逻辑在 `assemblyStore` 与 `core/robot/assemblyMerger.ts`
- 改动组装功能时重点检查：命名空间冲突、BridgeJoint 合法性、合并导出一致性、workspace 与 structure 视图切换时的 source file / selected file 同步

## 5. Workspace 交互

- `structure`：当前模型视图
- `workspace`：装配工作区视图
- 文件加入组装入口：右键菜单"添加"、文件行右侧绿色按钮
- 单击机器人文件打开为当前模型；显式"添加"才加入组装

## 6. 跨域 Handoff 接收端

`src/app/handoff/`、`src/handoff/` 是 BOT World Gallery → URDF Studio 的资产传递与插件激活接收端，不可删除。

### 路径 A — 弹窗 ZIP 接收

```text
handoff.html → src/handoff/main.ts
  → 接收 postMessage ZIP → IndexedDB 存储
  → BroadcastChannel 通知主 tab → 主 tab 即时 claim 并导入
  → 无已有 tab 时重定向 ?handoff=<id> → 新 tab URL bootstrap 消费
```

- 发送方通过 `window.open('handoff.html')` 打开弹窗，经 postMessage 握手后传输 ZIP
- 弹窗验证 origin 白名单后将数据写入 IndexedDB，通过 BroadcastChannel 通知主 tab
- **已有 tab**：主 tab 监听 `archive-ready` 广播，立即原子 claim 并导入
- **无已有 tab**：弹窗等待 1s BroadcastChannel 回复后超时，redirect 到 `?handoff=<id>`，新 tab 通过 URL 参数 claim 并导入
- 安全：origin 白名单校验、真实 `senderOrigin` 记录、`textContent` 防止 XSS

### 路径 B — 服务端令牌接收（已删除）

路径 B（`externalImportHandoffProtocol.ts` + `externalImportHandoffStorage.ts`）已完全移除。所有资产类型统一使用路径 A。

### 路径 C — 插件激活

```text
handoff.html?plugin=<key> → src/handoff/main.ts
  → 写入轻量记录（无 ZIP，仅 pluginKey）→ IndexedDB
  → BroadcastChannel 通知 → 已打开编辑器 tab 即时消费 → openTool(key)
  → 若无已有 tab → 重定向 ?plugin=<key> → usePluginLaunch hook 激活
```

- `usePluginLaunch`（`src/app/hooks/usePluginLaunch.ts`）：读取 `?plugin=<key>` URL 参数，通过 `requestAnimationFrame` 双帧等待后调用 `openTool(key)`，参数消费后从 URL 移除

### 协议与存储

| 项目 | 值 |
|------|-----|
| 消息类型 | `READY` / `PAYLOAD` / `RESULT`（三步，无 offer/accept） |
| 路径 A/C 数据库 | `bot-world-popup-handoff`，store `archives` |
| 通知机制 | BroadcastChannel（`urdf-studio-handoff`） |
| TTL | 15 min |
| 协议版本 | `POPUP_HANDOFF_PROTOCOL_VERSION = 1` |
| 安全 | Origin 白名单 + 真实 senderOrigin + 原子 claim + DB 连接池化 |

约束：三端（BOT World、URDF Studio、Motion Studio）的 `popupHandoffProtocol.ts` 必须保持协议版本一致。

## 7. 明确热点文件（新增逻辑优先抽离）

- `src/features/property-editor/utils/geometryConversion.ts`
- `src/features/file-io/utils/usdExport.ts`
- `src/app/hooks/useFileExport.ts`
- `src/app/AppLayout.tsx`
