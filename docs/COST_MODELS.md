# Cost Models

These values are used for approximate post-execution cost estimation based on Agent Zero logs.

| Model | Input $ / 1K | Output $ / 1K | Notes |
| --- | ---: | ---: | --- |
| claude-sonnet-4-5 | 0.003 | 0.015 | Anthropic default |
| claude-haiku-4-5 | 0.00025 | 0.00125 | Utility model |
| gpt-4.1 | 0.002 | 0.008 | OpenAI |
| gpt-4.1-mini | 0.0004 | 0.0016 | OpenAI lite |
| gemini-1.5-flash | 0.000075 | 0.0003 | Google |
| gemini-2.0-flash | 0.0001 | 0.0004 | Google |
| unknown | 0.002 | 0.008 | Safe default fallback |

The runtime source of truth is `src/cost-models.json`.
