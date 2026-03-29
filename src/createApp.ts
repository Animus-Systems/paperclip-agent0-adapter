import { timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { Logger } from 'pino';
import type { AppConfig } from './config';
import { A0Client, A0ClientError, A0TimeoutError } from './a0Client';
import { ContextStore } from './contextStore';
import { extractCostFromLogs } from './costExtractor';

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
  now?: () => number;
}

async function fetchIssueDetails(
  issueId: string,
  paperclipBaseUrl: string,
  apiKey: string,
  logger: Logger
): Promise<{ title: string; description: string; identifier: string } | null> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }
    const response = await fetch(`${paperclipBaseUrl}/api/issues/${issueId}`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(3000)
    });
    if (!response.ok) {
      logger.debug({ issueId, status: response.status }, 'Paperclip issue fetch failed.');
      return null;
    }
    const data = await response.json() as Record<string, unknown>;
    return {
      title: String(data.title ?? ''),
      description: String(data.description ?? data.body ?? ''),
      identifier: String(data.identifier ?? issueId)
    };
  } catch (err) {
    logger.debug({ err, issueId }, 'Could not fetch issue details from Paperclip.');
    return null;
  }
}

async function buildA0Message(
  body: Record<string, unknown>,
  config: AppConfig,
  logger: Logger
): Promise<string> {
  const context = (body.context ?? {}) as Record<string, unknown>;
  const agentId = String(body.agentId ?? body.agent_id ?? 'unknown');
  const runId = String(body.runId ?? '');

  // Extract task/issue info from Paperclip's context
  const issueId = String(context.issueId ?? context.taskId ?? '');
  const wakeReason = String(context.wakeReason ?? 'on_demand');
  const prompt = String(context.paperclipPrompt ?? context.prompt ?? '');

  // Try to get issue details from Paperclip if we have an issue ID
  let issueTitle = '';
  let issueDescription = '';
  if (issueId) {
    const paperclipUrl = config.PAPERCLIP_URL || 'http://server:3100';
    const details = await fetchIssueDetails(issueId, paperclipUrl, config.PAPERCLIP_API_KEY || '', logger);
    if (details) {
      issueTitle = details.title;
      issueDescription = details.description;
    }
  }

  // Build sections
  const sections: string[] = [];

  sections.push(`## PAPERCLIP TASK`);
  sections.push(`**Agent:** ${agentId} | **Run:** ${runId}`);

  if (issueId) {
    sections.push(`**Issue:** ${issueId}`);
  }

  sections.push(`**Wake Reason:** ${wakeReason}`);
  sections.push('');

  if (prompt) {
    sections.push(prompt);
  } else if (issueTitle || issueDescription) {
    if (issueTitle) sections.push(`## ${issueTitle}`);
    if (issueDescription) sections.push(issueDescription);
    sections.push('');
    sections.push('When done, output a concise summary of what was accomplished.');
  } else if (issueId) {
    sections.push(`Work on issue ${issueId}. When done, output a concise summary of what was accomplished.`);
  } else {
    sections.push('This is a Paperclip heartbeat check-in. No specific task was assigned.');
    sections.push('Report your current status and any pending work. Do NOT run scheduled tasks or start new work unprompted.');
  }

  sections.push('');
  sections.push('---');
  sections.push('Do not ask clarifying questions — work with the information provided.');

  return sections.join('\n');
}

async function postIssueComment(
  issueId: string,
  body: string,
  paperclipBaseUrl: string,
  apiKey: string,
  logger: Logger
): Promise<void> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const response = await fetch(`${paperclipBaseUrl}/api/issues/${issueId}/comments`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(5000)
    });
    if (!response.ok) {
      logger.warn({ issueId, status: response.status }, 'Failed to post comment to Paperclip issue.');
    } else {
      logger.info({ issueId }, 'Posted A0 result as comment on Paperclip issue.');
    }
  } catch (err) {
    logger.warn({ err, issueId }, 'Could not post comment to Paperclip.');
  }
}

