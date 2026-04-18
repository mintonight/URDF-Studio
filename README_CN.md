<div align="center">

# URDF Studio

[![React](https://img.shields.io/badge/React-19.2-blue?logo=react)](https://reactjs.org/)
[![Three.js](https://img.shields.io/badge/Three.js-0.181-black?logo=three.js)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-6.2-purple?logo=vite)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

面向 `URDF`、`MJCF`、`USD`、`Xacro`、`SDF` 和 `.usp` 项目工作流的机器人设计、组装、可视化与导出工作台。

**在线体验：** [urdf.d-robotics.cc](https://urdf.d-robotics.cc/)

[English](./README.md) | [中文](./README_CN.md)

</div>

---

## 项目简介

URDF Studio 是一个运行在浏览器中的机器人建模环境，用来处理机器人拓扑、视觉/碰撞几何体、硬件参数、多文件工作区以及导出交付，而不需要每次都直接手写 XML。

当前版本重点整合了：

- `Skeleton`、`Detail`、`Hardware` 三种编辑模式
- 多机器人组装、桥接关节和工作区文件管理
- 基于 worker 的导入/导出链路
- USD runtime hydration、prepared export cache 和 roundtrip archive 工作流
- AI 生成、AI 审阅与报告导出
- 可复用的 `@urdf-studio/react-robot-canvas` 包工作区

包身份说明：

- 根应用：`urdf-studio@2.0.0`（私有工作区应用）
- 对外发布包：`@urdf-studio/react-robot-canvas@0.1.0`

版本管理约定：

- 私有应用与对外发布包采用各自独立的语义化版本
- 应用版本在构建时注入前端，并显示在 About 弹窗中
- 版本升级统一通过 `npm run version:bump`，不要手改多个清单文件

## 核心能力

### 编辑能力

- 构建与编辑 link/joint 运动学树
- 编辑 visual mesh、collision mesh、测量与辅助显示
- 配置电机与硬件参数
- 通过统一 viewer 壳层切换不同编辑模式

### 工作区与组装

- 支持单文件、文件夹、ZIP 和 `.usp` 项目归档导入
- 维护 workspace 文件树、源码文本与选中状态同步
- 将多个机器人装配到同一工作区，并通过 bridge joint 建立连接
- 保留历史记录、pending edit 和预解析机器人缓存

### 可视化

- 基于 React Three Fiber 的共享工作区画布，同时服务 visualizer 与 URDF/USD viewer
- 运行时 URDF/MJCF viewer 与 vendored USD viewer runtime
- USD stage preparation、hydration、metadata extraction 和 offscreen worker 渲染链路
- 支持截图、helper overlay、transform controls 与碰撞编辑

### 导出与互操作

- 导出 `URDF`、`MJCF`、`USD`、`SDF`、`Xacro`、CSV/BOM、PDF、ZIP 和 `.usp`
- worker 化的 project archive、USD export、USD binary archive 转换
- 面向 roundtrip 的 USD archive 生成与 prepared export cache
- 对外复用的 `react-robot-canvas` 包工作区

## 技术栈

- **前端**：React 19.2、TypeScript 5.8、Vite 6.2
- **3D**：Three.js 0.181、React Three Fiber 9、Drei 10
- **状态管理**：Zustand 5
- **样式**：Tailwind CSS 4
- **解析 / 导出**：位于 `src/core` 的 URDF、MJCF、USD、Xacro、SDF 与 mesh 管线
- **打包导出**：JSZip、jsPDF
- **包工作区**：`packages/react-robot-canvas`

## 仓库结构

```text
src/
  app/                  应用壳、编排、overlay、viewer handoff
  features/             业务模块（visualizer、urdf-viewer、file-io、code-editor 等）
  store/                Zustand store
  shared/               共享 UI、3D 基础设施、i18n、debug、静态数据
  core/                 解析器、生成器、loader、robot 逻辑
  lib/                  仓库内可复用库入口
  styles/               全局样式与语义 token
  types/                跨模块类型
packages/react-robot-canvas/
  可发布的复用包工作区
docs/
  架构说明、runtime 审计、贡献者上下文
scripts/
  回归验证、schema 生成、比较脚本、本地工具
log/
  本地运行日志与保留的排障输出
.tmp/
  某些脚本使用的临时构建/运行 scratch 目录
.worktrees/
  使用 git worktree 时的本地隔离工作区目录
public/
  静态资源、Monaco、USD bindings、示例机器人
tmp/
  截图、trace、临时验证产物
output/
  用户可见导出与需要保留的验证产物
test/
  fixture 语料、浏览器回归样本与外部镜像工程
```

架构补充：

- `src/app` 不是一个薄壳。它已经明确分成 `components/`、`hooks/`、`utils/`、`workers/`，负责 document loading、viewer handoff、导入导出编排、pending history 和 binary/archive worker bridge。
- `src/features/urdf-viewer` 是当前最重的 feature 之一，内部同时包含 React UI、vendored USD runtime、adapter/utils，以及 worker 驱动的 offscreen 渲染链路。

## 快速开始

### 环境要求

- Node.js 18 或更高版本
- npm
- 用于本地 USD 验证的现代 Chromium 浏览器

### 安装

```bash
git clone https://github.com/OpenLegged/URDF-Studio.git
cd URDF-Studio
npm install
```

### 可选环境变量

项目即使没有 AI 凭据也可以运行。如果需要启用 AI 生成 / AI 审阅，请设置 `vite.config.ts` 注入到前端运行时的环境变量：

```bash
OPENAI_API_KEY=your_api_key
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4.1-mini

# 当前 Vite define shim 也支持这个备选键
GEMINI_API_KEY=

# 可选：覆盖 Monaco 静态资源路径
VITE_MONACO_VS_PATH=
```

可以放到 `.env.local` 中。

### 启动

```bash
npm run dev
```

打开：

- `http://127.0.0.1:3000`

当前 Vite dev server 会固定绑定在 `127.0.0.1`，并返回 USD WASM runtime 所需的 cross-origin isolation headers。

## USD 运行时要求

USD 加载依赖 `SharedArrayBuffer`，因此页面必须处于 cross-origin isolated 环境。

- 开发使用 `npm run dev`
- 本地验证生产构建使用 `npm run preview`
- 优先使用 `127.0.0.1` / `localhost` 或 HTTPS
- 不要用缺少下列响应头的普通静态服务器直接托管 `dist/`

```http
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Cross-Origin-Resource-Policy: same-site
```

如果这些响应头不存在，应用壳可能仍然能打开，但 USD 导入 / stage open 会失败。

## 常用命令

```bash
# 应用
npm run dev
npm run build
npm run preview

# 版本管理
npm run version:show
npm run version:bump -- --app minor
npm run version:bump -- --package patch

# 可复用包工作区
npm run build:package:react-robot-canvas
npm run pack:package:react-robot-canvas

# schema / 对比工具
npm run code-editor:generate-urdf-schema
npm run mjcf:compare
npm run sdf:compare

# 回归脚本
npm run regression:shadow-hand-hover
npx tsx scripts/regression/validate_unitree_model_roundtrip_archive.ts

# Codex 韧性 / key-router 工具
npm run codex:retry
npm run codex:gui
npm run codex:key-router:deploy:dry
```

`scripts/` 下还包含 URDF 检查、机器人预览图生成、MuJoCo/MJCF 对比、回归 runner，以及本地 Codex 支撑工具。

## 测试与验证

当前仓库已经提供统一的根级质量命令，用于格式化、Lint 和 CI 校验：

- `npm run format`
- `npm run format:check`
- `npm run lint`
- `npm run typecheck:quality`
- `npm run check`

`npm run typecheck` 仍保留为全仓 TypeScript 债务检查。CI 和 `npm run check` 当前使用 `npm run typecheck:quality`，它会先排除 test/spec 文件，以便在测试夹具持续迁移期间保持 runtime 编译为绿。

Git hooks 通过 Husky + lint-staged + Commitlint 接入：

- `pre-commit`：对 staged 文件执行格式化，并在 staged diff 上运行 ESLint / Stylelint
- `commit-msg`：校验 Conventional Commit 提交信息

`npm test` 当前只覆盖仓库内可自给的测试，不包含依赖 `test/` 外部大型语料的 fixture 回归。

通常通过以下方式完成验证：

- 在改动模块旁边运行定向 `node --test` / `npx tsx --test`
- 运行 `scripts/regression/` 下的定向回归脚本
- 使用 `npm test` 跑 `npm run verify:fast` 采用的仓库内快速测试
- 执行 `npm run build`
- 如果改动了 `src/lib` 或 `packages/react-robot-canvas`，补跑包构建
- 通过 `npm run test:fixtures:*` / `npm run verify:full` 针对 `test/` 下的大型 fixture 语料做回归检查，尤其是 `test/unitree_model`、`test/gazebo_models`、`test/awesome_robot_descriptions_repos`、`test/usd-viewer`

## 文档入口

- [更新日志](./CHANGELOG.md)
- [发布流程](./RELEASING.md)
- [架构边界](./docs/architecture-boundaries.md)
- [Robot Canvas 库说明](./docs/robot-canvas-lib.md)
- [Runtime Fallback Audit](./docs/runtime-fallback-audit.md)
- [贡献者 Prompt 主文档](./docs/prompts/CLAUDE.md)
- [Agent 规范](./AGENTS.md)

## 包工作区

仓库内同时包含可发布的包工作区：

- [`packages/react-robot-canvas`](./packages/react-robot-canvas)

这个包当前对外提供 `RobotCanvas`，用于在独立 React 应用中嵌入 URDF/MJCF 查看能力，而不需要带上完整的 URDF Studio 应用壳。

## 贡献说明

- 保持依赖方向符合 `app -> features -> store -> shared -> core -> types`
- 优先复用现有 hooks / utils，而不是重复实现 viewer 或 export 逻辑
- 遵循 [AGENTS.md](./AGENTS.md) 中的运行时与样式约束
- 临时截图、trace、浏览器验证产物统一放到 `tmp/`

## 许可证

本项目采用 **Apache License 2.0**，详见 [LICENSE](./LICENSE)。

## 致谢

感谢 [D-Robotics](https://developer.d-robotics.cc/) 提供支持。

[![Star History Chart](https://api.star-history.com/svg?repos=OpenLegged/URDF-Studio&type=date&legend=top-left)](https://www.star-history.com/#OpenLegged/URDF-Studio&type=date&legend=top-left)
