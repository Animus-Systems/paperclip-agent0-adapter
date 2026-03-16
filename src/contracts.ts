import { z } from 'zod';

export const goalContextSchema = z
  .object({
    company_mission: z.string().trim().min(1).optional(),
    project_goal: z.string().trim().min(1).optional(),
    agent_goal: z.string().trim().min(1).optional()
  })
  .partial()
  .default({});

export const heartbeatTaskSchema = z.object({
  id: z.string().trim().min(1),
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  goal_context: goalContextSchema.optional().default({})
});

export const heartbeatPayloadSchema = z.object({
  agent_id: z.string().trim().min(1),
  company_id: z.string().trim().min(1),
  task: heartbeatTaskSchema,
  budget_remaining: z.number().finite(),
  callback_url: z.string().url(),
  metadata: z.record(z.unknown()).optional().default({})
});

export const callbackStatusSchema = z.enum(['completed', 'failed', 'timeout']);

export const callbackPayloadSchema = z.object({
  ticket_id: z.string().trim().min(1),
  agent_id: z.string().trim().min(1),
  context_id: z.string().trim().min(1).nullable(),
  status: callbackStatusSchema,
  result: z.string(),
  cost_usd: z.number().finite().nonnegative(),
  tokens_used: z.number().int().nonnegative(),
  duration_ms: z.number().int().nonnegative(),
  metadata: z.record(z.unknown()).default({})
});

export type GoalContext = z.infer<typeof goalContextSchema>;
export type HeartbeatTask = z.infer<typeof heartbeatTaskSchema>;
export type HeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
export type CallbackPayload = z.infer<typeof callbackPayloadSchema>;
export type CallbackStatus = z.infer<typeof callbackStatusSchema>;

export interface BudgetCheckResult {
  allowed: boolean;
  reason?: 'budget_exhausted';
}

export interface A0MessageResponse {
  context_id: string;
  response: string;
}

export interface A0LogEntry {
  content?: string;
  message?: string;
  [key: string]: unknown;
}

export interface CostExtractionResult {
  model: string;
  promptTokens: number;
  completionTokens: number;
  tokensUsed: number;
  costUsd: number;
}
