'use client';

import { useState } from 'react';
import {
  Activity,
  BadgeCheck,
  BrainCircuit,
  CheckCircle2,
  ChevronRight,
  CircleUserRound,
  Clock3,
  Download,
  FileCheck2,
  FlaskConical,
  LayoutDashboard,
  LoaderCircle,
  Network,
  Pause,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
import {
  CartesianGrid,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from 'recharts';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  parseScenarioPrompt,
  scenarioLabel,
  type ScenarioConfig,
} from '@/lib/scenario';
import {
  percent,
  runSimulation,
  type Customer,
  type CustomerTimeState,
  type RelationshipEdge,
  type SimulationResult,
  type StrategyId,
} from '@/lib/simulation';

type View = 'tasks' | 'customers' | 'sandbox' | 'audit';

const nav = [
  { id: 'tasks' as const, label: '智能任务中心', icon: LayoutDashboard },
  { id: 'customers' as const, label: '客户洞察中心', icon: CircleUserRound },
  { id: 'sandbox' as const, label: '群体行为沙盘', icon: Network },
  { id: 'audit' as const, label: '策略与审计', icon: ShieldCheck },
];

const plan = [
  ['识别目标客户', '筛选持有高波动产品且近期回撤超过 8% 的客户'],
  ['构建行为画像', '聚合风险等级、心理参数与历史服务记忆'],
  ['生成候选策略', '形成不干预、统一提示、分群沟通三套方案'],
  ['运行群体模拟', '按结构化 ScenarioConfig 执行客户群体传播'],
  ['完成合规审查', '适当性、误导性表达与人工审批检查'],
] as const;

const chartConfig = {
  baseline: { label: '不主动沟通', color: '#94a3b8' },
  broadcast: { label: '统一风险提示', color: '#f59e0b' },
  segmented: { label: '分群差异化沟通', color: '#2563eb' },
} satisfies ChartConfig;

function AppShell({
  active,
  onNavigate,
  scenario,
  children,
}: {
  active: View;
  onNavigate: (view: View) => void;
  scenario: ScenarioConfig;
  children: React.ReactNode;
}) {
  const activeItem = nav.find((item) => item.id === active) ?? nav[0];
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen lg:grid-cols-[248px_minmax(0,1fr)]">
        <aside className="hidden border-r border-sidebar-border bg-sidebar px-4 py-5 lg:flex lg:flex-col">
          <button className="flex items-center gap-3 px-2 text-left" onClick={() => onNavigate('tasks')}>
            <div className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm">
              <BrainCircuit className="size-5" />
            </div>
            <div>
              <p className="font-heading text-sm font-semibold tracking-tight text-sidebar-foreground">证券客户行为沙盘</p>
              <p className="text-xs text-sidebar-foreground/55">ClientSim Agent</p>
            </div>
          </button>

          <nav aria-label="主要导航" className="mt-8 space-y-1">
            {nav.map(({ id, label, icon: Icon }) => {
              const isActive = active === id;
              return (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                    isActive
                      ? 'bg-sidebar-primary text-sidebar-primary-foreground shadow-sm'
                      : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                  }`}
                >
                  <Icon className="size-4" />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-8 px-2">
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-sidebar-foreground/35">Harness 状态</p>
            <div className="mt-3 space-y-3 text-xs text-sidebar-foreground/65">
              <div className="flex justify-between"><span>Planner</span><span className="text-emerald-400">在线</span></div>
              <div className="flex justify-between"><span>Tool Registry</span><span>6 个工具</span></div>
              <div className="flex justify-between"><span>Policy Gateway</span><span className="text-emerald-400">已启用</span></div>
            </div>
          </div>

          <div className="mt-auto rounded-xl border border-sidebar-border bg-background/10 p-3 text-sidebar-foreground">
            <div className="flex items-center gap-2 text-xs font-medium">
              <BadgeCheck className="size-4 text-emerald-400" />系统运行正常
            </div>
            <p className="mt-1.5 text-xs leading-5 text-sidebar-foreground/50">合成客户数据 · 演示环境</p>
          </div>
        </aside>

        <section className="min-w-0">
          <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-card/85 px-4 backdrop-blur md:px-8">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{activeItem.label}</p>
              <h1 className="font-heading text-base font-semibold">市场下跌 {(Math.abs(scenario.marketShock) * 100).toFixed(0)}% 客户群体压力测试</h1>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="hidden sm:inline-flex">{scenario.durationHours} 小时 · 种子 {scenario.seed}</Badge>
              <Button variant="outline" size="sm" className="hidden sm:inline-flex"><Search />搜索</Button>
              <Button size="sm" onClick={() => onNavigate('tasks')}><Sparkles />新建任务</Button>
            </div>
          </header>
          <nav className="flex gap-1 overflow-x-auto border-b bg-card px-3 py-2 lg:hidden">
            {nav.map(({ id, label, icon: Icon }) => (
              <Button key={id} size="sm" variant={active === id ? 'secondary' : 'ghost'} onClick={() => onNavigate(id)}>
                <Icon />{label}
              </Button>
            ))}
          </nav>
          <div className="mx-auto max-w-[1500px] p-4 md:p-6 xl:p-8">{children}</div>
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value, hint, tone = 'blue' }: { label: string; value: string; hint: string; tone?: 'blue' | 'rose' | 'amber' | 'emerald' | 'violet' }) {
  const color = { blue: 'text-sky-600', rose: 'text-rose-600', amber: 'text-amber-600', emerald: 'text-emerald-600', violet: 'text-violet-600' }[tone];
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-heading text-2xl font-semibold tracking-tight ${color}`}>{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

function PropagationNetwork({ customers, relationships, states, step }: { customers: Customer[]; relationships: RelationshipEdge[]; states?: CustomerTimeState[]; step: number }) {
  const archetypeCenters: Record<string, { x: number; y: number }> = {
    稳健守成型: { x: 126, y: 104 },
    长期成长型: { x: 330, y: 74 },
    进取交易型: { x: 526, y: 112 },
    高频敏感型: { x: 222, y: 238 },
    沉默流失型: { x: 448, y: 240 },
  };
  const stateMap = new Map(states?.map((state) => [state.id, state]) ?? []);
  const sampledCustomers = Object.keys(archetypeCenters).flatMap((archetype) =>
    customers.filter((customer) => customer.archetype === archetype).slice(0, 9),
  );
  const nodes = sampledCustomers.map((customer, index) => {
    const center = archetypeCenters[customer.archetype];
    const state = stateMap.get(customer.id);
    const panic = state?.panic ?? customer.panic;
    const trust = state?.trust ?? customer.psychology.trust;
    const angle = ((Number(customer.id.slice(2)) * 47) % 360) * Math.PI / 180 + step * 0.025 * (index % 2 ? 1 : -1);
    const orbit = 18 + (index % 9) * 3.4 + panic * 9;
    const x = center.x + Math.cos(angle) * orbit;
    const y = center.y + Math.sin(angle) * orbit * 0.72;
    const fill = panic > 0.62 ? '#ef4444' : panic > 0.42 ? '#f59e0b' : trust > 0.68 ? '#10b981' : '#3b82f6';
    return { ...customer, state, panic, x, y, radius: 4.5 + customer.influence * 6 + panic * 2.4, fill };
  });
  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const visibleEdges = relationships.filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target)).slice(0, 42);
  const edgeStyle = {
    similarity: { stroke: '#3b82f6', dash: undefined },
    social: { stroke: '#f59e0b', dash: undefined },
    service: { stroke: '#10b981', dash: '4 3' },
  } as const;
  return (
    <div className="relative min-h-[350px] overflow-hidden rounded-xl border bg-[radial-gradient(circle_at_50%_50%,color-mix(in_oklch,var(--primary)_9%,transparent),transparent_68%),linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-[size:auto,28px_28px,28px_28px]">
      <svg viewBox="0 0 660 320" className="absolute inset-0 size-full" aria-label="动态客户群体传播网络">
        {Object.entries(archetypeCenters).map(([label, center]) => <g key={label}><circle cx={center.x} cy={center.y} r="55" fill="var(--primary)" opacity=".035" stroke="var(--primary)" strokeDasharray="3 5" /><text x={center.x} y={center.y + 61} textAnchor="middle" className="fill-muted-foreground text-[9px]">{label}</text></g>)}
        <g strokeWidth="1.2">
          {visibleEdges.map((edge) => {
            const source = nodeMap.get(edge.source)!;
            const target = nodeMap.get(edge.target)!;
            const style = edgeStyle[edge.type];
            return <line key={`${edge.source}-${edge.target}-${edge.type}`} className={edge.type === 'service' ? 'network-flow' : edge.type === 'social' ? 'network-pulse' : ''} x1={source.x} y1={source.y} x2={target.x} y2={target.y} stroke={style.stroke} strokeDasharray={style.dash} opacity={0.18 + edge.weight * 0.48} />;
          })}
        </g>
        {nodes.map((node) => (
          <g key={node.id} style={{ transform: `translate(${node.x}px, ${node.y}px)`, transition: 'transform 450ms cubic-bezier(.2,.8,.2,1)' }}>
            {(node.state?.priority ?? node.priority) === '高' && <circle r={node.radius + 9} fill="none" stroke={node.fill} strokeWidth="2" opacity=".35" className="network-risk-ring" />}
            <circle r={node.radius} fill={node.fill} className="drop-shadow-sm" style={{ transition: 'fill 350ms ease, r 350ms ease' }} />
          </g>
        ))}
      </svg>
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-3 rounded-lg border bg-background/88 px-3 py-2 text-[10px] text-muted-foreground backdrop-blur">
        <span><i className="mr-1 inline-block size-2 rounded-full bg-rose-500" />恐慌</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-amber-500" />观望</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-emerald-500" />稳定</span>
        <span><i className="mr-1 inline-block size-2 rounded-full bg-blue-500" />待观察</span>
        <span className="border-l pl-3"><i className="mr-1 inline-block h-px w-3 bg-blue-500 align-middle" />相似性</span>
        <span><i className="mr-1 inline-block h-px w-3 bg-amber-500 align-middle" />社交影响</span>
        <span><i className="mr-1 inline-block h-px w-3 border-t border-dashed border-emerald-500 align-middle" />服务触达</span>
      </div>
    </div>
  );
}

function TaskCenter({ result, running, progress, completedSteps, prompt, setPrompt, onRun, onNavigate, scenarioNotice, executionMode }: {
  result: SimulationResult;
  running: boolean;
  progress: number;
  completedSteps: number;
  prompt: string;
  setPrompt: (value: string) => void;
  onRun: () => void;
  onNavigate: (view: View) => void;
  scenarioNotice: string;
  executionMode: '服务端模拟' | '本地降级';
}) {
  const recommended = result.strategies.find((item) => item.id === result.recommended)!;
  const highRisk = result.customers.filter((customer) => customer.priority === '高').length;
  const previewStep = Math.min(6, result.scenario.timeSteps);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
        <Card className="border-primary/15 bg-[linear-gradient(145deg,var(--card),color-mix(in_oklch,var(--primary)_4%,var(--card)))]">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><BrainCircuit className="size-4 text-primary" />告诉 Agent 你想完成什么</CardTitle>
                <CardDescription className="mt-1">平台将自主规划、调用工具、运行模拟并完成合规审查。</CardDescription>
              </div>
              <Badge className={executionMode === '服务端模拟' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700'}>{executionMode}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea aria-label="任务描述" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-28 resize-none border-primary/15 bg-background/80 p-4 text-[15px] leading-7 shadow-inner" />
            {scenarioNotice && <p className={`mt-2 text-xs ${scenarioNotice.includes('失败') || scenarioNotice.includes('默认') ? 'text-amber-700' : 'text-emerald-700'}`}>{scenarioNotice}</p>}
            {running && <div className="mt-4"><div className="mb-2 flex justify-between text-xs"><span>正在执行：{plan[Math.min(completedSteps, 4)][0]}</span><span className="font-mono">{progress}%</span></div><Progress value={progress} /></div>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2"><Badge variant="outline">下跌 {(Math.abs(result.scenario.marketShock) * 100).toFixed(0)}%</Badge><Badge variant="outline">{result.customerCount} 名客户</Badge><Badge variant="outline">{result.scenario.timeSteps} 个时间步</Badge><Badge variant="outline">随机种子 {result.seed}</Badge></div>
              <Button size="lg" className="px-4" onClick={onRun} disabled={running}>{running ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}{running ? '分析中' : '开始分析'}</Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-primary" />执行概览</CardTitle><CardDescription>最近一次完整模拟 · {Math.max(0.1, result.durationMs).toFixed(1)} 秒（本地计算）</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <MetricCard label="高风险客户" value={`${highRisk}`} hint="需优先干预" tone="rose" />
            <MetricCard label="恐慌峰值" value={percent(recommended.peakPanic)} hint="分群沟通策略" tone="amber" />
            <MetricCard label="投诉风险" value={percent(recommended.finalComplaint)} hint="模拟期末值" tone="violet" />
            <MetricCard label="合规发现" value={`${result.findings.length}`} hint="1 项阻断" tone="blue" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(380px,.72fr)_minmax(0,1.28fr)]">
        <Card>
          <CardHeader><CardTitle>Agent 执行计划</CardTitle><CardDescription>结构化轨迹，不展示原始思维链</CardDescription></CardHeader>
          <CardContent className="space-y-1">
            {plan.map(([title, detail], index) => {
              const done = index < completedSteps;
              const active = running && index === completedSteps;
              return <div key={title} className="flex gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
                <div className={`grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${done ? 'bg-primary text-primary-foreground' : active ? 'border border-primary bg-primary/10 text-primary' : 'border bg-background text-muted-foreground'}`}>{done ? <CheckCircle2 className="size-3.5" /> : String(index + 1).padStart(2, '0')}</div>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="text-sm font-medium">{title}</p>{done && <Badge className="h-4 px-1.5 text-[10px]" variant="secondary">已完成</Badge>}{active && <Badge className="h-4 px-1.5 text-[10px]">执行中</Badge>}</div><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{detail}</p></div>
                <ChevronRight className="mt-1 size-4 text-muted-foreground/50" />
              </div>;
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-primary" />客户群体传播预览</CardTitle><CardDescription className="mt-1">分群沟通策略 · 时间步 {Math.min(6, result.scenario.timeSteps)} / {result.scenario.timeSteps}</CardDescription></div><Button variant="outline" size="sm" onClick={() => onNavigate('sandbox')}><FlaskConical />进入沙盘</Button></div></CardHeader>
          <CardContent><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_190px]"><PropagationNetwork customers={result.customers} relationships={result.relationships} states={recommended.customerStates[previewStep - 1]} step={previewStep} /><div className="space-y-4">{[
            ['恐慌情绪', recommended.snapshots[Math.min(5, result.scenario.timeSteps - 1)].panic, 'text-rose-600'], ['卖出倾向', recommended.snapshots[Math.min(5, result.scenario.timeSteps - 1)].sell, 'text-amber-600'], ['机构信任', recommended.snapshots[Math.min(5, result.scenario.timeSteps - 1)].trust, 'text-emerald-600'], ['触达覆盖', recommended.snapshots[Math.min(5, result.scenario.timeSteps - 1)].coverage, 'text-sky-600'],
          ].map(([label, value, color]) => <div key={label as string}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className={`font-mono font-semibold ${color}`}>{percent(value as number, 0)}</span></div><Progress value={(value as number) * 100} /></div>)}<div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"><span className="font-semibold">关键节点 {result.customers[0].id}</span><br />高影响力、高从众敏感度，建议在第 3 时间步前人工介入。</div></div></div></CardContent>
        </Card>
      </div>
    </div>
  );
}

function CustomerInsights({ result }: { result: SimulationResult }) {
  const [selectedId, setSelectedId] = useState(result.customers[0].id);
  const [step, setStep] = useState(Math.min(6, result.scenario.timeSteps));
  const selected = result.customers.find((customer) => customer.id === selectedId) ?? result.customers[0];
  const recommended = result.strategies.find((item) => item.id === result.recommended)!;
  const currentState = recommended.customerStates[step - 1].find((state) => state.id === selected.id) ?? recommended.customerStates[step - 1][0];
  const factors = [
    ['损失厌恶', selected.psychology.lossAversion], ['从众敏感', selected.psychology.herding], ['收益追求', selected.psychology.ambition], ['投资纪律', selected.psychology.discipline], ['长期耐心', selected.psychology.patience], ['机构信任', selected.psychology.trust],
  ] as const;
  const radarData = factors.map(([factor, value]) => ({ factor, value: Math.round(value * 100) }));
  const behaviors = [
    ['买入', currentState.buy, 'bg-sky-500'],
    ['持有', currentState.hold, 'bg-emerald-500'],
    ['卖出', currentState.sell, 'bg-rose-500'],
    ['咨询', currentState.consult, 'bg-violet-500'],
    ['投诉', currentState.complaint, 'bg-amber-500'],
    ['流失', currentState.churn, 'bg-slate-500'],
  ] as const;
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
    <Card><CardHeader><div className="flex justify-between"><div><CardTitle>高风险客户队列</CardTitle><CardDescription>按行为风险与网络影响力综合排序，数据已脱敏。</CardDescription></div><Badge variant="outline">{result.customerCount} 名客户</Badge></div></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>客户</TableHead><TableHead>原型</TableHead><TableHead>风险等级</TableHead><TableHead>回撤</TableHead><TableHead>恐慌</TableHead><TableHead>优先级</TableHead></TableRow></TableHeader><TableBody>{result.customers.slice(0, 12).map((customer) => <TableRow key={customer.id} onClick={() => setSelectedId(customer.id)} className={`cursor-pointer ${customer.id === selected.id ? 'bg-primary/5' : ''}`}><TableCell><div className="font-medium">{customer.name}</div><div className="text-xs text-muted-foreground">{customer.id}</div></TableCell><TableCell>{customer.archetype}</TableCell><TableCell><Badge variant="outline">{customer.riskLevel}</Badge></TableCell><TableCell className="text-rose-600">-{customer.drawdown}%</TableCell><TableCell>{percent(customer.panic, 0)}</TableCell><TableCell><Badge variant={customer.priority === '高' ? 'destructive' : customer.priority === '中' ? 'secondary' : 'outline'}>{customer.priority}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    <div className="space-y-5"><Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle>{selected.name} · {selected.id}</CardTitle><CardDescription>{selected.archetype} · {selected.product}</CardDescription></div><Badge className="bg-rose-500/10 text-rose-700">{currentState.priority}优先级</Badge></div></CardHeader><CardContent><div className="grid items-center gap-2 sm:grid-cols-[1.1fr_.9fr]"><ChartContainer config={{ value: { label: '性格权重', color: '#2563eb' } }} className="h-[250px] w-full"><RadarChart data={radarData} outerRadius="68%"><PolarGrid /><PolarAngleAxis dataKey="factor" tick={{ fontSize: 10 }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} /><Radar dataKey="value" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.22} strokeWidth={2} /></RadarChart></ChartContainer><div className="space-y-2.5">{factors.map(([label, value]) => <div key={label}><div className="mb-1 flex justify-between text-[11px]"><span>{label}</span><span className="font-mono text-muted-foreground">{percent(value, 0)}</span></div><Progress value={value * 100} /></div>)}</div></div><p className="mt-2 text-center text-xs text-muted-foreground">点击左侧任一客户，性格结构会即时切换。</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-primary" />个体动态行为</CardTitle><CardDescription>{recommended.name} · 时间步 {step}/{result.scenario.timeSteps}</CardDescription></CardHeader><CardContent><div className="grid grid-cols-2 gap-3">{behaviors.map(([label, value, color]) => <div key={label} className="rounded-lg border bg-muted/25 p-3"><div className="flex items-center justify-between text-xs"><span>{label}</span><span className="font-mono font-semibold">{percent(value)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${value * 100}%` }} /></div></div>)}</div><div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>市场冲击</span><span>个体响应</span><span>状态收敛</span></div><Slider value={[step]} min={1} max={result.scenario.timeSteps} step={1} onValueChange={(value) => setStep(Array.isArray(value) ? value[0] : Number(value))} /></div><div className="mt-3 flex justify-between text-xs"><span>恐慌 {percent(currentState.panic)}</span><span>信任 {percent(currentState.trust)}</span></div></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-4 text-primary" />客户记忆摘要</CardTitle><CardDescription>仅展示业务事实与结构化证据</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><div className="rounded-lg bg-muted/50 p-3"><p className="font-medium">近 30 日行为</p><p className="mt-1 text-xs leading-5 text-muted-foreground">连续 3 次查看高波动产品净值，未主动咨询；历史回撤超过 10% 时曾快速赎回。</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="font-medium">沟通偏好</p><p className="mt-1 text-xs leading-5 text-muted-foreground">更接受包含量化依据的简短说明；对“立即行动”等强刺激表达敏感。</p></div></CardContent></Card>
    </div>
  </div>;
}

function SandboxView({ result }: { result: SimulationResult }) {
  const [strategy, setStrategy] = useState<StrategyId>(result.recommended);
  const [step, setStep] = useState(Math.min(6, result.scenario.timeSteps));
  const [playing, setPlaying] = useState(false);
  const selected = result.strategies.find((item) => item.id === strategy)!;
  const snapshot = selected.snapshots[step - 1];
  const chartData = selected.snapshots.map((_, index) => {
    const row: Record<string, number> = { step: index + 1 };
    result.strategies.forEach((item) => { row[item.id] = item.snapshots[index].panic * 100; });
    return row;
  });
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    setPlaying(true);
    let cursor = step;
    const timer = window.setInterval(() => {
      cursor += 1;
      if (cursor > result.scenario.timeSteps) { window.clearInterval(timer); setPlaying(false); return; }
      setStep(cursor);
    }, 450);
  };
  return <div className="space-y-5">
    <div className="grid gap-3 lg:grid-cols-3">{result.strategies.map((item) => <button key={item.id} onClick={() => setStrategy(item.id)} className={`rounded-xl border p-4 text-left transition-all ${strategy === item.id ? 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary/10' : 'bg-card hover:border-primary/30'}`}><div className="flex items-center justify-between"><span className="font-medium">{item.name}</span>{item.id === result.recommended && <Badge>推荐</Badge>}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p><div className="mt-3 flex items-end justify-between"><span className="text-xs text-muted-foreground">综合得分</span><span className="font-mono text-xl font-semibold">{(item.score * 100).toFixed(1)}</span></div></button>)}</div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]"><Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle className="flex items-center gap-2"><Network className="size-4 text-primary" />群体传播回放</CardTitle><CardDescription>{selected.name} · {scenarioLabel(result.scenario)} · 时间步 {step}/{result.scenario.timeSteps}</CardDescription></div><Button variant="outline" size="sm" onClick={togglePlay}>{playing ? <Pause /> : <Play />}{playing ? '暂停' : '播放'}</Button></div></CardHeader><CardContent><PropagationNetwork customers={result.customers} relationships={result.relationships} states={selected.customerStates[step - 1]} step={step} /><div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>市场事件</span><span>机构干预</span><span>状态收敛</span></div><Slider value={[step]} min={1} max={result.scenario.timeSteps} step={1} onValueChange={(value) => setStep(Array.isArray(value) ? value[0] : Number(value))} /></div></CardContent></Card>
      <div className="space-y-5"><Card><CardHeader><CardTitle>当前群体状态</CardTitle><CardDescription>时间步 {step} 聚合指标</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-3"><MetricCard label="恐慌情绪" value={percent(snapshot.panic)} hint="客户群均值" tone="rose" /><MetricCard label="卖出倾向" value={percent(snapshot.sell)} hint="概率估计" tone="amber" /><MetricCard label="传播强度" value={percent(snapshot.contagion)} hint="邻居状态贡献" tone="violet" /><MetricCard label="机构信任" value={percent(snapshot.trust)} hint="动态更新" tone="emerald" /></CardContent></Card><Card><CardHeader><CardTitle>群体行为分布</CardTitle><CardDescription>六类行为倾向随时间步同步更新</CardDescription></CardHeader><CardContent className="space-y-2.5">{[['买入', snapshot.buy], ['持有', snapshot.hold], ['卖出', snapshot.sell], ['咨询', snapshot.consult], ['投诉', snapshot.complaint], ['流失', snapshot.churn]].map(([label, value]) => <div key={label as string}><div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="font-mono">{percent(value as number)}</span></div><Progress value={(value as number) * 100} /></div>)}</CardContent></Card><Alert className="border-amber-200 bg-amber-50 text-amber-900"><TriangleAlert /><AlertTitle>发现群体临界点</AlertTitle><AlertDescription>三类关系网络共 {result.relationships.length} 条边参与传播计算；优先干预高影响节点可降低后续卖出倾向。</AlertDescription></Alert></div>
    </div>
    <Card><CardHeader><CardTitle>策略恐慌曲线对比</CardTitle><CardDescription>相同客户、市场冲击与随机种子下的对照实验</CardDescription></CardHeader><CardContent><ChartContainer config={chartConfig} className="h-[280px] w-full"><LineChart data={chartData} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="step" tickLine={false} axisLine={false} /><YAxis tickFormatter={(value) => `${value}%`} domain={[0, 100]} tickLine={false} axisLine={false} width={44} /><ChartTooltip content={<ChartTooltipContent />} />{result.strategies.map((item) => <Line key={item.id} type="monotone" dataKey={item.id} stroke={`var(--color-${item.id})`} strokeWidth={item.id === strategy ? 3 : 1.8} dot={false} />)}</LineChart></ChartContainer></CardContent></Card>
    <Card><CardHeader><CardTitle>结构化因素解释</CardTitle><CardDescription>展示进入决策的因素、权重与证据，不展示原始思维链。</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{result.explanationFactors.map((factor) => <div key={factor.label} className="rounded-lg border bg-muted/25 p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{factor.label}</span><Badge variant={factor.direction === '风险缓释' ? 'outline' : 'secondary'}>{factor.direction}</Badge></div><div className="mt-2 flex items-center gap-3"><Progress value={factor.weight * 100} /><span className="w-10 text-right font-mono text-xs">{percent(factor.weight, 0)}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{factor.evidence}</p></div>)}</CardContent></Card>
  </div>;
}

function AuditView({ result }: { result: SimulationResult }) {
  const downloadReport = () => {
    const recommended = result.strategies.find((item) => item.id === result.recommended)!;
    const finalState = recommended.snapshots.at(-1)!;
    const report = `证券客户行为沙盘 - 策略模拟报告\n\n场景：${scenarioLabel(result.scenario)}\n客户数量：${result.customerCount}\n时间步：${result.scenario.timeSteps}\n随机种子：${result.seed}\n推荐策略：${recommended.name}\n综合得分：${(recommended.score * 100).toFixed(1)}\n恐慌峰值：${percent(recommended.peakPanic)}\n买入倾向：${percent(finalState.buy)}\n持有倾向：${percent(finalState.hold)}\n卖出倾向：${percent(recommended.finalSell)}\n咨询倾向：${percent(finalState.consult)}\n投诉风险：${percent(recommended.finalComplaint)}\n流失风险：${percent(recommended.finalChurn)}\n\n说明：本报告为基于合成客户的情景推演，不构成对真实客户行为的绝对预测。`;
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = '证券客户行为沙盘-策略模拟报告.txt'; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-xl font-semibold">策略比较与审计记录</h2><p className="mt-1 text-sm text-muted-foreground">所有结果均保留工具、规则与人工责任主体。</p></div><Button onClick={downloadReport}><Download />导出报告</Button></div>
    <Card><CardHeader><CardTitle>策略结果对比</CardTitle><CardDescription>综合得分越高代表群体风险越低、信任保持越好。</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>策略</TableHead><TableHead>综合得分</TableHead><TableHead>恐慌峰值</TableHead><TableHead>卖出倾向</TableHead><TableHead>投诉风险</TableHead><TableHead>流失风险</TableHead><TableHead>合规风险</TableHead></TableRow></TableHeader><TableBody>{result.strategies.map((item) => <TableRow key={item.id}><TableCell className="font-medium">{item.name}{item.id === result.recommended && <Badge className="ml-2">推荐</Badge>}</TableCell><TableCell className="font-mono font-semibold">{(item.score * 100).toFixed(1)}</TableCell><TableCell>{percent(item.peakPanic)}</TableCell><TableCell>{percent(item.finalSell)}</TableCell><TableCell>{percent(item.finalComplaint)}</TableCell><TableCell>{percent(item.finalChurn)}</TableCell><TableCell><Badge variant={item.complianceRisk === '高' ? 'destructive' : item.complianceRisk === '中' ? 'secondary' : 'outline'}>{item.complianceRisk}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    <div className="grid gap-5 xl:grid-cols-2"><Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4 text-primary" />合规发现</CardTitle><CardDescription>Policy Gateway 硬边界检查</CardDescription></CardHeader><CardContent className="space-y-3">{result.findings.map((finding) => <div key={finding.id} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Badge variant={finding.severity === '阻断' ? 'destructive' : finding.severity === '警告' ? 'secondary' : 'outline'}>{finding.severity}</Badge><span className="font-mono text-xs text-muted-foreground">{finding.rule}</span></div><Badge variant="outline">{finding.status}</Badge></div><p className="mt-2 text-sm font-medium">{finding.strategy}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{finding.detail}</p></div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><FileCheck2 className="size-4 text-primary" />执行审计轨迹</CardTitle><CardDescription>可还原、可追责、可复核</CardDescription></CardHeader><CardContent><div className="relative space-y-4 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-border">{result.audit.map((item) => <div key={`${item.time}-${item.actor}`} className="relative grid grid-cols-[12px_70px_120px_1fr] items-start gap-3 text-xs"><i className="mt-1 size-2.5 rounded-full border-2 border-background bg-primary ring-1 ring-primary" /><span className="font-mono text-muted-foreground">{item.time}</span><span className="font-medium">{item.actor}</span><span><strong className="font-medium">{item.action}</strong><br /><span className="leading-5 text-muted-foreground">{item.result}</span></span></div>)}</div></CardContent></Card></div>
    <Alert className="border-sky-200 bg-sky-50 text-sky-900"><UserRoundCheck /><AlertTitle>人类责任锚定已启用</AlertTitle><AlertDescription>平台仅提供分析和建议。高风险客户触达、产品推荐和任何交易操作均需具备相应权限的人员确认。</AlertDescription></Alert>
  </div>;
}

export function SandboxApp() {
  const [active, setActive] = useState<View>('tasks');
  const [result, setResult] = useState<SimulationResult>(() => runSimulation());
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(100);
  const [completedSteps, setCompletedSteps] = useState(5);
  const [scenarioNotice, setScenarioNotice] = useState('');
  const [executionMode, setExecutionMode] = useState<'服务端模拟' | '本地降级'>('服务端模拟');
  const [prompt, setPrompt] = useState('市场今天下跌 10%，请分析持有高波动产品的客户，生成三套沟通方案，模拟未来 24 小时的客户群体反应，并告诉我应该优先联系谁。');

  const handleRun = async () => {
    if (running) return;
    setRunning(true); setProgress(0); setCompletedSteps(0);
    const parsed = parseScenarioPrompt(prompt);
    setScenarioNotice(parsed.defaultedFields.length ? `未识别的参数已使用默认值：${parsed.defaultedFields.join('、')}` : '场景参数已全部从任务描述中识别。');
    const timer = window.setInterval(() => {
      setProgress((value) => Math.min(88, value + 7));
      setCompletedSteps((value) => Math.min(4, value + 1));
    }, 240);
    try {
      const [response] = await Promise.all([
        fetch('/api/simulations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parsed.config) }),
        new Promise((resolve) => window.setTimeout(resolve, 900)),
      ]);
      if (!response.ok) throw new Error('simulation-api-failed');
      const next = await response.json() as SimulationResult;
      setExecutionMode('服务端模拟');
      setResult(next);
      fetch('/api/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt, result: next }) }).catch(() => undefined);
    } catch {
      const next = runSimulation(parsed.config);
      setExecutionMode('本地降级');
      setScenarioNotice('服务端模拟失败，已使用同版本确定性引擎完成本地降级。');
      setResult(next);
    } finally {
      window.clearInterval(timer);
      setProgress(100); setCompletedSteps(5); setRunning(false);
    }
  };

  let content;
  if (active === 'customers') content = <CustomerInsights result={result} />;
  else if (active === 'sandbox') content = <SandboxView result={result} />;
  else if (active === 'audit') content = <AuditView result={result} />;
  else content = <TaskCenter result={result} running={running} progress={progress} completedSteps={completedSteps} prompt={prompt} setPrompt={setPrompt} onRun={handleRun} onNavigate={setActive} scenarioNotice={scenarioNotice} executionMode={executionMode} />;

  return <AppShell active={active} onNavigate={setActive} scenario={result.scenario}>{content}</AppShell>;
}
