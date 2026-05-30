# 浏览器测试体系修复 —— Codex 执行记录

> 配套：`docs/testing-rebuild-handoff.md`（完整背景/根因/已完成项）、根目录 `CLAUDE.md`（红线）。
> 本文件记录本轮 Codex 对浏览器测试体系的补齐工作。现行测试入口以 `docs/testing.md` 和 `package.json` 为准。

## 0. 当前状态（已核实）
- **L1 单元**：✅ 绿（`npm test` = 36 pass）。
- **T1**：✅ 已完成——package.json 不再有指向缺失文件的 `test:browser:mujoco-*` / `test:e2e*` 悬空脚本。
- **T2**：✅ 已完成——新增 `scripts/testing/browser/helpers/zip-import-helpers.mjs`（`zipDir` + `resolveUploadedRobotFileName` 健壮名称匹配 + `importZippedModel` = zip上传+解析名+triggerRobotLoad）；`urdf-helpers.mjs` / `sdf-helpers.mjs` 已改用它。URDF/SDF 导入超时的根因（原始目录上传不设 webkitRelativePath）已修。
- **T3**：✅ 已完成——现有 23 个浏览器测试已按真实 app 行为对齐，上次 `tmp/regression/run-all-summary.json` 显示 23/23 通过。
- **T4**：✅ 已完成——恢复 7 个 MuJoCo/MJCF 专项浏览器测试：`mujoco-import / tree-crud / property-editor / source-editor / assembly / viewer / export`。
- **入口**：✅ 已更新——`test:browser:all` 统一走 `run-all --browser-only`，避免手写串联遗漏 `xacro-import` 或新增用例。
- **地基**：`scripts/e2e/helpers/{browser-helpers,assertions}.mjs`、`scripts/testing/runner/run-all.mjs`、`scripts/testing/setup/clone_*.mjs` 均已就位并提交；`npm run test:all` / `node scripts/testing/runner/run-all.mjs` 可用。
- **已验证跑通**：`node scripts/testing/runner/run-all.mjs --browser-only` = 30/30 pass；`npm test`、`npm run typecheck:quality`、`npm run lint` 均通过。

## 1. 工作总览
| 阶段 | 内容 | 性质 |
|------|------|------|
| **T3** | 逐个把既有 `scripts/testing/browser/test_*.mjs` 的断言对齐**真实 app 行为**，直到 `run-all --browser-only` 全绿 | ✅ 已完成 |
| **T4** | 以 MJCF fixtures 重建 7 个 `test_mujoco_*.mjs` 并在 package.json 恢复脚本 | ✅ 已完成 |
| **T5** | 收尾验证：`npm test` + `run-all --browser-only` 全绿 + `npm run lint` + `npm run typecheck:quality` | ✅ 已完成 |

## 2. T3 执行方法（核心）

### 2.1 拿失败清单
```bash
node scripts/testing/runner/run-all.mjs --browser-only        # 共享一个 dev server 批量跑
# 读 tmp/regression/run-all-summary.json 的 results[]（每项 {name, exitCode, ms}）
# 也可单跑：node scripts/testing/runner/run-all.mjs --browser-only --filter <key片段>
```
> 单测试首次冷启 Vite 可能 60–90s，勿误判挂死。批量务必用 run-all 起共享 server。

### 2.2 逐个修复循环（对每个失败的 test_*.mjs）
1. 读该 `test_*.mjs`，看它断言了什么、用哪个格式 helper 的 `importModel`。
2. 单跑该测试，读 `[suite:*] ✗ assert N: ...` 失败行 + `tmp/regression/<name>_results.json`。
3. **查真实 app 行为**：用 `window.__URDF_STUDIO_DEBUG__`（仅在 URL 带 `?regressionDebug=1` 时存在，`createSession` 已自动加）暴露的接口取真值，定义见 `src/shared/debug/regressionBridge.ts`。常用：
   - `getRegressionSnapshot()` → `{ store:{name,rootLinkId,links,joints}, runtime, selectedFile, assembly, interaction:{hoveredSelection,...} }`
   - `getDocumentLoadState()` → `{status,fileName,format,error}`（**标准编辑器加载完成后 status 长期停在 `loading`，不要据此判就绪——用 `snapshot.runtime` 已建 + link 数**；仅 USD 到 `ready`/`hydrating`）
   - `getAvailableFiles()` / `getRuntimeSceneTransforms()` / `getProjectedInteractionTargets()`
   - `setViewerFlags({showCollision,showVisual,modelOpacity,...})` / `setViewerToolMode(mode)` / `setViewerJointAngles(map)`
   - `__store__.getState()`（robotStore 全量 action：addChild/updateLink/deleteLink/updateJoint/setJointAngle/addComponent/addBridge/undo/redo/…，见 `base-helpers.mjs` 的 `store` 封装）
   - `resetFixtureFiles()` / `seedFixtureFile()` / `loadRobotByName()`（USD seed-load 路径）
   - 必要时临时写诊断脚本（仿 §2.4）打印真实结构，用完即删。
