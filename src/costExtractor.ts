import costModels from './cost-models.json';
import type { A0LogEntry, CostExtractionResult } from './contracts';

const TOTAL_TOKENS_REGEX = /total_tokens[=:\s]+(\d+)/i;
const PROMPT_TOKENS_REGEX = /prompt_tokens[=:\s]+(\d+)/i;
const COMPLETION_TOKENS_REGEX = /completion_tokens[=:\s]+(\d+)/i;
const MODEL_REGEXES = [
  /model["']?\s*[:=]\s*["']?([a-z0-9._-]+)/i,
  /model='([a-z0-9._-]+)'/i,
  /model_name["']?\s*[:=]\s*["']?([a-z0-9._-]+)/i
];

interface CostModel {
  model: string;
  inputCostPer1k: number;
  outputCostPer1k: number;
  notes: string;
}

function getEntryContent(entry: A0LogEntry | string): string {
  if (typeof entry === 'string') {
    return entry;
  }

  if (typeof entry.content === 'string') {
    return entry.content;
  }

  if (typeof entry.message === 'string') {
    return entry.message;
  }

  return JSON.stringify(entry);
}

function detectModel(content: string): string | null {
  for (const regex of MODEL_REGEXES) {
    const match = regex.exec(content);
    if (match?.[1]) {
      return match[1].toLowerCase();
    }
  }

  return null;
}

function resolveCostModel(model: string, defaultModel: string): CostModel {
  const normalized = model.toLowerCase();
  const defaultNormalized = defaultModel.toLowerCase();
  const models = costModels as CostModel[];
  const exactMatch = models.find((item) => item.model.toLowerCase() === normalized);
  if (exactMatch) {
    return exactMatch;
  }

  const prefixMatch = models.find((item) => normalized.startsWith(item.model.toLowerCase()));
  if (prefixMatch) {
    return prefixMatch;
  }

  const defaultMatch = models.find((item) => item.model.toLowerCase() === defaultNormalized);
  if (defaultMatch) {
    return defaultMatch;
  }

  const unknownMatch = models.find((item) => item.model.toLowerCase() === 'unknown');
  if (unknownMatch) {
    return unknownMatch;
  }

  return {
    model: 'unknown',
    inputCostPer1k: 0.002,
    outputCostPer1k: 0.008,
    notes: 'In-code fallback'
  };
}

export function extractCostFromLogs(
  logs: Array<A0LogEntry | string>,
  defaultModel: string
): CostExtractionResult {
  let model = defaultModel.toLowerCase();
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;

  for (const entry of logs) {
    const content = getEntryContent(entry);

    const detectedModel = detectModel(content);
    if (detectedModel) {
      model = detectedModel;
    }

    const promptMatch = PROMPT_TOKENS_REGEX.exec(content);
    const completionMatch = COMPLETION_TOKENS_REGEX.exec(content);
    const totalMatch = TOTAL_TOKENS_REGEX.exec(content);

    if (promptMatch?.[1]) {
      promptTokens += Number.parseInt(promptMatch[1], 10);
    }

    if (completionMatch?.[1]) {
      completionTokens += Number.parseInt(completionMatch[1], 10);
    }

    if (totalMatch?.[1]) {
      totalTokens += Number.parseInt(totalMatch[1], 10);
    }
  }

  const tokensUsed = promptTokens + completionTokens > 0 ? promptTokens + completionTokens : totalTokens;
  const modelConfig = resolveCostModel(model, defaultModel);

  let costUsd = 0;
  if (promptTokens + completionTokens > 0) {
    costUsd =
      (promptTokens / 1000) * modelConfig.inputCostPer1k +
      (completionTokens / 1000) * modelConfig.outputCostPer1k;
  } else if (tokensUsed > 0) {
    const blendedRate = (modelConfig.inputCostPer1k + modelConfig.outputCostPer1k) / 2;
    costUsd = (tokensUsed / 1000) * blendedRate;
  }

  return {
    model: modelConfig.model,
    promptTokens,
    completionTokens,
    tokensUsed,
    costUsd: Number(costUsd.toFixed(6))
  };
}
