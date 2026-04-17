# AI 助手与审阅

> 最后更新：2026-04-15 | 覆盖源码：`src/features/ai-assistant/`
> 交叉引用：[architecture.md](architecture.md)（ai-assistant <-> file-io 例外说明）

## 1. 环境变量

```env
VITE_OPENAI_API_KEY=your_key
VITE_OPENAI_BASE_URL=https://api.openai.com/v1
VITE_OPENAI_MODEL=deepseek-v3
```

## 2. 审阅标准输入

- `src/features/ai-assistant/config/urdf_inspect_standard_en.md`
- `src/features/ai-assistant/config/urdf_inspect_stantard_zh.md`

> 注意：中文文件名当前拼写为 `stantard`，属仓库现状，不要擅自改名。

## 3. Skill-first 路由策略

默认原则：
- 若需求本质是"工作流指导、最佳实践、排障框架、测试套路、设计约束"，优先使用 skill，而不是在 prompt 里堆 MCP/tool 名称
- skill 压缩"怎么做"的上下文；只有确实需要执行外部能力时，才调用对应 MCP/tool
- skill 不能替代真实执行能力（浏览器点击、远程 API、Figma 读取等）

优先替代映射：

| 任务类型 | 优先 skill | 仅在必要时使用 MCP |
|----------|-----------|-------------------|
| 浏览器验证 / 截图 | `webapp-testing`、`playwright`、`browser-automation` | 真实 DOM 快照、网络面板、DevTools 级检查 |
| 3D / R3F / Three.js | `threejs-skills` | — |
| URDF Studio UI 改造 | `urdf-studio-style`、`frontend-design` | — |
| 调试 / 排障 | `systematic-debugging`、`debugger` | — |
| 测试 / QA | `testing-qa` | — |
| 库文档 | `context7-auto-research` | Context7 / Web 搜索 |
| 代码审阅 | `requesting-code-review`、`find-bugs` | — |

使用约束：
- 同一任务优先选择 1 个主 skill；不足时再补 1-2 个辅助
- 不要同时声明多个重叠 skill
- 若仓库已有现成脚本/测试/build 命令，优先本地命令，不改走 MCP

## 4. 与 AI 对话时的有效上下文

优先给出：
- 具体的 `Link` / `Joint` 名称
- 期望的父子关系
- 当前在 Editor 中操作的是拓扑、几何/碰撞、还是硬件相关能力
- 涉及电机时的力矩 / 传动 / 阻尼约束
- 目标格式（URDF / MJCF / USD / .usp）
- 是否涉及 merged assembly 或 workspace/structure 视图
