# URDF Studio Claude Entrypoint

此文件保留为兼容入口，避免根目录再次维护一份会漂移的长篇 agent 文档。

开始前先读：

1. [AGENTS.md](AGENTS.md) - 当前仓库的执行规范、架构红线、验证要求
2. [docs/CATALOG.md](docs/CATALOG.md) - 按任务类型分流到对应领域文档

最关键的项目约束：

- 依赖方向保持 `app -> features -> store -> shared -> core -> types`
- `core/` 保持纯逻辑，不引入 React / UI / Feature 依赖
- 优先复用现有 hooks、utils、components，不新增重复抽象
- 新增 `ResizeObserver`、timer、worker listener、THREE 资源时必须对称 cleanup

常用命令：

```bash
npm run dev
npm run lint
npm run typecheck
npm run test
npm run verify:fast
npm run verify:full
```

说明：

- 旧的 `CLAUDE.md` 长文档内容已经收敛到 `AGENTS.md` 和 `docs/*`
- 如果这里和仓库现状冲突，以 `AGENTS.md` 与实际代码结构为准
