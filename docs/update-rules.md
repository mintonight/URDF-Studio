# 代码变更 → 文档更新 & 验证映射

> 最后更新：2026-04-15 | 覆盖范围：变更工作流、验证命令、测试样本索引
> 交叉引用：[architecture.md](architecture.md)、[viewer.md](viewer.md)、[file-io.md](file-io.md)

## 1. 代码变更工作流

1. 定位任务所属模式与模块边界
2. 明确改动是在 `app` 编排层、单一 `feature`、还是 `shared/core` 通用层
3. 检查依赖方向是否符合架构红线，避免新增例外
4. 优先复用现有 hooks/utils/components，不重复造轮子
5. 保持类型完整性，避免 `any`
6. 涉及 3D/USD/mesh 时，检查材质缓存、资源释放、hydration/export 生命周期
7. 做最小必要改动并验证

## 2. 单文件与模块化策略

默认优先模块化拆分。

允许单文件：仅限小改动（文案、样式微调、局部 bug 修复）且不引入新职责。

必须拆分的场景：
- 同时引入"状态 + 视图 + 业务逻辑"
- 新增可复用逻辑（优先抽为 hook/utils）
- 文件已明显过大且继续修改会降低可维护性

## 3. 验收清单

- [ ] Light / Dark / 高对比模式下可读性通过
- [ ] 无新增分散硬编码颜色
- [ ] 3D 资源无明显泄漏（材质/几何体/纹理释放）
- [ ] worker/offscreen 生命周期完整释放
- [ ] 新增的 observer / listener / timer / object URL / ImageBitmap / pending request map 均有对称 cleanup
- [ ] USD hydration / roundtrip / export 未破坏 source-of-truth 流程
- [ ] 浏览器验证产物放入 `tmp/`，未新增根目录截图/trace
- [ ] 浏览器测试结束后无残留会话或临时进程
- [ ] 变更符合模块职责，没有破坏依赖方向
- [ ] 未新增 silent fallback / 吞错式兜底
- [ ] import/export/hydration 等 worker bridge 失败时显式报错
- [ ] 若改 USD worker / metadata 链路，已完成 `test/unitree_model` 全量验证且结果落盘到 `tmp/regression/`
- [ ] 若改运行时代码，已完成对应测试或构建验证

## 4. 常用命令

```bash
# 基础
npm run dev
npm run lint
npm run typecheck
npm run test
npm run build
npm run verify:fast
npm run verify:full

# 结构查看
find src -maxdepth 3 -type d | sort

# 仓库级搜索（排除 vendor/产物/临时）
rg -n "pattern" src docs scripts packages/react-robot-canvas \
  -g '!test/**' -g '!.tmp/**' -g '!tmp/**' -g '!dist/**' -g '!node_modules/**'

# USD worker / metadata 回归
node --test \
  src/features/urdf-viewer/runtime/hydra/render-delegate/robot-metadata-stage-fallback.test.js \
  src/features/urdf-viewer/runtime/hydra/render-delegate/folded-fixed-link-truth.test.js

npx tsx --test \
  src/features/urdf-viewer/utils/usdViewerRobotAdapter.test.ts \
  src/features/urdf-viewer/utils/usdRuntimeRobotHydration.test.ts

# Unitree roundtrip / archive 验证
npx tsx scripts/regression/validate_unitree_model_roundtrip_archive.ts

# 现成 fixture 回归入口
npm run test:fixtures:imports
npm run test:fixtures:unitree-usd
npm run test:fixtures:unitree-ros-urdfs
npm run test:fixtures:unitree-ros-usda

# 打包对外库（仅在改到 src/lib 或 packages/react-robot-canvas 时）
npm run build:package:react-robot-canvas
```

## 5. 测试样本索引

### USD / worker / roundtrip 主样本（`test/unitree_model/`）

| 样本 | 用途 |
|------|------|
| `Go2/usd/go2.usd` | 四足基准：USD stage open、worker metadata、hydration |
| `Go2W/usd/go2w.usd` | 轮足变体：资产命名差异与 roundtrip 稳定性 |
| `B2/usd/b2.usd` | 更大体量四足：folded fixed link、复杂结构 |
| `H1-2/h1_2/h1_2.usd` | Humanoid：双足/人形链路与 viewer hydration |
| `H1-2/h1_2_handless/h1_2_handless.usd` | Handless 变体：资产差异下的 runtime 行为 |
| `*.viewer_roundtrip.usd` | 导出后 diff、回归对照与 roundtrip 验证 |

### SDF / Gazebo 样本（`test/gazebo_models/`）

| 样本 | 用途 |
|------|------|
| `camera/model.sdf` | 轻量 smoke |
| `cordless_drill/model.sdf` | DAE + STL + texture 混合 |
| `bus_stop/model.sdf` | 多 mesh + 贴图 + 混合格式 |
| `apartment/model.sdf` | 大场景：纹理 + viewer 性能 |
| `camera/model-1_2.sdf` 等 | 版本化 SDF 兼容性 |

### URDF 样本（`test/awesome_robot_descriptions_repos/`）

| 样本 | 用途 |
|------|------|
| `anymal_c_simple_description/urdf/anymal.urdf` | 纹理 + DAE 完整四足 |
| `mini_cheetah_urdf/urdf/mini_cheetah.urdf` | OBJ/STL 混合资产 |
| `cassie_description/urdf/cassie_v4.urdf` | 双足复杂关节层级 |
| `fanuc_m760ic_description/urdf/m710ic70.urdf` | 工业机械臂 |
| `models/franka_description/urdf/panda_arm_hand.urdf` | gltf + ktx2 + png/bin |

### MJCF 样本（`test/awesome_robot_descriptions_repos/mujoco_menagerie/`）

| 样本 | 用途 |
|------|------|
| `unitree_go2/go2.xml` | 标准 MuJoCo menagerie 样本 |
| `unitree_go2/scene.xml` | 带 scene 包装的 MJCF |

### 样本选择建议

- 快速 smoke：`gazebo_models/camera/model.sdf`、`fanuc.../m710ic70.urdf`、`Go2/usd/go2.usd`
- 资源加载回归：`bus_stop/model.sdf`、`panda_arm_hand.urdf`、`mini_cheetah.urdf`
- 复杂层级：`H1-2/h1_2/h1_2.usd`、`cassie_v4.urdf`
- USD worker / metadata / roundtrip：整套 `test/unitree_model`

## 6. 浏览器验证规则

- 默认使用无头模式（`headless: true`），除非用户要求可见窗口
- 验证产物写入 `tmp/`（可分子目录 `tmp/screenshots/`、`tmp/playwright/` 等）
- 禁止将截图直接写到仓库根目录
- `output/` 仅用于用户可见导出结果和回归归档
- 截图前关闭遮挡画面的侧栏、浮层和调试面板
- 验证完成后关闭残留浏览器标签页、DevTools、Playwright 会话和临时进程

## 7. 文档更新映射

| 变更范围 | 应更新文档 |
|----------|-----------|
| 新增 feature / 拆分 feature 目录 | `AGENTS.md` §2、`architecture.md` §4 |
| 新增 store | `AGENTS.md` §5、`architecture.md` |
| 修改 USD worker / runtime 链路 | `viewer.md` §6-7、`update-rules.md` §5 |
| 修改导入导出流程 | `file-io.md` §2 |
| 修改 UI 样式 / 新增语义色 token | `style-guide.md` §3 |
| 新增架构例外 | `architecture.md` §3 |
| 新增长期稳定测试样本 | `update-rules.md` §5 |
