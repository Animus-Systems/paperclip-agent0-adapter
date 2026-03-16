import type { Logger } from 'pino';
import type { BudgetCheckResult } from './contracts';

export interface BudgetGuardConfig {
  BUDGET_WARN_THRESHOLD: number;
  BUDGET_BLOCK_AT_ZERO: boolean;
}

export function checkBudget(
  agentId: string,
  budgetRemaining: number,
  config: BudgetGuardConfig,
  logger: Logger
): BudgetCheckResult {
  if (budgetRemaining <= 0) {
    logger.warn({ agentId, budgetRemaining }, '[BUDGET] Agent has zero or negative budget remaining.');

    if (config.BUDGET_BLOCK_AT_ZERO) {
      return { allowed: false, reason: 'budget_exhausted' };
    }
  }

  if (budgetRemaining < config.BUDGET_WARN_THRESHOLD) {
    logger.warn({ agentId, budgetRemaining }, '[BUDGET] Agent budget is below warning threshold.');
  }

  return { allowed: true };
}
