# AUDIT-ASKDATA-ROUND3 — 取数 Agent 第三轮只读复核

审计子智能体（只读）。除本文件外未修改、创建、删除任何文件；未运行 vitest / lint / tsc / build（会写缓存与产物），改为用独立 tsx 探针直接调用围栏与规划器复现每一条断言与预期。

**本轮结论：不能判「通过」。** 有两条阻断级问题：
- **R3-1（本轮新引入）**：外层 LIMIT 收敛用 `stripped` 的下标去切原 SQL，遇到字符串字面量就切错位置，生成**语法损坏的 SQL**，而围栏仍返回 `passed=true`；其中一个变体会把上限从 1000 静默放大成 10000。
- **R3-2（同类未修完）**：`户均/人均` 遇到 `fixed` 型 SUM/COUNT 指标时跳过除法，静默给出偏大 500–1000 倍的数字——这正是「会主动输出错误数字」这一类。

其余 N1、N3、N4、N5、N6、B2 与材料口径均已修好或对齐。

---

## 一、快照与前提

快照时刻 2026-09-19 19:09（Asia/Shanghai）。SHA256 前 12 位：

| 文件 | 哈希 | 最后写入 |
|---|---|---|
| lib/analytics/guardrail.ts | 408761914725 | 19:05:53 |
| lib/analytics/planner.ts | 005C9F429477 | 19:05:34 |
| lib/analytics/agent.ts | 0A53DAF66EC6 | 19:05:04 |
| lib/analytics/guardrail.negative.test.ts | 083C844C3132 | 19:06:27 |
| lib/analytics/planner.test.ts | BF0975E0F475 | **19:08:11（审计期间在变）** |
| lib/harness/tools.ts | BC43ED20BAF3 | 19:06:47 |
| lib/analytics/tools.ts | 352E988DB767 | 18:51:05（未变，仍是唯一定义源） |
| scripts/eval-ask.ts | EC0595FC1B21 | 19:07:21 |
| README.md / artifacts/指标证据表.md / scripts/build-docx.py | 4DDA3D19AB9C / F9B7C32515DB / BB912E664063 | 19:06:58 |

guardrail.ts 与 planner.ts 在本轮复核期间没有再变，因此第三节所有实测结论都对应这两个哈希。`planner.test.ts` 在 19:08:11 仍在增加用例（我两次计数得到 133 → 135），测试数字本身还在动。

**前提**：仓库仍只有 `.env.example`，无 `.env.local` → 模型路径依旧未实测，本报告全部针对规则路径。实测环境为内存 SQLite + `lib/analytics/seed.ts` 的同一套 DDL 与合成数据（1000 客户 / seed 20260830）。

---

## 二、结论摘要

| 项 | 结论 | 关键证据 |
|---|---|---|
| N1 域外词表 | **已修复**（附 1 条误伤） | 边界集 12/12；我 8 条独立探针 8/8；但 channel 取值「电话」被误拒 |
| N2 CTE 限定符 | **已修复** | 两 CTE 互连、CTE 名限定引用均放行 |
| N3 派生表别名 | **已修复** | 3 条派生表用例放行，6 条括号对照用例无误判 |
| N4 输出别名 | **已修复** | `AS hold_value` / `AS amount` 放行，跨表幻觉仍拦 |
| N5 同名工具 | **已修复** | harness/tools.ts:339-341 由 analyticsTools 派生 |
| N6 锚点缓存 | **已修复** | 同进程 300 → 1000 两库，第二条不再假报 G-RES-07 |
| B2 残余 | **部分修复 + 新引入 R3-1** | 无字面量时正确收敛；有字面量时切坏 SQL |
| 户均/人均（N1 同类） | **部分修复 + R3-2** | 持仓市值/成本/总资产已修；日均资产/净流入/交易金额仍差 500–1000 倍 |
| 材料 4 处 | **已修复**（剩 1 处数字对不上） | 20 条规则 ✓、135 项 ✓、12/12 ✓、可执行名单已删 ✓、表 2 SEM 已拆 ✓；「25 条负例断言」无法复现 |

