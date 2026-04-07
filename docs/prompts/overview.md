# AI Prompt 系统概览

这里只做跳转，不再复述规则。

## 默认读取

1. 先读仓库根目录 `AGENTS.md`
2. 再读 `docs/prompts/CLAUDE.md`
3. 只在需要文件锚点时再看：
   - `docs/prompts/URDF_STUDIO_STYLE_GUIDE.md`
   - `docs/prompts/visualizer.md`
   - `docs/prompts/urdf-viewer.md`
4. 需要边界或对外库说明时再看：
   - `docs/architecture-boundaries.md`
   - `docs/robot-canvas-lib.md`
   - `docs/runtime-fallback-audit.md`
5. AI 审阅标准直接读取：
   - `src/features/ai-assistant/config/urdf_inspect_standard_en.md`
   - `src/features/ai-assistant/config/urdf_inspect_stantard_zh.md`
6. 若文档与当前 `src/` 结构冲突，以 `AGENTS.md`、`docs/prompts/CLAUDE.md` 和真实源码为准

## 当前结构热区

- `src/app/components/unified-viewer/*`：统一 viewer 的 scene root、overlay、raycast 与 joints panel 适配
- `src/app/hooks/file-export/*`：应用级导出 helper 子树
- `src/features/urdf-viewer/runtime/*`：USD runtime、Hydra delegate、vendor 与 worker 相关适配
- `src/shared/components/3d/*`：双 viewer 共享画布、渲染器、lighting、snapshot 与 transform controls
