# AUDIT-ASKDATA-ROUND2 — 取数 Agent 第二轮只读复核

审计子智能体（只读）。除本文件外未修改、创建、删除任何文件；未运行 vitest / lint / tsc / build（避免写缓存与产物），改为用独立 tsx 探针直接调用围栏与 Agent 函数复现每条断言。

---

## 一、快照与前提

快照时刻 2026-09-19 19:03（Asia/Shanghai）。SHA256 前 12 位：

| 文件 | 哈希 | 最后写入 |
|---|---|---|
| lib/analytics/guardrail.ts | 17107395E2F0 | 18:54:02 |
| lib/analytics/guardrail.negative.test.ts | 792513E7222D | 18:54:10 |
| lib/analytics/agent.ts | 875EE0278577 | 18:52:40 |
| lib/analytics/planner.ts | B06C0E730317 | 18:53:51 |
| lib/analytics/seed.ts | EBA9E996AF66 | 18:52:59 |
| lib/analytics/metadata.ts | 9BB4D9792FD3 | 18:52:59 |
| lib/analytics/tools.ts | 352E988DB767 | 18:51:05 |
| evals/ask-corpus.jsonl | F21B9D21D039 | 18:53:20 |
| evals/ask-heldout.jsonl | 2CFFDBFD52C7 | 18:52:59 |
| evals/ask-boundary.jsonl | 35C3E1689EE0 | 18:53:32 |
| scripts/eval-ask.ts | A648A60B5887 | 18:54:38 |
| README.md | 6B754C170052 | 18:59:40 |
| artifacts/指标证据表.md | 73383C92F112 | 18:59:40 |

19:00:33 与 19:03:20 两次取哈希完全一致，即代码与材料在本轮复核期间没有再变，下述实测都对应这一份快照。

**前提**：仓库仍只有 `.env.example`，无 `.env.local`，因此模型路径（llm）依旧未实测，全部结论针对规则路径。所有实测都在内存 SQLite 中，用 `lib/analytics/seed.ts` 的同一套 DDL 与合成数据（1000 客户 / seed 20260830）。

**一个必须记下的时间线**：语料 18:53:20 → 边界集 18:53:32 → 规划器 18:53:51。规划器是在三份语料全部定稿之后才最后一次修改的。这一点直接决定第 1 条的结论。

---

## 二、结论摘要

| # | 项 | 结论 |
|---|---|---|
| 1 | A1 准确率口径 | **部分修复**（披露到位、新增可失败指标；但留出集未冻结，且"2 条缺口"低估了缺陷范围，见 N1） |
| 2 | A2 列级校验 | **已修复**（10/10 用例符合预期） |
| 3 | A3 CTE | **部分修复 + 新引入**（正常 CTE 放行；但 CTE 名限定引用被误拦、CTE 内跨表幻觉可穿透） |
| 4 | A4 指标校验 | **已修复**（仅模型路径过校验，需在材料中限定表述） |
| 5 | B1 结果层 | **部分修复 + 新引入**（G-RES-06/07 生效；锚点缓存跨库污染，见 N6） |
| 6 | B2 子查询 LIMIT | **部分修复**（补全生效；"内层小 LIMIT 在前"时外层超限完全不触发） |
| 7 | B3 函数白名单 + C4 注释 | **已修复** |
| 8 | B6 接线 | **已修复 + 新引入**（路由/工具/界面齐备；同名工具两处定义，见 N5） |
| 9 | A5 口径 | **已修复**（高净值标签与阈值完全一致，对称差 0） |
| 10 | C3 / C5 / C8 | **已修复**（C5 附一条边界说明） |
| 11 | C7 测试 | **部分修复**（16 条新断言与实现一致；未覆盖本轮新出现的三类误拦） |

新引入问题 6 条（N1—N6），其中 N1/N2/N3 建议优先处理。

**最重要的一条独立证据**：我另写了 8 条**不在任何语料里**的问法做泛化探针，只有 3 条通过。语料上的 100% 与开放问法上的表现差距很大——这不是新问题，而是第 1 条"部分修复"的量化依据。

