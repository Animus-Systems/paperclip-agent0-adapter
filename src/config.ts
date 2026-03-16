import path from 'node:path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }

    if (normalized === 'false') {
      return false;
    }
  }

  return value;
}, z.boolean());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  A0_BASE_URL: z.string().url().default('http://localhost:50001'),
  A0_API_KEY: z.string().min(1),
  A0_TIMEOUT_MS: z.coerce.number().int().positive().default(360000),
  A0_DEFAULT_CONTEXT_LIFETIME_HOURS: z.coerce.number().int().positive().default(48),
  A0_RETRY_DELAY_MS: z.coerce.number().int().nonnegative().default(10000),
  ADAPTER_SECRET: z.string().min(1),
  CONTEXT_DB_PATH: z.string().min(1).default('./data/contexts.sqlite'),
  PAPERCLIP_WEBHOOK_SECRET: z.string().min(1),
  PAPERCLIP_CALLBACK_RETRY_BASE_MS: z.coerce.number().int().nonnegative().default(2000),
  BUDGET_WARN_THRESHOLD: z.coerce.number().nonnegative().default(2),
  BUDGET_BLOCK_AT_ZERO: booleanFromEnv.default(true),
  COST_LOG_FETCH_COUNT: z.coerce.number().int().positive().default(100),
  DEFAULT_MODEL_FOR_COST: z.string().min(1).default('claude-sonnet-4-5'),
  DEFAULT_COMPANY_MISSION: z
    .string()
    .min(1)
    .default('Deliver useful outcomes for the company.'),
  DEFAULT_PROJECT_GOAL: z
    .string()
    .min(1)
    .default('Complete the current task effectively.'),
  DEFAULT_AGENT_GOAL: z
    .string()
    .min(1)
    .default('Execute the assigned work autonomously.'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

export type AppConfig = z.infer<typeof envSchema> & {
  CONTEXT_DB_PATH: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse(env);

  return {
    ...parsed,
    CONTEXT_DB_PATH: path.resolve(parsed.CONTEXT_DB_PATH)
  };
}

export function maskSecret(value: string): string {
  if (value.length <= 4) {
    return '****';
  }

  return `${value.slice(0, 2)}****${value.slice(-2)}`;
}
