import { createD1Store } from '../../../../../lib/harness/store';
import type { TaskStatus } from '../../../../../lib/harness/types';

const terminalStatuses: TaskStatus[] = ['succeeded', 'failed', 'cancelled'];
const pollIntervalMs = 300;
const heartbeatMs = 15000;
const maxStreamMs = 120000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 真实 SSE：从 task_events 增量推送执行事件，直到任务进入终态。
 * 首个事件（step.started）在任何模型调用之前写入，因此首帧延迟与模型无关。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const url = new URL(request.url);
  let cursor = Number(url.searchParams.get('after') ?? 0);
  if (!Number.isFinite(cursor) || cursor < 0) cursor = 0;

  const store = await createD1Store();
  const task = await store.getTask(id);
  if (!task) return Response.json({ error: '未找到任务。' }, { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const deadline = Date.now() + maxStreamMs;
      let lastHeartbeat = Date.now();
      let closed = false;

      const close = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          // 客户端已断开。
        }
      };

      const flush = async () => {
        const events = await store.getEvents(id, cursor);
        for (const event of events) {
          cursor = event.seq;
          controller.enqueue(
            encoder.encode(
              `id: ${event.seq}\nevent: ${event.type}\ndata: ${JSON.stringify({ seq: event.seq, type: event.type, at: event.at, payload: event.payload })}\n\n`,
            ),
          );
        }
        return events.length;
      };

      try {
        controller.enqueue(encoder.encode(': connected\nretry: 2000\n\n'));
        await flush();
        while (!request.signal.aborted && Date.now() < deadline) {
          const status = (await store.getTask(id))?.status ?? null;
          if (status && terminalStatuses.includes(status)) {
            await flush();
            break;
          }
          await sleep(pollIntervalMs);
          await flush();
          if (Date.now() - lastHeartbeat > heartbeatMs) {
            lastHeartbeat = Date.now();
            controller.enqueue(encoder.encode(`event: heartbeat\ndata: ${JSON.stringify({ at: Date.now() })}\n\n`));
          }
        }
      } catch {
        // 忽略读取异常，直接关闭连接；客户端会回退到轮询。
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