---

## 三、逐条核验

### 1. A1 准确率口径 → 部分修复

**已修复的**
- `evals/ask-boundary.jsonl`（12 条，`expect.kind='decline'`）与 eval-ask.ts 的判定分支（eval-ask.ts:124-125：`if (!actualSql) return { ok: true, reason: '已明确拒答并提示换问法' }`）。
- 我实测三档：样本内 **50/50**、留出集 **15/15**、边界集 **10/12 = 83.3%**，与主智能体所述及材料数字**完全一致**。两条失败正是 b09「客户满意度是多少」与 b12「近一周的投诉客户有多少」。
- 披露确实存在且措辞诚实：README:19、artifacts/指标证据表.md 第九节「口径说明」（第 196-199 行，含"样本内与留出集都是 100%，但两者仍在同一套自造语料体系内"）、scripts/build-docx.py:276（"不能外推为真实数据集上的准确率"）。

**未修复的**
- **留出集未冻结**：ask-heldout.jsonl 写于 18:52:59，planner.ts 最后修改 18:53:51 —— 留出集先定稿、规划器后改，因此 15/15 同样是"对着语料调过"的结果。
- **"2 条已知缺口"低估了缺陷范围**：那 2 条不是两个孤立的坏用例，而是同一条兜底规则的产物（见 N1）。我用 3 条新问法复现了同一类失败。
- 泛化能力未被任何独立集合度量（见下）。

**独立泛化探针**（我现写、不在任何语料、我不看规划器实现即可判定的问法）：

| 问法 | 期望 | 实际 | 结论 |
|---|---|---|---|
| 我们有多少位客户 | 1000 | 1000 | 通过 |
| R5 产品的持仓市值合计 | 1,998,222,824 | 1,998,222,824 | 通过 |
| C3 客户里有多少人持有纯债优选 | 28 | 28 | 通过 |
| 户均持仓市值是多少 | 8,066,582（人均） | 8,066,582,414（合计） | **差 1000 倍，且不报警** |
| 持有 3 只以上产品的客户有多少人 | 504（HAVING） | 1000 | **条件被静默忽略** |
| 有没有客户投诉了 | 拒答 | 1000 | **答非所问** |
| 开户超过 10 年的客户有多少 | 拒答 | 1000 | **答非所问** |
| 近 90 日有交易且有资金流入的客户有多少人 | 两个条件同时生效 | 1000 | **两个条件都被忽略** |

（我另设的一条对照值自己写错了：`各营业部的客户总资产` 我误填 `COUNT(*)`，实际生成的 `GROUP BY c.branch` 分组 SQL 是正确的，不计入失败。）

**结论**：披露层面已经做到位，指标层面有了会失败的集合（83.3%），这两点是真修复；但"100%"的成因（规划器与语料同轮迭代、留出集未冻结）没有消除，且独立探针 3/8 通过说明材料的限定语还可以再明确一句"该数字不代表开放问法的泛化能力"（指标证据表第 199 行已接近这个意思，建议提升为正文而非脚注）。

### 2. A2 列级校验 → 已修复

实现：`guardrail.ts:184-189` 建立"别名 → 表"映射，`guardrail.ts:192-211` 校验带前缀引用（G-SEM-05），`guardrail.ts:216-230` 校验无前缀字段（G-SEM-06）。

实测 10 个用例全部符合预期：

| 用例 | 期望 | 实测 |
|---|---|---|
| `SELECT gender, market_value FROM cust_info LIMIT 10` | 拦截 | 拦截 G-SEM-06 |
| `SELECT c.cust_id, c.market_value FROM cust_info c LIMIT 10` | 拦截 | 拦截 G-SEM-05 + G-SEM-06 |
| `SELECT h.market_value FROM cust_info c JOIN cust_holding h …` | 放行 | 放行 |
| 规划器典型多表查询（cust_tag 分组 + SUM(market_value)） | 放行 | 放行 |
| `WHERE cust_id IN (SELECT cust_id FROM cust_info …)` 子查询跨表 | 放行 | 放行 |
| 聚合别名 `AS 营业部 / AS 交易金额` | 放行 | 放行 |
| CASE 常量与中文别名 | 放行 | 放行 |
| 单表 prod_info | 放行 | 放行 |
| mgr_info + service_relation | 放行 | 放行 |
| cust_info + cust_holding + cust_asset 三表 | 放行 | 放行 |

