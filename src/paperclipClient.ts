import { createHmac } from 'node:crypto';
import type { Logger } from 'pino';
import type { CallbackPayload } from './contracts';

type FetchFn = typeof fetch;
type SleepFn = (ms: number) => Promise<void>;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface PaperclipClientConfig {
  PAPERCLIP_WEBHOOK_SECRET: string;
  PAPERCLIP_CALLBACK_RETRY_BASE_MS: number;
}

export function createPaperclipSignature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export class PaperclipClient {
  public constructor(
    private readonly config: PaperclipClientConfig,
    private readonly logger: Logger,
    private readonly fetchFn: FetchFn = fetch,
    private readonly sleep: SleepFn = defaultSleep
  ) {}

  public async postResult(callbackUrl: string, payload: CallbackPayload): Promise<boolean> {
    const body = JSON.stringify(payload);
    const signature = createPaperclipSignature(body, this.config.PAPERCLIP_WEBHOOK_SECRET);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const response = await this.fetchFn(callbackUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Paperclip-Signature': signature
          },
          body
        });

        if (response.ok) {
          return true;
        }

        if (response.status >= 400 && response.status < 500) {
          this.logger.error(
            { statusCode: response.status, callbackUrl, payload },
            'Paperclip callback rejected the payload with a 4xx response.'
          );
          return false;
        }

        this.logger.warn(
          { statusCode: response.status, callbackUrl, attempt },
          'Paperclip callback failed with a retryable response.'
        );
      } catch (error) {
        this.logger.warn({ err: error, callbackUrl, attempt }, 'Paperclip callback failed with a network error.');
      }

      if (attempt < 3) {
        const delay = this.config.PAPERCLIP_CALLBACK_RETRY_BASE_MS * 2 ** attempt;
        await this.sleep(delay);
      }
    }

    this.logger.error({ callbackUrl, payload }, 'Paperclip callback failed after retries.');
    return false;
  }
}