---

## 三、逐条核验

### N1 域外词表 → 已修复（附 1 条误伤）

- 实现：`planner.ts:110-113` 的 `outOfDomainTerms`，`planner.ts:300-301` 用 `lowered.includes(term)` 命中即 `return null`（小写化后比较，所以「KPI」大写也拦得住）。
- 兜底同时被收紧：`planner.ts:312` 现在要求问题里同时出现"多少/几/数量/总数/统计/一共有"**和**"客户/人数"才允许回退到客户数，否则直接拒答。
- 实测：边界集 **12/12 = 100%**（ROUND2 是 10/12）；ROUND2 那两条（b09 客户满意度、b12 近一周的投诉客户）现在都正确拒答。
- **我 ROUND2 的 8 条独立探针：全部通过（8/8）**，而且期望值是我自己写 SQL 独立算的，与主智能体给出的四个数字完全一致：

| 问法 | 我的独立期望 | 规划器实际 | 判定 |
|---|---|---|---|
| 我们有多少位客户 | 1000 | 1000 | 通过 |
| R5 产品的持仓市值合计 | 1,998,222,824 | 1,998,222,824 | 通过 |
| C3 客户里有多少人持有纯债优选 | 28 | 28 | 通过 |
| 户均持仓市值是多少 | 8,066,582.41 | 8,066,582.41 | 通过 |
| 持有 3 只以上产品的客户有多少人 | 504 | 504 | 通过 |
| 开户超过 10 年的客户有多少 | 48 | 48 | 通过 |
| 近 90 日有交易且有资金流入的客户有多少人 | 140 | 140 | 通过 |
| 有多少客户投诉了 | 拒答 | 拒答 | 通过 |

- **误伤 1 例（一般）**：「主要服务渠道是电话的客户有多少人」被拒答，而 `cust_info.channel` 的取值域就是 `App / 电话 / 线下`（`dim_common` 里也登记了 `电话`），数据里真实存在 **327 名** channel='电话' 的客户。也就是说「电话」既是域外主题词表里的词，又是九张表里的合法字段取值。
  - 修复方向：把 `'电话'` 从词表里换成更精确的 `'电话号'/'手机号'/'联系方式'`；或改成"命中词表 **且** 该词不在任何已登记字段的取值域内"才拒答。
  - 影响面：小（只会拒答这一种问法，不会给错数字），但它属于"该答的没答"。

### N2 CTE 限定符 → 已修复

- 实现：`guardrail.ts:207` 把 `cteNames` 收进 `opaqueAliases`，`guardrail.ts:214` 在带前缀校验里 `continue` 跳过；`guardrail.ts:106` 的正则改为 `(?:WITH\b|,)`，解决"第二个 CTE 抽不到"。
- 实测：
  - `WITH a AS (...), b AS (...) SELECT COUNT(*) AS n FROM a JOIN b ON a.cust_id = b.cust_id LIMIT 5` → **放行**（ROUND2 是 G-SEM-05 + G-SEM-03 双拦截）；
  - `WITH holdings AS (SELECT * FROM cust_holding) SELECT holdings.market_value FROM holdings LIMIT 5` → **放行**（ROUND2 被误拦）；
  - 对照：`SELECT c.market_value FROM cust_info c LIMIT 10` 仍然拦截 G-SEM-05（能力没有退化）。

### N3 派生表别名 → 已修复

