# 界面文案收口审计 · 用户可见文字来源清单

审核对象：提交 `8efdeeb`
审核日期：2026-09-18

## 结论

**不能收口 —— 还有 2 处活跃问题，而且又落回同一个模式：报告有两份实现，你改了服务端那份，客户端那份没改。**

你这一轮的返工本身是准确的：`tools.ts:294` 已改「推演段数／每段」，报告的「策略对比」已改相对分（`:286-295` 用 `relativeUtilityBreakdown`），`toolRegistry` 的 title/intent 已改为经 `stepMeta()` 引用 `planner.ts`，`lib/scenario.ts` 的说明文字已去「客群口径」（仅剩一处注释）。

但报告在 `components/sandbox-app.tsx:537-572` **另有一份客户端实现**，而且那是「导出报告」按钮真正产出的文件。

---

## 一、用户可见文字来源清单（逐项状态）

| # | 来源 | 状态 | 说明 |
|---|---|---|---|
| 1 | `components/sandbox-app.tsx` 静态文案与 JSX 内插 | **基本干净** | 20 个旧术语中仅剩 2 处：`:428` 表头「原型」；`:545`「每步粒度」（在报告里） |
| 2 | `lib/harness/planner.ts` canonicalSteps 的 title/intent | **干净** | 8 条已全部业务化 |
| 3 | `lib/harness/tools.ts` toolRegistry title/intent | **干净** | 已改为 `stepMeta()` 引用规划器单一来源 |
| 4 | `lib/harness/tools.ts` 8 条工具 audit 文本 | **干净** | 本轮复核无旧术语命中 |
| 5 | `lib/harness/tools.ts` report.compose markdown | **干净** | 段数/相对分均已对齐 |
| 6 | `lib/harness/runner.ts` 错误信息、notes、skill 事件 | **干净** | actor 映射表八项与本地一致；事件文案已业务化 |
| 7 | `lib/harness/memory.ts` 画像描述 | **干净** | 上轮已去「近 30 日 N 次」 |
| 8 | `lib/simulation.ts` 审计条目／explanationFactors／合规 detail／宏观微观沟通方案 | **干净（1 处死文案）** | 审计 8 条与界面同口径；`explanationFactors` 标签已改「行情跌幅/客户怕亏程度/…」；**唯一问题**：`:1136-1138` 的 `strategySearch.note` 含「净效用／锚点／Policy Gateway」，但 UI 未渲染（见提示-1） |
| 9 | `lib/compliance/rules.ts` 规则标题与建议 | **干净** | 「确定性判断」属合规规范用语，保留正确 |
| 10 | `lib/compliance/review.ts` detail 模板 | **干净** | 仅在注释里出现「留痕」 |
| 11 | `lib/baselines/compare.ts` 对照模式说明 | **干净** | `modeLabels` 已业务化 |
| 12 | `lib/client/run-task.ts` 前端提示 | **干净** | 仅注释里出现「聚合签名」 |
| 13 | `app/api/**` 错误响应 | **基本干净** | `health` 返回 `service: 'ClientSim Harness'`（接口字段，非界面） |
| 14 | **`components/sandbox-app.tsx:537-572` 客户端导出报告** | **✗ 有问题** | 见重要-1 |
| 15 | **`components/sandbox-app.tsx:352` defaultedFields 渲染** | **✗ 有问题** | 见重要-2 |
| 16 | `scripts/` 脚本输出 | **不属用户可见**，但有一处流入材料 | `sweep-strategies.ts`／`eval-plan.ts` 是开发者工具；`benchmark.ts:431,437` 的「峰值时间步／每步小时」会写进 `artifacts/metrics/latest.md` |
| 17 | README 与 `artifacts/` 材料 | **有意保留专业术语** | 见第四节判断 |

---

## 二、重要（2 条）

### 重要-1　导出报告有两份实现，客户端那份仍有旧术语与英文字段名

**位置**：`components/sandbox-app.tsx:537-572`（`downloadReport`）

**问题一：报告正文有一整行英文字段名**（`:544`）

```
'场景参数：marketShock=' + result.scenario.marketShock + '，durationHours=' + … + '，customerCount=' + … + '，timeSteps=' + … + '，seed=' + …
```

这是**用户下载后打开报告看到的第一屏**，等于把内部变量名直接写进了交付文件。

**问题二：旧术语仍在**（`:545`）

```
'每步粒度：' + result.scenarioMeta.stepHours.toFixed(2) + ' 小时',
```

服务端那份本轮已改成「推演段数／每段」，客户端这份没跟上。

**其余部分已对齐**（可作为参考）：`:550` 综合推荐度用 `scores.of(...)` 相对分 ✓；`:547` 「客户筛选条件」✓；`:563-565` 「结果指纹／复现校验／分层对比」✓；`:567` **免责声明保留** ✓（安全信息未被削弱）。

**为什么这是第三类「两份实现」**：服务端 `report.compose`（`lib/harness/tools.ts:288-300`）产出的 markdown 走 `/api/reports/{id}`；客户端 `downloadReport` 产出的 txt 走「导出报告」按钮。**两者是同一份报告的两种实现**，本次只修了服务端那份。

**建议**：把客户端 `downloadReport` 改为直接使用服务端返回的 `reportMarkdown`（`outcome`/任务结果里已有），删掉这份客户端实现；这样从根上消除第三处重复来源。若因离线兜底必须保留本地生成，则至少把 `:544` 改成中文标签（`跌幅 10%、持续 24 小时、300 名客户、10 段推演、随机种子 …`）、`:545` 改「推演段数」。

### 重要-2　界面显示英文字段键名，而中文映射已存在却未被引用

**位置**：`components/sandbox-app.tsx:352`

