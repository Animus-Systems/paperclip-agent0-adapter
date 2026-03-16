import { createServer } from 'node:http';
import { A0Client } from './a0Client';
import { loadConfig, maskSecret } from './config';
import { ContextStore } from './contextStore';
import { createApp } from './createApp';
import { createLogger } from './logger';
import { PaperclipClient } from './paperclipClient';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config);
  const contextStore = new ContextStore(config.CONTEXT_DB_PATH);
  const a0Client = new A0Client(config, logger);
  const paperclipClient = new PaperclipClient(config, logger);
  const app = createApp({
    config,
    logger,
    contextStore,
    a0Client,
    paperclipClient
  });

  const a0Reachable = await a0Client.healthCheck();
  if (!a0Reachable) {
    logger.warn('Agent Zero health check failed at startup. Adapter is starting anyway.');
  }

  const server = createServer(app);
  server.listen(config.PORT, () => {
    logger.info(
      {
        port: config.PORT,
        a0BaseUrl: config.A0_BASE_URL,
        contextDbPath: config.CONTEXT_DB_PATH,
        adapterSecret: maskSecret(config.ADAPTER_SECRET),
        paperclipWebhookSecret: maskSecret(config.PAPERCLIP_WEBHOOK_SECRET)
      },
      'paperclip-a0-adapter is listening.'
    );
  });
}

void main().catch((error) => {
  console.error('Fatal startup error', error);
  process.exit(1);
});
