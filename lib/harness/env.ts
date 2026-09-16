let cached: Record<string, unknown> | null = null;

/**
 * 读取运行时环境变量：优先 Workers 绑定，其次进程环境。
 * 使用动态导入以便在非 Workers 环境（例如单元测试）中安全降级。
 */
export async function readRuntimeEnv(): Promise<Record<string, unknown>> {
  if (cached) return cached;
  const merged: Record<string, unknown> = {};
  if (typeof process !== 'undefined' && process.env) {
    Object.assign(merged, process.env as unknown as Record<string, unknown>);
  }
  try {
    const mod = (await import('cloudflare:workers')) as unknown as { env?: Record<string, unknown> };
    if (mod.env) Object.assign(merged, mod.env);
  } catch {
    // 非 Workers 运行时：只使用进程环境变量。
  }
  cached = merged;
  return merged;
}

export function resetRuntimeEnvCache() {
  cached = null;
}
