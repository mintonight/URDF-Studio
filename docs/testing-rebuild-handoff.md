# 浏览器测试体系修复 —— Codex 执行交接文档

> 交接人：Claude。本文档自包含，Codex 可据此直接接手完成剩余工作。
> 目标：让 URDF Studio 的三层测试（尤其是浏览器 E2E 层）真正"一口气全跑通"。
> 语言：中文沟通，代码/路径/命令保持原文。遵守根仓库 `CLAUDE.md` 全部红线。

---

## 0. 背景（为什么有这份文档）

用户原始诉求：参考大厂做法，按功能（碰撞编辑、交互、显示、拼接、导入导出、AI…）建测试用例，且能"一口气全跑完"。

调研后发现：项目**已有**接近大厂水准的三层测试体系，但浏览器层此前**跑不起来**——它依赖的底层地基从未被创建/提交。已确认的事实与已完成的修复见下。剩余工作主要是**逐个把浏览器测试的断言与真实 app 行为对齐**（这些 `test_*.mjs` 是历史上写好但从未真正运行过的，存在大量"写得对不上 app"的小问题）。

三层结构：
| 层 | 入口 | 状态 |
|----|------|------|
| L1 单元（536+） | `npm test` / `npm run test:unit:all` | ✅ 已修好（见 §2.1） |
| L2 浏览器 E2E（~22 个真实文件） | `npm run test:browser:*` / `npm run test:all` | 🟡 地基已修好；MJCF(zip)路径已验证跑通；**目录上传格式(URDF/SDF)导入超时待修(T2)**；个别测试断言待对齐(T3) |
| L3 语料/真值回归 | `npm run test:fixtures` / `verify:full` | ✅ 原本可用 |

---

## 1. 已确认的根因（不要重复排查，直接基于这些结论）

1. **浏览器测试地基从未存在**：`scripts/testing/browser/helpers/*.mjs` 与 `test_drag_drop_snapshot.mjs` 都 `import` 自 `scripts/e2e/helpers/browser-helpers.mjs` 和 `assertions.mjs`，但这两个文件（及 `scripts/testing/setup/clone_*.mjs`）从未被创建。→ **已重建**（§2.2）。`.gitignore` 第 20/21 行 `!scripts/testing/`、`!scripts/e2e/` 已放行这些新文件，`git check-ignore` 确认可追踪，**无需改 .gitignore**。

2. **`npm test` 本身是坏的**：`scripts/testing/runner/run-node-tests.mjs` 被移动到 `runner/` 子目录后，`REPO_ROOT` 仍用 `../..`（落在 `scripts/`），导致所有单元测试"文件缺失"。→ **已修为 `../../..`**（§2.1）。

3. **浏览器测试集体挂起的真正机制**（关键，务必理解）：
   - 上传文件（`input.uploadFile`）只会**注册 + auto-select**（`selectedFile.name` 被设上），**不会把文档加载进 viewer**。
   - 必须显式调 `window.__URDF_STUDIO_DEBUG__.loadRobotByName(fileName)`（→ `App.tsx` 的 `loadRobotFile`）才会真正加载。
   - **但** `regressionBridge.ts` 里的 `loadRobotByName` 内部 `await waitForStableSnapshot()`，该函数要求 `documentLoadState.status === 'ready'`；而**标准编辑器（非 USD，即 MJCF/URDF/SDF）加载完成后 `status` 会一直停在 `'loading'` 永不翻 `'ready'`**（用 diag 脚本实测：`runtime:true`、`linkCount:14`、无报错，但 status 永远 `loading`）。所以 `await loadRobotByName` 会阻塞到 180s 超时。
   - 正确的"已加载"判据是 **`snapshot.runtime` 已构建 + 有 link**（committed 的 `run_menagerie_browser_regression.mjs` 的 `snapshotWithDebug` 正是这么判的，不看 `status==='ready'`）。USD 路径才会到 `ready`/`hydrating`。
   - → **已修复**：`triggerRobotLoad` 改 fire-and-forget（不 await 内部 stable-wait）；`waitForReady` 改为"runtime 已建 + 有 link 即就绪，或 status 为 ready/hydrating"（§2.3）。theme 测试已据此跑通（模型加载、canvas 渲染、无页面错误）。

