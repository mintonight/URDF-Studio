# URDF Studio Agent Guide

> 最后更新：2026-05-26 | 技术栈：React 19.2 + TypeScript 5.8 + Three.js/R3F + Vite 6.2 + Tailwind CSS 4.1 + Zustand 5
> 完整文档索引：[docs/CATALOG.md](docs/CATALOG.md)

URDF Studio 是机器人设计、装配、可视化与导出工作台。核心能力：单模式 Editor 编辑、多 URDF 组装与桥接关节、多格式导入导出（URDF / MJCF / SDF / USD / Xacro / ZIP / .usp）、AI 生成与审阅、PDF/CSV 报告、可复用 react-robot-canvas 画布封装。

## 语言偏好

- 默认中文沟通（过程说明、总结、澄清、错误说明），除非用户明确要求其他语言
- 代码标识符、命令、文件路径、API 名称、错误原文保持原文

## src/ 目录结构

```
src/
├── app/            应用编排层：App shell、viewer 组合、导入导出、workspace/source sync、USD hydration
│   ├── components/ App 级 UI 编排与跨域入口
│   ├── hooks/      跨 store / viewer / source 同步 hook
│   ├── utils/      App 层辅助逻辑
│   └── workers/    App 编排使用的 worker
├── features/       业务功能模块
│   ├── ai-assistant/     AI 生成与审阅
│   ├── assembly/         桥接组件创建与组装（桥接弹窗内部模块在 components/bridge-create/）
│   ├── code-editor/      源码编辑器
│   ├── editor/           Editor 统一公开入口
│   ├── file-io/          底层文件能力（格式检测、project archive、USD/SDF export、弹层）
│   ├── hardware-config/  硬件/电机配置（兼容层 re-export）
│   ├── property-editor/  属性编辑、几何编辑、碰撞优化
│   ├── robot-tree/       文件树与结构树（tree-editor/ + tree-node/）
│   └── urdf-viewer/      Editor 实现：拓扑/几何/碰撞/测量 + USD runtime + workers
├── store/          Zustand 状态层
├── shared/         共享组件、3D 基础设施、hooks、i18n、数据、调试桥接、utils、workers
│   ├── components/ 共享 UI 与 3D 基础组件
│   ├── data/       静态数据与内置配置
│   ├── debug/      调试桥接与验证辅助
│   ├── hooks/      通用 React hooks
│   ├── i18n/       本地化文案与类型
│   ├── utils/      通用工具（含 THREE / DOM / PDF 等）
│   └── workers/    共享 worker
├── core/           纯逻辑：解析器、robot core、mesh loaders、parse workers、runtime diagnostics
│   ├── geometry/       几何计算
│   ├── loaders/        mesh / 资源加载
│   ├── parsers/        URDF / MJCF / SDF / USD 等解析
│   ├── robot/          robot core 与拓扑逻辑
│   ├── stl-compressor/ STL 压缩逻辑
│   ├── utils/          core 层工具
│   └── workers/        parse / runtime workers
├── lib/            对外复用的 RobotCanvas 封装（仅收稳定通用能力）
├── styles/         全局样式与语义 token
└── types/          跨模块类型定义
```

补充：`docs/`（Agent 上下文）、`scripts/`、`packages/react-robot-canvas/`（对外发布包）、`public/usd/bindings/`（USD WASM）、`output/`（导出结果）、`tmp/`（临时验证产物）、`test/`（大型 fixture 与回归样本）、`test/usd-viewer/`（独立 USD viewer 验证环境与浏览器清理脚本）

## 架构红线与执行准则

依赖方向：`app -> features -> store -> shared -> core -> types`

