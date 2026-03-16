import pino from 'pino';
import { A0Client, A0ClientError, A0TimeoutError } from '../src/a0Client';

const logger = pino({ enabled: false });

function createConfig(overrides: Partial<ConstructorParameters<typeof A0Client>[0]> = {}) {
  return {
    A0_BASE_URL: 'http://a0.example',
    A0_API_KEY: 'secret',
    A0_TIMEOUT_MS: 50,
    A0_DEFAULT_CONTEXT_LIFETIME_HOURS: 48,
    A0_RETRY_DELAY_MS: 5,
    COST_LOG_FETCH_COUNT: 100,
    ...overrides
  };
}

describe('A0Client', () => {
  it('sends messages with the expected payload and returns the parsed response', async () => {
    const fetchFn: typeof fetch = async (input, init) => {
      expect(String(input)).toBe('http://a0.example/api_message');
      expect(init?.headers).toMatchObject({
        'Content-Type': 'application/json',
        'X-API-KEY': 'secret'
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        message: 'hello',
        context_id: 'ctx-1',
        lifetime_hours: 48
      });

      return new Response(JSON.stringify({ context_id: 'ctx-2', response: 'done' }), { status: 200 });
    };

    const client = new A0Client(createConfig(), logger, fetchFn);
    const result = await client.sendMessage('hello', 'ctx-1');

    expect(result).toEqual({ context_id: 'ctx-2', response: 'done' });
  });

  it('retries once on 5xx responses', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ message: 'boom' }), { status: 500 });
      }

      return new Response(JSON.stringify({ context_id: 'ctx-2', response: 'done' }), { status: 200 });
    };

    const client = new A0Client(createConfig(), logger, fetchFn, async (ms) => {
      sleeps.push(ms);
    });

    const result = await client.sendMessage('hello');

    expect(result.context_id).toBe('ctx-2');
    expect(calls).toBe(2);
    expect(sleeps).toEqual([5]);
  });

  it('throws an auth error on 401 responses', async () => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ message: 'bad key' }), { status: 401 });
    const client = new A0Client(createConfig(), logger, fetchFn);

    await expect(client.sendMessage('hello')).rejects.toMatchObject({
      message: 'A0 authentication failed.',
      statusCode: 401
    });
  });

  it('throws a timeout error when the request is aborted', async () => {
    const fetchFn: typeof fetch = async (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });

    const client = new A0Client(createConfig({ A0_TIMEOUT_MS: 5 }), logger, fetchFn);

    await expect(client.sendMessage('hello')).rejects.toBeInstanceOf(A0TimeoutError);
  });

  it('parses log responses from different envelope shapes', async () => {
    const fetchFn: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes('/api_log_get')) {
        return new Response(JSON.stringify({ items: [{ content: 'first' }], logs: [{ content: 'second' }] }), {
          status: 200
        });
      }

      return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    };
    const client = new A0Client(createConfig(), logger, fetchFn);

    await expect(client.getLogs('ctx-1', 10)).resolves.toEqual([{ content: 'first' }]);
  });

  it('parses log responses from the logs envelope and falls back to an empty list', async () => {
    const client = new A0Client(
      createConfig(),
      logger,
      async () => new Response(JSON.stringify({ logs: [{ content: 'second' }] }), { status: 200 })
    );

    await expect(client.getLogs('ctx-1', 10)).resolves.toEqual([{ content: 'second' }]);

    const fallbackClient = new A0Client(createConfig(), logger, async () => new Response(JSON.stringify({}), { status: 200 }));
    await expect(fallbackClient.getLogs('ctx-1', 10)).resolves.toEqual([]);
  });

  it('throws a descriptive error when A0 returns a 4xx message', async () => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ message: 'project not found' }), { status: 400 });
    const client = new A0Client(createConfig(), logger, fetchFn);

    await expect(client.sendMessage('hello')).rejects.toMatchObject({
      message: 'project not found',
      statusCode: 400
    });
  });

  it('fails when A0 responds without the required fields', async () => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ response: 'missing context id' }), { status: 200 });
    const client = new A0Client(createConfig(), logger, fetchFn);

    await expect(client.sendMessage('hello')).rejects.toMatchObject({
      message: 'A0 response was missing required fields.'
    });
  });

  it('retries once on network errors and then surfaces the failure', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    const fetchFn: typeof fetch = async () => {
      calls += 1;
      throw new Error('socket hang up');
    };
    const client = new A0Client(createConfig(), logger, fetchFn, async (ms) => {
      sleeps.push(ms);
    });

    await expect(client.sendMessage('hello')).rejects.toMatchObject({
      message: 'socket hang up'
    });
    expect(calls).toBe(2);
    expect(sleeps).toEqual([5]);
  });

  it('returns true when the health endpoint is reachable', async () => {
    const fetchFn: typeof fetch = async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
    const client = new A0Client(createConfig(), logger, fetchFn);

    await expect(client.healthCheck()).resolves.toBe(true);
  });

  it('returns false when health checks throw', async () => {
    const fetchFn: typeof fetch = async () => {
      throw new Error('network down');
    };

    const client = new A0Client(createConfig(), logger, fetchFn);
    await expect(client.healthCheck()).resolves.toBe(false);
  });
});
