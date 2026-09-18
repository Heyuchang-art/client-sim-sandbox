# 界面文案实施 · 独立审核（第六轮）

审核对象：提交 `f244804`
审核日期：2026-09-18

## 结论

**重要-1 从根上修好了**（共用函数已消除分叉，基线构造等价，50% 档符号正确），**轻微-1 也修好了**（两条路径 action 已对齐）。**重要-2 仍未完全修好**：8 条 `audit` 文本确实清理干净，但 `lib/harness/tools.ts` 里还有 4 处用户可见的旧术语，其中 **1 处在导出的报告正文里**。

---

## 一、重要（1 条）

### 重要-1　导出报告正文仍写「时间步」「每步」

**位置**：`lib/harness/tools.ts:294`（`report.compose` 步骤生成的 markdown）

```
`- 时间步：${result.scenario.timeSteps} 步，每步 ${result.scenarioMeta.stepHours} 小时`,
```

**为什么这是用户可见的**：这段 markdown 由 `report.compose` 产出，经 `buildSimulationRecord` 存入 `reportMarkdown`，再由「导出报告」按钮与 `GET /api/reports/{id}` 返回。也就是说，**客户经理下载的那份报告正文里，通篇用「段」描述推演进度，唯独这一行写「时间步」「每步」**。

**影响**：这是本轮 C 项（时间步→段）唯一漏掉的地方，而且落在**要交给领导或评委的文件**里，比界面上的残留更显眼。报告开头还有一处 `每段 X 小时`（`lib/simulation.ts:1301` 审计文本），两者对照更明显。

**建议**：改成「- 推演段数：共 N 段，每段 X 小时」。

---

## 二、提示（1 条）

### 提示-1　`toolRegistry` 的 3 条 `intent` 是与规划器分叉的「死拷贝」

**位置**：`lib/harness/tools.ts:116`、`:151`、`:195`

```
116: intent: '按客群口径筛选候选客户并记录排除原因',
151: intent: '生成相似性、社交影响与统一服务三类关系边',
195: intent: '按确定性数值模型推演逐时间步的群体状态',
```

**核实结论**：这三条**目前不会被渲染**。我检索了全部 `.intent` 引用（`runner.ts:252`、`run-task.ts:182/193`、`sandbox-app.tsx:390`），它们取的都是 **`step.intent`**，即 `lib/harness/planner.ts` 的 `canonicalSteps`——那份已经迁移成「按你指定的条件筛出目标客户」这类业务措辞。`toolRegistry` 里这一份是重复的旧文案。

**为什么仍值得处理**：这正是你本轮刚消除掉的那类问题——**同一个语义存了两份实现，改了一份、漏了另一份**。规划器那份改了，注册表这份没改；今天没人读它，但任何人日后把 `toolRegistry[x].intent` 接到界面上，旧术语就会立刻复活。

**建议**：删掉 `toolRegistry` 里的 `title`/`intent` 字段（改用 `planner.ts` 的单一来源），或让 registry 直接从 `canonicalSteps` 取值。顺带检查 `HarnessTool` 类型里这两个字段是否还有别的读取方。

---

## 三、已核实修好的部分

### 重要-1（第五轮）——共用函数已消除分叉，基线构造等价

**分叉消除**：`lib/simulation.ts:1151` 新增并导出 `relativeUtilityBreakdown(weights, baseline, utilities)`，返回 `{ of, baseline, all }`。界面侧 `components/sandbox-app.tsx:659-662` 的 `relativeBreakdown` 已改为**薄包装**，直接调用引擎函数，原先那份独立实现已删除（我确认界面内已无 `baseTotal` 等旧实现痕迹）。

**基线构造等价性——成立**。引擎侧构造的对象是：

```
{ avoidance: 0, cost: baselineMetrics.touchCost, wake: baselineMetrics.wake,
  total: -weights.cost * baselineMetrics.touchCost - weights.wake * baselineMetrics.wake }
```

与真实基线效用对比：真实基线由 `utilityFrom(baselineMetrics, baselineMetrics, weights)` 得到，其 `avoidance = 0.3×(b.panic−b.panic) + … = 0`，`cost = b.touchCost`，`wake = b.wake`——**逐项相同**。而且 `of()` 内部是用 `weights.avoid*avoidance − weights.cost*cost − weights.wake*wake` 现算 `total`，构造对象里的 `total` 字段实际不参与计算，属于冗余但无害。结论：**等价，不会引入偏差。**

**50% 档符号验证通过**（推荐非基线）：分群 26.26 − 5.84 − 1.02 = 19.40 ≈ 19.41；统一提示 20.01 − 1.68 − 1.47 = 16.86 ✓；不主动 0.00 − 0.00 − 0.00 = 0.00 ✓。审计第 8 步与主表同号同口径，**上一轮的「− 人力成本 -4.31」双重否定已消除**。新增的回归测试覆盖了「推荐非基线」场景，方向正确。

### 轻微-1（第五轮）——已修好

`lib/simulation.ts:1277` 第 4 步 action 现为「建立客户关系网络」、`1281` 第 8 步为「生成报告」，与 `lib/harness/planner.ts:17,21` 的规范步骤名一致。两条路径的 `action` 列已无差异。

### 逐字段最终比对

| 字段 | 状态 |
|---|---|
| actor | ✓ 八项完全一致（`runner.ts:39-48` ↔ `simulation.ts:1301-1305`） |
| action | ✓ 已对齐规划器单一来源 |
| result | ○ 本地与服务的文本粒度不同但均为业务语言；**唯一残留是导出报告模板（重要-1）** |
| status | ○ 服务端第 1、2 步可为 `pending`（字段回落/命中不足），本地恒为 `completed`——合理差异，你也确认未在材料中声称完全一致 |

---

## 四、逐条回答

1. **共用函数是否真的消除了分叉？** 是。界面已无独立实现（改为薄包装）；`baseline` 构造与真实基线效用**逐项等价**，不影响任何数值。
2. **`tools.ts` 8 条文本是否还有术语残留？** 8 条 `audit` 文本**已清理干净**（`每步/时间步/客群口径/原型/心理因素/关系边/避险收益/Policy Gateway/数值推演/草稿级/候选策略/触达成本/唤醒` 在这 8 条里均无命中）。但同一文件另有 4 处：`:294` 在**导出报告**里（重要-1），`:116/:151/:195` 是 **toolRegistry 的死拷贝 intent**（提示-1）。
3. **四条字段是否已无可避免之外的差异？** actor/action 已无差异；result 尚有一处（导出报告）；status 的差异合理。
4. **还有别的跨模块口径不一致吗？** 有，就是提示-1：**`planner.ts` 的 `canonicalSteps` 与 `tools.ts` 的 `toolRegistry` 各存一份 title/intent**，与本轮修掉的「引擎 vs 界面各存一份换算」是同一类问题。这是目前唯一已知的重复来源，建议一并收掉。

---

## 五、落地顺序

| 顺序 | 事项 | 改动量 |
|---|---|---|
| 1 | 重要-1：`tools.ts:294` 报告正文改「推演段数／每段」 | 1 行 |
| 2 | 提示-1：删掉 `toolRegistry` 的 `title`/`intent` 或改为引用 `canonicalSteps` | 约 6 行 |
| 3 | 复核：导出一次报告，确认全文术语一致 | — |

第 1 项做完，「时间步→段」这个改名才算覆盖到全部用户可见文本。

> 本轮结论基于提交 `f244804` 与源码复核。未改动被审核项目的任何文件。