上一轮"列白名单只用全表并集"的缺口已经真正补上。附带的两个副作用记在 N2/N4。

### 3. A3 CTE → 部分修复 + 新引入

**已修复**：`WITH x AS (SELECT cust_id FROM cust_info) SELECT COUNT(*) AS n FROM x LIMIT 5` 现在放行（`extractCteNames` 在 guardrail.ts:97-100，表白名单在 guardrail.ts:168-170 放行 CTE 名）。

**新引入 1（拦截缺口）**：`WITH x AS (SELECT market_value FROM cust_info) SELECT * FROM x LIMIT 5` → **passed=true**。
原因：guardrail.ts:216 的 `if (cteNames.length === 0)` 在存在 CTE 时整体跳过无前缀字段的表归属校验；而 `market_value` 又在全局并集白名单里（guardrail.ts:237），G-SEM-03 也不会报。**跨表幻觉字段可以用一层 CTE 洗白**。执行时会因 `no such column` 失败并降级，所以不是安全漏洞，但"列级校验"在这类写法上完全失效。

**新引入 2（误拦）**：`WITH holdings AS (SELECT * FROM cust_holding) SELECT holdings.market_value FROM holdings LIMIT 5` → **拦截 G-SEM-05**。
原因：guardrail.ts:185-189 的 `aliasToTable` 只登记物理表及其别名，`FROM holdings`（CTE）没有登记；guardrail.ts:197 的 `if (!owner) qualifiedBad.push(...)` 直接判为字段与表不匹配。CTE 名做限定符是最标准的 CTE 写法之一，模型只要这样写就被拦并降级。同类用例 `WITH a AS (...), b AS (...) SELECT ... FROM a JOIN b ON a.cust_id = b.cust_id` → G-SEM-05 + G-SEM-03 双拦截。

### 4. A4 指标校验 → 已修复

- 实现：`inspectMetrics`（guardrail.ts:266-283）把声明值同时比对注册表的 `name` 与 `label`。
- 实测：`inspectMetrics(["customer_count","客户数","持仓市值"])` → `[]`；`["客户满意度","NPS"]` → 1 条 G-SEM-04 拦截；`["nps_score"]` → 拦截；`[]` → `[]`。
- 接线：agent.ts:133 收集 → agent.ts:151-153 与 SQL 校验合并并计入 `guardrailPassed`，被拦即降级；agent.ts:224 把 `metrics` 放进返回体。
- 口径限定：指标校验只作用于**模型路径**（agent.ts:151 位于 `if (sql)` 分支内）；规则路径的 metrics 直接取自我们自己的注册表（agent.ts:181），不过校验。材料写"所有指标都过校验"会不准确，建议写"模型声明的指标必须已登记，未登记即拦截"。

### 5. B1 结果层 → 部分修复 + 新引入

- G-RES-06（guardrail.ts:329-335）：`持仓市值=1e15` → 触发；真实总资产 `2.18e10` → 不触发（无误报）。列名匹配已扩到中文（guardrail.ts:313）。
- G-RES-07（guardrail.ts:337-344）：`客户数=5000`、锚点 1000 → 触发；`1000/1000` → 不触发（正确，子集可以等于全量）；`1001/1000` → 触发；`交易笔数=99999` → 不触发（只匹配 `/客户数|人数/`）。
- 仍未做（已知）：结果层全部 finding 都是"提醒"，没有拦截分支；scripts/build-docx.py:260 已如实标注。
- 新引入：锚点来源有缺陷，见 N6。

### 6. B2 子查询 LIMIT → 部分修复

