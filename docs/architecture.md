# 架构边界详细说明

> 最后更新：2026-04-15 | 覆盖源码：`src/` 全局
> 交叉引用：[viewer.md](viewer.md)、[file-io.md](file-io.md)、[robot-canvas-lib.md](robot-canvas-lib.md)

## 1. 依赖方向

```text
app -> features -> store -> shared -> core -> types
```

按层约束：
- `app`：编排 features/store/shared/core/types，不把业务细节反向塞回下层
- `features`：依赖 store/shared/core/types，禁止依赖 app
- `store` / `shared`：不应新增对 features 的运行时依赖
- `core`：纯函数，不引入 React / UI / Feature 依赖
- `types`：只提供类型与常量，不回指上层
- 使用 `@/` 路径别名指向 `src/`

## 2. lib / packages 约束

- `src/lib/` 视为对外复用封装层，只收稳定、通用、与应用壳无关的能力
- 应用内部不要把 `src/lib/` 当业务逻辑 source of truth
- 若能力强依赖 robotStore、workspace、app overlays 或特定业务流程，不要抽进 `src/lib/`
- `packages/react-robot-canvas/` 是对外发布包工作区；`dist/` 由构建脚本维护，禁止手改

## 3. 当前存量例外（禁止扩散）

运行时代码：
- `src/shared/hooks/useTheme.ts` -> `@/store/uiStore`
- `src/shared/components/Panel/JointControlItem.tsx` -> `@/store/robotStore`
- `src/features/ai-assistant/utils/pdfExport.ts` -> `@/features/file-io/components/InspectionReportTemplate`

测试期例外（不作为运行时先例）：
- `src/features/file-io/utils/usdFloatingRoundtrip.test.ts` -> `urdf-viewer` runtime/utils
- `src/features/file-io/utils/usdGo2Roundtrip.test.ts` -> `urdf-viewer` runtime/utils

## 4. Feature Public APIs

- `editor`：统一 Editor 公开入口，通过 `src/features/editor/index.ts` 暴露
- `urdf-viewer`：Editor 实现子目录，通过 `src/features/urdf-viewer/index.ts` 暴露
- `file-io`：导入导出入口，通过 `src/features/file-io/index.ts` 暴露

## 5. Canonical Data Sources

- `DEFAULT_MOTOR_LIBRARY` canonical source：`src/shared/data/defaultMotorLibrary.json`
- `src/shared/data/motorLibrary.ts`：仅负责验证、标准化与导入路径检测
- `src/features/hardware-config/index.ts`：兼容层 re-export

## 6. Shared Three.js 工具

- 通用 THREE 释放：`src/shared/utils/three/dispose.ts`
- `src/features/urdf-viewer/utils/dispose.ts`：兼容层 re-export
- collision overlay material：`src/shared/utils/three/collisionOverlayMaterial.ts`
- MJCF parser material：`src/core/utils/materialFactory.ts`

## 7. Debuggability First

默认原则：兜底不是默认美德，silent fallback 会掩盖真实问题、污染状态、拉高排障成本。

必须遵循：
- 默认优先暴露真实错误，不吞错、不改写异常、不偷偷切备用路径
- 禁止新增 `catch -> 返回空值/默认值/旧缓存/伪成功状态` 的 silent fallback
- 导入、导出、hydration、roundtrip、解析、viewer 初始化等 source-of-truth 链路禁止不透明兜底
- Worker bridge / off-main-thread 链路默认 fail fast，不要因 worker 不可用就在主线程悄悄补实现
- 禁止用"自动重试 + 自动降级 + 自动切换备用实现"掩盖根因

若必须保留窄兜底，同时满足：
- 保留原始错误信息、栈与触发条件
- 能被用户或开发者明确观察到
- 不得悄悄改写 source of truth
- 注释说明为何必须兜底及降级到什么

## 8. Linux 哲学与 Linus taste

这是一级工程约束，不是风格建议。

默认取向：
- 优先简单直接的数据流与控制流，不为"理论优雅"引入额外抽象层
- 优先解决真实问题，不为未来场景预埋复杂框架
- 优先把复杂度消灭在设计里，不包进 manager/factory/coordinator 名字里

必须遵循：
- 小而清晰的接口优先
- 优先组合现有稳定模块，不新增"万能层""统一抽象层""Base*"或过度泛化封装
- 优先通过更好的数据结构消灭特殊情况，不继续堆 `if/else`
- 命名必须直白，描述真实语义、所有权、生命周期和失败路径
- 不把坏状态悄悄修平；异常时暴露不变量被破坏的位置
- 新抽象必须证明降低了整体复杂度；只搬运复杂度则不抽

明确不鼓励：
- 为"模式统一"引入不需要的架构层
- 过度 OO / 继承 / 配置化 / 泛型化
- 把复杂交互拆成大量弱关联小文件
- 用 silent fallback、隐式同步、魔法默认值维持表面整洁
- 为避免修改旧代码而额外包适配器

## 9. 内存 / 生命周期约束

- 新增 `ResizeObserver`、全局事件监听、RAF、timer、worker listener、`ImageBitmap`、object URL、THREE 材质/几何体/纹理、OffscreenCanvas 时必须同时实现对称 cleanup
- shared worker / singleton runtime 必须明确所有者和释放边界
- 新增 shared worker / singleton runtime 时，评审必须能指出对应 `dispose*` / `reset*` 调用点
- 临时缓存必须有上限、淘汰策略或显式 dispose/reset 路径

## 10. 依赖检查命令

```bash
# 检查潜在反向依赖（core/shared/store 对 features 的引用）
rg -n "from ['\"]@/features/" src/core src/shared src/store

# 检查 feature 间直接耦合
rg -n "from ['\"]@/features/" src/features

# 检查 shared 对 store 的依赖
rg -n "from ['\"]@/store/" src/shared

# 检查硬编码色值
rg -n "#[0-9A-Fa-f]{3,8}" src

# 检查 #0088FF 使用范围
rg -n "#0088FF|#0088ff" src | rg -v "Slider.tsx|styles/index.css"
```

## 11. 推荐后续 cleanup

1. 把 inspection-report criteria/config 移到中性 shared 位置
2. 移除 `ai-assistant <-> file-io` 双向依赖
3. 继续把 App.tsx / AppLayout.tsx 中的编排逻辑推入 app hooks