- 实现：`guardrail.ts:98-102` 的 `extractDerivedAliases`，`guardrail.ts:207` 收进 `opaqueAliases`、`guardrail.ts:269` 收进 `knownIdentifiers`。
- 实测：`SELECT t.n FROM (SELECT COUNT(*) AS n FROM cust_info) t LIMIT 5`、`SELECT s.branch, s.n FROM (...) s LIMIT 5`、`... FROM (...) a JOIN (...) b LIMIT 5` 三条全部**放行**（ROUND2 全部被 G-SEM-05 + G-SEM-03 拦截）。
- **误判排查**：我在 6 条含括号的普通 SQL 上验证捕获结果不会误伤——`WHERE (age > 30) AND ...`（捕获到 `AND`，被 allowedFunctions 过滤）、`HAVING (COUNT(*) > 100)`（`)` 后无词）、`WHERE (a) OR (b)`（`OR` 被过滤）、`SUM(x) AS 持仓市值`（中文不匹配）、`(age + 1) AS age_plus`、`IN (SELECT ...) AND (age > 20)` → **6 条全部放行，无误拦**。
- 方向性说明：`extractDerivedAliases` 只会把捕获到的词**加进**白名单（放宽），因此它带来的风险方向是"多放行"而不是"误拦"。理论上若某个被捕获的词恰好被当作限定符前缀，可以让一条幻觉引用溜过 G-SEM-05；我没有构造出实际可复现的用例，仅作提示。

### N4 输出别名 → 已修复

- 实现：`guardrail.ts:235-237` 抽出 `AS <name>`，`guardrail.ts:248` 在 G-SEM-06 的候选集里排除。
- 实测：`SELECT SUM(h.market_value) AS hold_value FROM cust_info c JOIN cust_holding h ...` → **放行**；`AS amount` → **放行**；对照 `SELECT gender, market_value FROM cust_info LIMIT 10` 仍拦截 G-SEM-06、`SELECT c.market_value FROM cust_info c` 仍拦截 G-SEM-05 —— 收紧的那一侧没有松掉。

### N5 同名工具 → 已修复

- 实现：`lib/harness/tools.ts:17` `import { analyticsTools } from '../analytics/tools'`，`:339-341` 用 `Object.fromEntries(analyticsTools.map(...))` 生成五个工具，`title` 取 `tool.title`、`intent` 取 `tool.description`、参数由 `tool.name` 分派（`:351-353`）。
- 核对：`lib/analytics/tools.ts` 的哈希仍是 18:51:05 的 352E988DB767（未再改），标题/说明现在只有一份来源。ROUND2 提到的"查看可用的数据表 vs 查看可用数据表"这类分叉不会再出现。

### N6 锚点缓存 → 已修复

- 实现：`agent.ts` 已删除模块级 `cachedCustomerCount`，改为每次问答实时查询。
- 实测（同一进程内两个库）：
  - 库1（300 客户）问「客户总数是多少」→ `{"客户数":300}`，结果层无提醒；
  - 库2（1000 客户）问同一问题 → `{"客户数":1000}`，结果层**无提醒**。
  ROUND2 在同一场景下会报出假的 G-RES-07「客户数=1000，全库只有 300」，现已消失。

### B2 残余 → 部分修复 + 新引入（见 R3-1）

- 实现意图：`guardrail.ts:148` 用 `totalLimitMatch`（顶层 LIMIT）判断是否超限，`guardrail.ts:151-156` 的 `clampTopLevelLimit()` 取**最后一次**出现的 LIMIT 做替换，`:165-171` 顶层无 LIMIT 但子查询有 → G-STRUCT-06 补全，`:172-178` 都没有 → G-STRUCT-05 补全。
- **正确的情况**：
  - `SELECT * FROM cust_info LIMIT 5000` → `LIMIT 1000` ✓
  - `SELECT * FROM cust_info WHERE cust_id IN (SELECT cust_id FROM cust_trade LIMIT 5) LIMIT 5000` → 内层 `LIMIT 5` 保留、外层改为 `LIMIT 1000` ✓（"多个 LIMIT 选最后一次"在无字面量时定位正确）
  - 顶层无 LIMIT + 子查询有 → G-STRUCT-06 + 外层补 1000 ✓
- **坏掉的情况**：见 R3-1。

### 户均 / 人均（与 N1 同类） → 部分修复（见 R3-2）

已修好的（我用自己的 SQL 独立算期望值）：户均持仓市值 8,066,582.41 ✓、户均持仓成本 9,357,818.96 ✓、户均总资产 11,780,575.94 ✓。
仍未修的：见 R3-2。

