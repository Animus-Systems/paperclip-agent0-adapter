import pino from 'pino';
import { createPaperclipSignature, PaperclipClient } from '../src/paperclipClient';

const logger = pino({ enabled: false });

describe('PaperclipClient', () => {
  it('creates deterministic HMAC signatures', () => {
    const signature = createPaperclipSignature('{"hello":"world"}', 'secret');
    expect(signature).toBe('2677ad3e7c090b2fa2c0fb13020d66d5420879b8316eb356a2d60fb9073bc778');
  });

  it('retries on 5xx responses and succeeds later', async () => {
    let attempts = 0;
    const fetchFn: typeof fetch = async () => {
      attempts += 1;
      return new Response(null, { status: attempts < 3 ? 500 : 200 });
    };
    const sleeps: number[] = [];
    const client = new PaperclipClient(
      {
        PAPERCLIP_WEBHOOK_SECRET: 'secret',
        PAPERCLIP_CALLBACK_RETRY_BASE_MS: 2
      },
      logger,
      fetchFn,
      async (ms) => {
        sleeps.push(ms);
      }
    );

    const result = await client.postResult('https://example.com/callback', {
      ticket_id: 'T-1',
      agent_id: 'A-1',
      context_id: 'ctx-1',
      status: 'completed',
      result: 'done',
      cost_usd: 0.12,
      tokens_used: 42,
      duration_ms: 10,
      metadata: {}
    });

    expect(result).toBe(true);
    expect(attempts).toBe(3);
    expect(sleeps).toEqual([2, 4]);
  });

  it('does not retry on 4xx responses', async () => {
    let attempts = 0;
    const fetchFn: typeof fetch = async () => {
      attempts += 1;
      return new Response(null, { status: 400 });
    };
    const client = new PaperclipClient(
      {
        PAPERCLIP_WEBHOOK_SECRET: 'secret',
        PAPERCLIP_CALLBACK_RETRY_BASE_MS: 2
      },
      logger,
      fetchFn
    );

    const result = await client.postResult('https://example.com/callback', {
      ticket_id: 'T-1',
      agent_id: 'A-1',
      context_id: 'ctx-1',
      status: 'failed',
      result: 'bad request',
      cost_usd: 0,
      tokens_used: 0,
      duration_ms: 10,
      metadata: {}
    });

    expect(result).toBe(false);
    expect(attempts).toBe(1);
  });

  it('retries network errors and eventually returns false after exhausting attempts', async () => {
    let attempts = 0;
    const fetchFn: typeof fetch = async () => {
      attempts += 1;
      throw new Error('network down');
    };
    const sleeps: number[] = [];
    const client = new PaperclipClient(
      {
        PAPERCLIP_WEBHOOK_SECRET: 'secret',
        PAPERCLIP_CALLBACK_RETRY_BASE_MS: 2
      },
      logger,
      fetchFn,
      async (ms) => {
        sleeps.push(ms);
      }
    );

    const result = await client.postResult('https://example.com/callback', {
      ticket_id: 'T-1',
      agent_id: 'A-1',
      context_id: 'ctx-1',
      status: 'failed',
      result: 'network down',
      cost_usd: 0,
      tokens_used: 0,
      duration_ms: 10,
      metadata: {}
    });

    expect(result).toBe(false);
    expect(attempts).toBe(4);
    expect(sleeps).toEqual([2, 4, 8]);
  });
});