- 已修复：`SELECT cust_id FROM cust_info WHERE cust_id IN (SELECT cust_id FROM cust_trade LIMIT 5)` → 提醒 G-STRUCT-06，`normalizedSql` 末尾补上 `LIMIT 1000`（guardrail.ts:155-162）。
- `topLevel()`（guardrail.ts:75-83）实测边界正常：字面量里的 `LIMIT 5` 不被误认（补全到 1000）、`UNION` 无 LIMIT 会补全、平衡括号不误判。
- **残余缺口**：guardrail.ts:142 的 `anyLimitMatch` 取的是**文本里第一个** LIMIT，而"是否超限"的判断（guardrail.ts:149）用的就是它。实测：
  - `SELECT * FROM cust_info WHERE cust_id IN (SELECT cust_id FROM cust_trade LIMIT 5) LIMIT 5000` → **passed=true，无任何 finding**，外层 5000 既没收敛也没提醒；
  - 对照 `SELECT * FROM cust_trade LIMIT 5000` → 正确收敛到 1000。
  即"内层 LIMIT 出现在前"时，外层上限这条规则整体失效。修复方向：收敛判断用 `totalLimitMatch`（外层）而不是 `anyLimitMatch`。

### 7. B3 函数白名单 + C4 注释 → 已修复

- 12 个函数用例全部放行：LENGTH、UPPER、IFNULL、NULLIF+COALESCE、GROUP_CONCAT、CURRENT_DATE、datetime、`COUNT(*) OVER ()`、REPLACE、`ROW_NUMBER() OVER (PARTITION BY …)`、SUBSTR、PRINTF、strftime+julianday。
- `REPLACE(cust_name,'a','b')` 不再触发 G-STRUCT-03（forbiddenKeywords 已移除 REPLACE，guardrail.ts:47-52 有注释说明由"必须以 SELECT/WITH 开头"兜住）。
- 注释检测已改在去字面量后的版本上（guardrail.ts:132-138）：`LIKE '%--%'` 与 `LIKE '%/*%'` 均放行；真注释 `SELECT cust_id FROM cust_info -- 绕过 LIMIT 5` 仍被 G-STRUCT-04 拦截。

### 8. B6 接线 → 已修复 + 新引入

- 工具：`lib/harness/types.ts:25-29` 扩了 5 个 ToolName；`lib/harness/tools.ts:286-345` 注册了 metadata.tables / metadata.describe / metadata.metrics / metadata.glossary / analytics.ask；tools.ts:283-285 注明了它们与推演八步的关系。
- 路由：`app/api/analytics/ask/route.ts` 已改走 `askAnalytics`，响应 spread 出 sql / guardrail / mode / metrics（第 25-31 行）；`app/api/analytics/metadata/route.ts` 提供 JSON 与 `?format=markdown`；`app/api/analytics/review/route.ts` 写入 `analytics_reviews`，该表在 `lib/db-runtime.ts:52` 创建（已核对）。
- 界面：AskView 有五步文案（components/sandbox-app.tsx:510/516/522/528/536）、调用 `/api/analytics/ask`、渲染 guardrail findings，并有「用这批客户跑一次推演」按钮（第 658 行）；工具计数"13 项"（第 177 行）与 8+5 一致。
- 新引入：同名工具两处定义，见 N5。

### 9. A5 口径 → 已修复

- `seed.ts:121`：`cust_tag: highNetWorth ? '高净值客户' : '普通客户'`，不再让活跃/沉默抢占标签。
- 实测：`cust_tag='高净值客户'` **198** 人，`total_asset ≥ 1000万` **198** 人，**对称差 0**。
- `dim_common` 的 cust_tag 取值只剩 `["高净值客户","普通客户"]`，与字段语义一致。
- `metadata.ts:133-135` 把活跃/沉默改成派生口径，并新增「客群标签」条目说明"cust_info.cust_tag 只按总资产划分……活跃与沉默是派生口径，不体现在该字段里"；实测 活跃 918（近 90 日有交易）、沉默 54（无交易且无流入），与定义一致。
- **关于"planner 的活跃/沉默子查询是否与围栏的按表校验冲突"**：不冲突。我在三档语料 77 条上逐条检查了规划器生成的 SQL，被围栏拦截 0 条（其中包含 q05/q06/q39 这三条按新口径重写的活跃/沉默题）。