```
{runState.defaultedFields.length > 0 && <p …>未识别的参数已使用默认值：{runState.defaultedFields.join('、')}</p>}
```

`defaultedFields` 存放的是 `ScenarioField` 键（`marketShock`、`durationHours`、`customerCount`、`timeSteps`、`seed`、`targetSegment`），所以这句会渲染成：

```
未识别的参数已使用默认值：marketShock、durationHours
```

**而 `lib/scenario.ts:52` 已经定义了现成的中文映射 `scenarioFieldLabels`**（`marketShock: '市场跌幅'` 等）——我全仓检索后确认：**这个映射从未被任何地方引用**。这是典型的「有现成实现但没接上」，与本轮修掉的 `toolRegistry` 重复来源同类。

**影响**：用户在「未识别的参数」这条提示里看到英文变量名，恰恰是提示信息最需要说人话的位置。

**建议**：`:352` 改为 `runState.defaultedFields.map((f) => scenarioFieldLabels[f] ?? f).join('、')`。

---

## 三、提示（3 条，不阻断）

**提示-1　`lib/simulation.ts:1136-1138` 的 `strategySearch.note` 是含旧术语的死文案。** 内容为「搜索最优组合的**净效用** X 高于推荐**锚点**…未经 **Policy Gateway** 审查…」，但 `components/sandbox-app.tsx:619` 只渲染 `title`/`hint`/表格，`note` 未被渲染（API 会返回）。属死文案，与 `toolRegistry` 同类，建议顺手改成与界面一致的说法或直接删掉。

**提示-2　`components/sandbox-app.tsx:428` 表头仍写「原型」。** 其余各处（规划器 intent、审计、客户情况速览）已统一为「客户画像」，只有这个列头没跟上。

**提示-3　`lib/scenario.ts:43` 注释仍有「客群口径」**（代码注释，非用户可见，可留）；`:56` 的 `timeSteps: '时间步'` 在 `scenarioFieldLabels` 里，该映射目前无人引用——修重要-2 时请把它改成「推演段数」，否则接上映射反而会把这个旧词带进界面。

---

## 四、README 与 artifacts 是否算「用户可见文字」

**我的判断：算，但要分类处理，不建议把界面词汇强行搬到材料里。**

- 现状：README 与 `artifacts/*.md` 里保留了 `净效用 / 避险收益 / 触达成本 / 唤醒 / 聚合签名 / Harness / Reflector / 口径 / 留痕 / 时间步 / 原型` 等术语（命中 40+ 处）。
- **这本身不是缺陷**：这批材料面向评委与团队自己，保留专业词汇更能体现技术深度，而且 `指标证据表 5.x`、`PPT提纲` 里的术语讨论是必要的。
- **但会产生一个新问题**：评委读完 README 里的「净效用 = 避险收益 − 触达成本 − 唤醒成本」，再打开界面却只看到「综合推荐度 = 风险改善 − 人力成本 − 打扰代价」，两边对不上。
- **建议（一处即可解决）**：在 README 的术语出现处加一张 5 行的对照表——「界面用词 ↔ 材料用词」（净效用＝综合推荐度、避险收益＝风险改善、触达成本＝人力成本、唤醒成本＝打扰代价、时间步＝推演段）。这比把材料全部改写更省事，也更适合两类读者。
- 另：`artifacts/metrics/latest.md` 由 `scripts/benchmark.ts:431,437` 生成，含「峰值时间步／每步小时」——该文件是自动产物，建议在脚本里改词，而不是手工改产物。

---

## 五、`.tmp/` 与 `artifacts/screenshots-ui/` 是否该纳入版本管理

**`artifacts/screenshots-ui/`：应该提交（已提交，正确）。** 它是初赛材料与决赛展示的组成部分，属于交付物；9 张 PNG 体积可控。建议顺带在材料索引里引用，否则它只是躺在仓库里。

**`.tmp/`：不应提交。** 它放的是构建与验证的中间产物（`run.mjs` 产出的 `.mjs`、`build-docx.py`、`ui-text.txt`），属可再生文件，已在 `.gitignore` 中，保持忽略正确。

**但有两类例外值得单独处理：**
1. **分析/验收脚本**（如早前的 `calib.ts`、`diag.ts`、以及 `sweep-strategies.ts`）——这些有长期价值。`sweep-strategies.ts` 已在 `scripts/` 并入库 ✓；若今后再写同类脚本，请直接放 `scripts/`，不要放 `.tmp/`。
2. **验收证据**（如 `ui-text.txt`）——它记录了「界面实际渲染文字」，是复查依据。建议需要留档时把它复制到 `artifacts/audit/`（与审计报告同目录），而不是留在 `.tmp/`。

---

## 六、落地顺序

| 顺序 | 事项 | 改动量 |
|---|---|---|
| 1 | 重要-1：`downloadReport` 改用服务端 `reportMarkdown`（或至少修 `:544` 英文键名与 `:545` 每步粒度） | 改用约 10 行删除；最修约 2 行 |
| 2 | 重要-2：`:352` 用 `scenarioFieldLabels` 映射，并同步把该映射里的「时间步」改「推演段数」 | 2 行 |
| 3 | 提示-1：`simulation.ts:1136-1138` 死文案改词或删除 | 3 行 |
| 4 | 提示-2：`:428` 表头「原型」→「客户画像」 | 1 行 |
| 5 | README 加 5 行「界面用词 ↔ 材料用词」对照表 | 5 行 |
| 6 | `scripts/benchmark.ts:431,437` 输出改词 | 2 行 |

第 1、2 项做完，才谈得上收口——它们都是「文字在用户手里」的位置，比界面里的残留更要紧。

> 本轮结论基于提交 `8efdeeb` 与全仓扫描（20 个旧术语 × 全部可能产生用户可见文字的文件）。未改动被审核项目的任何文件。
