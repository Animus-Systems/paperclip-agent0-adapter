import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Logger } from 'pino';
import type { AppConfig } from './config';
import type { CallbackPayload, HeartbeatPayload } from './contracts';
import { callbackPayloadSchema, heartbeatPayloadSchema } from './contracts';
import { A0Client, A0ClientError, A0TimeoutError } from './a0Client';
import { checkBudget } from './budgetGuard';
import { ContextStore } from './contextStore';
import { extractCostFromLogs } from './costExtractor';
import { PaperclipClient } from './paperclipClient';
import { translateHeartbeat } from './translator';

function safeSecretCompare(received: string | undefined, expected: string): boolean {
  if (!received) {
    return false;
  }

  const left = Buffer.from(received);
  const right = Buffer.from(expected);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export interface AppDependencies {
  config: AppConfig;
  logger: Logger;
  contextStore: ContextStore;
  a0Client: A0Client;
  paperclipClient: PaperclipClient;
  now?: () => number;
}

export function createApp(dependencies: AppDependencies) {
  const { config, logger, contextStore, a0Client, paperclipClient } = dependencies;
  const now = dependencies.now ?? (() => Date.now());
  const inFlightTickets = new Set<string>();
  const app = express();

  app.use(express.json());

  app.use((request, response, next) => {
    logger.info(
      {
        method: request.method,
        path: request.path,
        agentId: request.body?.agent_id,
        ticketId: request.body?.task?.id
      },
      'Incoming request.'
    );
    next();
  });

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  app.post('/heartbeat', async (request, response, next) => {
    try {
      if (!safeSecretCompare(request.header('X-Adapter-Secret'), config.ADAPTER_SECRET)) {
        response.status(401).json({ status: 'error', message: 'Unauthorized' });
        return;
      }

      const parseResult = heartbeatPayloadSchema.safeParse(request.body);
      if (!parseResult.success) {
        const issue = parseResult.error.issues[0];
        response.status(400).json({
          status: 'error',
          message: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid request body.'
        });
        return;
      }

      const payload = parseResult.data;
      const budgetCheck = checkBudget(payload.agent_id, payload.budget_remaining, config, logger);
      if (!budgetCheck.allowed) {
        response.status(402).json({ status: 'budget_exhausted', agent_id: payload.agent_id });
        return;
      }

      const ticketId = payload.task.id;
      if (inFlightTickets.has(ticketId)) {
        response.status(202).json({ status: 'accepted', deduplicated: true, ticket_id: ticketId });
        return;
      }

      inFlightTickets.add(ticketId);
      void executeHeartbeat(payload).finally(() => {
        inFlightTickets.delete(ticketId);
      });

      response.status(202).json({ status: 'accepted', ticket_id: ticketId, agent_id: payload.agent_id });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    logger.error({ err: error }, 'Unhandled request error.');
    response.status(500).json({ status: 'error', message: 'Internal server error' });
  });

  async function executeHeartbeat(payload: HeartbeatPayload): Promise<void> {
    const startedAt = now();
    const currentContextId = contextStore.getContextId(payload.agent_id);
    const message = translateHeartbeat(payload, config);
    let status: CallbackPayload['status'] = 'completed';
    let result = '';
    let contextId: string | null = currentContextId;

    try {
      const a0Response = await a0Client.sendMessage(message, currentContextId);
      contextId = a0Response.context_id;
      result = a0Response.response;
      contextStore.saveContextId(payload.agent_id, a0Response.context_id, payload.company_id);
    } catch (error) {
      if (error instanceof A0TimeoutError) {
        status = 'timeout';
        result = 'A0 request timed out.';
      } else if (error instanceof A0ClientError) {
        status = 'failed';
        result = error.message;
      } else {
        status = 'failed';
        result = error instanceof Error ? error.message : 'Unknown adapter failure.';
      }

      logger.error({ err: error, agentId: payload.agent_id, ticketId: payload.task.id }, 'Heartbeat execution failed.');
    }

    let tokensUsed = 0;
    let costUsd = 0;

    if (contextId) {
      try {
        const logs = await a0Client.getLogs(contextId, config.COST_LOG_FETCH_COUNT);
        const cost = extractCostFromLogs(logs, config.DEFAULT_MODEL_FOR_COST);
        tokensUsed = cost.tokensUsed;
        costUsd = cost.costUsd;
      } catch (error) {
        logger.warn({ err: error, contextId }, 'Failed to extract cost from Agent Zero logs.');
      }
    }

    const callbackPayload = callbackPayloadSchema.parse({
      ticket_id: payload.task.id,
      agent_id: payload.agent_id,
      context_id: contextId,
      status,
      result,
      cost_usd: costUsd,
      tokens_used: tokensUsed,
      duration_ms: Math.max(0, now() - startedAt),
      metadata: payload.metadata
    });

    await paperclipClient.postResult(payload.callback_url, callbackPayload);
    logger.info(
      {
        agentId: payload.agent_id,
        ticketId: payload.task.id,
        contextId,
        status,
        costUsd,
        tokensUsed
      },
      'Heartbeat execution completed.'
    );
  }

  return app;
}
