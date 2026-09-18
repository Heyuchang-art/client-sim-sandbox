'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  BadgeCheck,
  Ban,
  Boxes,
  BrainCircuit,
  ClipboardCopy,
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
  Megaphone,
  Pause,
  Play,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  UserRoundCheck,
  UsersRound,
  ListChecks,
  RefreshCw,
  RotateCcw,
  Star,
  SlidersHorizontal,
  ThumbsUp,
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
  aggregateSignature,
  buildMicroCommunicationPlan,
  percent,
  runSimulation,
  type Customer,
  type CustomerTimeState,
  type RelationshipEdge,
  type SimulationResult,
  type StrategyId,
} from '@/lib/simulation';
import { buildMemorySummaries } from '@/lib/harness/memory';
import {
  cancelServerTask,
  completeOutcome,
  degradationOf,
  emptyRunState,
  localOutcome,
  startServerTask,
  type RunOutcome,
  type RunState,
} from '@/lib/client/run-task';

type View = 'tasks' | 'customers' | 'sandbox' | 'audit' | 'skills';

const nav = [
  { id: 'tasks' as const, label: '智能任务中心', icon: LayoutDashboard },
  { id: 'customers' as const, label: '客户洞察中心', icon: CircleUserRound },
  { id: 'sandbox' as const, label: '群体行为沙盘', icon: Network },
  { id: 'audit' as const, label: '策略与审计', icon: ShieldCheck },
  { id: 'skills' as const, label: '技能与审批', icon: Boxes },
];

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
            <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-sidebar-foreground/35">系统状态</p>
            <div className="mt-3 space-y-3 text-xs text-sidebar-foreground/65">
              <div className="flex justify-between" title="Agent 自主拆解任务步骤（Planner）"><span>任务规划</span><span className="text-emerald-400">正常</span></div>
              <div className="flex justify-between" title="可被调用的工具集合（Tool Registry）"><span>可用工具</span><span>8 项</span></div>
              <div className="flex justify-between" title="合规硬边界审查（Policy Gateway）"><span>合规审查</span><span className="text-emerald-400">已开启</span></div>
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
              <h1 className="font-heading text-base font-semibold">客户群体行为压力预演</h1>
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