4. **package.json 有悬空脚本引用**（指向从未创建的文件）：
   - 7 个 `test:browser:mujoco-*` → `scripts/testing/browser/test_mujoco_*.mjs`（不存在）：`mujoco-import / source-editor / property-editor / tree-crud / assembly / viewer / export`。它们是 `test:browser:all` 的前 7 项。
   - 4 个 `test:e2e*` → `scripts/e2e/test_*.mjs`（不存在）。
   - → **待处理**（T1）。

---

## 2. 已完成的修改（已落盘，勿重复）

### 2.1 修 `npm test`
- `scripts/testing/runner/run-node-tests.mjs`：`REPO_ROOT` 由 `../..` 改 `../../..`；usage 文本里的旧路径 `scripts/test/...` 改为 `scripts/testing/runner/...`。
- 验证：`npm test` 通过（fast lane 36 测试绿）；`--list` 显示 `src` suite 正确解析 538 文件。

### 2.2 重建地基（新增文件）
- `scripts/e2e/helpers/browser-helpers.mjs`：导出 `ensureSite / launchBrowser / createPage / uploadFile / uploadDirectory / collectFiles / writeJsonAtomic / ensureDir / triggerRobotLoad / stabilizeDebugPage / isTransientPageContextError / DEFAULT_SITE_URL / DEFAULT_OPERATION_TIMEOUT_MS`。实现整合自 committed 的 `run_menagerie_browser_regression.mjs`、`run_unitree_browser_regression.mjs`、`run_shadow_hand_hover_regression.mjs`。
- `scripts/e2e/helpers/assertions.mjs`：`createTestSuite / assert / assertEqual / assertGreaterThan / assertNonNull / printSummary`（零依赖）。
- `scripts/testing/setup/_clone-util.mjs` + `clone_{all_test_data,mujoco_menagerie,unitree_model,unitree_ros}.mjs`：幂等 git clone（目录已存在则跳过）。
- 验证：全部 format-helper 的 import 链可解析、导出齐全。

### 2.3 修加载/就绪路径（改 committed 文件）
- `scripts/testing/browser/helpers/base-helpers.mjs`：
  - 引入 `isTransientPageContextError`；`createSession` 支持 `URDF_E2E_HEADED=1` 环境变量（供 run-all `--headed`）。
  - `waitForReady`：默认超时 120s；**runtime 已建+有 link 即就绪**（或 status ready/hydrating）；status 为 error 抛出含原因；瞬时导航错误重试；超时打印 last state。
- `scripts/e2e/helpers/browser-helpers.mjs` 的 `triggerRobotLoad`：**fire-and-forget**（`void loadRobotByName(fn)`，不 await 内部 180s stable-wait），容忍瞬时导航错误。
- 4 个格式 helper（`urdf/mjcf/sdf/xacro-helpers.mjs`）的 `importModel`：在等到 `selectedFile.name===fileName` 后追加 `await triggerRobotLoad(page, fileName, timeoutMs)`。

### 2.4 统一入口（新增）
- `scripts/testing/runner/run-all.mjs`：L1 单元 → L2 浏览器 →（可选 `--fixtures`）L3。**失败不中断**，自动从 package.json 发现 `test:browser:*`，**先起一个共享 dev server**（各测试 `ensureSite` 复用、不再各自冷启动 Vite），结尾跑 `cleanup-headless.cjs`，输出汇总表 + `tmp/regression/run-all-summary.json`。支持 `--unit-only/--browser-only/--skip-*/--fixtures/--headed/--filter/--list`。
- `package.json`：新增 `"test:all": "node scripts/testing/runner/run-all.mjs"`。
- 验证：`--list` 正确；`--browser-only --filter import` 实跑时共享 server 成功启动并被复用。

### 2.5 文档（新增）
- `docs/testing.md`：面向非专业用户的测试金字塔指南（三层、命令、新功能往哪加测试、如何读结果）。

