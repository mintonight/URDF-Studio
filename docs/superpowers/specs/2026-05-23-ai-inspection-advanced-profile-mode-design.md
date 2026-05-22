# AI 审阅专业模式 Profile 分层改版设计

> 日期：2026-05-23  
> 范围：`src/features/ai-assistant/` 中 AI 审阅配置阶段的专业模式交互  
> 目标：让专业模式成为推荐方案的可解释、可恢复、可微调版本，而不是平铺 profile 清单。

## 1. 背景

AI 审阅已经切到 profile-only 标准，执行单元是 `profileId + itemId`。当前运行标准包含 5 个 layer、28 个 profile、126 个检查项：

- `base`：基础通用层；
- `morph`：机器人形态层；
- `format`：源格式层；
- `target`：目标平台层；
- `workflow`：工作流层。

现有专业模式由 `InspectionSidebar + InspectionSetupView` 组成。它可以操作 profile 和 item，但左侧仍是 profile 平铺列表，只附带 layer 标签。这个交互已经跟不上分层 profile 的心智模型，尤其当用户通过本地缓存直接进入专业模式时，看不到常规模式里的推荐方案。

## 2. 设计目标

1. 专业模式必须显示推荐方案，不管用户是从常规模式切入还是直接进入专业模式。
2. 专业模式按 layer 浏览和选择 profile，不再平铺全部 profile。
3. 用户能看懂当前选择和系统推荐之间的关系：推荐纳入、用户添加、用户排除、证据不足、不适用。
4. 用户修改范围后可以一键恢复推荐，也可以恢复单个 profile 的推荐选择。
5. 不改变审阅执行主路径：最终仍由 `selectedProfiles -> toSelectedInspectionProfileMap -> runRobotInspection` 发起审阅。
6. 保持当前架构边界，改动限制在 `features/ai-assistant` 和 i18n 文案。

## 3. 非目标

- 不重做 AI 审阅弹窗整体框架。
- 不改变 profile 定义、prompt 契约、报告结构和 PDF 导出契约。
- 不引入新的审阅强度档位。
- 不把专业模式改成多步骤向导。
- 不把 target/platform 选择从常规模式完全搬进专业模式；本次只展示和允许 profile 级选择。

## 4. 信息架构

专业模式配置阶段改为三层：

### 4.1 推荐方案层

位于专业模式主内容顶部，使用紧凑推荐条。它回答：

- 系统推荐这次审什么；
- 推荐依据是什么；
- 当前选择是否偏离推荐；
- 如何恢复推荐。

推荐条显示：

- 推荐方案标题，例如“四足 URDF 仿真就绪检查”；
- 已选检查项数量 / 总检查项数量；
- 偏离推荐数量；
- 推荐原因摘要，例如来源格式、形态、mesh 资产、工作流上下文、目标平台状态；
- 操作：`恢复推荐`、`查看原因`。

### 4.2 分层范围层

左侧 `InspectionSidebar` 改为 layer tree：

```text
基础通用层 20/20
  通用机器人模型基础检查 5/5 推荐
  通用物理合理性检查 5/5 推荐

机器人形态层 5/36
  四足机器人检查 5/5 推荐
  机械臂检查 0/5 证据不足
  灵巧手检查 0/5 不适用

源格式层 10/30
  URDF 源格式检查 5/5 推荐
  Mesh 资产检查 5/5 自动追加

目标平台层 0/20
  未选择目标平台

工作流层 4/20
  碰撞体编辑 4/4 推荐
```

每个 layer 显示：

- layer 名称；
- 已选 item 数 / layer 总 item 数；
- 是否有推荐 profile；
- 是否有不适用或证据不足 profile；
- 展开/收起状态。

每个 profile 行显示：

- 选中状态：全选、部分选择、未选；
- profile 名称；
- 已选 item 数 / profile item 总数；
- 状态 badge：`推荐`、`自动追加`、`用户添加`、`用户排除`、`证据不足`、`不适用`、`偏离推荐`。

