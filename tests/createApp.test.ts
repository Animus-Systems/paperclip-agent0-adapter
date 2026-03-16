import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import pino from 'pino';
import request from 'supertest';
import { A0TimeoutError } from '../src/a0Client';
import { loadConfig } from '../src/config';
import { ContextStore } from '../src/contextStore';
import { createApp } from '../src/createApp';

const logger = pino({ enabled: false });

function createDbPath(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paperclip-a0-createapp-'));
  return path.join(directory, 'contexts.sqlite');
}

function createConfig() {
  return loadConfig({
    NODE_ENV: 'test',
    PORT: '4000',
    A0_BASE_URL: 'http://localhost:50001',
    A0_API_KEY: 'a0-secret',
    A0_TIMEOUT_MS: '1000',
    A0_DEFAULT_CONTEXT_LIFETIME_HOURS: '48',
    A0_RETRY_DELAY_MS: '1',
    ADAPTER_SECRET: 'adapter-secret',
    CONTEXT_DB_PATH: createDbPath(),
    PAPERCLIP_WEBHOOK_SECRET: 'paperclip-secret',
    PAPERCLIP_CALLBACK_RETRY_BASE_MS: '1',
    BUDGET_WARN_THRESHOLD: '2',
    BUDGET_BLOCK_AT_ZERO: 'true',
    COST_LOG_FETCH_COUNT: '25',
    DEFAULT_MODEL_FOR_COST: 'claude-sonnet-4-5',
    DEFAULT_COMPANY_MISSION: 'Mission',
    DEFAULT_PROJECT_GOAL: 'Goal',
    DEFAULT_AGENT_GOAL: 'Mandate',
    LOG_LEVEL: 'info'
  });
}

function createHeartbeatBody() {
  return {
    agent_id: 'agent-1',
    company_id: 'company-1',
    task: {
      id: 'ticket-1',
      title: 'Do work',
      description: 'Finish the assigned work.',
      goal_context: {}
    },
    budget_remaining: 10,
    callback_url: 'https://paperclip.example/callback',
    metadata: {}
  };
}

