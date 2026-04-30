# 统一渲染前端重构计划

## 概述

将当前分散的渲染路径（RobotModel + UsdWasmStage + UsdOffscreenStage）统一为单一的前端渲染组件 `RobotModel`，格式差异下沉到后端抽象层。

## 问题分析

### 当前架构问题

```
ViewerScene (src/features/urdf-viewer/components/ViewerScene.tsx)
├─ format === 'usd'
│  ├─ UsdOffscreenStage.tsx  (~900 行) - 后台预加载
│  └─ UsdWasmStage.tsx       (~3759 行) - 交互式 USD 渲染
│
└─ format !== 'usd'
   └─ RobotModel.tsx         (~833 行) - 传统格式渲染

总代码量: ~5492 行，存在大量重复逻辑
```

### 重复的功能模块

| 功能 | RobotModel | UsdWasmStage | 共享度 |
|------|-----------|--------------|--------|
| 鼠标交互 | useMouseInteraction | 自定义 raycast | 0% |
| 悬停检测 | useHoverDetection | usdHoverPointerState | 0% |
| 高亮管理 | useHighlightManager | useUsdHighlightLifecycle | 0% |
| 变换控制 | Origin/CollisionTransformControls | UsdOrigin/UsdCollisionTransformControls | 0% |
| 关节交互 | JointInteraction | 内联实现 | 0% |
| 加载状态 | ViewerLoadingHud | 自定义 HUD | 50% |
| 相机聚焦 | useCameraFocus | computeCameraFrame | 0% |

### 设计债务

1. **代码重复**：每个交互功能都实现了两套
2. **维护成本高**：新功能需要在两处实现
3. **测试成本翻倍**：USD 和非 USD 需要分别测试
4. **用户体验不一致**：某些功能只在一种路径下可用

## 目标架构

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           统一前端层                                     │
│  RobotModel.tsx (唯一入口，格式无关)                                      │
│  ├─ useRobotLoader       ← 统一加载 hook                                │
│  ├─ useMouseInteraction   ← 统一交互 hook                                │
│  ├─ useHoverDetection     ← 统一悬停 hook                                │
│  ├─ useHighlightManager   ← 统一高亮 hook                                │
│  ├─ useCameraFocus        ← 统一相机 hook                                │
│  ├─ OriginTransformControls (统一)                                       │
│  ├─ CollisionTransformControls (统一)                                     │
│  ├─ JointInteraction (统一)                                               │
│  ├─ AssemblyTransformControls (统一)                                      │
│  └─ LinkIkTransformControls (统一)                                       │
└─────────────────────────────────────────────────────────────────────────┘
                                        ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                         后端抽象层                                       │