### 4.3 检查项微调层

右侧 `InspectionSetupView` 继续展示当前 focused profile 的 item 卡片，但补充：

- profile 推荐原因或适用性说明；
- `全选本 profile`；
- `清空本 profile`；
- `恢复本 profile 推荐`；
- 每个 item 的推荐关系：`推荐纳入`、`用户排除`、`用户添加`、`不适用`、`证据不足`；
- 每个 item 的失败等级和证据等级。

## 5. 状态模型

### 5.1 基准推荐状态

新增或派生：

```ts
type RecommendedInspectionProfiles = SelectedInspectionProfiles
```

推荐基线优先来自 `normalInspectionPlan.selectedProfiles`，而不是单独用 `profileRecommendation.profileIds` 重新生成。原因：

- `normalInspectionPlan` 已接入目的、目标平台、工作流上下文和适用性过滤；
- 常规模式和专业模式必须共享同一个推荐基线。

### 5.2 当前选择状态

继续使用现有：

```ts
type SelectedInspectionProfiles = Record<string, Set<string>>
```

它仍是真正发起审阅的 source of truth。

### 5.3 适用性状态

继续使用：

```ts
isInspectionItemApplicable(robot, profileId, itemId?)
```

专业模式应在 UI 层消费这个状态，用于解释 profile/item 为什么默认不选，或为什么用户强制选择时需要提示。

### 5.4 派生状态

建议新增纯函数，放在 `src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.ts`：

```ts
interface InspectionSelectionDeviation {
  addedItems: Array<{ profileId: string; itemId: string }>
  removedItems: Array<{ profileId: string; itemId: string }>
  changedProfileIds: string[]
  totalChangedItemCount: number
}

interface InspectionLayerSummary {
  layer: InspectionProfileLayer
  selectedItemCount: number
  recommendedItemCount: number
  totalItemCount: number
  unavailableProfileCount: number
  insufficientEvidenceProfileCount: number
  profileIds: string[]
}

interface InspectionProfileScopeSummary {
  profileId: string
  layer: InspectionProfileLayer
  selectedItemCount: number
  recommendedItemCount: number
  totalItemCount: number
  applicability: InspectionApplicabilityStatus
  relation: 'recommended' | 'user_added' | 'user_removed' | 'unchanged_unselected' | 'partial'
}

interface InspectionItemScopeSummary {
  profileId: string
  itemId: string
  selected: boolean
  recommended: boolean
  applicability: InspectionApplicabilityStatus
  relation: 'recommended_included' | 'user_added' | 'user_removed' | 'not_recommended' | 'unavailable'
}
```

这些函数只读 `INSPECTION_PROFILE_DEFINITIONS`、`selectedProfiles`、`recommendedProfiles` 和 `isInspectionItemApplicable`，不读 React 状态。

## 6. 交互规则

### 6.1 进入专业模式

- 如果用户从常规模式切到专业模式，`selectedProfiles` 已经等于 `normalInspectionPlan.selectedProfiles`，专业模式直接显示推荐条和分层树。
- 如果用户通过本地缓存直接进入专业模式，也必须构造 `normalInspectionPlan`，并在顶部显示同一推荐条。
- 进入专业模式时不应在每次 render 都覆盖用户选择。只有推荐基线变化且用户还没有手动改过时，才可自动同步。

### 6.2 手动修改

- 点击 profile 选择框：全选或清空该 profile 的 item。
- 点击 item：只切换当前 item。
- 修改后，顶部推荐条显示偏离推荐数量。
- 用户添加不适用或证据不足 profile/item 时，允许操作，但显示提示 badge；不阻断专家用户。

### 6.3 恢复推荐

- `恢复推荐`：把 `selectedProfiles` 替换为 `normalInspectionPlan.selectedProfiles`。
- `恢复本 profile 推荐`：只替换该 profile 的 item set：
  - 推荐基线有该 profile：恢复到推荐 item set；
  - 推荐基线没有该 profile：清空该 profile。