export function createApp(dependencies: AppDependencies) {
  const { config, logger, contextStore, a0Client } = dependencies;
  const now = dependencies.now ?? (() => Date.now());
  const inFlightRuns = new Set<string>();
  const app = express();

  app.use(express.json());

  app.use((request, _response, next) => {
    logger.info(
      {
        method: request.method,
        path: request.path,
        agentId: request.body?.agentId,
        runId: request.body?.runId
      },
      'Incoming request.'
    );
    next();
  });

  app.get('/health', (_request, response) => {
    response.status(200).json({ status: 'ok' });
  });

  // Paperclip's test probe sends HEAD to verify connectivity
  app.head('/heartbeat', (_request, response) => {
    response.status(200).end();
  });

  // Paperclip's HTTP adapter sends: { ...payloadTemplate, agentId, runId, context }
  // and waits synchronously for a 200 response.
  app.post('/heartbeat', async (request, response, next) => {
    try {
      // Auth check (optional — skip if ADAPTER_SECRET is "none")
      if (config.ADAPTER_SECRET !== 'none') {
        if (!safeSecretCompare(request.header('X-Adapter-Secret'), config.ADAPTER_SECRET)) {
          response.status(401).json({ status: 'error', message: 'Unauthorized' });
          return;
        }
      }

      const body = request.body as Record<string, unknown>;
      const agentId = String(body.agentId ?? body.agent_id ?? '');
      const runId = String(body.runId ?? '');

      if (!agentId) {
        response.status(400).json({ status: 'error', message: 'Missing agentId' });
        return;
      }

      // Dedup in-flight runs
      const dedupeKey = `${agentId}:${runId}`;
      if (inFlightRuns.has(dedupeKey)) {
        response.status(200).json({ status: 'ok', deduplicated: true });
        return;
      }

      inFlightRuns.add(dedupeKey);
      const startedAt = now();

      try {
        // Get stored context for conversation continuity
        let storedContextId = contextStore.getContextId(agentId);

        // Translate Paperclip payload to A0 message
        const message = await buildA0Message(body, config, logger);

        logger.info({ agentId, runId, hasStoredContext: !!storedContextId, contextKeys: Object.keys(body.context ?? {}) }, 'Sending message to Agent Zero.');
      logger.debug({ agentId, body }, 'Full heartbeat payload.');

        // Send to Agent Zero and WAIT for response
        // If stored context is expired (404), retry without it
        let a0Response;
        try {
          a0Response = await a0Client.sendMessage(message, storedContextId);
        } catch (firstError) {
          if (firstError instanceof A0ClientError && firstError.statusCode === 404 && storedContextId) {
            logger.warn({ agentId, contextId: storedContextId }, 'Stored context expired. Retrying with fresh context.');
            contextStore.deleteContextId(agentId);
            storedContextId = null;
            a0Response = await a0Client.sendMessage(message, null);
          } else {
            throw firstError;
          }
        }

        // Save context for next run
        const companyId = String((body.context as Record<string, unknown>)?.companyId ?? '');
        contextStore.saveContextId(agentId, a0Response.context_id, companyId);

        // Extract cost from logs
        let tokensUsed = 0;
        let costUsd = 0;
        try {
          const logs = await a0Client.getLogs(a0Response.context_id, config.COST_LOG_FETCH_COUNT);
          const cost = extractCostFromLogs(logs, config.DEFAULT_MODEL_FOR_COST);
          tokensUsed = cost.tokensUsed;
          costUsd = cost.costUsd;
        } catch (costError) {
          logger.warn({ err: costError }, 'Failed to extract cost from A0 logs.');
        }

        const durationMs = now() - startedAt;
        logger.info({ agentId, runId, contextId: a0Response.context_id, durationMs, costUsd, tokensUsed }, 'Agent Zero execution completed.');

        // Post A0's response as a comment on the Paperclip issue
        const context = (body.context ?? {}) as Record<string, unknown>;
        const issueId = String(context.issueId ?? context.taskId ?? '');
        if (issueId && a0Response.response) {
          const commentBody = `**Agent Zero result** (${(durationMs / 1000).toFixed(1)}s)\n\n${a0Response.response}`;
          await postIssueComment(
            issueId,
            commentBody,
            config.PAPERCLIP_URL || 'http://server:3100',
            config.PAPERCLIP_API_KEY || '',
            logger
          );
        }

        response.status(200).json({
          status: 'ok',
          agentId,
          runId,
          contextId: a0Response.context_id,
          result: a0Response.response,
          costUsd,
          tokensUsed,
          durationMs
        });
      } catch (error) {
        const durationMs = now() - startedAt;

        if (error instanceof A0TimeoutError) {
          logger.error({ agentId, runId, durationMs }, 'Agent Zero request timed out.');
          response.status(504).json({ status: 'timeout', agentId, message: 'Agent Zero request timed out.' });
        } else if (error instanceof A0ClientError) {
          logger.error({ err: error, agentId, runId, durationMs }, 'Agent Zero request failed.');
          response.status(502).json({ status: 'error', agentId, message: error.message });
        } else {
          logger.error({ err: error, agentId, runId, durationMs }, 'Unexpected adapter error.');
          response.status(500).json({ status: 'error', agentId, message: error instanceof Error ? error.message : 'Unknown error' });
        }
      } finally {
        inFlightRuns.delete(dedupeKey);
      }
    } catch (error) {
      next(error);
    }
  });

  app.use((error: Error, _request: Request, response: Response, _next: NextFunction) => {
    logger.error({ err: error }, 'Unhandled request error.');
    response.status(500).json({ status: 'error', message: 'Internal server error' });
  });

  return app;
}
