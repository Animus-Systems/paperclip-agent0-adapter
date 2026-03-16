import pino, { Logger } from 'pino';
import type { AppConfig } from './config';

export function createLogger(config: AppConfig): Logger {
  return pino({
    name: 'paperclip-a0-adapter',
    level: config.LOG_LEVEL,
    enabled: config.NODE_ENV !== 'test'
  });
}