### 6.4 切回常规模式

如果当前选择已偏离推荐，切回常规模式时不能静默丢失自定义范围。建议第一阶段采用保守策略：

- 常规模式顶部显示“已自定义审阅范围”；
- 显示当前选择统计；
- 提供 `恢复推荐`；
- 常规模式的目的/目标切换如果会重算 plan，则需要提示用户当前自定义范围将被推荐方案覆盖。

如果第一阶段不做常规模式自定义提示，则至少不能在切换模式时意外覆盖 `selectedProfiles`。

### 6.5 报告阶段

报告阶段的侧栏继续 read-only，但也按 layer 分组导航：

- 只展示本次实际执行过的 profile/item；
- 不展示 `恢复推荐`；
- profile/item 点击仍导航到报告 anchor；
- layer 可展开/收起。

## 7. 组件拆分

### 7.1 新增 `InspectionRecommendationBanner`

位置：

```text
src/features/ai-assistant/components/InspectionRecommendationBanner.tsx
```

职责：

- 显示专业模式顶部推荐方案；
- 显示推荐原因摘要；
- 显示选择统计和偏离推荐统计；
- 触发 `onRestoreRecommendation`；
- 控制推荐原因展开/收起。

输入：

```ts
interface InspectionRecommendationBannerProps {
  lang: Language
  t: TranslationKeys
  plan: NormalInspectionPlan
  selectedProfiles: SelectedInspectionProfiles
  recommendedProfiles: SelectedInspectionProfiles
  onRestoreRecommendation: () => void
}
```

### 7.2 重构 `InspectionSidebar`

职责从“平铺 profile 列表”改为“layer tree + report navigation”。

新增输入：

```ts
recommendedProfiles?: SelectedInspectionProfiles
profileSummaries?: InspectionProfileScopeSummary[]
layerSummaries?: InspectionLayerSummary[]
```

为了降低风险，可让 `InspectionSidebar` 内部先调用 view-model 函数派生 summaries，后续再按测试和复用情况外提。

### 7.3 扩展 `InspectionSetupView`

新增 props：

```ts
recommendedProfiles: SelectedInspectionProfiles
onSelectProfileItems: (profileId: string, itemIds: Set<string>) => void
onRestoreProfileRecommendation: (profileId: string) => void
```

右侧 item 卡片根据推荐关系显示 badge。

### 7.4 调整 `AIInspectionModal`

新增派生：

```ts
const recommendedProfiles = normalInspectionPlan.selectedProfiles
```

新增 handler：

```ts
const handleRestoreRecommendation = () => {
  setSelectedProfiles(cloneSelectedInspectionProfiles(recommendedProfiles))
}

const handleRestoreProfileRecommendation = (profileId: string) => {
  setSelectedProfiles(prev => restoreProfileSelection(prev, recommendedProfiles, profileId))
}
```

需要新增工具函数避免直接复用 Set 引用。

## 8. 工具函数

建议在 `inspectionProfileSelection.ts` 增加：

```ts
export function cloneSelectedInspectionProfiles(
  selectedProfiles: SelectedInspectionProfiles,
): SelectedInspectionProfiles

export function areSelectedInspectionProfilesEqual(
  a: SelectedInspectionProfiles,
  b: SelectedInspectionProfiles,
): boolean

export function restoreInspectionProfileSelection(
  current: SelectedInspectionProfiles,
  recommended: SelectedInspectionProfiles,
  profileId: string,
): SelectedInspectionProfiles
```

建议新增 `inspectionAdvancedScopeViewModel.ts`：

- `buildInspectionSelectionDeviation(...)`
- `buildInspectionLayerSummaries(...)`
- `buildInspectionProfileScopeSummaries(...)`
- `buildInspectionItemScopeSummaries(...)`

这些函数需要单元测试。

## 9. UI 与样式