---

## 四、阻断级

### R3-1（本轮新引入）外层 LIMIT 收敛会切坏 SQL

**证据**：`guardrail.ts:151-156`

```
const clampTopLevelLimit = () => {
  const matches = [...stripped.matchAll(/\bLIMIT\s+(\d+)\b/gi)];
  const last = matches[matches.length - 1];
  ...
  return sql.slice(0, last.index) + `LIMIT ${guardrailMaxRows}` + sql.slice(last.index + last[0].length);
};
```

下标 `last.index` 来自 **stripped**（字符串字面量已被替换成 `''`，长度变短），切分却作用在 **sql** 上。只要 LIMIT 前面出现过字符串字面量，下标就会偏小，切点落在字面量中间。

**实测**（`inspectSql` 全部返回 `passed=true`，即调用方会直接执行 `normalizedSql`）：

| 原 SQL | 规范化结果 |
|---|---|
| `SELECT * FROM cust_info LIMIT 5000` | `SELECT * FROM cust_info LIMIT 1000`（正确） |
| `SELECT * FROM cust_info WHERE branch = '南京鼓楼营业部' LIMIT 5000` | `SELECT * FROM cust_info WHERE branch = '南京LIMIT 1000IT 5000`（引号未闭合，语法错） |
| `SELECT * FROM cust_info WHERE cust_tag = '高净值客户' LIMIT 5000` | `SELECT * FROM cust_info WHERE cust_tag = '高净LIMIT 1000 5000`（语法错） |
| `SELECT * FROM cust_info WHERE cust_tag = 'X' LIMIT 5000` | `SELECT * FROM cust_info WHERE cust_tag = 'X'LIMIT 10000`（**语法合法，但上限被放大 10 倍**） |
| `SELECT * FROM cust_info WHERE branch = '南京鼓楼营业部' AND cust_id IN (SELECT cust_id FROM cust_trade LIMIT 5) LIMIT 5000` | `... cust_id IN (SELECT cust_id FROM cust_trade LILIMIT 1000IT 5000`（语法错） |

**影响**：
1. 大部分情况会执行失败 → 模型路径被误判为不可用并降级（白降级，直接压低准确率）；
2. `'X'` 这种短字面量会把 `LIMIT 5000` 变成 `LIMIT 10000`——**结构层的行数上限被静默放大**，而围栏报 `passed=true`。这违反了赛题"表、指标、结果的合法性验证"里最硬的一条。
3. 这是本轮新引入的：ROUND2 的版本用的是 `sql.replace(/LIMIT\s+\d+/i, ...)`，虽然收敛对象选错（选到子查询的 LIMIT）但**不会破坏 SQL**。

**修复方向**：`clampTopLevelLimit` 必须在**原 sql** 上定位，例如对 `sql` 自身跑 `/LIMIT\s+\d+/gi` 取最后一次匹配（`topLevel(sql)` 只用于"是否存在顶层 LIMIT"的判断）；或者先算出 `stripLiterals` 造成的偏移量再映射回原串。绝不能用另一个串的下标去切原串。

### R3-2（同类未修完）户均/人均遇到 fixed 型指标会静默给出 500–1000 倍偏大的数字

**证据**：`planner.ts:328`

```
if (perCapita && metric.key !== 'per_capita_asset' && !metric.fixed) { ...做除法... }
```

`fixed` 的语义是"这个指标只有一种聚合写法"，但它被当成了"不能做人均除法"的判据。于是所有 **SUM/COUNT 型但带 `fixed`** 的指标都会跳过除法，直接返回合计。

**实测（期望值由我自己写 SQL 算出）**：

| 问法 | 我的独立期望 | 规划器实际 | 倍数 |
|---|---|---|---|
| 户均日均资产是多少 | 10,942,305.70 | 10,942,305,697 | 1000.0 |
| 人均日均资产是多少 | 10,942,305.70 | 10,942,305,697 | 1000.0 |
| 户均净流入是多少 | -226,008.72 | -215,160,299 | 952.0 |
| 户均交易金额是多少 | 18,314,923.54 | 16,813,099,811 | 918.0 |
| 户均近 90 日交易金额 | 6,705,981.16 | 3,902,881,033 | 582.0 |
| 人均持仓数量是多少 | 2.50 | 2,503 | 1001.2 |

