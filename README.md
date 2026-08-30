# 证券客户行为沙盘

面向券商客户经营团队的策略预演工作台。系统通过确定性数值模型模拟暴跌行情下 300—1000 名合成客户的个体心理、从众行为和情绪传播，并对三套沟通策略进行效果与合规比较。

## 当前已实现

- 智能任务中心：自然语言目标、结构化执行计划、工具状态和审计轨迹。
- 客户洞察中心：五类客户原型、六项心理参数、持仓回撤与干预优先级。
- 群体行为沙盘：固定随机种子、10—20 个时间步、传播网络、动态指标与回放。
- 策略与审计中心：三套策略排名、禁止性表达检查、适当性提示和文本报告导出。
- 服务接口：任务、SSE 状态、模拟、时间步、客户、合规检查、报告和健康检查。
- 持久化：D1/SQLite 兼容结构，保存任务、模拟摘要与审计事件。

## 技术结构

- 前端：React 19、TypeScript、Tailwind CSS、shadcn/ui、Recharts。
- 服务端：Vinext API Routes，部署于 Cloudflare Workers。
- 数据：Cloudflare D1；表结构使用 Drizzle 定义。
- 模拟：浏览器和服务端均可运行的确定性 TypeScript 数值引擎。

当前托管版本使用平台数据库与异步能力，以便快速演示。`/api/*` 接口保持清晰边界，后续可将实现替换为 FastAPI + PostgreSQL/pgvector + Redis/RQ，而不改变前端业务流程。

## 本地运行

```bash
npm install
npm run dev
```

访问 `http://localhost:3000`。首次启动会自动创建本地 D1 数据表。

## 构建与校验

```bash
npm run lint
npm run build
```

## 主要接口

- `GET /api/health`
- `POST /api/tasks`
- `GET /api/tasks/{id}/events`
- `POST /api/simulations`
- `GET /api/simulations/{id}`
- `GET /api/simulations/{id}/snapshots`
- `POST /api/compliance/check`
- `GET /api/customers/{id}`
- `GET /api/reports/{id}`

## 数据边界

当前所有客户均为合成且脱敏的演示数据；结果用于策略压力测试，不构成投资建议，也不代表真实客户预测准确率。系统不触达真实客户、不执行交易，高风险策略必须经过人工审批。