- 使用语义 token：`bg-panel-bg`、`bg-element-bg`、`border-border-black`、`text-text-*`、`text-system-blue`、`bg-system-blue/10`。
- 推荐条使用轻量边框和 `system-blue` 图标/文字强调，不使用大面积蓝色实底。
- layer 树保持密集工作台风格，避免大卡片堆叠。
- 状态不能只靠颜色表达，必须有 badge 文案或图标。
- focus ring 使用 `focus-visible:ring-system-blue/30`。
- 新增文案必须同步 `src/shared/i18n/locales/en.ts` 和 `zh.ts`，并更新对应 locale 测试。

## 10. 测试计划

### 10.1 工具函数测试

新增：

```text
src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.test.ts
```

覆盖：

- layer summary 按 5 个 layer 聚合；
- profile relation 正确区分推荐、用户添加、用户排除、部分选择；
- item relation 正确区分推荐纳入、用户添加、用户排除；
- 不适用 / 证据不足状态进入 summary；
- deviation 统计准确。

扩展：

```text
src/features/ai-assistant/utils/inspectionProfileSelection.test.ts
```

覆盖 clone/equality/restore profile。

### 10.2 组件测试

扩展：

```text
src/features/ai-assistant/components/AIInspectionModal.test.tsx
src/features/ai-assistant/components/InspectionSidebar.test.tsx
```

覆盖：

- advanced 模式直接打开时仍显示推荐方案；
- 专业模式显示 layer 分组，不再只平铺 profile；
- 修改 item 后显示偏离推荐；
- 点击恢复推荐恢复 `selectedProfiles`；
- 点击恢复本 profile 推荐只影响一个 profile；
- read-only 报告侧栏按 layer 导航且不显示恢复操作。

### 10.3 验证命令

优先运行：

```bash
npm run typecheck
node --import tsx --test src/features/ai-assistant/utils/inspectionAdvancedScopeViewModel.test.ts
node --import tsx --test src/features/ai-assistant/components/AIInspectionModal.test.tsx
```

如果组件测试入口依赖 Vite/jsdom 环境，按现有测试脚本运行相关文件或使用 `npm run test`。

最终建议运行：

```bash
npm run typecheck
npm run test
```

涉及 UI 文案和样式较多时，再运行：

```bash
npm run build
```

## 11. 分阶段实施

### 阶段 1：数据与推荐基线

- 增加 selection clone/equality/restore 工具；
- 增加 advanced scope view-model；
- 测试 view-model 和 selection 工具；
- 不改 UI。

### 阶段 2：专业模式推荐条

- 新增 `InspectionRecommendationBanner`；
- advanced 模式主内容顶部接入推荐条；
- 接入 `恢复推荐`；
- 测试 advanced 直达时显示推荐方案。

### 阶段 3：侧栏 layer tree

- 重构 `InspectionSidebar` 的 setup 状态为 layer tree；
- 保持 read-only report navigation 能用；
- 显示 layer/profile 计数和状态 badge；
- 测试 profile/item toggle 与导航。

### 阶段 4：右侧 item 推荐关系

- 扩展 `InspectionSetupView` item badge；
- 增加 `恢复本 profile 推荐`；
- 显示 profile 推荐原因或适用性提示；
- 测试 item relation 展示和单 profile restore。

### 阶段 5：常规模式偏离提示

- 如果用户已自定义范围，常规模式显示“已自定义审阅范围”；
- 目的/目标切换覆盖自定义范围时给出明确行为；
- 测试 normal/advanced 来回切换不丢选择。

## 12. 验收标准

- 专业模式直达时能看到推荐方案。
- 专业模式左侧按 layer 分组浏览 profile。
- 用户能看出哪些 profile/item 是推荐纳入、用户添加、用户排除、证据不足或不适用。
- 修改范围后能看到偏离推荐数量，并能恢复推荐。
- 审阅执行仍只使用当前 `selectedProfiles`。
- 常规模式和专业模式共享同一推荐基线，不出现两套推荐结果。
- Light / Dark / 高对比模式下推荐条、badge、focus 和层级状态可读。
