# 证券客户行为沙盘 ClientSim Agent

面向券商客户经营团队的策略预演工作台。系统用确定性数值模型模拟暴跌行情下 50 至 1000 名合成客户的个体心理、从众行为与情绪传播，在策略真正触达客户之前给出群体反应预演、干预队列与合规审查结论。

参加 2026 华泰证券杯南京大学 AI+创新创意大赛，课题为"通用智能体赋能证券业务——应用场景探索与实践"。初赛只做一个主场景：暴跌行情客户群体压力测试。

## 能力边界

本项目把职责明确分成三类，这一点决定了系统能同时做到可复现与可审计。

**由大模型负责（可降级）**

- 自然语言业务目标的理解与任务规划
- 场景参数抽取（跌幅、持续时间、客户规模、时间步、随机种子），抽取结果必须通过 Schema 校验
- 候选沟通策略与话术的起草
- 结果解释与反思摘要

**由确定性数值引擎负责（不含模型调用）**

- 合成客户生成、五类原型与六项心理参数
- 三类关系网络与邻居情绪传播
- 逐时间步的个体行为演化，输出买入、持有、卖出、咨询、投诉、流失六类倾向
- 聚合指标、峰值暴露与干预优先级
- 同一场景与随机种子必然复现，输出聚合签名用于回归比对

**由合规硬边界负责（模型不可绕过）**

- 19 条合规规则的全文扫描与否定语境识别
- C1 至 C5 客户风险等级与产品风险等级的适当性矩阵
- 命中阻断级规则时强制改写或拦截该策略，并写入审计记录
- 规则版本与模型版本分开记录

模型不可用时系统进入规则模式或确定性降级，界面会显式标注当前执行模式，不会把规则结果包装成模型结果。

## 功能

- 智能任务中心：自然语言输入、真实 SSE 进度、结构化工具轨迹、执行概览、失败重试与取消。
- 客户洞察中心：按模拟期峰值暴露排序的高风险客户队列、六维性格雷达、个体行为时间轴、一人一策沟通建议与话术红线。
- 群体行为沙盘：三套策略结果对比、五类原型分群布局的传播网络回放、逐时间步聚合指标与六类行为倾向分布。
- 策略与审计：策略比较、合规发现清单（含命中片段与字符区间）、带真实时间戳的执行审计轨迹、报告导出。
- Skill 与审批：Reflector 生成的候选技能、指标快照、批准与拒绝、版本回滚；无审批在线学习关闭。
- 人工反馈：评分与备注，仅用于生成候选技能，不自动修改引擎参数。

## 技术结构

- 前端：React 19、TypeScript、Tailwind CSS、shadcn/ui、Recharts
- 服务端：Vinext API Routes，部署于 Cloudflare Workers
- 数据：Cloudflare D1 / SQLite 兼容结构，表结构用 Drizzle 定义
- 模拟：浏览器与服务端共用的确定性 TypeScript 数值引擎

## 本地运行

```bash
npm install
npm run dev
```

访问 http://localhost:3000，首次启动会自动创建本地数据表。

模型接入为 OpenAI 兼容接口，在 `.env.local` 中配置。未配置时系统进入规则模式，功能完整可用。

```
OPENAI_BASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=
MODEL_TIMEOUT_MS=20000
MODEL_MAX_RETRIES=1
```

密钥不进入代码仓库；部署环境使用平台密钥管理。

## 命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动本地开发服务器 |
| `npm run build` | 生产构建 |
| `npm start` | 以 Wrangler 运行构建产物 |
| `npm test` | 运行 52 项自动化回归测试 |
| `npm run lint` | 静态检查（oxlint） |
| `npx tsc --noEmit` | 类型检查 |
| `npm run metrics` | 生成指标快照到 artifacts/metrics/ |
| `npm run eval:plan` | 评测 20 个标准任务的规划与工具调用 |
| `npm run eval:compliance` | 评测 32 条标注合规语料 |

服务端实测需要开发服务器在运行：

```bash
BENCHMARK_BASE_URL=http://localhost:3000 npm run metrics
```

