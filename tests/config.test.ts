import { loadConfig, maskSecret } from '../src/config';

describe('config', () => {
  it('parses booleans and resolves the database path', () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      PORT: '4000',
      A0_BASE_URL: 'http://localhost:50001',
      A0_API_KEY: 'a0-secret',
      A0_TIMEOUT_MS: '1000',
      A0_DEFAULT_CONTEXT_LIFETIME_HOURS: '48',
      A0_RETRY_DELAY_MS: '10',
      ADAPTER_SECRET: 'adapter-secret',
      CONTEXT_DB_PATH: './data/contexts.sqlite',
      PAPERCLIP_WEBHOOK_SECRET: 'paperclip-secret',
      PAPERCLIP_CALLBACK_RETRY_BASE_MS: '2',
      BUDGET_WARN_THRESHOLD: '2',
      BUDGET_BLOCK_AT_ZERO: 'false',
      COST_LOG_FETCH_COUNT: '25',
      DEFAULT_MODEL_FOR_COST: 'minimax-m2.7',
      DEFAULT_COMPANY_MISSION: 'Mission',
      DEFAULT_PROJECT_GOAL: 'Goal',
      DEFAULT_AGENT_GOAL: 'Mandate',
      LOG_LEVEL: 'info'
    });

    expect(config.BUDGET_BLOCK_AT_ZERO).toBe(false);
    expect(config.CONTEXT_DB_PATH).toContain('/data/contexts.sqlite');
  });

  it('masks secrets consistently', () => {
    expect(maskSecret('secret-value')).toBe('se****ue');
    expect(maskSecret('abc')).toBe('****');
  });
});