### 10. C3 / C5 / C8 → 已修复

- C3：`seed.ts:11` 参考日 `2026-09-18`。实测九表全部日期最大值 = 2026-09-18，晚于参考日 0 行、晚于今天（2026-09-19）0 行。
- C5：实测「近 30 日的交易金额和净流入」生成的 WHERE 同时含 `t.trade_date >= date('2026-09-18','-30 day')` 与 `f.flow_date >= date('2026-09-18','-30 day')`，且该 SQL 通过围栏。上一轮的 `else if` 问题已消除。
  - 附一条边界（不算缺陷，但建议在界面或返回体注明）：当问题带时间窗、但指标不涉及流水表时，生成 SQL 里**没有任何时间条件**，时间窗被静默忽略。实测「近 30 日的持仓市值」= 全量 `SUM(h.market_value)`，既不拒答也不提示。持仓表本身没有历史快照，这是设计使然，但"近 30 日"这四个字被丢掉时应当有一句说明。
- C8：`metadata.ts:114/118` 已登记 trade_count_180d 与 net_inflow_180d。

### 11. C7 测试 → 部分修复

- `lib/analytics/guardrail.negative.test.ts`（792513E7222D）含 **16 个 `it(`**，覆盖跨表幻觉字段（带前缀/不带前缀）、CTE 放行、子查询 LIMIT、字符串注释符、函数白名单、REPLACE、指标校验、结果层四例。
- 我不用 vitest，而是逐条把断言里的 SQL 直接喂给围栏函数复跑：**16 条的预期行为与实现一致**。
- 缺口（本轮新出现的误拦都没被覆盖）：缺 (a) CTE 名限定引用、(b) 派生表别名 `FROM (...) t`、(c) 输出别名与别的表列名撞名、(d) CTE 内跨表幻觉字段可穿透。建议各补一条断言，否则下一轮还会重复发现。
- `it(` 计数：simulation 37 + guardrail.negative 16 + guardrail 14 + review 13 + ask 12 + runner 12 + scenario 11 + compare 3 = **118**，与材料"118 项"一致（但通过与否我未独立验证，见第五节）。

---

## 四、新引入问题（建议单独排期）

### N1（重要）兜底规则会把"没登记的指标"当成客户数
- 现象：只要问题里出现"多少/几/数量/总数/统计/一共有"且没有任何已登记指标命中，规划器就回退到 `customer_count`，给出一个自信的客户总数。
- 实测（我现写的问法）：`有多少客户投诉了` → 返回 1000；`开户超过 10 年的客户有多少` → 返回 1000；`近 90 日有交易且有资金流入的客户有多少人` → 返回 1000（两个条件都被忽略）。加上边界集原有的 2 条，同一类失败已复现 **5 条**。
- 影响：这是唯一一类会**主动输出错误数字**的缺陷，直接打在"结果质量 30%"，也是材料诚实性的隐患——"2 条已知缺口"读起来像两个孤立用例，实际是一条兜底规则的系统性表现。
- 修复方向：回退前先要求问题里出现已登记实体（客户/产品/客户经理/持仓/交易/流水）与已登记指标；仍然识别不到时明确拒答。退一步的兜底做法：即使回退到客户数，也要在 `notes` 与界面标注"问题中的其它限定条件未被理解"。
- 材料修订建议：把"2 条已知缺口"改为"该缺口属于一条兜底规则，边界集命中 2 条；审计另复现 3 条同类"。

### N2（重要）CTE 名做限定符被误拦
- 证据：`guardrail.ts:185-189`（aliasToTable 只登记物理表与别名）+ `guardrail.ts:197`（owner 缺失即判不匹配）。实测 `WITH holdings AS (SELECT * FROM cust_holding) SELECT holdings.market_value FROM holdings LIMIT 5` → G-SEM-05 拦截。
- 修复方向：把 `cteNames` 以"CTE"身份登记进已知别名集合，命中 CTE 时跳过列校验（对应 guardrail.ts:202 已有的"CTE 的列无法校验，跳过"思路，只是没覆盖限定写法）。

