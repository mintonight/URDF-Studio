# 文档索引

> 最后更新：2026-04-15

## 按任务类型导航

| 你要做什么 | 先读 | 再读（按需） |
|-----------|------|-------------|
| 改 Editor / 3D 场景 / Viewer / USD runtime | [AGENTS.md](../AGENTS.md) | [viewer.md](viewer.md) |
| 改导入 / 导出 / Workspace / 组装 | [AGENTS.md](../AGENTS.md) | [file-io.md](file-io.md) |
| 改 UI 样式 / 颜色 / 主题 / 可访问性 | [AGENTS.md](../AGENTS.md) | [style-guide.md](style-guide.md) |
| 改 AI 助手 / 审阅 / skill 路由 | [AGENTS.md](../AGENTS.md) | [ai-features.md](ai-features.md) |
| 改架构边界 / 新增依赖 / 例外管理 | [AGENTS.md](../AGENTS.md) | [architecture.md](architecture.md) |
| 改 react-robot-canvas 对外库 | [AGENTS.md](../AGENTS.md) | [robot-canvas-lib.md](robot-canvas-lib.md) |
| 变更后验收 / 找测试样本 / 跑回归 | [AGENTS.md](../AGENTS.md) | [update-rules.md](update-rules.md) |
| USD runtime fallback 审计 | [AGENTS.md](../AGENTS.md) | [runtime-fallback-audit.md](runtime-fallback-audit.md) |

## 文档清单

| 文档 | 内容 | 行数 |
|------|------|------|
| [AGENTS.md](../AGENTS.md) | 项目入口：定位、结构、红线、Store、导航 | ~150 |
| [viewer.md](viewer.md) | Editor/Viewer 子域：拓扑、几何/碰撞/测量、USD runtime、offscreen、hydration | ~130 |
| [file-io.md](file-io.md) | 导入导出链路：App 编排、File I/O、Workspace、组装、project archive | ~140 |
| [style-guide.md](style-guide.md) | UI 样式：语义色 token、蓝色约束、暗色层级、面板文案、验收标准 | ~70 |
| [ai-features.md](ai-features.md) | AI 助手：环境变量、审阅标准路径、skill-first 路由 | ~60 |
| [architecture.md](architecture.md) | 架构边界：依赖方向、例外清单、debuggability first、Linux 哲学、内存约束、检查命令 | ~140 |
| [update-rules.md](update-rules.md) | 变更工作流：验收清单、常用命令、测试样本索引、浏览器验证规则、文档更新映射 | ~130 |
| [robot-canvas-lib.md](robot-canvas-lib.md) | 对外库说明：RobotCanvas API、发布流程、后续拆分建议 | 保留不动 |
| [runtime-fallback-audit.md](runtime-fallback-audit.md) | USD runtime fallback 审计报告（P0-P2） | 保留不动 |

## 已退役文档

以下文件已退役，内容已合并到上述文档中：

- `docs/prompts/CLAUDE.md` → 内容分散到 `AGENTS.md` + 各领域文档
- `docs/prompts/overview.md` → 导航功能由本文件取代
- `docs/prompts/URDF_STUDIO_STYLE_GUIDE.md` → 内容在 `style-guide.md`
- `docs/prompts/urdf-viewer.md` → 内容在 `viewer.md`
- 根目录 `CLAUDE.md` → 由 `AGENTS.md` 取代