- 不新增反向依赖；features 之间通过 store 通信
- `core/` 保持纯函数，不引入 React / UI / Feature 依赖
- 使用 `@/` 指向 `src/`；`src/lib/` 只收稳定通用能力，不当业务 source of truth
- 优先复用现有 hooks/utils/components，不重复造轮子；类型完整，避免 `any`
- 涉及 3D / USD / mesh 时检查材质缓存、资源释放、hydration/export 生命周期
- 新增 `ResizeObserver`、timer、worker listener、THREE 资源时必须对称 cleanup
- 桥接弹窗对外入口保持 `features/assembly/components/BridgeCreateModal.tsx`，内部实现放 `components/bridge-create/`
- 单元测试邻近源码放置（`src/**/*.test.*`）
- **跨域 Handoff 接收端**：`src/app/hooks/useAssetImportFromUrl.ts`、`src/app/components/BotWorldImportOverlay.tsx` 为 BOT-World 资产导入核心文件；插件激活详见 [docs/file-io.md](docs/file-io.md) §6
- **调试接口默认关闭**：`window.__URDF_STUDIO_DEBUG__`、`window.__usdStageLoadDebug*`、`window.__visualizerCollisionLoadDebug*` 等回归调试接口只能在 URL 显式带 `?regressionDebug=1` 时启用；不要仅因 `DEV`、本地开发或普通预览环境暴露。Codex / Claude / 回归脚本需要调试时由脚本加该参数。
- **修复用户上报的 bug 必须用浏览器实测**：拿到用户反馈的 bug 后，不能凭推理或读代码就判定已修好。必须通过 `npm run dev` 启动应用，并使用浏览器自动化工具（chrome-devtools / playwright MCP）走一遍用户复现路径，确认现象消失后才能回复"已修复"。typecheck / 单元测试通过 ≠ bug 修好
- **浏览器自动化必须清理进程**：使用 chrome-devtools / Playwright / Puppeteer / MCP 或运行浏览器回归脚本后，必须关闭 page、context、browser、DevTools 会话和由 agent 启动的 dev server；结束前运行 `node test/usd-viewer/scripts/cleanup-headless.cjs`。如仍有残留，只清理由本次自动化产生的 chrome-devtools/playwright/puppeteer 临时进程，禁止杀掉用户日常浏览器。

存量例外与设计哲学（debuggability first、Linux 哲学：简单数据流优于抽象层）详见 [docs/architecture.md](docs/architecture.md) §3、§7-8。

## Editor 单模式

| 子域 | 典型任务 |
|------|---------|
| 拓扑 | Link / Joint 增删、拓扑编辑、关节参数 |
| 几何 / 碰撞 / 测量 | Visual / Collision、mesh、材质、碰撞变换 |
| 硬件配置 | 电机型号、传动比、阻尼、摩擦 |

公开入口 `features/editor/index.ts`，实现位于 `features/urdf-viewer/`，跨子域交互在 `app/` 或 `shared/components/3d/`。详见 [docs/viewer.md](docs/viewer.md)。

## 状态管理

| Store | 职责 |
|-------|------|
| `robotStore` | 模型 CRUD、Undo/Redo、派生计算、闭环约束 |
| `uiStore` | 主题、语言、侧栏、面板、显示选项（含持久化） |
| `selectionStore` | 选中、悬停、pulse、focus |
| `assetsStore` | mesh、texture、robot files、motor library、USD snapshot、export cache |
| `assemblyStore` | 多 URDF 组装、BridgeJoint、组件管理、组装历史 |
| `assemblySelectionStore` | workspace 组件 / bridge / source file 选区 |
| `collisionTransformStore` | 碰撞 gizmo 瞬时 pending transform |
| `jointInteractionPreviewStore` | 跨 viewer 关节交互预览 |

跨 store 协调优先放 `app/hooks/*`；USD 中间态优先落在 `assetsStore` 或 `app/utils/*`。

## 常用命令

```bash
npm run dev            # 开发
npm run lint           # 代码检查
npm run typecheck      # 类型检查
npm run test           # 测试
npm run build          # 构建
npm run verify:fast    # 快速验证
npm run verify:full    # 完整验证
node test/usd-viewer/scripts/cleanup-headless.cjs  # 清理自动化残留浏览器进程
```

## 格式回归样本

涉及格式解析、导入、导出、资源解析或 viewer hydration 时，优先使用以下大型语料：

| 格式 / 场景 | 基准目录 |
|-------------|----------|
| MJCF | `test/mujoco_menagerie-main/` |
| MJCF tendon | `test/myosuite-main/` |
| SDF | `test/gazebo_models/` |
| USD | `test/unitree_model/` |
| USDA | `test/unitree_ros_usda/` |
| URDF | `test/unitree_ros/` |

## 文档导航

| 任务 | 文档 |
|------|------|
| Editor / 3D / Viewer / USD runtime | [docs/viewer.md](docs/viewer.md) |
| 导入导出 / Workspace / 组装 | [docs/file-io.md](docs/file-io.md) |
| UI 样式 / 颜色 / 主题 / 可访问性 | [docs/style-guide.md](docs/style-guide.md) |
| AI 助手 / 审阅 / skill 路由 | [docs/ai-features.md](docs/ai-features.md) |
| 架构边界 / 依赖方向 / 例外 / 设计哲学 | [docs/architecture.md](docs/architecture.md) |
| 验收清单 / 测试样本 / 回归命令 | [docs/update-rules.md](docs/update-rules.md) |
| react-robot-canvas 对外库 | [docs/robot-canvas-lib.md](docs/robot-canvas-lib.md) |
| 完整文档索引 | [docs/CATALOG.md](docs/CATALOG.md) |