（已修的对照组：户均持仓市值、户均持仓成本、户均总资产三条全部通过。）

**受影响的指标清单**（`planner.ts` 里带 `fixed` 且是 SUM/COUNT 型）：`net_inflow`（净流入）、`trade_amount`（交易金额）、`daily_asset`（日均资产）、以及 COUNT 型的 `holding_count` / `trade_count` / `flow_count` / `product_count` / `manager_count` / `customer_count`。（`per_capita_asset` 本身有人均语义，不受影响；`avg_age` / `profit_ratio` 是 AVG，除法无意义。）

**影响**：这是"会主动输出错误数字"这一类里目前唯一剩下的活路径，且触发词（户均/人均）是很自然的业务说法，返回的数字量级看起来也"像那么回事"（上千万），不带任何提示。它同时会被样本内语料漏掉——50 条语料里只有一条户均题，恰好落在已修的那一档。

**修复方向**：把"不做人均除法"从 `fixed` 拆成显式标记，例如给 `avg_age` / `profit_ratio` 打 `noPerCapita: true`（或反过来给 SUM/COUNT 型打 `perCapitaDividable: true`），让 `daily_asset` / `net_inflow` / `trade_amount` / 各 COUNT 指标都能真的除以客户数。若某些指标的"人均"语义本身有歧义（如"人均持仓数量"），宁可拒答也不要返回合计。

---

## 五、其它发现（一般）

**G1 「25 条负例断言」这个数字对不上**
`artifacts/指标证据表.md:191` 与 `scripts/build-docx.py:435` 写"25 条负例断言全部通过"。实测：`lib/analytics/guardrail.negative.test.ts` = **22 个 `it(` / 31 个 `expect(`**；新增的 `lib/analytics/planner.test.ts` = **11 个 `it(` / 22 个 `expect(`**。用"用例数"或"断言数"任一 `it(`/`expect(` 口径都凑不出 25。建议改成可复现的表述（例如"围栏负例 22 条用例、31 条断言；规划器行为 11 条用例、22 条断言"），否则会和 135 项总数一样被追问。

**G2 CTE 内的跨表幻觉字段仍可穿透，但已显式留痕**
`WITH x AS (SELECT market_value FROM cust_info) SELECT * FROM x LIMIT 5` → `passed=true`（`guardrail.ts:238` 在 `cteNames.length > 0` 时整体跳过无前缀字段的表归属校验）。本轮新增了 **G-SEM-07 提醒**（`guardrail.ts:256-262`）把这次跳过写进 findings 与审计，因此它已经从"静默放行"变成"已披露的限制"。
建议：要么接受并写进材料（作为围栏已知边界），要么把 CTE 内层单独抽出来做一次列校验（`WITH x AS (SELECT ...)` 的括号内其实可以按普通 SELECT 校验）。

**G3 `detailSubquery` 的类型守卫形同虚设**
`planner.ts:145-157`：`detailTimeColumn` 声明为 `Record<string, string>`，参数类型是 `keyof typeof detailTimeColumn`（结果是 `string`），所以传错表名不会被 TS 拦住；`planner.ts:154` 的 `if (column)` 会让缺失的时间列**静默不生效**（生成一条没有时间窗的查询）。当前三个调用点（`cust_trade` / `cust_holding` / `cust_cashflow`）都是合法键，**没有实际行为问题**，但这个守卫一旦有人写错表名就会变成"静默漏时间窗"。建议改成 `Record<'cust_trade' | 'cust_cashflow' | 'cust_holding', string>`（非可选）或显式抛错。

