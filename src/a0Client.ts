import type { Logger } from 'pino';
import type { A0LogEntry, A0MessageResponse } from './contracts';

export class A0ClientError extends Error {
  public readonly statusCode?: number;

  public constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'A0ClientError';
    this.statusCode = statusCode;
  }
}

export class A0TimeoutError extends Error {
  public constructor(message = 'A0 request timed out.') {
    super(message);
    this.name = 'A0TimeoutError';
  }
}

export interface A0ClientConfig {
  A0_BASE_URL: string;
  A0_API_KEY: string;
  A0_TIMEOUT_MS: number;
  A0_DEFAULT_CONTEXT_LIFETIME_HOURS: number;
  A0_RETRY_DELAY_MS: number;
  COST_LOG_FETCH_COUNT: number;
}

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class A0Client {
  public constructor(
    private readonly config: A0ClientConfig,
    private readonly logger: Logger,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: SleepFn = defaultSleep
  ) {}

  public async sendMessage(message: string, contextId?: string | null): Promise<A0MessageResponse> {
    const body = {
      message,
      lifetime_hours: this.config.A0_DEFAULT_CONTEXT_LIFETIME_HOURS,
      ...(contextId ? { context_id: contextId } : {})
    };

    const response = await this.requestJson<A0MessageResponse>(
      '/api_message',
      {
        method: 'POST',
        body: JSON.stringify(body)
      },
      true
    );

    if (!response.context_id || typeof response.response !== 'string') {
      throw new A0ClientError('A0 response was missing required fields.');
    }

    return response;
  }

  public async getLogs(contextId: string, length = this.config.COST_LOG_FETCH_COUNT): Promise<A0LogEntry[]> {
    const query = new URLSearchParams({
      context_id: contextId,
      length: String(length)
    });

    const response = await this.requestJson<unknown>(`/api_log_get?${query.toString()}`, { method: 'GET' }, false);

    if (Array.isArray(response)) {
      return response as A0LogEntry[];
    }

    if (
      response &&
      typeof response === 'object' &&
      'items' in response &&
      Array.isArray((response as { items: unknown }).items)
    ) {
      return (response as { items: A0LogEntry[] }).items;
    }

    if (
      response &&
      typeof response === 'object' &&
      'logs' in response &&
      Array.isArray((response as { logs: unknown }).logs)
    ) {
      return (response as { logs: A0LogEntry[] }).logs;
    }

    return [];
  }

  public async terminateChat(contextId: string): Promise<void> {
    await this.requestJson('/api_terminate_chat', {
      method: 'POST',
      body: JSON.stringify({ context_id: contextId })
    });
  }

  public async healthCheck(): Promise<boolean> {
    try {
      const url = new URL('/api_health', this.config.A0_BASE_URL);
      const response = await this.fetchFn(url, {
        method: 'GET',
        headers: {
          'X-API-KEY': this.config.A0_API_KEY
        }
      });

      return response.ok;
    } catch (error) {
      this.logger.warn({ err: error }, 'Agent Zero health check failed.');
      return false;
    }
  }

  private async requestJson<T>(
    pathname: string,
    init: RequestInit,
    allowRetry = false,
    attempt = 0
  ): Promise<T> {
    const url = new URL(pathname, this.config.A0_BASE_URL);
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort();
    }, this.config.A0_TIMEOUT_MS);

    try {
      const response = await this.fetchFn(url, {
        ...init,
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-API-KEY': this.config.A0_API_KEY,
          ...(init.headers ?? {})
        }
      });

      const text = await response.text();
      const json = text ? (JSON.parse(text) as T) : ({} as T);

      if (response.ok) {
        return json;
      }

      if (response.status === 401) {
        throw new A0ClientError('A0 authentication failed.', 401);
      }

      if (response.status >= 500 && allowRetry && attempt === 0) {
        this.logger.warn({ statusCode: response.status }, 'A0 server error. Retrying once.');
        await this.sleep(this.config.A0_RETRY_DELAY_MS);
        return this.requestJson<T>(pathname, init, allowRetry, attempt + 1);
      }

      const message =
        json && typeof json === 'object' && 'message' in (json as Record<string, unknown>)
          ? String((json as Record<string, unknown>).message)
          : `A0 request failed with status ${response.status}.`;

      throw new A0ClientError(message, response.status);
    } catch (error) {
      if (error instanceof A0ClientError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new A0TimeoutError();
      }

      if (allowRetry && attempt === 0) {
        this.logger.warn({ err: error }, 'A0 request failed due to network error. Retrying once.');
        await this.sleep(this.config.A0_RETRY_DELAY_MS);
        return this.requestJson<T>(pathname, init, allowRetry, attempt + 1);
      }

      throw new A0ClientError(error instanceof Error ? error.message : 'A0 request failed.');
    } finally {
      clearTimeout(timeout);
    }
  }
}
