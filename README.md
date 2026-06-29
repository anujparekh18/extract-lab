# Extract Lab

Extract Lab is an open-source workbench for iterating on structured document extraction with LLMs. Define Zod schemas, upload documents, experiment with prompts and Gemini models, then compare every run with validated JSON, token usage, cost, and latency.

## Screenshots

Coming soon.

## What It Does

Extract Lab gives developers a local workbench for testing document extraction systems before they become production workflows. You define document types, write Zod schemas in code, upload PDFs/images or paste text in the UI, create prompts, and run structured extraction with Google Gemini.

Each run stores snapshots of the prompt, schema version, model configuration, output, usage, cost, and latency so historical results remain understandable as prompts and schemas evolve.

## Why Extract Lab?

Structured extraction work gets messy quickly. Prompts change, schemas evolve, model settings drift, and one-off test documents pile up in screenshots, notebooks, and local scripts. Without a run history, it is hard to know whether a prompt improved extraction quality or simply changed the shape of the failure.

Extract Lab keeps prompt, schema, model, and output snapshots together so historical results remain understandable and reproducible. Instead of manually comparing JSON blobs across experiments, you can run the same document through different prompts, schema versions, or model configs and inspect the differences side by side.

## Why Not Just Write a Script?

Scripts and notebooks are useful for the first experiment, but they become hard to trust once prompts, schemas, documents, outputs, models, costs, and latency all change over time. Extract Lab keeps those moving parts attached to each run, with snapshots, validation, and comparison views that make iteration easier to review later.

## Features

- Define extraction schemas in code with Zod.
- Register document types and schema versions in `src/extraction/schema-registry.ts`.
- Use the included invoice schema under `src/extraction/schemas`.
- Try the included invoice examples under `examples/invoice/`.
- Create and edit extraction prompts in the UI.
- Upload PDFs/images or paste raw text documents in the UI.
- Run structured extraction through Google Gemini.
- Inspect validated JSON output.
- Compare run history across prompts, schemas, documents, and model configs.
- Track token usage, approximate cost, and latency for each run.
- Store immutable run snapshots for reproducible experiments.
- Use Convex for backend functions, database, and file storage.

## Quick Start

### 1. Install Dependencies

```bash
bun install
```

### 2. Create a Convex Project and Start Convex

Run Convex locally and follow the prompts to create or connect a Convex project:

```bash
bunx convex dev
```

This command writes the Convex deployment values needed by the frontend.

### 3. Configure Frontend Environment

Copy the example frontend environment file:

```bash
cp .env.example .env.local
```

Your `.env.local` should contain Convex frontend values such as:

```env
CONVEX_DEPLOYMENT=
VITE_CONVEX_URL=
VITE_CONVEX_SITE_URL=
```

Do not put your Gemini API key in `.env.local`. The browser does not need it, and it should not be exposed to frontend code.

### 4. Configure the Gemini API Key in Convex

Set your Gemini API key in the Convex backend environment:

```bash
npx convex env set GOOGLE_GENERATIVE_AI_API_KEY "your-key"
```

Extraction runs execute through Convex backend functions, so the Gemini key belongs in Convex env, not in frontend `.env.local`.

### 5. Run the App

In a second terminal, start the TanStack Start dev server:

```bash
bun run dev
```

Open the local URL printed by Vite, usually:

```text
http://localhost:3000
```

### 6. Run Your First Extraction

The app includes a default Invoice workspace and document type.

1. Open the Invoice workspace.
2. Upload `examples/invoice/sample-invoice.jpg`.
3. Go to Prompts.
4. Create a prompt using `examples/invoice/sample-prompt.md`.
5. Return to the uploaded document.
6. Select the prompt, schema version, and model.
7. Run extraction.
8. Inspect the validated JSON output and run history.
9. Edit the prompt and run extraction again to compare results.

## Project Structure

```text
src/extraction/                    # Extraction schemas, registry, and model config
src/extraction/schema-registry.ts  # Document type and schema version registry
src/extraction/models.ts           # Gemini model config, pricing, and defaults
src/extraction/schemas/            # Zod extraction schemas
src/routes/                        # TanStack Start routes and UI screens
convex/                            # Convex backend, storage, and run logic
examples/invoice/                  # Example invoice files and prompt
.agents/                           # Optional agent skills for contributors
```

## Agent Skills

The `.agents/` directory contains optional Codex agent skills used while developing and reviewing Extract Lab. Contributors can use these skills for UI review, browser testing, and React implementation guidance when working in compatible agent tooling.

These files are part of the repository, but they are not required to install, build, or use Extract Lab.

## Schemas

Schemas are defined in code with Zod. Add or edit schemas under `src/extraction/schemas`, then register them in `src/extraction/schema-registry.ts`.

The UI document type key must match the registry key. For example, the included invoice schema is registered as `invoice`, so the matching document type key in the UI should also be `invoice`.

## Models

Model configuration lives in `src/extraction/models.ts`. Extract Lab is currently Gemini-only and uses the Vercel AI SDK with the Google provider.

Edit this file when you want to add supported Gemini models, change the default model, or update pricing assumptions. Cost tracking is approximate and depends on the configured token prices.

## Current Limitations

- Google Gemini only.
- Convex backend required.
- Schemas are code-first; there is no GUI schema editor.
- No auth or multi-user support by default.
- Intended for local/private developer use unless auth is added.
- No batch or dataset evaluation yet.
- Costs are approximate.

## Privacy and Deployment Notes

Extract Lab is intended for local/private developer use. It does not include auth or multi-user support by default.

Uploaded files and pasted text are stored in Convex and sent to Google Gemini during extraction. Do not upload sensitive documents unless your Convex project, Google Gemini account, and local environment are configured appropriately for that data.

Do not deploy Extract Lab publicly without adding authentication and access controls.

## Tech Stack

- TanStack Start
- React
- Convex
- Vercel AI SDK
- Google Gemini
- Zod
- Tailwind CSS
- Bun