## 接口清单

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/health | 健康检查与当前执行模式 |
| POST | /api/tasks | 提交任务，返回 202 与 taskId |
| GET | /api/tasks | 任务列表 |
| GET | /api/tasks/{id} | 任务状态、计划与结果引用 |
| GET | /api/tasks/{id}/events | 任务事件流（SSE，15 秒心跳） |
| POST | /api/tasks/{id}/cancel | 取消任务，在步骤边界生效 |
| POST | /api/simulations | 同步执行一次模拟（调试用） |
| GET | /api/simulations/{id} | 模拟结果 |
| GET | /api/simulations/{id}/snapshots | 逐时间步聚合快照 |
| GET | /api/simulations/{id}/step-states | 逐客户状态（用于回放） |
| GET | /api/customers/{id} | 客户画像与事件 |
| POST | /api/compliance/check | 对任意文本执行同一套规则集 |
| GET | /api/reports/{id} | 结构化报告，可加 `?format=markdown` |
| GET | /api/skills | 技能列表 |
| POST | /api/skills/{id}/approve | 批准候选技能 |
| POST | /api/skills/{id}/reject | 拒绝候选技能 |
| POST | /api/skills/{id}/rollback | 回滚技能版本 |
| GET | /api/feedback | 人工反馈列表 |
| POST | /api/feedback | 提交评分、标签与备注 |

## 场景配置契约

自然语言任务会被解析并校验为结构化场景：

```json
{
  "marketShock": -0.10,
  "durationHours": 24,
  "customerCount": 300,
  "timeSteps": 10,
  "seed": 20260830,
  "targetSegment": "high_volatility_drawdown"
}
```

- 取值范围：跌幅 0.01 至 0.5、时长 1 至 168 小时、客户 50 至 1000、时间步 5 至 20。
- 抽取失败或缺失的字段使用显式默认值，并在界面提示 `defaultedFields`，不静默忽略用户输入。
- `targetSegment` 为真实筛选条件：高波动回撤客群要求持有高波动产品且回撤不低于 8%，命中不足时按回撤降序补足并在界面与审计中标注；`all_customers` 为对照组。
- 场景配置、模型版本、规则版本与随机种子写入审计轨迹与导出报告。

## 项目材料

| 文件 | 内容 |
| --- | --- |
| `初赛申报书-证券客户行为沙盘.docx` | 初赛申报书正文 |
| `artifacts/指标证据表.md` | 指标口径、样本量、阈值与复现命令 |
| `artifacts/演示脚本.md` | 3 至 5 分钟演示分镜与讲解词 |
| `artifacts/PPT提纲.md` | 决赛答辩 PPT 提纲与备答要点 |
| `artifacts/metrics/` | 自动生成的指标快照（JSON 与 Markdown） |
| `artifacts/diagrams/` | 系统架构、Agent Loop 时序、五层链路图 |
| `artifacts/screenshots/` | 五个核心界面截图 |
| `evals/tasks.jsonl` | 20 个标准业务任务 |
| `evals/compliance-corpus.jsonl` | 32 条标注合规语料 |

## 数据与合规声明

- 当前全部客户为合成且脱敏的演示数据，不包含任何真实客户信息，不宣称真实客户行为的预测准确率；指标用于说明系统行为的一致性与稳定性。
- 系统只输出分析、建议与模拟结果，不自动触达真实客户，不执行任何交易或产品申购动作；高风险动作必须经过人工审批。
- 不保存也不展示模型的原始思维链，界面只呈现因素权重、数据证据、规则命中与结构化执行轨迹。
- 无审批的在线学习处于关闭状态；人工反馈只用于生成候选技能，不会自动修改引擎参数或策略权重。
- 同一结构化场景与随机种子完全复现；调整市场跌幅会真实改变客户初始冲击、情绪传播、卖出与流失风险，而不只是改变界面文字。

## 后续路线

1. 官方数据集到位后，用真实分布校准客户画像与心理参数，并更新指标口径。
2. 增加产品推荐适当性预演作为第二个业务场景。
3. 扩展券商系统对接与多租户权限体系。
4. 视需要把服务端实现替换为 FastAPI + PostgreSQL/pgvector + Redis/RQ，`/api/*` 契约保持不变。
