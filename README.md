# Paperclip → Agent Zero Adapter

A sidecar service that connects [Paperclip](https://github.com/paperclipai/paperclip) to [Agent Zero](https://github.com/agent0ai/agent-zero). When Paperclip assigns a task to an agent configured with the HTTP adapter, this service receives the heartbeat, sends it to Agent Zero for execution, and posts the result back as a comment on the Paperclip issue.

## How it works

```text
Paperclip assigns issue to agent
  → POST /heartbeat (this adapter)
    → Fetches issue title + description from Paperclip API
    → Sends message to Agent Zero /api/api_message
    → Agent Zero executes the task
    → Adapter posts result as comment on the Paperclip issue
  → Returns 200 to Paperclip
```

The adapter also:

- Maintains conversation continuity per agent (SQLite-backed context store)
- Extracts token usage and cost from Agent Zero logs
- Handles expired Agent Zero contexts gracefully (auto-retries with fresh context)
- Deduplicates concurrent heartbeats for the same run

## Setup

### 1. Configure environment

Copy `.env.example` to `.env` and fill in the required values:

```bash
cp .env.example .env
```

**Required:**

| Variable | Description |
| -------- | ----------- |
| `A0_API_KEY` | Agent Zero API key (find in A0 Settings → MCP Server Token) |

**Important:**

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `A0_BASE_URL` | `http://localhost:5555/api/` | Agent Zero API base URL. Must end with `/api/` |
| `PAPERCLIP_URL` | `http://server:3100` | Paperclip API URL (use Docker service name when in same compose) |
| `PAPERCLIP_API_KEY` | (empty) | Agent JWT for authenticating with Paperclip API. Required for fetching issue details and posting comments. See [Generating a Paperclip API key](#generating-a-paperclip-api-key) |

**Optional:**

| Variable | Default | Description |
| -------- | ------- | ----------- |
| `PORT` | `4000` | Adapter listen port |
| `ADAPTER_SECRET` | `none` | Shared secret for `X-Adapter-Secret` header validation. Set to `none` to disable |
| `CONTEXT_DB_PATH` | `./data/contexts.sqlite` | SQLite database path for context persistence |
| `A0_TIMEOUT_MS` | `360000` | Agent Zero request timeout (6 minutes) |
| `A0_DEFAULT_CONTEXT_LIFETIME_HOURS` | `48` | How long A0 contexts persist |
| `DEFAULT_MODEL_FOR_COST` | `minimax-m2.7` | Fallback model for cost estimation |
| `LOG_LEVEL` | `info` | Log level: debug, info, warn, error |

### 2. Run standalone

```bash
npm install
npm run build
npm start
```

### 3. Run with Docker

```bash
docker compose up --build
```

### 4. Run as part of a Paperclip stack

Add the adapter to your Paperclip `docker-compose.yml`:

```yaml
  a0-adapter:
    build:
      context: ./path/to/paperclip-agent0-adapter
    ports:
      - "4000:4000"
    environment:
      A0_BASE_URL: "http://host.docker.internal:5555/api/"
      A0_API_KEY: "your-agent-zero-api-key"
      PAPERCLIP_URL: "http://server:3100"
      PAPERCLIP_API_KEY: "your-paperclip-agent-jwt"
      ADAPTER_SECRET: "none"
    volumes:
      - ./adapter-data:/app/data
    restart: unless-stopped
```

Then in Paperclip, create an agent with:
- **Adapter type:** HTTP
- **Webhook URL:** `http://a0-adapter:4000/heartbeat`
- **Method:** POST

## Configuring the Paperclip agent

1. In Paperclip, create a new agent or edit an existing one
2. Set **Adapter type** to **HTTP**
3. Set **Webhook URL** to `http://a0-adapter:4000/heartbeat` (Docker service name) or `http://localhost:4000/heartbeat` (standalone)
4. Leave headers and payload template empty — the adapter handles everything
5. Assign an issue to the agent and trigger a heartbeat

The adapter will:

- Fetch the issue details (title, description) from Paperclip
- Send them to Agent Zero as a task
- Wait for Agent Zero to complete
- Post the result as a comment on the issue

## Generating a Paperclip API key

The adapter needs a JWT to call Paperclip's API (for fetching issues and posting comments). Generate one using your `PAPERCLIP_AGENT_JWT_SECRET`:

```bash
node -e "
const crypto = require('crypto');
const secret = 'YOUR_PAPERCLIP_AGENT_JWT_SECRET';
const agentId = 'YOUR_AGENT_ID';
const companyId = 'YOUR_COMPANY_ID';
const header = Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
const payload = Buffer.from(JSON.stringify({
  sub: agentId,
  company_id: companyId,
  adapter_type: 'http',
  run_id: 'adapter-api',
  iss: 'paperclip',
  aud: 'paperclip-api',
  iat: Math.floor(Date.now()/1000),
  exp: Math.floor(Date.now()/1000) + 86400*365
})).toString('base64url');
const sig = crypto.createHmac('sha256', secret).update(header+'.'+payload).digest('base64url');
console.log(header+'.'+payload+'.'+sig);
"
```

Also make sure `server` (or whatever Docker hostname the adapter uses) is in Paperclip's allowed hostnames:

```bash
pnpm paperclipai allowed-hostname server
```

Or set `PAPERCLIP_ALLOWED_HOSTNAMES=server,a0-adapter,localhost` on the Paperclip server container.

## Cost models

The adapter estimates execution cost from Agent Zero logs. Bundled models (all under $3/1M output via OpenRouter):

| Model | Input/1K | Output/1K |
| ----- | -------- | --------- |
| minimax-m2.7 (default) | $0.0003 | $0.0012 |
| minimax-m2.5 | $0.0003 | $0.0012 |
| deepseek-v3.2 | $0.00026 | $0.00038 |
| deepseek-r1 | $0.0007 | $0.0025 |
| gemini-2.5-flash | $0.0003 | $0.0025 |
| gemini-2.5-flash-lite | $0.0001 | $0.0004 |
| llama-4-maverick | $0.00027 | $0.00085 |
| qwen3.5-plus | $0.00026 | $0.00156 |

## API

### `GET /health`

Returns `{ "status": "ok" }`.

### `HEAD /heartbeat`

Returns 200. Used by Paperclip's adapter test probe.

### `POST /heartbeat`

Accepts Paperclip's HTTP adapter payload (`{ agentId, runId, context }`), executes via Agent Zero, and returns the result synchronously.

**Optional header:** `X-Adapter-Secret` (validated if `ADAPTER_SECRET` is not `none`)

**Response (200):**

```json
{
  "status": "ok",
  "agentId": "...",
  "runId": "...",
  "contextId": "...",
  "result": "Agent Zero's response text",
  "costUsd": 0.001,
  "tokensUsed": 500,
  "durationMs": 12000
}
```

## Testing

```bash
npm test
```

Coverage threshold: 80%.

## License

MIT — Animus Systems SL