4. **据真实行为修断言**（或修 helper），不要为变绿把断言改空/删断言。已知例：
   - `test_theme_switching.mjs` assert1「theme detectable from DOM」——app 主题不是靠 `documentElement` 的 `dark/light` class 或 `data-theme`，查 `uiStore` 主题应用逻辑（可能是 CSS 变量/`color-scheme`/某容器 class），改成检测真实信号。
5. 重跑该测试至绿，再进入下一个。

### 2.3 各测试简表（30 个真实文件，按域分组，逐个验证）
- 导入：`urdf_model_import`、`sdf_model_import`、`usd_model_import`、`multi_format_import`、`xacro_import`（T2 后应大幅好转，重点验 selectedFile 名解析）
- 导出：`urdf_export`、`mjcf_export`、`sdf_usd_export`、`assembly_export`
- 编辑：`urdf_tree_crud`、`urdf_property_editor`、`urdf_source_editor`
- 装配：`urdf_assembly`、`cross_format_assembly`
- 交互/显示：`measure_tool`、`ik_drag`、`paint_mode`、`theme_switching`、`language_switching`、`drag_drop_snapshot`
- MuJoCo/MJCF 专项：`mujoco_import`、`mujoco_tree_crud`、`mujoco_property_editor`、`mujoco_source_editor`、`mujoco_assembly`、`mujoco_viewer`、`mujoco_export`
- 其它：`hardware_config`、`ai_assistant`、`collision_optimization`

### 2.4 诊断脚本模板（按需临时建，用后删）
```js
import { createSession } from './scripts/testing/browser/helpers/<fmt>-helpers.mjs';
const s = await createSession(); const { page } = s;
try {
  // …importModel / store 操作…
  console.log(JSON.stringify(await page.evaluate(() => {
    const api = window.__URDF_STUDIO_DEBUG__;
    return { snap: api.getRegressionSnapshot(), load: api.getDocumentLoadState() };
  }), null, 2));
} finally { await s.cleanup(); }
```

## 3. 必守红线（CLAUDE.md）
- **每轮浏览器自动化后** `node test/usd-viewer/scripts/cleanup-headless.cjs`；只清本次自动化进程，**禁止杀用户日常浏览器**（尤其 `/home/xyk/Desktop/BotLab` 的 vite / VS Code chatgpt 扩展进程）。
- 批量跑用 `run-all` 起**共享 dev server**，避免反复冷启动 Vite。
- 调试接口默认关闭，靠 `?regressionDebug=1`（helper 已自动加）。

## 4. 加载机制铁律（别再踩）
- 上传只 auto-select，不加载；必须 `triggerRobotLoad`（已封装，fire-and-forget，勿 await 其内部 180s stable-wait）。
- "就绪"= `snapshot.runtime` 已建 + link 数 > 0（非 `status==='ready'`，仅 USD 例外）。`waitForReady` 已据此实现。
- 导入可能触发一次 SPA 导航销毁上下文；`isTransientPageContextError` 已用于重试。

## 5. Git / 提交策略（重要：分支有并发活动）
- 本分支 `refactor/eng-standards-phase-a` 有用户并行的 eng-standards 重构提交。**Codex 只允许**：编辑工作树文件、`git add` + `git commit` 自己这批测试改动（清晰 message，如 `test(browser): align <name> assertions`）。
- **禁止** `git reset --hard` / `rebase` / `commit --amend` / `git checkout <branch>` / 删分支等会改写他人历史的操作。
- 每修好一个测试就 commit，避免被并发提交吞掉、也便于中断恢复。

## 6. 验收标准（Done）
1. `npm test` 绿。
2. `node scripts/testing/runner/run-all.mjs --browser-only` 汇总表浏览器测试全绿（无法修复项需在测试内注明原因并在最终总结里列出，不得静默跳过/改空断言）。
3. `npm run lint` + `npm run typecheck:quality` 通过；全量 `npm run typecheck` 仍按既有测试类型债另行处理。
4. 浏览器自动化无残留进程（且未误杀用户进程）。
5. 最终输出一段总结：改了哪些测试、各自原因、最终 run-all 通过情况。
