import { extractCostFromLogs } from '../src/costExtractor';

describe('extractCostFromLogs', () => {
  it('parses LiteLLM usage and model information across multiple log entries', () => {
    const result = extractCostFromLogs(
      [
        "model='deepseek-v3.2' usage: Usage(prompt_tokens=1000, completion_tokens=250, total_tokens=1250)",
        { content: 'usage: Usage(prompt_tokens=500, completion_tokens=50, total_tokens=550)' }
      ],
      'minimax-m2.7'
    );

    expect(result.model).toBe('deepseek-v3.2');
    expect(result.promptTokens).toBe(1500);
    expect(result.completionTokens).toBe(300);
    expect(result.tokensUsed).toBe(1800);
    expect(result.costUsd).toBeCloseTo(0.000504, 6);
  });

  it('falls back to the default model and returns zero when logs are empty', () => {
    const result = extractCostFromLogs([], 'minimax-m2.7');

    expect(result.model).toBe('minimax-m2.7');
    expect(result.tokensUsed).toBe(0);
    expect(result.costUsd).toBe(0);
  });

  it('uses prefix model matches and blended pricing when only total tokens are present', () => {
    const result = extractCostFromLogs(
      ["model='minimax-m2.7-turbo' usage: Usage(total_tokens=1000)"],
      'deepseek-r1'
    );

    expect(result.model).toBe('minimax-m2.7');
    expect(result.promptTokens).toBe(0);
    expect(result.completionTokens).toBe(0);
    expect(result.tokensUsed).toBe(1000);
    expect(result.costUsd).toBeCloseTo(0.00075, 6);
  });
});
