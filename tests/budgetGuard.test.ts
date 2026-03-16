import pino from 'pino';
import { checkBudget } from '../src/budgetGuard';

const logger = pino({ enabled: false });

describe('checkBudget', () => {
  it('blocks tasks at zero budget', () => {
    const result = checkBudget(
      'agent-1',
      0,
      { BUDGET_WARN_THRESHOLD: 2, BUDGET_BLOCK_AT_ZERO: true },
      logger
    );

    expect(result).toEqual({ allowed: false, reason: 'budget_exhausted' });
  });

  it('allows tasks above zero budget', () => {
    const result = checkBudget(
      'agent-1',
      5,
      { BUDGET_WARN_THRESHOLD: 2, BUDGET_BLOCK_AT_ZERO: true },
      logger
    );

    expect(result).toEqual({ allowed: true });
  });

  it('allows zero-budget tasks when configured not to block', () => {
    const result = checkBudget(
      'agent-1',
      -1,
      { BUDGET_WARN_THRESHOLD: 2, BUDGET_BLOCK_AT_ZERO: false },
      logger
    );

    expect(result).toEqual({ allowed: true });
  });
});
