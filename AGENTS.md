# URDF Studio Agent Guide

内容已合并到 [CLAUDE.md](CLAUDE.md)。本文件保留为兼容入口，所有 agent 上下文请直接读 `CLAUDE.md`。

同步提醒：

- 更新 agent 规则时以 `CLAUDE.md` 为主，必要时同步本兼容入口。
- `scripts/` 已统一为 `build/`、`generate/`、`test/`、`tools/`、`release/` 五类；新增或移动脚本时不要恢复旧目录名，具体结构以 `CLAUDE.md` 的 `scripts/ 目录结构` 为准。
- 浏览器验证、Playwright/Puppeteer/chrome-devtools MCP、浏览器回归脚本结束后，必须按 `CLAUDE.md` 清理残留浏览器进程；优先运行 `node test/usd-viewer/scripts/cleanup-headless.cjs`，不要使用会误杀用户浏览器的宽泛 `pkill chrome` / `killall chrome`。