### N3（重要）派生表别名被误拦
- 证据：`FROM (...)` 后面跟的别名既不在 aliasToTable（guardrail.ts:185-189）也不在 knownIdentifiers（guardrail.ts:234-240）。实测 `SELECT t.n FROM (SELECT COUNT(*) AS n FROM cust_info) t LIMIT 5` → G-SEM-05 + G-SEM-03 双拦截；`SELECT s.branch, s.n FROM (SELECT branch, COUNT(*) AS n FROM cust_info GROUP BY branch) s LIMIT 5` 同样被拦。
- 影响：`FROM (子查询) 别名` 是最常见的 SQL 写法之一。模型路径一旦接入，这类正确查询会被判为幻觉并降级，直接压低准确率。
- 修复方向：从 `\)\s+([A-Za-z_]\w*)` 抽取派生表别名，加入 aliasToTable（标记为子查询）与 knownIdentifiers。

### N4（一般）输出别名与其它表的列名撞名会被当幻觉字段
- 证据：G-SEM-06（guardrail.ts:216-230）只看 token 是否属于"本次查询用到的表"，不区分它是 `AS` 后面的输出别名。实测 `SELECT SUM(h.market_value) AS hold_value FROM cust_info c JOIN cust_holding h …` → 拦截 G-SEM-06（`hold_value` 是 cust_asset 的列）；`AS amount` → 同样拦截；`AS trade_date`（该表在查询里）→ 放行。
- 修复方向：把 `AS x` 抽出的别名从 G-SEM-06 的候选集中排除（guardrail.ts:239 已经在 knownIdentifiers 里做了这件事，G-SEM-06 没有复用）。

### N5（一般）同名工具两处定义
- 证据：`lib/analytics/tools.ts:46-100` 定义了 5 个工具（name/title/description/args/run），`lib/harness/tools.ts:286-345` 又定义了同名 5 个工具（name/title/intent/run）。标题已经不一致（"查看可用的数据表" vs "查看可用数据表"）。`/api/analytics/metadata` 读的是 analytics/tools.ts 的目录，Harness 用的是另一份。
- 影响：两份描述会独立漂移，界面展示的口径与 Harness 实际执行的工具可能不同——这正是过去几轮审计反复处理过的"同一件事多份实现"。
- 修复方向：保留 `lib/analytics/tools.ts` 作为唯一定义源，harness 侧 import 后适配 `HarnessTool` 形状。

### N6（一般）结果层锚点用了模块级缓存且无失效机制
- 证据：`agent.ts:81-89` 的 `cachedCustomerCount` 是模块级单值。实测同一进程内：先对 300 客户的库提问（锚点缓存 300），再对 1000 客户的默认库提同一问题 → 第二条返回 `客户数=1000`，并报出**假的** G-RES-07「客户数=1000，但全库只有 300 名客户」。
- 影响：单库部署不会触发；但评测脚本、单元测试、以及"换官方数据后 isolate 未回收"的窗口期都会给出错误锚点与假告警。
- 修复方向：锚点作为参数从调用方传入，或按 db 实例做 Map 缓存，避免模块级单值。

---

## 五、本轮仍未做 / 我未独立验证

**仍然未做（与主智能体自述一致，建议材料继续如实标注）**
- 模型路径未实测（无密钥）：所有准确率、延迟都来自规则路径。
- 结果层只提醒不拦截（`inspectResult` 无拦截分支）。
- 边界集 2 条失败仍在，且按 N1 属于一类缺口。
- 沙盘侧 Policy Gateway 未与取数围栏统一（两套规则各管一段；build-docx.py:260 已说明）。

**我未独立验证的**
- `npm test`（118 项）、`npm run lint`、`npx tsc --noEmit`、`npm run build` 我均未运行（只读约束会产生缓存与产物文件）。我只核对了 `it(` 计数 = 118 与材料一致，以及负例测试的 16 条断言与实现行为一致。
- 端到端延迟数字（首次 1112 ms、后续 7-9 ms）未独立验证，需要启动开发服务器才能复测。
- 首帧 / SSE 相关指标属于沙盘链路，本轮不在范围内。

