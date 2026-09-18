# 界面文案收口审计 · 最终核验

审核对象：提交 `14bfa05`
审核日期：2026-09-18

## 本轮通过

第七轮清单里的两处重要问题都已修好，且都是**结构性修复**而非改文案：导出报告改为优先取服务端 markdown、只保留一份回落模板；`scenarioFieldLabels` 已接上并同步改了映射内的旧词。全仓扫描 20 个旧术语，**用户可见的界面与报告文本中已无残留**（剩余命中全部在代码注释与开发者脚本里）。

另附你要的第 4 处重复实现（潜伏型，不阻断本轮）。

---

## 一、第七轮清单逐项状态（独立复核）

| # | 来源 | 第七轮状态 | 本轮实测 |
|---|---|---|---|
| 1 | `sandbox-app.tsx` 静态文案与 JSX 内插 | 剩 2 处 | **✓ 已清**：全仓术语扫描在 `components/` 下零命中（`原型`、`每步` 均无） |
| 2 | `planner.ts` canonicalSteps title/intent | 干净 | ✓ |
| 3 | `tools.ts` toolRegistry title/intent | 干净 | ✓（已由 `stepMeta()` 单源引用） |
| 4 | `tools.ts` 8 条工具 audit 文本 | 干净 | ✓ |
| 5 | `tools.ts` report.compose markdown | 干净 | ✓ |
| 6 | `runner.ts` 错误信息／notes／skill 事件 | 干净 | ✓ |
| 7 | `memory.ts` 画像描述 | 干净 | ✓ |
| 8 | `simulation.ts` 审计／explanationFactors／合规 detail／沟通方案 | 干净（1 处死文案） | **✓ 已清**：剩余命中全部是注释（`:137/181/194/218/251/268/323/329/332/349/351/353/767/784/786/790/841/870/1078/1079/1097`），无用户可见字符串 |
| 9 | `compliance/rules.ts` 规则标题与建议 | 干净 | ✓ |
| 10 | `compliance/review.ts` detail 模板 | 干净 | ✓ |
| 11 | `baselines/compare.ts` 对照模式说明 | 干净 | ✓ |
| 12 | `client/run-task.ts` 前端提示 | 干净 | ✓ |
| 13 | `app/api/**` 错误响应 | 基本干净 | ✓ |
| 14 | **`sandbox-app.tsx` 客户端导出报告** | **✗ 报告有两份实现** | **✓ 已修**：`downloadReport`（`:577-591`）改为 `fetch('/api/reports/{taskId}?format=markdown')`，失败才回落 `buildLocalReport()`。样例 `artifacts/screenshots-ui/导出报告-样例.txt` 首行为「# 客户群体行为压力预演报告」，全文无 `marketShock/timeSteps/每步/时间步/净效用/避险收益` |
| 15 | **`sandbox-app.tsx:352` defaultedFields** | **✗ 英文键名** | **✓ 已修**：已接 `scenarioFieldLabels`；映射内 `timeSteps: '时间步'` 也已改「推演段数」（两处一起改，避免了接上映射反而带出旧词） |
| 16 | `scripts/` 脚本输出 | `benchmark.ts` 有旧表头 | **✓ 已修**：表头改「每段小时／峰值所在段／推荐方案」；`sweep-strategies.ts` 输出仍有旧词（见提示-2） |
| 17 | README 与 `artifacts/` 材料 | 建议加对照表 | **✓ 已加** 7 行「界面用词 ↔ 材料用词 ↔ 含义」对照 |

**数据源已验证的关键点**：`lib/simulation.ts:474` 的注释「产品风险等级统一取自合规规则模块」，且 `:4` 确实从 `lib/compliance/rules.ts` 导入 `productRiskByProduct`——**这张表的两份实现此前已被合并**，不构成遗留问题。

---

## 二、你要找的第 4 处重复实现：`statusBySeverity` 是死表，且与在用的 `statusFor` 结论不一致

**位置**：
- `lib/compliance/rules.ts:25` 定义并导出 `statusBySeverity`
- `lib/compliance/review.ts:92` 另有一个本地 `statusFor(rule, severity)`

**证据一：`statusBySeverity` 没有任何引用方。** 全仓检索（排除测试与 node_modules）显示它只出现在自己的定义处。真正生效的是 `review.ts` 的 `statusFor`，被 `reviewCandidates` 与 `checkText` 调用。

**证据二：两者对 `required` 类规则给出不同答案，不是简单的重复，而是分叉。**

```
statusBySeverity（死表）：  notice → '通过'
statusFor（在用）：         notice + rule.kind === 'required' → '待审批'
                                     notice + 其他            → '通过'
```

受影响的是 `RISK-DISCLOSURE-01`（缺少风险揭示）、`RISK-DISCLOSURE-02`（缺少不承诺收益声明）、`HUMAN-ANCHORING-01`（缺少人工责任锚定）这三条 `notice + required` 规则：按死表应为「通过」，按在用的实现是「待审批」。

**为什么现在不是故障、但值得处理**：没人引用死表，所以界面表现正确。但任何人日后为了「消除重复」把 `review.ts` 改成调用导出的 `statusBySeverity`，这三条规则的状态会**静默从「待审批」变成「通过」**——正好是合规信息最不该出错的地方。这与前几轮的模式完全一致：**一份没人用、一份在用，而两份的语义已经分叉**。

**建议**：把 `statusFor` 的逻辑收进 `rules.ts`（保留 `kind === 'required'` 分支），删掉 `statusBySeverity`；或反过来让 `statusBySeverity` 变成接收 `kind` 的函数。无论哪种，只留一份。

---

## 三、剩余提示（均不阻断）

**提示-1　`buildLocalReport()` 的正文我未能实证。** `downloadReport` 的服务端分支我通过样例文件核实了；但回落模板只在「没有 taskId」时触发，样例走的是服务端路径，因此 `buildLocalReport()` 里的实际文字尚未被任何产物覆盖。你自述已把英文字段名与「每步」改掉，且全仓扫描在 `components/` 下已无相关命中，我倾向没问题——**建议补一次「未提交服务端任务时点导出报告」的验证**，10 秒即可闭合。

**提示-2　`scripts/sweep-strategies.ts` 的输出仍有旧词**（`:126` 聚合签名、`:168/195` 唤醒／触达成本、`:171` 关系边、`:172` 原型）。它和 `benchmark.ts` 同属验收脚本，`benchmark.ts` 本轮已改，这一份没有。这两个脚本的输出不进界面、只进终端与材料，**不属用户可见**，改不改都行；若要统一，按 `benchmark.ts` 的口径顺一遍即可。

**提示-3　代码注释里仍有旧词**（`simulation.ts` 20 余处、`review.ts:108`、`run-task.ts:47`、`scenario.ts:43`）。注释不是用户可见文本，**建议保留**——在注释里用「避险收益／Policy Gateway／聚合签名」这些精确定义反而便于维护者对照早期设计。

---

## 四、对照表与快照

- **README 用词对照表**：7 行、含「界面用词 ↔ 材料用词 ↔ 含义」，正是解决「评委读 README 找不到界面词汇」的最小做法 ✓
- **快照**：已改脚本后重跑，生成 09-18 快照并删除过期 09-17 ✓——符合「改脚本不改变产物」的原则

---

> 本轮结论基于提交 `14bfa05`、全仓 20 术语扫描、映射表引用统计与样例报告复核。未改动被审核项目的任何文件。
