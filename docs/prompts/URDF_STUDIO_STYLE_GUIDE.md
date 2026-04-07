# URDF Studio Style Guide

本文件改为轻量入口，完整内容已并入 `docs/prompts/CLAUDE.md` 第 6 节。

## 只看这几条即可

- 语义 token 入口：`src/styles/index.css`
- 主题状态：`src/store/uiStore.ts`
- 系统主题监听：`src/app/hooks/useAppEffects.ts`
- 主要 UI 宿主：`src/app/AppLayout.tsx`、`src/app/components/header/*`、`src/app/components/settings/*`
- 共享 UI 原语：`src/shared/components/ui/*`
- 3D HUD / 画布主题辅助：`src/shared/components/3d/LoadingHud.tsx`、`src/shared/components/3d/scene/themeUtils.ts`
- 不写分散硬编码色值，优先语义类
- Focus 态保持可见，建议 `ring-system-blue/30`
- `#0088FF` 仅用于 `slider-accent` / 进度线 / 细线高亮
- `Light / Dark / 高对比` 三种场景都要可读