│  interface RobotRendererBackend {                                        │
│    load(props: RendererSceneProps): Promise<RobotSceneGraph>;           │
│    getRobotObject(): THREE.Object3D | null;                             │
│    getLinkMeshMap(): Map<string, THREE.Mesh[]>;                         │
│    updateLinkTransform(linkId, matrix): void;                           │
│    raycast(raycaster, options): RaycastHit[];                           │
│    dispose(): void;                                                      │
│  }                                                                        │
│                                                                           │
│  ThreeJsBackend.ts   ← 实现 ← RobotRendererBackend (URDF/MJCF/SDF)       │
│  UsdWasmBackend.ts   ← 实现 ← RobotRendererBackend (USD/USDA)          │
└─────────────────────────────────────────────────────────────────────────┘
```

## 需求摘要

1. 创建 `RobotRendererBackend` 接口，定义渲染后端必须实现的契约
2. 实现 `ThreeJsBackend` 处理传统格式
3. 实现 `UsdWasmBackend` 处理 USD 格式
4. 重构 `RobotModel` 为格式无关的统一前端
5. 删除 `UsdWasmStage.tsx` 和 `UsdOffscreenStage.tsx`
6. 简化 `ViewerScene.tsx` 移除格式分支

## 验收标准

### 功能验收
- [ ] 所有格式（URDF/MJCF/SDF/USD/Xacro/Mesh）通过统一的 `RobotModel` 渲染
- [ ] 鼠标选择/悬停在所有格式下行为一致
- [ ] 变换控制（origin/collision/joint）在所有格式下可用
- [ ] IK 功能在所有格式下可用
- [ ] 组装变换在所有格式下可用
- [ ] 相机自动聚焦在所有格式下正常工作

### 代码质量验收
- [ ] 不存在 `UsdWasmStage` 或 `UsdOffscreenStage` 组件
- [ ] `ViewerScene.tsx` 中无格式分支逻辑
- [ ] 新增交互功能只需在 `RobotModel` 或 hooks 中实现一次
- [ ] 后端接口测试覆盖率 > 80%
- [ ] TypeScript 类型检查通过，无 `any`

### 性能验收
- [ ] USD 加载性能不低于原有实现
- [ ] 交互响应延迟 < 16ms
- [ ] 内存使用无明显增加

## 实施步骤

### Phase 1: 定义后端接口和共享类型

**目标**：建立后端抽象层的基础

1. 创建 `src/shared/components/3d/renderers/types.ts`
   - 定义 `RobotRendererBackend` 接口
   - 定义 `RendererSceneProps` 类型
   - 定义 `RobotSceneGraph` 返回类型
   - 定义 `RaycastHit` 和 `RaycastOptions` 类型

2. 创建 `src/shared/components/3d/renderers/index.ts`
   - 导出所有类型和接口

**预计代码量**：~150 行

**验证**：TypeScript 编译通过

---

### Phase 2: 实现 ThreeJsBackend

**目标**：将 RobotModel 的 Three.js 加载逻辑提取为独立后端

1. 创建 `src/shared/components/3d/renderers/ThreeJsBackend.ts`
   - 实现 `RobotRendererBackend` 接口
   - 移植 `useRobotLoader` 的核心逻辑
   - 处理 mesh 加载和材质应用
   - 实现基于 THREE 的 raycast

2. 创建 `src/shared/components/3d/renderers/ThreeJsBackend.test.ts`
   - 测试加载功能
   - 测试 raycast 功能
   - 测试清理功能

**预计代码量**：~400 行（+ ~200 行测试）

**涉及文件**：
- 新建：`src/shared/components/3d/renderers/ThreeJsBackend.ts`
- 参考：`src/features/urdf-viewer/hooks/useRobotLoader.ts`

**验证**：ThreeJsBackend 所有测试通过

---

### Phase 3: 实现 UsdWasmBackend

**目标**：将 USD 加载逻辑提取为独立后端

1. 创建 `src/shared/components/3d/renderers/UsdWasmBackend.ts`
   - 实现 `RobotRendererBackend` 接口
   - 移植 `UsdWasmStage` 的核心加载逻辑
   - 移植 `UsdOffscreenStage` 的预加载逻辑（如需保留）
   - 实现 USD 的 raycast（通过 USD Runtime）

2. 创建 `src/shared/components/3d/renderers/UsdWasmBackend.test.ts`
   - 测试 USD 场景加载
   - 测试 USD raycast
   - 测试清理功能

**预计代码量**：~600 行（+ ~150 行测试）

**涉及文件**：
- 新建：`src/shared/components/3d/renderers/UsdWasmBackend.ts`
- 参考：`src/features/urdf-viewer/components/UsdWasmStage.tsx`
- 参考：`src/features/urdf-viewer/components/UsdOffscreenStage.tsx`

**验证**：UsdWasmBackend 所有测试通过

---

### Phase 4: 统一交互 Hooks

**目标**：创建格式无关的交互 hooks

1. 重构 `src/features/urdf-viewer/hooks/useMouseInteraction.ts`
   - 接收 `RobotRendererBackend` 参数
   - 使用后端的 `raycast` 方法
   - 支持两种后端的统一交互

2. 重构 `src/features/urdf-viewer/hooks/useHoverDetection.ts`
   - 使用后端的 raycast
   - 统一悬停行为

3. 重构 `src/features/urdf-viewer/hooks/useHighlightManager.ts`
   - 统一高亮逻辑

4. 创建 `src/features/urdf-viewer/hooks/useRendererBackend.ts`
   - 统一后端管理
   - 处理后端生命周期

**预计代码量**：重构 ~300 行，新增 ~100 行

**验证**：所有 hooks 测试通过

---

### Phase 5: 统一变换控制组件

**目标**：合并 USD 和传统格式的变换控制

1. 创建 `src/features/urdf-viewer/components/TransformControls.tsx`（统一）
   - 替换 `OriginTransformControls` 和 `UsdOriginTransformControls`
   - 替换 `CollisionTransformControls` 和 `UsdCollisionTransformControls`
   - 使用 `RobotRendererBackend` 更新变换

2. 更新 `src/features/urdf-viewer/components/JointInteraction.tsx`
   - 支持统一后端

3. 更新 `src/features/urdf-viewer/components/AssemblyTransformControls.tsx`
   - 支持统一后端

**预计代码量**：重构 ~500 行

**涉及文件**：
- 删除：`UsdOriginTransformControls.tsx`
- 删除：`UsdCollisionTransformControls.tsx`
- 更新：`OriginTransformControls.tsx`
- 更新：`CollisionTransformControls.tsx`

**验证**：变换控制在所有格式下工作正常

---

### Phase 6: 重构 RobotModel 为统一前端

**目标**：移除格式特定逻辑，使用后端抽象

1. 重构 `src/features/urdf-viewer/components/RobotModel.tsx`
   - 根据格式选择后端
   - 使用 `useRendererBackend` hook
   - 使用统一的交互 hooks
   - 使用统一的变换控制组件
   - 移除所有 USD 特定代码

2. 更新 `src/features/urdf-viewer/components/RobotModel.test.tsx`
   - 添加 USD 测试用例
   - 验证格式无关性

**预计代码量**：重构 ~833 行 → ~500 行

**验证**：RobotModel 在所有格式下渲染正常

---

### Phase 7: 简化 ViewerScene

**目标**：移除格式分支，统一调用路径

1. 更新 `src/features/urdf-viewer/components/ViewerScene.tsx`
   - 移除 `useUsdStage` 条件判断
   - 移除 `UsdOffscreenStage` 和 `UsdWasmStage` 导入
   - 只保留 `RobotModel` 调用

2. 删除 `src/features/urdf-viewer/components/UsdWasmStage.tsx`
3. 删除 `src/features/urdf-viewer/components/UsdOffscreenStage.tsx`
4. 删除相关的 USD 特定 utilities（确认无其他引用）

**预计代码量**：删除 ~4700 行，简化 ~200 行

**验证**：ViewerScene 只有 `RobotModel` 一种渲染路径

---

### Phase 8: 清理和测试

**目标**：确保无遗留代码，功能完整

1. 运行全文搜索，确认无 `UsdWasmStage` 引用
2. 运行全文搜索，确认无 `UsdOffscreenStage` 引用
3. 运行 `npm run typecheck` 修复类型错误
4. 运行 `npm run lint` 修复 lint 错误
5. 运行 `npm run test` 确保所有测试通过
6. 手动测试所有格式的导入和显示

**验证**：所有检查通过

---

## 风险和缓解措施

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| USD 渲染性能下降 | 高 | 保持 USD WASM 运行时不变，只调整封装层；性能基准测试 |
| 交互功能回退 | 中 | 保留原有交互逻辑的测试用例；分阶段迁移，每阶段验证 |
| 兼容性问题 | 中 | 保持对外 API 不变；充分测试存量功能 |
| 重构周期长 | 低 | 按 Phase 逐步交付，每 Phase 可独立验证 |

## 文件变更清单

### 新增文件
```
src/shared/components/3d/renderers/
├── types.ts                              (~150 行)
├── index.ts                              (~20 行)
├── ThreeJsBackend.ts                     (~400 行)
├── ThreeJsBackend.test.ts                (~200 行)
├── UsdWasmBackend.ts                     (~600 行)
└── UsdWasmBackend.test.ts                (~150 行)

