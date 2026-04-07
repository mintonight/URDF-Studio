# Visualizer 模块入口

本文件改为轻量入口，完整上下文已并入 `docs/prompts/CLAUDE.md` 第 7 节。

## 快速定位

- 主组件：`src/features/visualizer/components/Visualizer.tsx`
- 场景编排：`src/features/visualizer/components/VisualizerScene.tsx`
- 面板编排：`src/features/visualizer/components/VisualizerPanels.tsx`
- 画布：`src/features/visualizer/components/VisualizerCanvas.tsx`
- 悬停控制：`src/features/visualizer/components/VisualizerHoverController.tsx`
- 约束覆盖：`src/features/visualizer/components/constraints/*`
- 节点递归：`src/features/visualizer/components/nodes/*`
- 控制器：`src/features/visualizer/components/controls/*`
- Hooks：`src/features/visualizer/hooks/*`
- 状态与预热：`src/features/visualizer/hooks/useVisualizerState.ts`、`src/features/visualizer/hooks/useCollisionMeshPrewarm.ts`
- 场景模式/布局：`src/features/visualizer/utils/mergedVisualizerSceneMode.ts`、`src/features/visualizer/utils/mergedVisualizerLayout.ts`
- 交互辅助：`src/features/visualizer/utils/hoverPicking.ts`、`src/features/visualizer/utils/geometryHover.ts`
- 材质缓存：`src/features/visualizer/utils/materialCache.ts`

## 关键约束

- 新功能优先拆到 hooks / 新组件，不继续堆进 `Visualizer.tsx`
- `src/app/components/unified-viewer/*` 负责统一 viewer 宿主与 mode 切换；不要把 app 级 overlay / preview / forced session 状态回灌到 visualizer feature 内部
- 保持 `RobotNode <-> JointNode` 交替递归结构
- 引用注册必须完整，避免 TransformControls 失联
- 材质通过缓存复用，避免高频路径直接创建
- 类型优先用 `RobotState`，避免 `any`
- 闭环与碰撞拖拽优先复用现有 hooks：`useClosedLoopDragSync`、`useJointPivots`、`useCollisionRefs`、`useTransformControls`
