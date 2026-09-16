import { describe, expect, it, vi } from 'vitest';
import { createMemoryStore } from './memory-store';
import { runTask } from './runner';
import type { ModelConfig } from '../model/adapter';
import type { HarnessEvent } from './types';

const prompt = '市场下跌 12%，持续 48 小时，针对持有高波动产品的 120 名客户做压力测试，10 个时间步。';

function failingModelConfig(): ModelConfig {
  return {
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'test-key',
    model: 'gpt-test',
    timeoutMs: 5,
    maxRetries: 0,
  };
}

describe('任务生命周期', () => {
  it('规则模式下按 8 个工具顺序完整执行并产出结果', async () => {
    const store = createMemoryStore({ id: 'task-1', prompt });
    const outcome = await runTask({ store, config: null, taskId: 'task-1', prompt });
    const { events, task, simulations, skills } = store.snapshot();

    expect(outcome.status).toBe('succeeded');
    expect(outcome.mode).toBe('rule');
    expect(task.status).toBe('succeeded');
    expect(simulations).toHaveLength(1);
    expect(skills).toHaveLength(1);

    const started = events.filter((event) => event.type === 'step.started').map((event) => event.payload.tool);
    expect(started).toEqual([
      'scenario.extract',
      'customers.query',
      'profile.build',
      'graph.build',
      'strategy.draft',
      'simulation.run',
      'compliance.review',
      'report.compose',
    ]);
    expect(events[0].type).toBe('task.status');
    expect(events[0].payload.status).toBe('running');
    expect(events.at(-1)?.type).toBe('task.completed');
  });

  it('首个事件先于任何模型调用写入，保证首帧反馈与模型延迟解耦', async () => {
    const store = createMemoryStore({ id: 'task-2', prompt });
    const events: HarnessEvent[] = [];
    const wrapped = { ...store, appendEvent: async (event: HarnessEvent & { taskId: string }) => { events.push(event); await store.appendEvent(event); } };
    await runTask({ store: wrapped, config: failingModelConfig(), taskId: 'task-2', prompt, stepTimeoutMs: 50 });
    expect(events[0].type).toBe('task.status');
    expect(events[0].payload.stage).toBe('planning');
    const plan = events[0].payload.plan as { steps: unknown[] };
    expect(plan.steps).toHaveLength(8);
    const firstStep = events.find((event) => event.type === 'step.started');
    expect(firstStep?.payload.tool).toBe('scenario.extract');
  });

  it('每一步都会产生 step.completed 与真实时间戳审计', async () => {
    const store = createMemoryStore({ id: 'task-3', prompt });
    await runTask({ store, config: null, taskId: 'task-3', prompt });
    const { events } = store.snapshot();
    const completed = events.filter((event) => event.type === 'step.completed');
    expect(completed).toHaveLength(8);
    completed.forEach((event) => expect(typeof event.at).toBe('number'));
  });
});

describe('模型失败降级', () => {
  it('模型不可用时降级为规则路径并显式标注', async () => {
    // 显式让模型请求失败（而不是依赖 DNS 行为），保证降级路径可复现。
    vi.stubGlobal('fetch', () => Promise.reject(new Error('model-unreachable')));
    try {
      const store = createMemoryStore({ id: 'task-4', prompt });
      const outcome = await runTask({ store, config: failingModelConfig(), taskId: 'task-4', prompt, stepTimeoutMs: 60 });
      const { task, events } = store.snapshot();
      expect(outcome.status).toBe('succeeded');
      expect(outcome.mode).toBe('degraded');
      expect(task.mode).toBe('degraded');
      const completed = events.find((event) => event.type === 'task.completed');
      const notes = (completed?.payload.notes ?? []) as string[];
      expect(notes.length).toBeGreaterThan(0);
      expect(notes.join(' ')).toContain('降级');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('单步超时不会静默忽略，会记录 step.failed', async () => {
    // 用永不返回的 fetch 替代真实网络，避免 1ms 计时器与 DNS 失败之间的竞态。
    vi.stubGlobal('fetch', () => new Promise(() => {}));
    try {
      const store = createMemoryStore({ id: 'task-5', prompt });
      const outcome = await runTask({
        store,
        config: failingModelConfig(),
        taskId: 'task-5',
        prompt,
        stepTimeoutMs: 1,
        maxAttempts: 1,
      });
      const { events } = store.snapshot();
      expect(outcome.status).toBe('failed');
      expect(outcome.errorCode).toBe('TASK_TIMEOUT');
      expect(events.some((event) => event.type === 'task.failed')).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('取消与可观测性', () => {
  it('取消请求在步骤边界生效并标记 cancelled', async () => {
    const store = createMemoryStore({ id: 'task-6', prompt });
    const wrapped = {
      ...store,
      async updateTask(id: string, patch: Record<string, unknown>) {
        await store.updateTask(id, patch);
        if (patch.status === 'running') await store.updateTask(id, { status: 'cancel_requested' });
      },
      async getTask(id: string) {
        return store.getTask(id);
      },
    };
    const outcome = await runTask({ store: wrapped, config: null, taskId: 'task-6', prompt });
    const { task, events } = store.snapshot();
    expect(outcome.status).toBe('cancelled');
    expect(outcome.errorCode).toBe('CANCELLED');
    expect(task.status).toBe('cancelled');
    expect(events.some((event) => event.payload.errorCode === 'CANCELLED')).toBe(true);
  });

  it('SSE 事件序号严格递增，便于断点续传', async () => {
    const store = createMemoryStore({ id: 'task-7', prompt });
    await runTask({ store, config: null, taskId: 'task-7', prompt });
    const { events } = store.snapshot();
    events.forEach((event, index) => expect(event.seq).toBe(index + 1));
    const tail = await store.getEvents('task-7', events.length - 2);
    expect(tail).toHaveLength(2);
  });

  it('模拟过程逐时间步推送快照事件', async () => {
    const store = createMemoryStore({ id: 'task-8', prompt });
    await runTask({ store, config: null, taskId: 'task-8', prompt });
    const { events } = store.snapshot();
    const snapshots = events.filter((event) => event.type === 'simulation.snapshot');
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots[0].payload).toHaveProperty('panic');
    expect(snapshots[0].payload).toHaveProperty('step');
  });
});
