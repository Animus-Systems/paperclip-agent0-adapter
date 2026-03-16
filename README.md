# paperclip-agent0-adapter

`paperclip-agent0-adapter` is a small TypeScript sidecar that lets Paperclip dispatch work to Agent Zero. It accepts Paperclip heartbeats, translates them into Agent Zero messages, keeps `agent_id -> context_id` continuity in SQLite, estimates execution cost from Agent Zero logs, and posts structured results back to Paperclip.

## What It Does

- Accepts `POST /heartbeat` requests from Paperclip.
- Validates `X-Adapter-Secret` before any work starts.
- Blocks zero-budget tasks before they reach Agent Zero.
- Converts Paperclip task payloads into the A0 message format with `[ACTIVATE_PROJECT: {company_id}]`.
- Reuses persistent Agent Zero context per `agent_id`.
- Calls `POST /api_message`, then `GET /api_log_get` for cost estimation.
- Posts a signed callback payload to Paperclip with result, cost, token usage, and timing.
- Deduplicates duplicate in-flight `ticket_id` executions.

## Quick Start

1. Copy `.env.example` to `.env` and fill in the secrets.
2. Install dependencies with `npm install`.
3. Run `npm run build`.
4. Start the adapter with `npm start`.
5. Point a Paperclip agent heartbeat at `http://localhost:4000/heartbeat`.

For local development:

```bash
npm run dev
```

## API Contract

### `POST /heartbeat`

Required header:

```text
X-Adapter-Secret: <ADAPTER_SECRET>
```

Request body:

```json
{
  "agent_id": "string",
  "company_id": "string",
  "task": {
    "id": "string",
    "title": "string",
    "description": "string",
    "goal_context": {
      "company_mission": "string",
      "project_goal": "string",
      "agent_goal": "string"
    }
  },
  "budget_remaining": 12.5,
  "callback_url": "https://paperclip.example/callback",
  "metadata": {}
}
```

Responses:

- `202`: accepted and executing asynchronously.
- `402`: zero-budget task blocked before execution.
- `400`: invalid payload.
- `401`: invalid or missing adapter secret.

### Callback Payload

The adapter signs the callback JSON with HMAC-SHA256 in `X-Paperclip-Signature`.

```json
{
  "ticket_id": "string",
  "agent_id": "string",
  "context_id": "string | null",
  "status": "completed | failed | timeout",
  "result": "string",
  "cost_usd": 0.12,
  "tokens_used": 400,
  "duration_ms": 1200,
  "metadata": {}
}
```

## Project Layout

```text
src/
  a0Client.ts
  budgetGuard.ts
  config.ts
  contextStore.ts
  contracts.ts
  costExtractor.ts
  createApp.ts
  logger.ts
  paperclipClient.ts
  server.ts
  translator.ts
tests/
  integration/heartbeat.test.ts
```

## Docker

Build and run the adapter by itself:

```bash
docker compose up --build
```

For the full stack example, use `examples/docker-compose.yml`.

## Testing

```bash
npm test
```

The Jest config enforces `>= 80%` global coverage.

## Notes

- `company_id` must match an existing Agent Zero project name exactly.
- Cost estimation is approximate because it is derived from Agent Zero logs.
- Mid-execution budget enforcement is intentionally out of scope.