describe('createApp', () => {
  it('returns health status', async () => {
    const config = createConfig();
    const store = new ContextStore(config.CONTEXT_DB_PATH);
    const app = createApp({
      config,
      logger,
      contextStore: store,
      a0Client: {
        async sendMessage() {
          return { context_id: 'ctx', response: 'done' };
        },
        async getLogs() {
          return [];
        },
        async terminateChat() {
          return;
        },
        async healthCheck() {
          return true;
        }
      } as never,
      paperclipClient: {
        async postResult() {
          return true;
        }
      } as never
    });

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
    store.close();
  });

  it('returns 401 when the adapter secret is missing or invalid', async () => {
    const config = createConfig();
    const store = new ContextStore(config.CONTEXT_DB_PATH);
    const app = createApp({
      config,
      logger,
      contextStore: store,
      a0Client: {
        async sendMessage() {
          return { context_id: 'ctx', response: 'done' };
        },
        async getLogs() {
          return [];
        },
        async terminateChat() {
          return;
        },
        async healthCheck() {
          return true;
        }
      } as never,
      paperclipClient: {
        async postResult() {
          return true;
        }
      } as never
    });

    const response = await request(app).post('/heartbeat').send(createHeartbeatBody());

    expect(response.status).toBe(401);
    store.close();
  });

  it('returns 400 when required payload fields are missing', async () => {
    const config = createConfig();
    const store = new ContextStore(config.CONTEXT_DB_PATH);
    const app = createApp({
      config,
      logger,
      contextStore: store,
      a0Client: {
        async sendMessage() {
          return { context_id: 'ctx', response: 'done' };
        },
        async getLogs() {
          return [];
        },
        async terminateChat() {
          return;
        },
        async healthCheck() {
          return true;
        }
      } as never,
      paperclipClient: {
        async postResult() {
          return true;
        }
      } as never
    });

    const response = await request(app)
      .post('/heartbeat')
      .set('X-Adapter-Secret', 'adapter-secret')
      .send({ agent_id: 'agent-1' });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('company_id');
    store.close();
  });

  it('deduplicates duplicate in-flight tickets', async () => {
    const config = createConfig();
    const store = new ContextStore(config.CONTEXT_DB_PATH);
    let resolveSend: (() => void) | undefined;
    const sendGate = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    let callbackResolve: (() => void) | undefined;
    const callbackDone = new Promise<void>((resolve) => {
      callbackResolve = resolve;
    });
    let sendCalls = 0;

    const app = createApp({
      config,
      logger,
      contextStore: store,
      a0Client: {
        async sendMessage() {
          sendCalls += 1;
          await sendGate;
          return { context_id: 'ctx-1', response: 'done' };
        },
        async getLogs() {
          return [];
        },
        async terminateChat() {
          return;
        },
        async healthCheck() {
          return true;
        }
      } as never,
      paperclipClient: {
        async postResult() {
          callbackResolve?.();
          return true;
        }
      } as never
    });

    const body = createHeartbeatBody();
    const firstRequest = request(app).post('/heartbeat').set('X-Adapter-Secret', 'adapter-secret').send(body);
    const secondRequest = request(app).post('/heartbeat').set('X-Adapter-Secret', 'adapter-secret').send(body);

    const [firstResponse, secondResponse] = await Promise.all([firstRequest, secondRequest]);

    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(secondResponse.body.deduplicated).toBe(true);
    expect(sendCalls).toBe(1);

    resolveSend?.();
    await callbackDone;
    store.close();
  });

  it('posts a timeout callback payload when Agent Zero times out', async () => {
    const config = createConfig();
    const store = new ContextStore(config.CONTEXT_DB_PATH);
    let callbackResolve: (() => void) | undefined;
    const callbackDone = new Promise<void>((resolve) => {
      callbackResolve = resolve;
    });
    let callbackPayload: Record<string, unknown> | undefined;

    const app = createApp({
      config,
      logger,
      contextStore: store,
      a0Client: {
        async sendMessage() {
          throw new A0TimeoutError();
        },
        async getLogs() {
          return [];
        },
        async terminateChat() {
          return;
        },
        async healthCheck() {
          return true;
        }
      } as never,
      paperclipClient: {
        async postResult(_url: string, payload: Record<string, unknown>) {
          callbackPayload = payload;
          callbackResolve?.();
          return true;
        }
      } as never
    });

    const response = await request(app)
      .post('/heartbeat')
      .set('X-Adapter-Secret', 'adapter-secret')
      .send(createHeartbeatBody());

    expect(response.status).toBe(202);
    await callbackDone;
    expect(callbackPayload).toMatchObject({
      status: 'timeout',
      result: 'A0 request timed out.',
      context_id: null
    });
    store.close();
  });

  it('posts a failed callback payload when Agent Zero returns an execution error', async () => {
    const config = createConfig();
    const store = new ContextStore(config.CONTEXT_DB_PATH);
    let callbackResolve: (() => void) | undefined;
    const callbackDone = new Promise<void>((resolve) => {
      callbackResolve = resolve;
    });
    let callbackPayload: Record<string, unknown> | undefined;

    const app = createApp({
      config,
      logger,
      contextStore: store,
      a0Client: {
        async sendMessage() {
          throw new Error('A0 unreachable');
        },
        async getLogs() {
          throw new Error('log fetch failed');
        },
        async terminateChat() {
          return;
        },
        async healthCheck() {
          return true;
        }
      } as never,
      paperclipClient: {
        async postResult(_url: string, payload: Record<string, unknown>) {
          callbackPayload = payload;
          callbackResolve?.();
          return true;
        }
      } as never
    });

    const response = await request(app)
      .post('/heartbeat')
      .set('X-Adapter-Secret', 'adapter-secret')
      .send(createHeartbeatBody());

    expect(response.status).toBe(202);
    await callbackDone;
    expect(callbackPayload).toMatchObject({
      status: 'failed',
      result: 'A0 unreachable',
      cost_usd: 0,
      tokens_used: 0
    });
    store.close();
  });
});