---

## 3. 剩余任务（Codex 执行）

> 每跑完浏览器自动化，必须 `node test/usd-viewer/scripts/cleanup-headless.cjs`（CLAUDE.md 红线）。Vite 冷启动在本机较慢（单个浏览器测试约 1.5–3 分钟）；强烈建议用 `run-all` 起共享 server 批量跑。

### T1. 清理 package.json 悬空脚本引用（先做，快）
- 删除 7 个 `test:browser:mujoco-*` 脚本（文件不存在），并从 `test:browser:all` 串联里移除这 7 项（它们是开头 7 个 `&&`）。
- 删除 4 个 `test:e2e*` 脚本（`scripts/e2e/test_*.mjs` 不存在），或在 T4 决定是否新建对应 e2e 测试后再定。
- 目的：`npm run test:all` / `test:browser:all` 不再因缺文件直接报错。
- 注意：被删的 MJCF 专项浏览器覆盖记入 T4（不要静默丢弃）。

### T2.（高优先）修目录上传路径：URDF + SDF 导入超时
- **现象（实测）**：`test:browser:sdf-import`（demo_joint_friction、r2_description）与 `test:browser:urdf-import`（a1_description…）**都**在 `importModel` 阶段超时——等 `selectedFile.name === <fileName>` 60s 不满足。而 MJCF（theme 测试）能过。
- **根因（强烈怀疑，已具备充分证据）**：`urdf-helpers` / `sdf-helpers` 的 `importModel` 走的是 `uploadDirectory`（puppeteer 往 `webkitdirectory` input `uploadFile(...files)` 原始多文件上传）。**puppeteer 这条路不会设置 `File.webkitRelativePath`**，app 的目录导入逻辑因此拿不到包内相对路径，无法正确识别主文件 / 命名 `selectedFile`。
  - 对照：能跑的 **`mjcf-helpers`** 和 committed 的 **`run_unitree_browser_regression.mjs`（`createBundleZip`）走的是"把目录打包成 zip → 上传单个 zip"**，不是原始目录上传。MJCF 能过正因如此。
- **推荐修法**：把 `urdf-helpers.importModel` 和 `sdf-helpers.importModel` 改成 **zip-目录-再上传单 zip**，与 `mjcf-helpers.importModel` 完全同构（`zipDir(dir)` → 写 `tmp/regression/_*.zip` → `input[type=file].uploadFile(zip)` → 等 `selectedFile.name===fileName` → `triggerRobotLoad`）。可直接把 `mjcf-helpers` 的 `zipDir`+流程抽成共享函数复用。
  - 若改后 `selectedFile.name` 仍对不上，再放宽匹配（endsWith / basename，参考 `run_menagerie` 的 `matchesSelection`），并据实修 `test_*_import.mjs` 传入的 `fileName`。
- 顺带可考虑废弃/保留 `browser-helpers.uploadDirectory`：若全部格式都改走 zip 上传，则 `uploadDirectory` 可移除（注意 `xacro-helpers` 用的是单文件 `uploadFile`，URDF/SDF 改 zip 后就无人用 `uploadDirectory` 了）。
- **确认 `usd-import`**：USD 走 `seedFixtureFile + loadRobotByName`（`usd-helpers.mjs`），路径与上传无关，可能本就 OK——单跑确认。
- 用临时 diag 脚本取证（仿下述模板）打印真实 `getAvailableFiles()` 与 `selectedFile?.name`：上传后 `page.evaluate(() => window.__URDF_STUDIO_DEBUG__.getAvailableFiles().map(f=>f.name))`。

