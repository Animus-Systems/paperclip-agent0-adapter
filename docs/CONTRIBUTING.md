# Contributing

## Principles

- Keep the adapter thin. Orchestration behavior belongs in Paperclip, not here.
- Keep the adapter framework-agnostic. Do not hardcode company, project, or business-specific logic.
- Preserve strict TypeScript safety. Do not introduce `any`.
- Prefer isolated modules with clear contracts and tests.

## Workflow

1. Add or update tests alongside behavior changes.
2. Keep API contracts in `src/contracts.ts` as the source of truth.
3. Update `docs/COST_MODELS.md` and `src/cost-models.json` together if pricing changes.
4. Run `npm test` before submitting a change.
