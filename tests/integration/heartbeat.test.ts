import { AddressInfo } from 'node:net';
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { A0Client } from '../../src/a0Client';
import { loadConfig } from '../../src/config';
import { ContextStore } from '../../src/contextStore';
import { createApp } from '../../src/createApp';
import { PaperclipClient, createPaperclipSignature } from '../../src/paperclipClient';

function listen(app: express.Express): Promise<{ url: string; close: () => Promise<void> }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () =>
          new Promise<void>((closeResolve, closeReject) => {
            server.close((error) => {
              if (error) {
                closeReject(error);
                return;
              }
              closeResolve();
            });
          })
      });
    });
  });
}

describe('POST /heartbeat', () => {
  it('executes a full heartbeat flow and posts the callback payload', async () => {
    const logger = pino({ enabled: false });
    const callbackPayloads: unknown[] = [];
    let callbackResolve: (() => void) | undefined;
    const callbackReceived = new Promise<void>((resolve) => {
      callbackResolve = resolve;
    });

    const a0App = express();
    a0App.use(express.json());
    a0App.get('/api_health', (_request, response) => {
      response.status(200).json({ status: 'ok' });
    });
    a0App.post('/api_message', (_request, response) => {
      response.status(200).json({ context_id: 'ctx-123', response: 'Task complete.' });
    });
    a0App.get('/api_log_get', (_request, response) => {
      response.status(200).json([
        {
          content: "model='gpt-4.1-mini' usage: Usage(prompt_tokens=300, completion_tokens=100, total_tokens=400)"
        }
      ]);
    });
    const a0Server = await listen(a0App);

    const callbackApp = express();
    callbackApp.use(express.json());
    callbackApp.post('/callback', (req, response) => {
      callbackPayloads.push(req.body);
      expect(req.header('X-Paperclip-Signature')).toBe(
        createPaperclipSignature(JSON.stringify(req.body), 'paperclip-secret')
      );
      response.status(200).json({ ok: true });
      callbackResolve?.();
    });
    const callbackServer = await listen(callbackApp);

    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '4000',
      A0_BASE_URL: a0Server.url,
      A0_API_KEY: 'a0-secret',
      A0_TIMEOUT_MS: '1000',
      A0_DEFAULT_CONTEXT_LIFETIME_HOURS: '48',
      A0_RETRY_DELAY_MS: '1',
      ADAPTER_SECRET: 'adapter-secret',
      CONTEXT_DB_PATH: '/tmp/paperclip-agent0-adapter-test.sqlite',
      PAPERCLIP_WEBHOOK_SECRET: 'paperclip-secret',
      PAPERCLIP_CALLBACK_RETRY_BASE_MS: '1',
      BUDGET_WARN_THRESHOLD: '2',
      BUDGET_BLOCK_AT_ZERO: 'true',
      COST_LOG_FETCH_COUNT: '25',
      DEFAULT_MODEL_FOR_COST: 'claude-sonnet-4-5',
      DEFAULT_COMPANY_MISSION: 'Default mission',
      DEFAULT_PROJECT_GOAL: 'Default project goal',
      DEFAULT_AGENT_GOAL: 'Default agent goal',
      LOG_LEVEL: 'info'
    });

    const store = new ContextStore(config.CONTEXT_DB_PATH);
    const app = createApp({
      config,
      logger,
      contextStore: store,
      a0Client: new A0Client(config, logger),
      paperclipClient: new PaperclipClient(config, logger)
    });

    const response = await request(app)
      .post('/heartbeat')
      .set('X-Adapter-Secret', 'adapter-secret')
      .send({
        agent_id: 'agent-123',
        company_id: 'company-abc',
        task: {
          id: 'ticket-999',
          title: 'Implement adapter',
          description: 'Build the adapter flow',
          goal_context: {
            company_mission: 'Mission',
            project_goal: 'Goal',
            agent_goal: 'Mandate'
          }
        },
        budget_remaining: 12.34,
        callback_url: `${callbackServer.url}/callback`,
        metadata: {
          source: 'integration-test'
        }
      });

    expect(response.status).toBe(202);
    await callbackReceived;

    expect(callbackPayloads).toHaveLength(1);
    expect(callbackPayloads[0]).toMatchObject({
      ticket_id: 'ticket-999',
      agent_id: 'agent-123',
      context_id: 'ctx-123',
      status: 'completed',
      result: 'Task complete.',
      tokens_used: 400,
      metadata: {
        source: 'integration-test'
      }
    });
    expect(store.getContextId('agent-123')).toBe('ctx-123');

    store.close();
    await a0Server.close();
    await callbackServer.close();
  });

  it('returns 402 immediately and never calls A0 when budget is exhausted', async () => {
    const logger = pino({ enabled: false });
    let a0Calls = 0;

    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '4000',
      A0_BASE_URL: 'http://127.0.0.1:9',
      A0_API_KEY: 'a0-secret',
      A0_TIMEOUT_MS: '1000',
      A0_DEFAULT_CONTEXT_LIFETIME_HOURS: '48',
      A0_RETRY_DELAY_MS: '1',
      ADAPTER_SECRET: 'adapter-secret',
      CONTEXT_DB_PATH: '/tmp/paperclip-agent0-adapter-budget.sqlite',
      PAPERCLIP_WEBHOOK_SECRET: 'paperclip-secret',
      PAPERCLIP_CALLBACK_RETRY_BASE_MS: '1',
      BUDGET_WARN_THRESHOLD: '2',
      BUDGET_BLOCK_AT_ZERO: 'true',
      COST_LOG_FETCH_COUNT: '25',
      DEFAULT_MODEL_FOR_COST: 'claude-sonnet-4-5',
      DEFAULT_COMPANY_MISSION: 'Default mission',
      DEFAULT_PROJECT_GOAL: 'Default project goal',
      DEFAULT_AGENT_GOAL: 'Default agent goal',
      LOG_LEVEL: 'info'
    });

    const app = createApp({
      config,
      logger,
      contextStore: new ContextStore(config.CONTEXT_DB_PATH),
      a0Client: {
        async sendMessage() {
          a0Calls += 1;
          throw new Error('should not be called');
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
      } as unknown as A0Client,
      paperclipClient: {
        async postResult() {
          return true;
        }
      } as unknown as PaperclipClient
    });

    const response = await request(app)
      .post('/heartbeat')
      .set('X-Adapter-Secret', 'adapter-secret')
      .send({
        agent_id: 'agent-123',
        company_id: 'company-abc',
        task: {
          id: 'ticket-999',
          title: 'Implement adapter',
          description: 'Build the adapter flow',
          goal_context: {}
        },
        budget_remaining: 0,
        callback_url: 'https://paperclip.example/callback',
        metadata: {}
      });

    expect(response.status).toBe(402);
    expect(a0Calls).toBe(0);
  });
});