src/features/urdf-viewer/hooks/
└── useRendererBackend.ts                 (~100 行)

src/features/urdf-viewer/components/
└── TransformControls.tsx                 (~500 行，重构)
```

### 修改文件
```
src/features/urdf-viewer/
├── hooks/useMouseInteraction.ts          (重构)
├── hooks/useHoverDetection.ts            (重构)
├── hooks/useHighlightManager.ts          (重构)
├── components/RobotModel.tsx             (重构)
├── components/OriginTransformControls.tsx (适配后端)
├── components/CollisionTransformControls.tsx (适配后端)
├── components/JointInteraction.tsx       (适配后端)
├── components/AssemblyTransformControls.tsx (适配后端)
└── components/ViewerScene.tsx            (大幅简化)
```

### 删除文件
```
src/features/urdf-viewer/components/
├── UsdWasmStage.tsx                      (~3759 行)
├── UsdOffscreenStage.tsx                 (~900 行)
├── UsdOriginTransformControls.tsx        (~100 行)
├── UsdCollisionTransformControls.tsx     (~160 行)
└── ViewerLoadingHud.tsx                  (可能，如果已有共享版本)
```

### 净代码量变化
- 删除：~4919 行
- 新增：~2120 行
- 重构：~2000 行
- **净减少**：~4800 行

## RALPLAN-DR Summary

### Principles
1. **单一职责**：前端组件只负责渲染和交互，格式处理下沉到后端
2. **开闭原则**：通过接口扩展支持新格式，无需修改前端组件
3. **DRY 原则**：消除 USD 和非 USD 之间的重复代码

### Decision Drivers
1. **维护成本**：当前两套渲染路径导致维护成本翻倍
2. **功能一致性**：用户期望所有格式有相同的交互体验
3. **扩展性**：未来支持新格式（如 glTF）需要统一框架

### Viable Options

#### Option A: 统一前端 + 后端抽象（推荐）
**Approach**: 创建 `RobotRendererBackend` 接口，实现 `ThreeJsBackend` 和 `UsdWasmBackend`，前端完全格式无关

**Pros**:
- 彻底消除重复代码
- 新增交互功能只需实现一次
- 未来扩展新格式成本低

**Cons**:
- 需要较大重构
- USD 特殊功能（如 OffscreenStage）需要取舍

**Why chosen**: 用户明确要求统一前端，这是最彻底的解决方案

#### Option B: 保留双路径，提取共享层
**Approach**: 保持两套渲染路径，提取共享的 hooks 和 utilities

**Pros**:
- 重构风险较低
- 可以保留 USD 特殊功能

**Cons**:
- 无法彻底消除重复
- 维护成本仍然较高

**Why rejected**: 用户希望最终只有一个前端，此方案无法满足

#### Option C: USD 转换为 URDF 渲染
**Approach**: USD 导入时转换为 URDF，然后统一使用 URDF 渲染

**Pros**:
- 完全统一渲染路径

**Cons**:
- 丢失 USD 特有的功能
- 转换可能有精度损失
- 与用户需求不符

**Why rejected**: USD 的原生功能很重要，不应丢弃

## ADR

### Decision
采用统一前端 + 后端抽象的架构，将 RobotModel 重构为格式无关的组件，格式差异通过 RobotRendererBackend 接口封装。

### Drivers
1. 当前 USD 和非 USD 有两套独立的渲染前端，代码重复严重
2. 维护两套路径成本高，新功能需要实现两次
3. 用户期望所有格式有一致的交互体验

### Alternatives Considered
1. 保留双路径，提取共享层 - 被拒绝，无法满足统一前端需求
2. USD 转换为 URDF 渲染 - 被拒绝，丢失 USD 原生功能

### Why Chosen
这是唯一能真正实现"统一前端"目标的方案，虽然重构成本较高，但长期收益明显。用户已选择简化 USD 特殊功能（移除 OffscreenStage），进一步降低了复杂度。

### Consequences
- **Positive**: 代码量减少 ~4800 行，维护成本减半，新功能开发加速
- **Negative**: 需要较大重构，短期内可能有回归风险
- **Neutral**: USD 特殊功能（如 OffscreenStage）被移除

### Follow-ups
1. 监控 USD 渲染性能，必要时在 UsdWasmBackend 层优化
2. 评估是否需要恢复 OffscreenStage 作为性能优化层
3. 考虑未来支持 glTF 等其他格式

## Verification Steps

### 自动化验证
1. 运行 `npm run typecheck` - 确保类型安全
2. 运行 `npm run lint` - 确保代码质量
3. 运行 `npm run test` - 确保所有测试通过
4. 运行 `npm run verify:fast` - 快速回归测试

### 手动验证
1. 导入 URDF 文件，验证渲染和交互
2. 导入 MJCF 文件，验证渲染和交互
3. 导入 SDF 文件，验证渲染和交互
4. 导入 USD 文件，验证渲染和交互
5. 导入 Xacro 文件，验证渲染和交互
6. 导入 Mesh 文件，验证渲染和交互
7. 测试选择/悬停在所有格式下的行为
8. 测试变换控制（origin/collision/joint）在所有格式下
9. 测试 IK 功能在所有格式下
10. 测试组装功能在所有格式下

### 性能验证
1. USD 文件加载时间对比原实现
2. 交互响应延迟测试
3. 内存使用对比

## Timeline

| Phase | 预计工时 | 依赖 |
|-------|----------|------|
| Phase 1 | 0.5 天 | 无 |
| Phase 2 | 1 天 | Phase 1 |
| Phase 3 | 1.5 天 | Phase 1 |
| Phase 4 | 1 天 | Phase 2, 3 |
| Phase 5 | 1 天 | Phase 4 |
| Phase 6 | 1.5 天 | Phase 4, 5 |
| Phase 7 | 0.5 天 | Phase 6 |
| Phase 8 | 0.5 天 | Phase 7 |
| **总计** | **7.5 天** | |

## Rollback Plan

如果重构过程中遇到严重问题：

1. 保留原 `UsdWasmStage.tsx` 和 `UsdOffscreenStage.tsx` 直到 Phase 7
2. 在 Phase 6 完成后进行完整功能测试
3. 如果发现问题，可以临时回退 `ViewerScene.tsx` 使用原有路径
4. Git 分支策略：每个 Phase 提交一个 commit，便于回退