**G4 内层子查询的超限 LIMIT 不收敛**
`SELECT * FROM (SELECT * FROM cust_trade LIMIT 5000) LIMIT 10` → `passed=true`，内层 5000 原样保留（外层 10 行兜住了结果集，但不拦内层扫描量）。属低风险，记录备查。

---

## 六、回答主智能体的四个重点问题

1. **域外词表会不会误伤合法提问**：会，1 例——「电话」既是 channel 的合法取值（327 名客户），也在词表里。其余 21 个词与 25 个指标标签、9 张表名、11 条术语均无子串冲突。另外兜底已收紧为"必须同时出现数量词与'客户/人数'"，比 ROUND2 精确很多。
2. **`extractDerivedAliases` 的正则会不会把普通 SQL 的别名误判**：不会误**拦**。捕获结果只用于**放宽**白名单（`opaqueAliases` / `knownIdentifiers`）；6 条含括号的对照用例全部放行（`AND`/`OR` 等被 allowedFunctions 过滤）。理论上存在"多放行"的方向性风险，但我没能构造出可利用的用例。
3. **顶层 LIMIT 收敛在多个 LIMIT 时定位是否正确**：**不正确**，见 R3-1。`stripped` 下标切原串是根本原因；即使修好下标，"子查询在前 + 外层超限"这一组合也需要在真正的外层 LIMIT 上操作（当前 `clampTopLevelLimit` 取"最后一次出现"，无字面量时恰好等于外层，属于巧合而非保证）。
4. **`detailSubquery` 的类型绕过有没有实际行为问题**：当前没有（三个调用点都是合法键）；风险在于类型守卫无效 + 缺列时静默丢时间窗，见 G3。

---

## 七、当前"会主动输出错误数字"的路径清单

按严重度排列，这是我最关心的一类，逐条给出当前状态：

| # | 路径 | 状态 | 证据 |
|---|---|---|---|
| 1 | 户均/人均 + fixed 型 SUM/COUNT 指标 | **仍在** | R3-2，实测 582–1001 倍偏差，6 条实例 |
| 2 | 兜底把域外问题答成客户总数 | 已修复 | 边界集 12/12；`planner.ts:312` 收紧 |
| 3 | 户均 + 持仓市值/成本/总资产 | 已修复 | 8,066,582.41 / 9,357,818.96 / 11,780,575.94 全部吻合 |
| 4 | 持有 N 只以上被忽略 | 已修复 | 504 与我的独立期望一致 |
| 5 | 开户 N 年被忽略 | 已修复 | 48 与我的独立期望一致 |
| 6 | 有交易 / 有流入 条件被忽略 | 已修复 | 140 与我的独立期望一致 |
| 7 | 前 N 名按分组名排序 | 已修复 | 返回顺序与我的独立降序查询完全一致 |
| 8 | 「近 30 日的持仓市值」时间窗被静默忽略 | 未修（设计使然） | ROUND2 已记录；持仓表无历史快照，建议在返回体或界面注明"该口径未含时间窗" |
| 9 | 围栏把 LIMIT 切成 `LIMIT 10000` | **仍在（新）** | R3-1，`passed=true`，上限静默放大 10 倍 |

---

## 八、建议

1. **先修 R3-1**（半小时内可完成的定位修正），它同时影响模型路径可用性与"行数上限"这条硬边界。
2. **再修 R3-2**（把 `fixed` 与"可做人均除法"解耦），这是最后一类会主动给错数字的路径；修完建议在 `planner.test.ts` 里按本报告的 6 条问法补断言（现在的测试只覆盖了已修好的那一条户均问法，所以漏了这六个）。
3. G1 的数字改法、G2 的边界声明、G3 的类型收紧，可以放在同一批。
4. 材料侧：等 R3-1/R3-2 修完后重跑三档语料再定稿数字——目前 README/指标证据表/docx 里的 20 条规则、135 项、12/12 都与实现一致，只有"25 条负例断言"对不上。

> 本报告结论绑定第一节的哈希。修完 R3-1 / R3-2 后请告知新哈希，我重跑三档语料 + 本报告第七节的 9 条路径做收尾核验。
