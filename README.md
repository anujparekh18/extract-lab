# Extract Lab

An open-source workbench for building, testing, and comparing structured document extraction workflows using LLMs.

## Stack

- Bun
- TanStack Start + React 19
- Convex
- Vercel AI SDK + Google provider
- Tailwind CSS v4

## Core Flow

1. Add schema support in code registry (`src/extraction/schema-registry.ts`) for a `docTypeKey` and version map (`docTypeKey -> { v1, v2 }`).
2. Create matching doc type in UI.
3. Upload files or paste raw text under that doc type.
4. Create prompts under that doc type.
5. Run extraction for one doc + one prompt + one schema version + one model config.
6. Compare run history side by side (JSON diff, prompt diff, cost, latency).

## Adding Gemini Models

Edit `src/extraction/models.ts` when you want to:

- add or remove supported Gemini models
- change the default model
- update model pricing
- update USD to INR conversion
- change model labels or cost display helpers

For a new Gemini model, add the model id to `SUPPORTED_GOOGLE_MODELS`. If you want cost estimates to appear in run history, also add pricing to `MODEL_PRICING_PER_1M_TOKENS_USD`. Models without pricing can still run, but cost will display as `-`.

## Important Rules

- `docTypeKey` in UI must match registry key in code.
- Doc type key is immutable after creation.
- Unsupported doc types can still have docs/prompts, but Run is disabled.
- One run per document at a time.
- Runs store immutable snapshots for prompt/schema/model.

## Setup

```bash
bun install
cp .env.example .env.local
bunx convex dev
bun run dev
```

## Environment

```env
GOOGLE_GENERATIVE_AI_API_KEY=
```
