# URDF Studio

专业的机器人设计、装配、可视化和导出工作台，支持 URDF、MJCF、USD、Xacro、SDF 和 .usp 项目工作流。

## 项目概览

**技术栈：** React 19.2 + TypeScript 5.8 + Three.js/R3F + Vite 6.2 + Tailwind CSS 4 + Zustand 5

**核心功能：**

- 机器人拓扑、几何/碰撞、硬件配置的单模式编辑
- 多机器人组装与桥接关节
- 多格式导入导出（URDF / MJCF / SDF / USD / Xacro / ZIP / .usp）
- AI 生成与审阅、PDF/CSV 报告
- 可复用 `@urdf-studio/react-robot-canvas` 画布封装

## 架构约束

**依赖方向：**

```
app -> features -> store -> shared -> core -> types
```

**关键规则：**

- 不新增反向依赖，features 之间通过 store 通信
- `core/` 保持纯函数，不引入 React/UI/Feature 依赖
- 使用 `@/` 指向 `src/`
- `src/lib/` 只收稳定通用能力，不作为应用内部业务逻辑的 source of truth
- 优先复用现有 hooks/utils/components
- 保持类型完整性，避免 `any`
- 新增 `ResizeObserver`、timer、worker listener、THREE 资源时必须对称 cleanup
- 单元测试邻近源码放置（`src/**/*.test.*`）

**设计哲学：** debuggability first + Linux 哲学（简单直接的数据流，优先通过更好的数据结构消灭特殊情况）

## 目录结构

```
src/
├── app/            应用编排层：App shell、viewer 组合、导入导出、workspace/source sync、USD hydration
├── features/       业务功能模块（ai-assistant、assembly、code-editor、editor、file-io、hardware-config、property-editor、robot-tree、urdf-viewer）
├── store/          Zustand 状态层（robotStore、uiStore、selectionStore、assetsStore、assemblyStore、assemblySelectionStore、collisionTransformStore、jointInteractionPreviewStore）
├── shared/         共享组件、3D 基础设施、hooks、i18n、数据、调试桥接、workers
├── core/           纯逻辑：解析器、robot core、mesh loaders、parse workers、runtime diagnostics
├── lib/            对外复用的 RobotCanvas 封装
├── styles/         全局样式与语义 token
└── types/          跨模块类型定义

docs/               Agent 上下文文档
scripts/            回归与辅助脚本
packages/react-robot-canvas/  对外发布包
test/               大型 fixture 与回归样本
```

## 常用命令

```bash
npm run dev              # 开发服务器（http://127.0.0.1:3000）
npm run build            # 构建生产版本
npm run lint             # 代码检查
npm run typecheck        # 完整类型检查
npm run typecheck:quality # 质量类型检查（排除 test/spec）
npm run test             # 运行测试
npm run format           # 格式化代码
npm run verify:fast      # 快速验证
npm run verify:full      # 完整验证（包含 test/ 下的 fixtures）
```

## 重要说明

**USD Runtime：**

- USD 加载依赖 `SharedArrayBuffer`，页面必须跨域隔离
- 使用 `npm run dev` 开发，`npm run preview` 验证生产构建
- 需要 Cross-Origin-Opener-Policy 和 Cross-Origin-Embedder-Policy 头

**环境变量（可选）：**

- `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL` - AI 功能
- `VITE_MONACO_VS_PATH` - Monaco 编辑器覆盖

**Git Hooks：**

- `pre-commit`：格式化暂存文件 + 对暂存 diff 运行 ESLint/Stylelint
- `commit-msg`：验证 Conventional Commit 消息

## 文档导航

详细文档见 `docs/` 目录：

- [完整文档索引](docs/CATALOG.md)
- [架构边界](docs/architecture.md)
- [Editor / 3D / Viewer / USD runtime](docs/viewer.md)
- [导入导出 / Workspace / 组装](docs/file-io.md)
- [UI 样式 / 颜色 / 主题 / 可访问性](docs/style-guide.md)
- [AI 助手 / 审阅](docs/ai-features.md)
- [验收清单 / 测试样本 / 回归命令](docs/update-rules.md)

## Agent 指南

完整的 Agent 指南见 [AGENTS.md](AGENTS.md)，包含：

- 详细的 src/ 目录结构
- 完整的 store 职责说明
- Editor 单模式的三个子域
- 执行准则和最佳实践
