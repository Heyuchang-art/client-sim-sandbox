export type ModelConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
};

export type ModelUsage = {
  promptTokens?: number;
  completionTokens?: number;
};

export type ModelCallResult<T> = {
  data: T;
  model: string;
  latencyMs: number;
  usage: ModelUsage;
  /** 是否来自降级路径（未调用模型或模型不可用后的规则兜底）。 */
  degraded: boolean;
  reason?: string;
  attempts: number;
};

export class ModelUnavailableError extends Error {
  readonly code = 'MODEL_UNAVAILABLE';
  constructor(message = '模型服务不可用或未配置。') {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

export class ModelTimeoutError extends Error {
  readonly code = 'MODEL_TIMEOUT';
  constructor(message = '模型调用超时。') {
    super(message);
    this.name = 'ModelTimeoutError';
  }
}

export class ModelFormatError extends Error {
  readonly code = 'MODEL_FORMAT';
  constructor(message = '模型输出无法解析为约定的 JSON 结构。') {
    super(message);
    this.name = 'ModelFormatError';
  }
}

export function loadModelConfig(env: Record<string, unknown>): ModelConfig | null {
  const apiKey = typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY.trim() : '';
  const model = typeof env.OPENAI_MODEL === 'string' ? env.OPENAI_MODEL.trim() : '';
  if (!apiKey || !model) return null;
  const baseUrl = (typeof env.OPENAI_BASE_URL === 'string' && env.OPENAI_BASE_URL.trim() !== ''
    ? env.OPENAI_BASE_URL.trim()
    : 'https://api.openai.com/v1').replace(/\/+$/, '');
  const timeoutMs = Number(env.MODEL_TIMEOUT_MS ?? 15000);
  const maxRetries = Number(env.MODEL_MAX_RETRIES ?? 2);
  return {
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 15000,
    maxRetries: Number.isFinite(maxRetries) && maxRetries >= 0 ? Math.min(maxRetries, 4) : 2,
  };
}

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

type ChatJsonParams<T> = {
  config: ModelConfig;
  system: string;
  user: string;
  /** 校验并收敛模型输出；返回 null 表示结构不符合约定。 */
  validate: (value: unknown) => T | null;
  maxOutputTokens?: number;
};

const retryableStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function isRetryable(error: unknown) {
  if (error instanceof ModelTimeoutError) return true;
  if (error instanceof ModelUnavailableError) return true;
  return false;
}

function extractJson(raw: string) {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as unknown;
      } catch {
        return null;
      }
    }
    return null;
  }
}

async function postChat(config: ModelConfig, messages: ChatMessage[], maxOutputTokens: number) {
  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: 0.2,
        max_tokens: maxOutputTokens,
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new ModelTimeoutError();
    }
    throw new ModelUnavailableError(error instanceof Error ? error.message : undefined);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    if (retryableStatuses.has(response.status)) {
      throw new ModelUnavailableError(`模型返回 ${response.status}：${detail.slice(0, 120)}`);
    }
    throw new ModelFormatError(`模型拒绝请求（${response.status}）：${detail.slice(0, 120)}`);
  }

  const body = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = body.choices?.[0]?.message?.content ?? '';
  return {
    content,
    usage: {
      promptTokens: body.usage?.prompt_tokens,
      completionTokens: body.usage?.completion_tokens,
    },
  };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 调用 OpenAI 兼容接口并强制结构化输出。
 * - 超时 / 5xx / 429 按指数退避重试；
 * - JSON 解析失败先做一次修复重试，仍失败抛 ModelFormatError 交给上层降级；
 * - 未配置密钥时由调用方直接走规则路径，不进入本函数。
 */
export async function chatJson<T>(params: ChatJsonParams<T>): Promise<ModelCallResult<T>> {
  const { config, system, user, validate, maxOutputTokens = 900 } = params;
  const startedAt = Date.now();
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    if (attempt > 0) await sleep(Math.min(2400, 300 * 2 ** (attempt - 1)));
    try {
      const { content, usage } = await postChat(
        config,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        maxOutputTokens,
      );
      const parsed = extractJson(content);
      if (parsed !== null) {
        const validated = validate(parsed);
        if (validated !== null) {
          return {
            data: validated,
            model: config.model,
            latencyMs: Date.now() - startedAt,
            usage,
            degraded: false,
            attempts: attempt + 1,
          };
        }
      }
      // 结构不符合约定：附带错误说明做一次修复重试。
      const repair = await postChat(
        config,
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
          { role: 'assistant', content: content.slice(0, 2000) },
          { role: 'user', content: '上面的 JSON 不符合约定结构，请只返回修正后的 JSON 对象，不要添加解释。' },
        ],
        maxOutputTokens,
      );
      const repaired = extractJson(repair.content);
      const validated = repaired === null ? null : validate(repaired);
      if (validated !== null) {
        return {
          data: validated,
          model: config.model,
          latencyMs: Date.now() - startedAt,
          usage: repair.usage,
          degraded: false,
          attempts: attempt + 1,
        };
      }
      throw new ModelFormatError(`模型输出无法通过结构校验：${repair.content.slice(0, 160)}`);
    } catch (error) {
      lastError = error;
      if (!isRetryable(error)) break;
    }
  }

  if (lastError instanceof ModelFormatError) throw lastError;
  if (lastError instanceof ModelTimeoutError) throw lastError;
  throw new ModelUnavailableError(lastError instanceof Error ? lastError.message : undefined);
}

export function errorCodeOf(error: unknown) {
  if (error instanceof ModelTimeoutError) return 'MODEL_TIMEOUT' as const;
  if (error instanceof ModelFormatError) return 'MODEL_FORMAT' as const;
  if (error instanceof ModelUnavailableError) return 'MODEL_UNAVAILABLE' as const;
  return 'INTERNAL' as const;
}
