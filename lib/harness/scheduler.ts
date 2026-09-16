export type BackgroundStrategy = 'after' | 'waitUntil' | 'inline';

type ExecutionContextLike = { waitUntil?: (promise: Promise<unknown>) => void };

/**
 * 后台执行调度：
 * 1) 优先使用 next/server 的 after()，响应返回后继续执行；
 * 2) 回退到运行时提供的 waitUntil；
 * 3) 两者都不可用时同步执行，保证功能不缺失（仅影响响应时延）。
 */
export async function runInBackground(work: () => Promise<void>): Promise<BackgroundStrategy> {
  try {
    const nextServer = (await import('next/server')) as { after?: (task: Promise<unknown> | (() => unknown)) => void };
    if (typeof nextServer.after === 'function') {
      nextServer.after(work);
      return 'after';
    }
  } catch {
    // 忽略：继续尝试 waitUntil 通道。
  }

  try {
    const shim = (await import('vinext/shims/unified-request-context')) as {
      getRequestContext?: () => { executionContext?: ExecutionContextLike | null } | null;
    };
    const context = shim.getRequestContext?.();
    const executionContext = context?.executionContext;
    if (executionContext && typeof executionContext.waitUntil === 'function') {
      executionContext.waitUntil(work());
      return 'waitUntil';
    }
  } catch {
    // 忽略：回退到同步执行。
  }

  await work();
  return 'inline';
}