---

## 六、材料口径核对

**与实现不符，需要改**
1. **README:18 与 scripts/build-docx.py:256 的"三层 16 条规则"**：guardrail.ts 实际有 **19 个唯一规则编号**（命令：`rg -o "G-(STRUCT|SEM|RES)-[0-9]{2}" lib/analytics/guardrail.ts | Sort-Object -Unique` → G-STRUCT-01..06、G-SEM-01..06、G-RES-01..07，6+6+7=19）。该数字在本轮重写后没有同步。→ **未修复**，应写 19。
2. **artifacts/指标证据表.md:191「6 类绕过与误报场景 12 条断言」**：guardrail.negative.test.ts 实际是 **16 个 `it(`**。→ 数字不符，建议改为 16 条（并补上 N2/N3/N4 三类后重算）。
3. **README:5「返回结果表格、口径解释与可执行名单」**：取数链路目前不产出名单——规则路径的 77 条语料查询全部是聚合，没有一条返回客户明细；而边界集 b04「给我一份可以打电话的名单」被设计为**应当拒答**。这条表述与实现和评测设计都不符。→ 建议删掉"与可执行名单"，或改为"客户名单由下游推演页的优先联系名单提供"。
4. **scripts/build-docx.py:243-253 表 2 的规则归属错位**：表中把 `G-SEM-03/05` 合成一行写成"字段必须属于本次查询用到的表……（带表前缀与不带表前缀两种写法分别校验）"，下一行又用 `G-SEM-06` 写"无表前缀的字段必须属于本次查询的表"，两行内容重复；而 G-SEM-03 的真实职责（全局白名单外的未登记字段或函数，guardrail.ts:241-252）在表里没有出现。→ 建议按实现重写这三行为：SEM-03 = 未登记字段/函数；SEM-05 = 带前缀的跨表引用；SEM-06 = 无前缀且属于其它表。

**核对通过的数字**
- 25 个指标（实测 `analyticsMetrics.length = 25`）、11 条业务术语（11）——与 build-docx.py:190 和 README:17 一致。
- 13 项工具（8 + 5）——与组件里"13 项"一致。
- 118 项测试——与 `it(` 计数一致。
- 三档语料条数与结果 50/15/12、100%/100%/83.3%——与我的独立实测逐一吻合；两名失败样本的命名也准确。
- 评测局限的表述（自造语料、样本内、官方问答对未发放、模型路径未跑）在三处材料中都存在，措辞比上一轮更保守。

**仍偏乐观但已有说明的**：指标证据表与申报书里的"100%"配合了足够的口径说明；不过建议把"不代表开放问法"从脚注提升到表格旁（依据见第三节第 1 条的独立探针）。

---

## 七、建议的下一轮顺序

1. **修 N1**（兜底给错答案）——唯一会主动输出错误数字的一类，同时影响结果质量与材料诚实性；并把材料里的"2 条已知缺口"改写为"一类规则缺口（边界集 2 条，审计另复现 3 条）"。
2. **修 N2 / N3 / N4**（三类误拦）——否则模型路径一接入，CTE 限定引用、派生表别名、与列名撞名的输出别名都会被判成幻觉并降级，端到端准确率会被这几类写法拖低。三条都在 guardrail.ts 内，改动集中。
3. **修 N6**（锚点缓存）——避免评测脚本与单元测试出现假告警。
4. **修 B2 残余**（外层 LIMIT 用 `totalLimitMatch` 判断）。
5. **改材料 4 处**（16→19、12 条断言→16、「可执行名单」、表 2 的 SEM 三行归属）。
6. **冻结下一版留出集**：planner 定稿后不再改动；最好请团队用与 planner 不同的措辞再补一份留出集，作为真正的泛化参照（本轮我自己的 8 条探针只有 3 条通过，说明这一项价值很高）。

> 本报告全部结论绑定第一节的快照哈希。若 guardrail.ts / planner.ts 已再次变更，请给出新哈希，我按新版本重核第三节与第四节。