### T3. 逐个对齐浏览器测试断言（主体工作量，Phase C）
- 这些 `test_*.mjs` 从未真正跑过，预期会有"断言和真实 app 对不上"的小问题。已知例：`test_theme_switching.mjs` 的 assert 1「theme detectable from DOM」失败——它检查 `documentElement` 上的 `dark/light` class 或 `data-theme`，但 app 实际的主题表示方式不同（需查 `uiStore`/主题应用逻辑确认真实信号，再改断言）。
- 执行方式（推荐）：用 `node scripts/testing/runner/run-all.mjs --browser-only` 一次性跑全部，拿到 `tmp/regression/run-all-summary.json` 的失败清单；然后**逐个**：读对应 `test_*.mjs` → 用 `--filter <key片段>` 单跑 → 据失败信息查 app 真实行为（`src/` + `window.__URDF_STUDIO_DEBUG__` 暴露的接口见 `src/shared/debug/regressionBridge.ts`）→ 修断言或修 helper → 重跑至绿。
- 原则：断言要对齐 app 的**真实**行为，不要为了变绿而把断言改空。改不动/疑似 app bug 的，在测试里标注并汇报，不要静默跳过。
- 全部 22 个真实 `test_*.mjs`：ai_assistant, assembly_export, collision_optimization, cross_format_assembly, drag_drop_snapshot, hardware_config, ik_drag, language_switching, measure_tool, mjcf_export, multi_format_import, paint_mode, sdf_model_import, theme_switching, urdf_assembly, urdf_export, urdf_model_import, urdf_property_editor, urdf_source_editor, urdf_tree_crud, usd_model_import, xacro_import。

### T4.（可选，补盲）重建 7 个 MJCF 专项浏览器测试
- 若要恢复 `test:browser:mujoco-*` 覆盖：以对应的 `test_urdf_*.mjs` 为模板，把 `urdf-helpers` 换成 `mjcf-helpers`、模型换成 menagerie 下的（如 `unitree_go2` / `go2.xml`）新建 `test_mujoco_*.mjs`，并在 package.json 恢复脚本。MJCF 导入路径已验证可用（theme 测试用的就是它）。
- 同理可决定是否新建 `scripts/e2e/test_*.mjs`（assembly_bridge / import_export / editor_operations）以支撑 `test:e2e*`。

### T5. 收尾验证
- `npm test`（L1 仍绿）。
- `node scripts/testing/runner/run-all.mjs --browser-only`（L2 全绿；阅读汇总表）。
- `npm run lint && npm run typecheck`。
- 每轮浏览器后 `node test/usd-viewer/scripts/cleanup-headless.cjs`，确认无残留（只清本次自动化进程，勿杀用户日常浏览器）。
- 视情况 `npm run verify:full`。

---

## 4. 必须知道的坑（Gotchas）

- **加载是 fire-and-forget**：永远不要 `await loadRobotByName(...)` 的返回（内部会 await 一个标准编辑器永不满足的 ready，阻塞 180s）。用 `triggerRobotLoad` 已封装。
- **"就绪"判据是 runtime 已建，不是 status==='ready'**（仅 USD 到 ready/hydrating）。
- **瞬时导航**：导入/加载可能触发一次 SPA 导航销毁执行上下文；`isTransientPageContextError` 已用于重试。
- **调试接口默认关闭**：`window.__URDF_STUDIO_DEBUG__` 仅在 URL 带 `?regressionDebug=1` 时存在；`createSession` 已自动加。
- **共享 server**：`ensureSite` 探测到 4173 可达就复用。批量跑务必用 `run-all` 起一个共享 server，否则每个测试冷启 Vite 极慢。
- **Vite 冷启动慢**：单测试首启可能 60–90s；超时设置已放宽，勿误判为挂死。
- **清理纪律**：见 T5 / CLAUDE.md。
- **可复用参考实现**（只读，勿改）：`scripts/regression/run_menagerie_browser_regression.mjs`（site/browser/load/重试范式）、`run_unitree_browser_regression.mjs`（upload/collectFiles）。

---

## 5. 验收标准（Done 的定义）
1. `npm test` 绿；`npm run test:all --browser-only` 汇总表中浏览器测试全绿（或对无法修复项有明确标注与说明）。
2. package.json 无悬空脚本引用。
3. `lint` + `typecheck` 通过。
4. 浏览器自动化无进程残留。
5. `docs/testing.md` 与实际命令一致。