function formatAuditTime(at?: number) {
  if (!at) return '序列';
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
    // 坐标必须取固定精度：style 里的长度值会被浏览器 CSSOM 规范化，
    // 全精度浮点在服务端渲染与客户端水合时会得到不同的字符串，触发水合不一致。
    const x = Number((center.x + Math.cos(angle) * orbit).toFixed(2));
    const y = Number((center.y + Math.sin(angle) * orbit * 0.72).toFixed(2));
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

const executionModeMeta: Record<string, { label: string; className: string }> = {
  llm: { label: 'AI 模式 · 模型在线', className: 'bg-emerald-500/10 text-emerald-700' },
  rule: { label: '内置规则模式', className: 'bg-sky-500/10 text-sky-700' },
  degraded: { label: '备用模式 · 使用内置规则', className: 'bg-amber-500/10 text-amber-700' },
  local: { label: '本地试算 · 与服务端同版本', className: 'bg-amber-500/10 text-amber-700' },
};

const errorCodeLabels: Record<string, string> = {
  MODEL_UNAVAILABLE: '模型不可用',
  MODEL_TIMEOUT: '模型调用超时',
  MODEL_FORMAT: '模型输出格式错误',
  KNOWLEDGE_MISSING: '知识库缺失',
  SIMULATION_FAILED: '数值模拟失败',
  TASK_TIMEOUT: '任务超出时间预算',
  CANCELLED: '任务已取消',
  INTERNAL: '内部错误',
};

function TaskCenter({ result, runState, prompt, setPrompt, onRun, onCancel, onNavigate }: {
  result: SimulationResult;
  runState: RunState;
  prompt: string;
  setPrompt: (value: string) => void;
  onRun: () => void;
  onCancel: () => void;
  onNavigate: (view: View) => void;
}) {
  const recommended = result.strategies.find((item) => item.id === result.recommended)!;
  const highRisk = result.customers.filter((customer) => customer.priority === '高').length;
  const mediumRisk = result.customers.filter((customer) => customer.priority === '中').length;
  const previewStep = Math.min(6, result.scenario.timeSteps);
  const previewSnapshot = recommended.snapshots[Math.min(5, result.scenario.timeSteps - 1)];
  const running = runState.phase === 'submitting' || runState.phase === 'streaming';
  const mode = executionModeMeta[runState.mode] ?? executionModeMeta.rule;
  const blockedFindings = result.findings.filter((finding) => finding.severity === '阻断').length;
  const currentStep = runState.steps.find((step) => step.status === 'running');
  const hotNode = [...result.customers].sort((a, b) => b.panic * b.influence - a.panic * a.influence)[0];
  const hotState = recommended.customerStates[previewStep - 1]?.find((state) => state.id === hotNode.id);
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,.8fr)]">
        <Card className="border-primary/15 bg-[linear-gradient(145deg,var(--card),color-mix(in_oklch,var(--primary)_4%,var(--card)))]">
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2"><BrainCircuit className="size-4 text-primary" />告诉系统你想完成什么</CardTitle>
                <CardDescription className="mt-1">用一句自然语言说清楚你的目标，系统会自动拆解步骤、调用工具、把客户群体的反应跑一遍，并做合规检查。</CardDescription>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge className={mode.className}>{mode.label}</Badge>
                {runState.model && <span className="font-mono text-[10px] text-muted-foreground">{runState.model}</span>}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea aria-label="任务描述" value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-28 resize-none border-primary/15 bg-background/80 p-4 text-[15px] leading-7 shadow-inner" />
            {runState.defaultedFields.length > 0 && <p className="mt-2 text-xs text-amber-700">未识别的参数已使用默认值：{runState.defaultedFields.join('、')}</p>}
            {runState.notes.length > 0 && <div className="mt-2 space-y-1 text-xs text-muted-foreground">{runState.notes.map((note, index) => <p key={'note-' + index}>{note}</p>)}</div>}
            {running && <div className="mt-4"><div className="mb-2 flex justify-between text-xs"><span>正在执行：{currentStep?.title ?? '建立任务计划'}</span><span className="font-mono">{runState.progress}%</span></div><Progress value={runState.progress} /></div>}
            {runState.phase === 'failed' && <Alert className="mt-4 border-rose-200 bg-rose-50 text-rose-900"><TriangleAlert /><AlertTitle><span title={'错误代码：' + (runState.errorCode ?? 'INTERNAL')}>{errorCodeLabels[runState.errorCode ?? 'INTERNAL'] ?? '任务失败'}</span></AlertTitle><AlertDescription>{runState.errorMessage ?? '任务没有跑完。可以点「重试」，或查看已经保存下来的备用结果。'}</AlertDescription></Alert>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2"><Badge variant="outline">下跌 {(Math.abs(result.scenario.marketShock) * 100).toFixed(0)}%</Badge><div className="flex gap-2"><Badge variant="outline">{result.customerCount} 名客户</Badge><Badge variant="outline">从 {result.scenarioMeta.generatedCustomers} 名客户中筛出 {result.customerCount} 名</Badge></div><Badge variant="outline">{result.scenario.timeSteps} 段推演</Badge><Badge variant="outline">随机种子 {result.seed}</Badge></div>
              <div className="flex gap-2">
                {running && runState.taskId && <Button variant="outline" size="lg" className="px-4" onClick={onCancel}><Ban />取消任务</Button>}
                {runState.phase === 'failed' && <Button variant="outline" size="lg" className="px-4" onClick={onRun}><RotateCcw />重试</Button>}
                <Button size="lg" className="px-4" onClick={onRun} disabled={running}>{running ? <LoaderCircle className="animate-spin" /> : <Play className="fill-current" />}{running ? '分析中' : '开始分析'}</Button>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-primary" />本次结果概览</CardTitle><CardDescription>{runState.phase === 'idle' ? '系统已就绪，输入你的目标即可开始' : '计算耗时 ' + Math.max(0.01, result.durationMs).toFixed(1) + ' 毫秒'}{runState.durationMs ? ' · 全程 ' + (runState.durationMs / 1000).toFixed(1) + ' 秒' : ''}{runState.firstFeedbackMs !== null ? ' · ' + runState.firstFeedbackMs + ' 毫秒出现首个进度' : ''}</CardDescription></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <MetricCard label="高风险客户" value={String(highRisk)} hint={'另有中风险 ' + mediumRisk + ' 名'} tone="rose" />
            <MetricCard label="恐慌峰值" value={percent(recommended.peakPanic)} hint={recommended.name} tone="amber" />
            <MetricCard label="投诉风险" value={percent(recommended.finalComplaint)} hint="推演结束时" tone="violet" />
            <MetricCard label="合规发现" value={String(result.findings.length)} hint={blockedFindings + ' 项违规话术已拦下 · ' + (result.findings.length - blockedFindings) + ' 项待人工确认'} tone="blue" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(380px,.72fr)_minmax(0,1.28fr)]">
        <Card>
          <CardHeader><CardTitle>执行步骤</CardTitle><CardDescription>系统把任务拆成了哪几步</CardDescription></CardHeader>
          <CardContent className="space-y-1">
            {runState.steps.length === 0 && <p className="px-2 py-3 text-xs leading-5 text-muted-foreground">{running ? '正在拆解任务…' : '还没有执行过任务。点击「开始分析」后，这里会显示系统实际执行的每一步。'}</p>}
            {runState.steps.map((step) => {
              const done = step.status === 'completed' || step.status === 'blocked';
              const active = step.status === 'running';
              const failed = step.status === 'failed';
              return <div key={step.index} className="flex gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/60">
                <div className={'grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold ' + (done ? 'bg-primary text-primary-foreground' : failed ? 'bg-destructive text-white' : active ? 'border border-primary bg-primary/10 text-primary' : 'border bg-background text-muted-foreground')}>{done ? <CheckCircle2 className="size-3.5" /> : String(step.index).padStart(2, '0')}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><p className="text-sm font-medium">{step.title}</p>{done && <Badge className="h-4 px-1.5 text-[10px]" variant={step.status === 'blocked' ? 'destructive' : 'secondary'}>{step.status === 'blocked' ? '有合规提醒' : '已完成'}</Badge>}{active && <Badge className="h-4 px-1.5 text-[10px]">执行中</Badge>}{failed && <Badge className="h-4 px-1.5 text-[10px]" variant="destructive">已失败</Badge>}</div>
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{step.audit ?? step.intent}</p>
                </div>
                <ChevronRight className="mt-1 size-4 text-muted-foreground/50" />
              </div>;
            })}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><div className="flex items-start justify-between gap-4"><div><CardTitle className="flex items-center gap-2"><UsersRound className="size-4 text-primary" />客户情绪扩散预览</CardTitle><CardDescription className="mt-1">分群沟通策略 · 第 {previewStep} 段（共 {result.scenario.timeSteps} 段） · 每段 {result.scenarioMeta.stepHours.toFixed(1)} 小时</CardDescription></div><Button variant="outline" size="sm" onClick={() => onNavigate('sandbox')}><FlaskConical />进入沙盘</Button></div></CardHeader>
          <CardContent><div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_190px]"><PropagationNetwork customers={result.customers} relationships={result.relationships} states={recommended.customerStates[previewStep - 1]} step={previewStep} /><div className="space-y-4">{[['恐慌情绪', previewSnapshot.panic, 'text-rose-600'], ['卖出倾向', previewSnapshot.sell, 'text-amber-600'], ['机构信任', previewSnapshot.trust, 'text-emerald-600'], ['已触达客户', previewSnapshot.coverage, 'text-sky-600']].map(([label, value, color]) => <div key={label as string}><div className="mb-1.5 flex items-center justify-between text-xs"><span className="text-muted-foreground">{label}</span><span className={'font-mono font-semibold ' + color}>{percent(value as number, 0)}</span></div><Progress value={(value as number) * 100} /></div>)}<div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs leading-5 text-rose-800"><span className="font-semibold">当前最需要优先联系的客户：{hotNode.name}（{hotNode.id}）</span><br />此刻恐慌 {percent(hotState?.panic ?? hotNode.panic, 0)}，是这批客户里最需要人工介入的一位。</div></div></div></CardContent>
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
  const microPlan = buildMicroCommunicationPlan(selected, currentState, result.scenario);
  const memorySummaries = buildMemorySummaries(result.customers);
  const memory = memorySummaries.find((item) => item.archetype === selected.archetype) ?? memorySummaries[0];
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
    <Card><CardHeader><div className="flex justify-between"><div><CardTitle>优先联系名单</CardTitle><CardDescription>按最难受的时刻排的：谁在推演过程中风险最高，谁排前面。</CardDescription></div><Badge variant="outline">{result.customerCount} 名客户</Badge></div></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>客户</TableHead><TableHead>原型</TableHead><TableHead>风险等级</TableHead><TableHead>回撤</TableHead><TableHead>峰值恐慌</TableHead><TableHead>优先级</TableHead></TableRow></TableHeader><TableBody>{result.customers.slice(0, 12).map((customer) => <TableRow key={customer.id} onClick={() => setSelectedId(customer.id)} className={`cursor-pointer ${customer.id === selected.id ? 'bg-primary/5' : ''}`}><TableCell><div className="font-medium">{customer.name}</div><div className="text-xs text-muted-foreground">{customer.id}</div></TableCell><TableCell>{customer.archetype}</TableCell><TableCell><Badge variant="outline">{customer.riskLevel}</Badge></TableCell><TableCell className="text-rose-600">-{customer.drawdown}%</TableCell><TableCell>{percent(customer.peakPanic, 0)}</TableCell><TableCell><Badge variant={customer.priority === '高' ? 'destructive' : customer.priority === '中' ? 'secondary' : 'outline'}>{customer.priority}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    <div className="space-y-5"><Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle>{selected.name} · {selected.id}</CardTitle><CardDescription>{selected.archetype} · {selected.product}</CardDescription></div><Badge className="bg-rose-500/10 text-rose-700">{selected.priority}优先级 · 模拟期峰值</Badge></div></CardHeader><CardContent><div className="grid items-center gap-2 sm:grid-cols-[1.1fr_.9fr]"><ChartContainer config={{ value: { label: '性格权重', color: '#2563eb' } }} className="h-[250px] w-full"><RadarChart data={radarData} outerRadius="68%"><PolarGrid /><PolarAngleAxis dataKey="factor" tick={{ fontSize: 10 }} /><PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} /><Radar dataKey="value" stroke="var(--color-value)" fill="var(--color-value)" fillOpacity={0.22} strokeWidth={2} /></RadarChart></ChartContainer><div className="space-y-2.5">{factors.map(([label, value]) => <div key={label}><div className="mb-1 flex justify-between text-[11px]"><span>{label}</span><span className="font-mono text-muted-foreground">{percent(value, 0)}</span></div><Progress value={value * 100} /></div>)}</div></div><p className="mt-2 text-center text-xs text-muted-foreground">点击左侧任一客户，性格结构会即时切换。</p></CardContent></Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Activity className="size-4 text-primary" />个体动态行为</CardTitle><CardDescription>{recommended.name} · 第 {step} 段（共 {result.scenario.timeSteps} 段）</CardDescription></CardHeader><CardContent><details className="group"><summary className="flex cursor-pointer list-none items-center justify-between text-sm text-muted-foreground"><span>查看这位客户的六项行为倾向</span><span className="flex items-center gap-1 text-xs"><span className="group-open:hidden">展开</span><span className="hidden group-open:inline">收起</span><ChevronRight className="size-4 transition-transform group-open:rotate-90" /></span></summary><div className="mt-3 grid grid-cols-2 gap-3">{behaviors.map(([label, value, color]) => <div key={label} className="rounded-lg border bg-muted/25 p-3"><div className="flex items-center justify-between text-xs"><span>{label}</span><span className="font-mono font-semibold">{percent(value)}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${value * 100}%` }} /></div></div>)}</div></details><div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>市场冲击</span><span>个体响应</span><span>状态收敛</span></div><Slider value={[step]} min={1} max={result.scenario.timeSteps} step={1} onValueChange={(value) => setStep(Array.isArray(value) ? value[0] : Number(value))} /></div><div className="mt-3 flex justify-between text-xs"><span>恐慌 {percent(currentState.panic)}</span><span>信任 {percent(currentState.trust)}</span></div></CardContent></Card>
      <Card className="overflow-hidden border-primary/20">
        <div className="border-b bg-primary/[.045] px-6 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><CardTitle className="flex items-center gap-2"><Target className="size-4 text-primary" />一人一策 · 微观沟通建议</CardTitle><CardDescription className="mt-1">随客户、情绪状态和推演进度动态更新</CardDescription></div>
            <div className="flex gap-2"><Badge variant={microPlan.urgency === '立即' ? 'destructive' : microPlan.urgency === '优先' ? 'secondary' : 'outline'}>{microPlan.urgency}触达</Badge><Badge variant="outline">{microPlan.channel}</Badge></div>
          </div>
        </div>
        <CardContent className="space-y-4 pt-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-muted/45 p-3"><p className="text-[11px] text-muted-foreground">沟通目标</p><p className="mt-1 text-sm font-medium leading-5">{microPlan.objective}</p></div>
            <div className="rounded-lg bg-muted/45 p-3"><p className="text-[11px] text-muted-foreground">时机与语气</p><p className="mt-1 text-sm font-medium leading-5">{microPlan.timing}</p><p className="mt-1 text-xs text-muted-foreground">{microPlan.tone}</p></div>
          </div>
          <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-4">
            <div className="flex items-center justify-between gap-3"><p className="text-sm font-semibold text-sky-950">建议话术</p><Button variant="outline" size="sm" onClick={() => void navigator.clipboard?.writeText(microPlan.recommendedMessage)}><ClipboardCopy />复制话术</Button></div>
            <p className="mt-3 text-sm leading-7 text-sky-950">{microPlan.recommendedMessage}</p>
          </div>
          <div><p className="mb-2 text-xs font-semibold">沟通要点</p><div className="space-y-2">{microPlan.keyPoints.map((point) => <div key={point} className="flex gap-2 text-xs leading-5 text-muted-foreground"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-emerald-600" /><span>{point}</span></div>)}</div></div>
          <Alert className="border-amber-200 bg-amber-50 text-amber-900"><ShieldAlert /><AlertTitle>话术红线</AlertTitle><AlertDescription>{microPlan.avoid}</AlertDescription></Alert>
          <div className="flex flex-wrap gap-2">{microPlan.evidence.map((item) => <Badge key={item} variant="outline" className="font-normal">{item}</Badge>)}</div>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><Clock3 className="size-4 text-primary" />客户情况速览</CardTitle><CardDescription>根据这位客户的历史行为和偏好整理 · {selected.archetype}</CardDescription></CardHeader><CardContent className="space-y-3 text-sm"><div className="rounded-lg bg-muted/50 p-3"><p className="font-medium">行为倾向</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{memory.behavior}</p></div><div className="rounded-lg bg-muted/50 p-3"><p className="font-medium">沟通偏好</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{memory.preference}</p></div><div className="flex flex-wrap gap-2">{memory.evidence.map((item) => <Badge key={item} variant="outline" className="font-normal">{item}</Badge>)}</div></CardContent></Card>
    </div>
  </div>;
}

function SandboxView({ result }: { result: SimulationResult }) {
  const [strategy, setStrategy] = useState<StrategyId>(result.recommended);
  const scores = relativeBreakdown(result);
  const [step, setStep] = useState(Math.min(6, result.scenario.timeSteps));
  const [playing, setPlaying] = useState(false);
  const selected = result.strategies.find((item) => item.id === strategy)!;
  const snapshot = selected.snapshots[step - 1];
  const macroPlan = selected.macroPlan;
  const activePhase = Math.min(2, Math.floor(((step - 1) / result.scenario.timeSteps) * 3));
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
    <div className="grid gap-3 lg:grid-cols-3">{result.strategies.map((item) => <button key={item.id} onClick={() => setStrategy(item.id)} className={`rounded-xl border p-4 text-left transition-all ${strategy === item.id ? 'border-primary bg-primary/5 shadow-sm ring-2 ring-primary/10' : 'bg-card hover:border-primary/30'}`}><div className="flex items-center justify-between"><span className="font-medium">{item.name}</span>{item.id === result.recommended && <Badge>推荐</Badge>}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">{item.description}</p><div className="mt-3 flex items-end justify-between"><span className="text-xs text-muted-foreground">综合推荐度</span><span className="font-mono text-xl font-semibold">{scores.of(item.utility).total.toFixed(2)}</span></div><div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground"><span>风险改善 {scores.of(item.utility).avoidance.toFixed(2)}</span><span>人力成本 {scores.of(item.utility).cost.toFixed(2)}</span><span>打扰代价 {scores.of(item.utility).wake.toFixed(2)}</span></div></button>)}</div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(300px,.65fr)]"><Card><CardHeader><div className="flex items-start justify-between"><div><CardTitle className="flex items-center gap-2"><Network className="size-4 text-primary" />情绪扩散回放</CardTitle><CardDescription>{selected.name} · {scenarioLabel(result.scenario)} · 第 {step} 段（共 {result.scenario.timeSteps} 段）</CardDescription></div><Button variant="outline" size="sm" onClick={togglePlay}>{playing ? <Pause /> : <Play />}{playing ? '暂停' : '播放'}</Button></div></CardHeader><CardContent><PropagationNetwork customers={result.customers} relationships={result.relationships} states={selected.customerStates[step - 1]} step={step} /><div className="mt-5"><div className="mb-2 flex justify-between text-xs text-muted-foreground"><span>市场事件</span><span>机构干预</span><span>状态收敛</span></div><Slider value={[step]} min={1} max={result.scenario.timeSteps} step={1} onValueChange={(value) => setStep(Array.isArray(value) ? value[0] : Number(value))} /></div></CardContent></Card>
      <div className="space-y-5"><Card><CardHeader><CardTitle>当前群体状态</CardTitle><CardDescription>第 {step} 段整体情况</CardDescription></CardHeader><CardContent className="grid grid-cols-2 gap-3"><MetricCard label="恐慌情绪" value={percent(snapshot.panic)} hint="客户群均值" tone="rose" /><MetricCard label="卖出倾向" value={percent(snapshot.sell)} hint="概率估计" tone="amber" /><MetricCard label="传播强度" value={percent(snapshot.contagion)} hint="邻居状态贡献" tone="violet" /><MetricCard label="机构信任" value={percent(snapshot.trust)} hint="动态更新" tone="emerald" /></CardContent></Card><Card><CardHeader><CardTitle>群体行为分布</CardTitle><CardDescription>六类行为倾向随推演进度同步更新</CardDescription></CardHeader><CardContent className="space-y-2.5">{[['买入', snapshot.buy], ['持有', snapshot.hold], ['卖出', snapshot.sell], ['咨询', snapshot.consult], ['投诉', snapshot.complaint], ['流失', snapshot.churn]].map(([label, value]) => <div key={label as string}><div className="mb-1 flex justify-between text-xs"><span>{label}</span><span className="font-mono">{percent(value as number)}</span></div><Progress value={(value as number) * 100} /></div>)}</CardContent></Card><Alert className="border-amber-200 bg-amber-50 text-amber-900"><TriangleAlert /><AlertTitle>发现群体临界点</AlertTitle><AlertDescription>客户之间的 {result.relationships.length} 条关联关系参与了情绪扩散计算；优先联系影响力大的客户，可以压低后续的卖出倾向。</AlertDescription></Alert></div>
    </div>
    <Card className="overflow-hidden border-primary/20">
      <div className="border-b bg-primary/[.045] px-6 py-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Megaphone className="size-4 text-primary" />宏观沟通指挥方案</CardTitle><CardDescription className="mt-1">整体处置原则、节奏与分阶段动作</CardDescription></div><div className="flex gap-2"><Badge>{selected.name}</Badge><Badge variant="outline">群体策略层</Badge></div></div></div>
      <CardContent className="pt-5">
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,.75fr)]">
          <div>
            <p className="text-sm font-medium leading-6">{macroPlan.objective}</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3">{macroPlan.phases.map((phase, index) => <div key={phase.name} className={`rounded-xl border p-3 transition-colors ${index === activePhase ? 'border-primary bg-primary/5 ring-2 ring-primary/10' : 'bg-muted/20'}`}><div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{index + 1}. {phase.name}</span>{index === activePhase && <Badge>当前阶段</Badge>}</div><p className="mt-1 font-mono text-[11px] text-primary">{phase.window}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{phase.action}</p></div>)}</div>
          </div>
          <div className="space-y-3 rounded-xl border bg-muted/25 p-4 text-xs">
            {[['目标客群', macroPlan.targetAudience], ['触达渠道', macroPlan.channels.join('、')], ['沟通节奏', macroPlan.cadence], ['责任主体', macroPlan.owner], ['升级规则', macroPlan.escalationRule]].map(([label, value]) => <div key={label} className="grid grid-cols-[64px_1fr] gap-3"><span className="text-muted-foreground">{label}</span><span className="leading-5">{value}</span></div>)}
            <div className="border-t pt-3"><p className="font-medium text-amber-700">合规边界</p><p className="mt-1 leading-5 text-muted-foreground">{macroPlan.guardrail}</p></div>
          </div>
        </div>
      </CardContent>
    </Card>
    <Card><CardHeader><CardTitle>三套方案的情绪走势对比</CardTitle><CardDescription>相同客户、市场冲击与随机种子下的对照实验</CardDescription></CardHeader><CardContent><ChartContainer config={chartConfig} className="h-[280px] w-full"><LineChart data={chartData} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="step" tickLine={false} axisLine={false} /><YAxis tickFormatter={(value) => `${value}%`} domain={[0, 100]} tickLine={false} axisLine={false} width={44} /><ChartTooltip content={<ChartTooltipContent />} />{result.strategies.map((item) => <Line key={item.id} type="monotone" dataKey={item.id} stroke={`var(--color-${item.id})`} strokeWidth={item.id === strategy ? 3 : 1.8} dot={false} />)}</LineChart></ChartContainer></CardContent></Card>
    <Card><CardHeader><CardTitle>影响因素</CardTitle><CardDescription>这次判断主要参考了哪些因素，各自占多大分量。</CardDescription></CardHeader><CardContent className="grid gap-3 md:grid-cols-2">{result.explanationFactors.map((factor) => <div key={factor.label} className="rounded-lg border bg-muted/25 p-3"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">{factor.label}</span><Badge variant={factor.direction === '风险缓释' ? 'outline' : 'secondary'}>{factor.direction}</Badge></div><div className="mt-2 flex items-center gap-3"><Progress value={factor.weight * 100} /><span className="w-10 text-right font-mono text-xs">{percent(factor.weight, 0)}</span></div><p className="mt-2 text-xs leading-5 text-muted-foreground">{factor.evidence}</p></div>)}</CardContent></Card>
  </div>;
}

function formatDateTime(at?: number | null) {
  if (!at) return '—';
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, '0');
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) + ' ' + pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function AuditView({ result, outcome, onNavigate }: { result: SimulationResult; outcome: RunOutcome | null; onNavigate: (view: View) => void }) {
  const [rating, setRating] = useState(4);
  const [comment, setComment] = useState('');
  const [feedbackState, setFeedbackState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const audit = outcome?.audit?.length ? outcome.audit : result.audit;
  const state = outcome?.state ?? null;
  const recommended = result.strategies.find((item) => item.id === result.recommended) ?? result.strategies[0];
  const scores = relativeBreakdown(result);
  const highRiskCount = result.customers.filter((customer) => customer.priority === '高').length;
  const blockedFindingCount = result.findings.filter((finding) => finding.severity === '阻断').length;
  const taskId = state?.taskId ?? null;
  const mode = executionModeMeta[state?.mode ?? 'rule'] ?? executionModeMeta.rule;
  const signature = outcome?.serverSignature ?? aggregateSignature(result);
  const ablationLabels = Object.entries(result.scenarioMeta.ablations)
    .filter(([, enabled]) => enabled)
    .map(([name]) => ablationNameLabels[name] ?? name);
  const deterministicText = outcome === null
    ? '未校验（本地引擎结果）'
    : outcome.deterministicMatch === null
      ? '服务端未返回结果指纹'
      : outcome.deterministicMatch
        ? '与本地重算完全一致'
        : '与本地重算不一致';

  const downloadReport = () => {
    const recommended = result.strategies.find((item) => item.id === result.recommended)!;
    const finalState = recommended.snapshots.at(-1)!;
    const report = [
      '证券客户行为沙盘 - 策略模拟报告',
      '',
      '场景：' + scenarioLabel(result.scenario),
      '场景参数：marketShock=' + result.scenario.marketShock + '，durationHours=' + result.scenario.durationHours + '，customerCount=' + result.scenario.customerCount + '，timeSteps=' + result.scenario.timeSteps + '，seed=' + result.scenario.seed + '，targetSegment=' + result.scenario.targetSegment,
      '每步粒度：' + result.scenarioMeta.stepHours.toFixed(2) + ' 小时',
      '客户数量：' + result.customerCount,
      '客户筛选条件：' + result.scenarioMeta.segmentCriteria,
      '随机种子：' + result.seed,
      '推荐策略：' + recommended.name,
      '综合推荐度：' + scores.of(recommended.utility).total.toFixed(2) + '（以「不主动沟通」为 0 分基准；风险改善 ' + scores.of(recommended.utility).avoidance.toFixed(2) + '，人力成本 ' + scores.of(recommended.utility).cost.toFixed(2) + '，打扰代价 ' + scores.of(recommended.utility).wake.toFixed(2) + '）',
      '恐慌峰值：' + percent(recommended.peakPanic),
      '买入倾向：' + percent(finalState.buy),
      '持有倾向：' + percent(finalState.hold),
      '卖出倾向：' + percent(recommended.finalSell),
      '咨询倾向：' + percent(finalState.consult),
      '投诉风险：' + percent(recommended.finalComplaint),
      '流失风险：' + percent(recommended.finalChurn),
      '',
      '任务 ID：' + (taskId ?? '本地计算（未提交服务端任务）'),
      '执行模式：' + mode.label,
      '模型：' + (state?.model ?? '未使用模型'),
      '规则版本：' + result.scenarioMeta.ruleVersion,
      '结果指纹：' + signature,
      '复现校验：' + deterministicText,
      '分层对比：' + (ablationLabels.length ? ablationLabels.join('、') : '无'),
      '',
      '说明：本报告为基于合成脱敏客户的情景推演，不构成对真实客户行为的预测或投资建议。',
    ].join('\n');
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url; link.download = '证券客户行为沙盘-策略模拟报告.txt'; link.click(); URL.revokeObjectURL(url);
  };

  const submitFeedback = async () => {
    if (!taskId) return;
    setFeedbackState('saving');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId, rating, comment: comment.slice(0, 500), labels: [result.recommended] }),
      });
      setFeedbackState(response.ok ? 'saved' : 'error');
    } catch {
      setFeedbackState('error');
    }
  };

  const taskFacts: Array<[string, string]> = [
    ['任务 ID', taskId ?? '本地计算（未提交服务端任务）'],
    ['执行模式', mode.label],
    ['模型', state?.model ?? '未使用模型'],
    ['规则版本', result.scenarioMeta.ruleVersion],
    ['随机种子', String(result.seed)],
    ['结果指纹', signature],
    ['复现校验', deterministicText],
    ['首帧反馈', state?.firstFeedbackMs !== null && state?.firstFeedbackMs !== undefined ? state.firstFeedbackMs + ' 毫秒' : '—'],
    ['端到端耗时', state?.durationMs ? (state.durationMs / 1000).toFixed(2) + ' 秒' : '—'],
    ['客户筛选条件', result.scenarioMeta.segmentCriteria + (result.scenarioMeta.segmentRelaxed ? '（命中不足，已按回撤降序补足）' : '')],
    ['客户池', '候选 ' + result.scenarioMeta.generatedCustomers + ' 名 · 命中 ' + (result.scenarioMeta.generatedCustomers - result.scenarioMeta.excludedCustomers) + ' 名 · 排除 ' + result.scenarioMeta.excludedCustomers + ' 名'],
    ['分层对比', ablationLabels.length ? ablationLabels.join('、') : '无'],
    ['人工审批', '高风险动作需人工确认；Skill 上线需审批'],
  ];

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-xl font-semibold">方案对比与执行记录</h2><p className="mt-1 text-sm text-muted-foreground">结论、依据与执行过程都保留下来，方便复查和留档。</p></div><Button onClick={downloadReport}><Download />导出报告</Button></div>
    <Card className="border-primary/20 bg-[linear-gradient(145deg,var(--card),color-mix(in_oklch,var(--primary)_5%,var(--card)))]"><CardContent className="flex flex-wrap items-center justify-between gap-4 py-5">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">本次建议</p>
        <p className="mt-1 font-heading text-lg font-semibold">采用「{recommended.name}」</p>
        <p className="mt-1 text-sm text-muted-foreground">{highRiskCount > 0 ? `有 ${highRiskCount} 名客户建议优先人工联系。` : '本次没有客户需要优先人工联系。'}全部候选方案共触发合规提醒 {result.findings.length} 项；其中 {blockedFindingCount} 项违规话术已在推演前拦下，这 {blockedFindingCount} 项来自未被采用的方案，不影响上面的推荐结论。</p>
      </div>
      <Button variant="outline" onClick={() => onNavigate('customers')}><UsersRound />查看要联系谁</Button>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>三套方案对比</CardTitle><CardDescription>四列都以「不主动沟通」为 0 分基准，可以直接相减核对：综合推荐度 = 风险改善 − 人力成本 − 打扰代价。正数表示比什么都不做更好，负数表示还不如不行动；人力成本与打扰代价是「比不行动多付出的部分」。</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>方案</TableHead><TableHead>综合推荐度</TableHead><TableHead>风险改善</TableHead><TableHead>人力成本</TableHead><TableHead>打扰代价</TableHead></TableRow></TableHeader><TableBody>{result.strategies.map((item) => <TableRow key={item.id}><TableCell className="font-medium">{item.name}{item.id === result.recommended && <Badge className="ml-2">推荐</Badge>}</TableCell><TableCell className="font-mono font-semibold">{scores.of(item.utility).total.toFixed(2)}</TableCell><TableCell className="font-mono">{scores.of(item.utility).avoidance.toFixed(2)}</TableCell><TableCell className="font-mono">{scores.of(item.utility).cost.toFixed(2)}</TableCell><TableCell className="font-mono">{scores.of(item.utility).wake.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table>
      <details className="mt-4 border-t pt-3"><summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground">展开各方案的风险指标与合规结论</summary>
        <Table className="mt-3"><TableHeader><TableRow><TableHead>方案</TableHead><TableHead>恐慌峰值</TableHead><TableHead>卖出倾向</TableHead><TableHead>流失风险</TableHead><TableHead>合规审查</TableHead></TableRow></TableHeader><TableBody>{result.strategies.map((item) => <TableRow key={item.id}><TableCell className="font-medium">{item.name}</TableCell><TableCell>{percent(item.peakPanic)}</TableCell><TableCell>{percent(item.finalSell)}</TableCell><TableCell>{percent(item.finalChurn)}</TableCell><TableCell><div className="flex items-center gap-2"><Badge variant={item.complianceRisk === '高' ? 'destructive' : item.complianceRisk === '中' ? 'secondary' : 'outline'}>{item.complianceRisk}</Badge><span className="text-[11px] text-muted-foreground">{item.findings.filter((finding) => finding.severity === '阻断').length} 项违规话术已拦下</span></div></TableCell></TableRow>)}</TableBody></Table></details>
    </CardContent></Card>
    {result.strategySearch && <CollapsibleCard title="还试过哪些组合" hint="系统另外算过的组合，仅供参考，不能直接执行" icon={<SlidersHorizontal className="size-4 text-primary" />} ><Table><TableHeader><TableRow><TableHead>组合</TableHead><TableHead>覆盖客户</TableHead><TableHead>人工投入</TableHead><TableHead>话术贴合度</TableHead><TableHead>综合推荐度</TableHead></TableRow></TableHeader><TableBody>{result.strategySearch.top.map((point, index) => <TableRow key={index}><TableCell className="font-medium">搜索点 {index + 1}</TableCell><TableCell className="font-mono">{percent(point.levers.reach, 0)}</TableCell><TableCell className="font-mono">{percent(point.levers.depth, 0)}</TableCell><TableCell className="font-mono">{percent(point.levers.personalize, 0)}</TableCell><TableCell className="font-mono font-semibold">{scores.of(point.utility).total.toFixed(2)}</TableCell></TableRow>)}</TableBody></Table></CollapsibleCard>}
    <div className="grid gap-5 xl:grid-cols-2">
      <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldAlert className="size-4 text-primary" />合规发现</CardTitle><CardDescription>已对全部候选话术做合规检查 · 规则版本 {result.scenarioMeta.ruleVersion}。状态说明：「已拦下」表示该违规表达已在推演前改写、不再计入结果；「待人工确认」表示需要业务人员判断是否放行，两者互不冲突。</CardDescription></CardHeader><CardContent className="space-y-3">{result.findings.filter((finding) => finding.severity !== '提示').length === 0 ? <p className="text-xs text-muted-foreground">本次候选策略未触发需要处置的合规规则。</p> : result.findings.filter((finding) => finding.severity !== '提示').map((finding, index) => <div key={finding.rule + '-' + finding.strategy + '-' + index} className="rounded-lg border p-3"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-2"><Badge variant={finding.severity === '阻断' ? 'destructive' : finding.severity === '警告' ? 'secondary' : 'outline'}>{finding.severity}</Badge><span className="text-xs text-muted-foreground" title={'规则编号 ' + finding.rule}>{finding.title}</span></div><Badge variant="outline">{finding.status}</Badge></div><p className="mt-2 text-sm font-medium">{finding.strategy} · {finding.title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{finding.detail}</p>{finding.excerpt && <p className="mt-2 rounded bg-muted/60 px-2 py-1 font-mono text-[11px] text-muted-foreground">命中片段：{finding.excerpt}（位置 {finding.index}，长度 {finding.length}）</p>}{finding.remediation && <p className="mt-1 text-xs text-emerald-700">整改建议：{finding.remediation}</p>}</div>)}<p className="text-[11px] leading-5 text-muted-foreground">另有 {result.findings.filter((finding) => finding.severity === '提示').length} 条提示级命中：关键词出现在否定语境中（例如「无法承诺收益」），判定为通过，不计入待处置项。</p></CardContent></Card>
      <CollapsibleCard title="执行记录" hint="每一步的时间和内容，用于复核" icon={<FileCheck2 className="size-4 text-primary" />} ><div className="relative space-y-4 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-border">{audit.map((item) => <div key={item.seq} className="relative grid grid-cols-[12px_70px_120px_1fr] items-start gap-3 text-xs"><i className="mt-1 size-2.5 rounded-full border-2 border-background bg-primary ring-1 ring-primary" /><span className="font-mono text-muted-foreground">{formatAuditTime(item.at)}</span><span className="font-medium">{item.actor}</span><span><strong className="font-medium">{item.action}</strong><br /><span className="leading-5 text-muted-foreground">{item.result}</span>{item.model && <span className="ml-1 font-mono text-[10px] text-muted-foreground">[{item.model}]</span>}</span></div>)}</div></CollapsibleCard>
    </div>
    <CollapsibleCard title="本次任务的完整记录" hint="场景设置、模型与规则版本、随机种子、审批人" icon={<ListChecks className="size-4 text-primary" />} >{taskFacts.map(([label, value]) => <div key={label} className="rounded-lg border bg-muted/25 p-3"><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-1 break-all font-mono text-xs">{value}</p></div>)}</CollapsibleCard>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><Star className="size-4 text-primary" />人工反馈</CardTitle><CardDescription>反馈仅用于生成候选技能，不会自动修改引擎参数。</CardDescription></CardHeader><CardContent className="space-y-3">
      <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">评分</span>{[1, 2, 3, 4, 5].map((value) => <Button key={value} size="sm" variant={rating === value ? 'default' : 'outline'} onClick={() => { setRating(value); setFeedbackState('idle'); }}>{value}</Button>)}</div>
      <Textarea aria-label="反馈备注" value={comment} onChange={(event) => { setComment(event.target.value); setFeedbackState('idle'); }} placeholder="可填写对本次规划、策略或合规判定的意见（选填）" className="min-h-20 resize-none" />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => void submitFeedback()} disabled={!taskId || feedbackState === 'saving'}>{feedbackState === 'saving' ? <LoaderCircle className="animate-spin" /> : <ThumbsUp />}提交反馈</Button>
        {!taskId && <span className="text-xs text-amber-700">当前结果为本地计算，提交反馈前需先执行一次服务端任务。</span>}
        {feedbackState === 'saved' && <span className="text-xs text-emerald-700">反馈已写入审计视图。</span>}
        {feedbackState === 'error' && <span className="text-xs text-rose-700">反馈提交失败，请稍后重试。</span>}
      </div>
    </CardContent></Card>
    <Alert className="border-sky-200 bg-sky-50 text-sky-900"><UserRoundCheck /><AlertTitle>人工确认已开启</AlertTitle><AlertDescription>平台仅提供分析和建议。高风险客户触达、产品推荐和任何交易操作均需具备相应权限的人员确认。</AlertDescription></Alert>
  </div>;
}

type SkillRow = {
  id: string;
  name: string;
  version: number;
  status: string;
  definition: unknown;
  metrics: Record<string, unknown> | null;
  sourceTaskId: string | null;
  createdAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
};

const skillStatusMeta: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
  candidate: { label: '候选', variant: 'secondary' },
  approved: { label: '已批准', variant: 'default' },
  archived: { label: '已归档', variant: 'outline' },
  rejected: { label: '已拒绝', variant: 'destructive' },
};

/**
 * 把效用换算成「相对不主动沟通」的四项分值。
 *
 * 为什么必须四列一起换算：原始效用里成本与打扰各乘了效用权重，而权重不显示在界面上，
 * 读者直接按「风险改善 − 人力成本 − 打扰代价」相减会得到错误的排序，甚至得出与系统相反的结论。
 * 这里把四列都换成相对基准且同一量纲的数值，读者可以直接相减核对：
 *   综合推荐度 = 风险改善 − 人力成本 − 打扰代价
 * 成本与打扰以负值显示，表示它们是扣分项。
 */
function relativeBreakdown(result: SimulationResult) {
  const { avoid, cost: costWeight, wake: wakeWeight } = result.utilityWeights;
  const baseline = result.strategies.find((item) => item.id === 'baseline') ?? result.strategies[0];
  const base = baseline.utility;
  const baseTotal = avoid * base.avoidance - costWeight * base.cost - wakeWeight * base.wake;
  const of = (utility: { avoidance: number; cost: number; wake: number }) => {
    const total = avoid * utility.avoidance - costWeight * utility.cost - wakeWeight * utility.wake;
    return {
      total: (total - baseTotal) * 100,
      avoidance: avoid * (utility.avoidance - base.avoidance) * 100,
      // 取正值：表示「比不行动多付出的部分」，公式里以减号出现，读者可直接按公式相减
      cost: costWeight * (utility.cost - base.cost) * 100,
      wake: wakeWeight * (utility.wake - base.wake) * 100,
    };
  };
  return { of, baseline: of(base) };
}

/** 可折叠卡片：把次要信息默认收起，降低首屏信息密度，需要时展开即可。 */
function CollapsibleCard({
  title,
  hint,
  icon,
  children,
}: {
  title: string;
  hint: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <details className="group rounded-xl border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="flex items-center gap-2 font-heading font-semibold">{icon}{title}</span>
          <span className="text-xs text-muted-foreground">{hint}</span>
        </div>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <span className="group-open:hidden">展开</span>
          <span className="hidden group-open:inline">收起</span>
          <ChevronRight className="size-4 transition-transform group-open:rotate-90" />
        </span>
      </summary>
      <div className="border-t px-6 py-4">{children}</div>
    </details>
  );
}

/** 分层对比开关的中文层名：界面上不应出现 disablePsychology 这类代码变量名。 */
const ablationNameLabels: Record<string, string> = {
  disablePsychology: '关闭心理层',
  disableContagion: '关闭传播层',
  disableMemory: '关闭记忆层',
  disableCompliance: '关闭合规层',
};

/** 技能指标的中文标签：字段名是给程序看的，界面必须给业务人员看得懂的名字。 */
const metricLabels: Record<string, string> = {
  score: '效果评分',
  peakPanic: '恐慌峰值',
  finalSell: '卖出倾向',
  finalChurn: '流失风险',
  findings: '合规发现',
  blockedFindings: '其中已拦下的违规项',
  customerCount: '客户数量',
  timeSteps: '推演段数',
  seed: '随机种子',
  engineMs: '计算耗时（毫秒）',
  ruleVersion: '规则版本',
};

function metricEntries(metrics: Record<string, unknown> | null) {
  if (!metrics) return [] as Array<[string, string]>;
  // score 是效用分而不是占比，按百分号显示会被误读成「把握有多大」，因此不在此列。
  const rateKeys = new Set(['peakPanic', 'finalSell', 'finalChurn']);
  return Object.entries(metrics)
    .filter(([, value]) => value !== null && value !== undefined)
    .map(([key, value]) => [
      metricLabels[key] ?? key,
      typeof value === 'number' && rateKeys.has(key) ? percent(value, 1) : String(value),
    ] as [string, string]);
}

function SkillsView() {
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    try {
      const response = await fetch('/api/skills');
      if (!response.ok) throw new Error('skills-api-failed');
      const data = (await response.json()) as { skills: SkillRow[] };
      setSkills(data.skills);
      setError('');
    } catch {
      setError('技能列表加载失败，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/skills')
      .then((response) =>
        response.ok
          ? (response.json() as Promise<{ skills: SkillRow[] }>)
          : Promise.reject(new Error('skills-api-failed')),
      )
      .then((data) => {
        if (cancelled) return;
        setSkills(data.skills);
        setError('');
      })
      .catch(() => {
        if (!cancelled) setError('技能列表加载失败，请稍后重试。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const decide = async (id: string, action: 'approve' | 'reject' | 'rollback') => {
    setBusy(id + ':' + action);
    try {
      await fetch('/api/skills/' + id + '/' + action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actor: 'compliance_reviewer' }),
      });
      await load(false);
    } catch {
      setError('审批操作失败，请稍后重试。');
    } finally {
      setBusy(null);
    }
  };

  const counts = {
    candidate: skills.filter((skill) => skill.status === 'candidate').length,
    approved: skills.filter((skill) => skill.status === 'approved').length,
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-heading text-xl font-semibold">技能与审批</h2><p className="mt-1 text-sm text-muted-foreground">任务完成后，系统会把这次的做法整理成一条候选技能，人工批准后才会被后续任务采用。</p></div><div className="flex items-center gap-2"><Badge variant="secondary">候选 {counts.candidate}</Badge><Badge>{counts.approved} 已批准</Badge><Button variant="outline" size="sm" onClick={() => void load(true)} disabled={loading}>{loading ? <LoaderCircle className="animate-spin" /> : <RefreshCw />}刷新</Button></div></div>
    <Alert className="border-sky-200 bg-sky-50 text-sky-900"><ListChecks /><AlertTitle>无审批在线学习已关闭</AlertTitle><AlertDescription>系统不会自动修改引擎参数或策略权重，候选技能 必须经人工批准后方可复用。</AlertDescription></Alert>
    {error && <Alert className="border-rose-200 bg-rose-50 text-rose-900"><TriangleAlert /><AlertTitle>加载失败</AlertTitle><AlertDescription>{error}</AlertDescription></Alert>}
    {!loading && skills.length === 0 && <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">暂无技能记录。执行一次服务端任务后，系统会沉淀候选技能。</CardContent></Card>}
    <div className="grid gap-4 xl:grid-cols-2">{skills.map((skill) => {
      const status = skillStatusMeta[skill.status] ?? { label: skill.status, variant: 'outline' as const };
      return <Card key={skill.id}><CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle className="flex items-center gap-2"><Boxes className="size-4 text-primary" />{skill.name}<Badge variant="outline">v{skill.version}</Badge></CardTitle><CardDescription className="mt-1">创建 {formatDateTime(skill.createdAt)}{skill.decidedAt ? ' · 审批 ' + formatDateTime(skill.decidedAt) + '（' + (skill.decidedBy ?? '未记录') + '）' : ''}</CardDescription></div><Badge variant={status.variant}>{status.label}</Badge></div></CardHeader><CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{metricEntries(skill.metrics).map(([key, value]) => <div key={key} className="rounded-lg border bg-muted/25 p-2"><p className="text-[10px] text-muted-foreground">{key}</p><p className="mt-0.5 font-mono text-xs">{value}</p></div>)}</div>
        {skill.sourceTaskId && <p className="text-[11px] text-muted-foreground" title={skill.sourceTaskId}>来自一次已完成的任务</p>}
        <div className="flex flex-wrap gap-2">
          {skill.status === 'candidate' && <Button size="sm" onClick={() => void decide(skill.id, 'approve')} disabled={busy !== null}><CheckCircle2 />批准</Button>}
          {skill.status === 'candidate' && <Button size="sm" variant="outline" onClick={() => void decide(skill.id, 'reject')} disabled={busy !== null}><Ban />拒绝</Button>}
          {(skill.status === 'approved' || skill.status === 'archived') && <Button size="sm" variant="outline" onClick={() => void decide(skill.id, 'rollback')} disabled={busy !== null}><RotateCcw />回滚到上一版本</Button>}
        </div>
      </CardContent></Card>;
    })}</div>
  </div>;
}

export function SandboxApp() {
  const [active, setActive] = useState<View>('tasks');
  const [result, setResult] = useState<SimulationResult>(() => runSimulation());
  const [outcome, setOutcome] = useState<RunOutcome | null>(null);
  const [runState, setRunState] = useState<RunState>(emptyRunState);
  const [prompt, setPrompt] = useState('市场今天下跌 10%，请分析持有高波动产品的客户，生成三套沟通方案，模拟未来 24 小时的客户群体反应，并告诉我应该优先联系谁。');
  const taskIdRef = useRef<string | null>(null);
  const stateRef = useRef<RunState>(emptyRunState);

  const handleState = (next: RunState) => {
    taskIdRef.current = next.taskId;
    stateRef.current = next;
    setRunState(next);
  };

  const handleRun = async () => {
    if (runState.phase === 'submitting' || runState.phase === 'streaming') return;
    const submitting: RunState = { ...emptyRunState, phase: 'submitting' };
    stateRef.current = submitting;
    setRunState(submitting);
    try {
      const base = await startServerTask(prompt, handleState);
      const completed = completeOutcome(base, base.strategyDrafts);
      setOutcome(completed);
      setResult(completed.result);
      setRunState(completed.state);
    } catch (error) {
      const degradation = degradationOf(error);
      const parsed = parseScenarioPrompt(prompt);
      const fallback = localOutcome(parsed.config, [], degradation.note, {
        ...stateRef.current,
        phase: 'finished',
        taskId: taskIdRef.current ?? stateRef.current.taskId,
      });
      setOutcome(fallback);
      setResult(fallback.result);
      setRunState({ ...fallback.state, phase: 'failed', errorCode: degradation.code, errorMessage: degradation.label });
    }
  };

  const handleCancel = () => {
    const taskId = taskIdRef.current;
    if (taskId) void cancelServerTask(taskId);
    setRunState((current) => ({ ...current, phase: 'failed', errorCode: 'CANCELLED', errorMessage: '任务已按人工请求取消。' }));
  };

  let content;
  if (active === 'customers') content = <CustomerInsights result={result} />;
  else if (active === 'sandbox') content = <SandboxView result={result} />;
  else if (active === 'audit') content = <AuditView result={result} outcome={outcome} onNavigate={setActive} />;
  else if (active === 'skills') content = <SkillsView />;
  else content = <TaskCenter result={result} runState={runState} prompt={prompt} setPrompt={setPrompt} onRun={() => void handleRun()} onCancel={handleCancel} onNavigate={setActive} />;

  return <AppShell active={active} onNavigate={setActive} scenario={result.scenario}>{content}</AppShell>;
}
