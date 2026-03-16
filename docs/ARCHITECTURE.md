# Architecture

`paperclip-agent0-adapter` is a thin translation service with four responsibilities:

1. Receive authenticated Paperclip heartbeat payloads.
2. Translate them into Agent Zero-compatible messages and preserve context continuity.
3. Estimate usage cost from Agent Zero logs.
4. Deliver a signed callback payload back to Paperclip.

## Request Flow

1. Paperclip sends `POST /heartbeat`.
2. The adapter validates the shared secret and budget.
3. The adapter responds `202` immediately.
4. Background execution resolves the stored `context_id`, translates the task, and calls A0 `/api_message`.
5. After A0 returns, the adapter fetches `/api_log_get`, estimates cost, and posts the callback payload.
6. The adapter upserts the latest `context_id` in SQLite.

## Persistence

SQLite stores the `agent_id -> context_id` mapping:

```sql
CREATE TABLE contexts (
  agent_id TEXT PRIMARY KEY,
  context_id TEXT NOT NULL,
  company_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
```

## Error Handling

- Zero budget: `402` and no A0 call.
- Invalid heartbeat: `400`.
- Invalid adapter secret: `401`.
- A0 timeout: callback status `timeout`.
- A0 network/auth/server failure: callback status `failed`.
- Callback 5xx or network failure: retry 3 times with exponential backoff.
