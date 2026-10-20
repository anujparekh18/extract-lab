// Extract Lab MCP server: lets an agent (Claude Code, Cursor, …) work with your extractors.
// It reads your results, tries prompts, and runs accuracy checks through the same Convex
// functions the app uses. It runs on your machine and talks to the deployment in .env.local.
//
// Connect from Claude Code (already set up in .mcp.json):   claude mcp list
// Run by hand:                                             bun mcp/server.ts
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { z } from "zod";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { ACCEPTED_MIME_TYPES } from "../convex/documents";
import { typescriptSnippet } from "../src/lib/codegen";
import { validateFields, type Field } from "../src/lib/fields";
import { pickerModels, PROVIDERS } from "../src/lib/models";
import { answerProblems, checkReport, completeAnswer, wrongFields } from "./report";

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/** Reads VITE_CONVEX_URL from .env.local next to the repo, wherever the client starts us from. */
function convexUrl() {
  if (process.env.VITE_CONVEX_URL) return process.env.VITE_CONVEX_URL;
  try {
    const env = readFileSync(join(import.meta.dir, "..", ".env.local"), "utf8");
    const match = env.match(/^VITE_CONVEX_URL=(.+)$/m);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    // Fall through to the error below.
  }
  throw new Error("VITE_CONVEX_URL not found. Run `bunx convex dev` once so .env.local exists.");
}

const convex = new ConvexHttpClient(convexUrl());

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Waits for `done` to return a value, checking every `everyMs`, for up to `seconds`. */
async function waitFor<T>(seconds: number, check: () => Promise<T | null>, everyMs = 2000): Promise<T | null> {
  const deadline = Date.now() + seconds * 1000;
  while (true) {
    const value = await check();
    if (value !== null || Date.now() > deadline) return value;
    await new Promise((resolve) => setTimeout(resolve, everyMs));
  }
}

class UserError extends Error {}

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

/** Runs a tool, turning failures into a readable error result instead of a crash. */
function tool<A>(handler: (args: A) => Promise<unknown>) {
  return async (args: A) => {
    try {
      return json(await handler(args));
    } catch (error) {
      const message =
        error instanceof ConvexError
          ? String(error.data)
          : error instanceof Error
            ? error.message
            : String(error);
      return { content: [{ type: "text" as const, text: message }], isError: true };
    }
  };
}

async function extractorBySlug(slug: string) {
  const extractor = await convex.query(api.extractors.getBySlug, { slug });
  if (!extractor) {
    const all = await convex.query(api.extractors.list, {});
    throw new UserError(`No extractor "${slug}". Known: ${all.map((e) => e.slug).join(", ") || "none yet"}.`);
  }
  if (!extractor.latestPrompt || !extractor.latestSchema) throw new UserError(`"${slug}" has no saved prompt or fields yet.`);
  return {
    ...extractor,
    latestPrompt: extractor.latestPrompt,
    latestSchema: { ...extractor.latestSchema, fields: extractor.latestSchema.fields as Field[] },
  };
}

async function checkModel(modelId: string) {
  const catalog = await convex.query(api.models.list, {});
  const model = catalog.find((m) => m.id === modelId);
  if (!model) throw new UserError(`Unknown model "${modelId}". Use list_models to see the ids.`);
  return model;
}

const MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv", ".eml", ".html"]);
const MAX_TEXT_CHARS = 60_000;

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: "extract-lab", version: "0.1.0" },
  {
    instructions: `Extract Lab finds the prompt, fields, and model that extract data from a type of document correctly and cheaply.
Each extractor has a prompt and fields (both versioned), documents, and for some documents a correct answer.
An accuracy check runs the latest prompt and fields with a model over every document that has a correct answer, and scores each field.

Fields marked "important": true must be right; reports score them separately (importantFieldsCorrect). Judge a setup by its important fields first, then by cost, then by the other fields.

A typical loop: get_extractor → run_check → read the wrong fields (read_document shows the document text) → save_version with a better prompt or field descriptions → run_check again and compare with list_checks.

Correct answers must come from a person or the user's own records. Never invent them or copy a model's output into them unless the user asks.
Extractions and checks call paid model APIs: say how many documents a check covers before running it on many models.
Nothing here deletes data. Saving always creates a new version, which the user can undo in the app.`,
  },
);

const readOnly = { readOnlyHint: true, openWorldHint: false } as const;

server.registerTool(
  "list_extractors",
  {
    title: "List extractors",
    description: "All extractors with how many documents and correct answers each has.",
    annotations: readOnly,
  },
  tool(async () => {
    const rows = await convex.query(api.extractors.list, {});
    return rows.map((e) => ({
      slug: e.slug,
      name: e.name,
      description: e.description,
      documents: e.documentCount,
      withCorrectAnswers: e.testCaseCount,
      fields: e.fieldCount,
      published: e.isPublished,
    }));
  }),
);

server.registerTool(
  "get_extractor",
  {
    title: "Get extractor",
    description:
      "An extractor's latest prompt and fields (with field checks), its default model, and the published setup. " +
      "Set include_code to also get TypeScript (zod schema, prompt, generateText call, and field checks) to use the extractor in another project.",
    inputSchema: { slug: z.string(), include_code: z.boolean().optional() },
    annotations: readOnly,
  },
  tool(async ({ slug, include_code }: { slug: string; include_code?: boolean }) => {
    const e = await extractorBySlug(slug);
    return {
      slug: e.slug,
      name: e.name,
      description: e.description,
      defaultModel: e.defaultModel,
      prompt: { version: e.latestPrompt.version, text: e.latestPrompt.text },
      fields: { version: e.latestSchema.version, fields: e.latestSchema.fields },
      published: e.published ?? null,
      ...(include_code
        ? {
            typescript: typescriptSnippet({
              name: e.name,
              prompt: e.latestPrompt.text,
              fields: e.latestSchema.fields,
              model: e.published?.model ?? e.defaultModel,
            }),
          }
        : {}),
    };
  }),
);

server.registerTool(
  "list_models",
  {
    title: "List models",
    description:
      "Models you can extract with: id, price in USD per 1M input/output tokens, and what they read (pdf, image, or text only). " +
      "Recent models only, unless include_older is set.",
    inputSchema: {
      provider: z.enum(Object.keys(PROVIDERS) as [keyof typeof PROVIDERS, ...(keyof typeof PROVIDERS)[]]).optional(),
      search: z.string().optional(),
      include_older: z.boolean().optional(),
    },
    annotations: readOnly,
  },
  tool(async ({ provider, search, include_older }: { provider?: string; search?: string; include_older?: boolean }) => {
    const [catalog, setup] = await Promise.all([convex.query(api.models.list, {}), convex.query(api.api.setup, {})]);
    return pickerModels(catalog, { query: search, showAll: include_older })
      .filter((m) => !provider || m.provider === provider)
      .map((m) => ({
        id: m.id,
        name: m.label,
        inputPerMillion: m.input,
        outputPerMillion: m.output,
        reads: m.files,
        released: m.releaseDate,
        hasKey: Boolean(setup.providers?.[m.provider]),
      }));
  }),
);

server.registerTool(
  "list_documents",
  {
    title: "List documents",
    description: "An extractor's documents, whether each has a correct answer, and its latest extraction status.",
    inputSchema: { slug: z.string() },
    annotations: readOnly,
  },
  tool(async ({ slug }: { slug: string }) => {
    const e = await extractorBySlug(slug);
    const docs = await convex.query(api.documents.list, { extractorId: e._id });
    return docs.map((d) => ({
      documentId: d._id,
      title: d.title,
      kind: d.kind === "file" ? d.mimeType : "text",
      hasCorrectAnswer: d.hasExpected,
      lastExtraction: d.lastRun?.status ?? null,
    }));
  }),
);

server.registerTool(
  "read_document",
  {
    title: "Read document",
    description:
      "A document's text, its correct answer, and its latest extraction. Files (PDFs, images) come back as a text transcript, " +
      "made once by a cheap model; the transcript can contain small reading mistakes, so it's for understanding failures, not for correct answers.",
    inputSchema: { document_id: z.string(), include_text: z.boolean().optional() },
    annotations: { readOnlyHint: false, openWorldHint: true },
  },
  tool(async ({ document_id, include_text = true }: { document_id: string; include_text?: boolean }) => {
    const id = document_id as Id<"documents">;
    let doc = await convex.query(api.documents.get, { id });
    if (!doc) throw new UserError(`No document ${document_id}.`);

    let text: string | null = doc.text ?? null;
    let textNote: string | undefined;
    if (include_text && doc.kind === "file") {
      if (doc.transcript?.status !== "ready") {
        await convex.mutation(api.documents.requestTranscript, { id });
        doc =
          (await waitFor(90, async () => {
            const fresh = await convex.query(api.documents.get, { id });
            return fresh && fresh.transcript?.status !== "running" ? fresh : null;
          })) ?? doc;
      }
      if (doc.transcript?.status === "ready") text = doc.transcript.text ?? null;
      else textNote = doc.transcript?.status === "failed" ? `Transcript failed: ${doc.transcript.error}` : "Transcript still running; try again shortly.";
    }
    if (text && text.length > MAX_TEXT_CHARS) {
      textNote = `Showing the first ${MAX_TEXT_CHARS} of ${text.length} characters.`;
      text = text.slice(0, MAX_TEXT_CHARS);
    }

    const [latest] = await convex.query(api.runs.listByDocument, { documentId: id });
    let comparison: ReturnType<typeof wrongFields> | undefined;
    if (latest?.status === "success" && doc.expected !== undefined) {
      const run = await convex.query(api.runs.get, { id: latest._id });
      if (run?.schema) comparison = wrongFields(run.schema.fields, doc.expected, latest.output, doc.expectedNotSure);
    }

    return {
      documentId: doc._id,
      title: doc.title,
      kind: doc.kind === "file" ? doc.mimeType : "text",
      fileName: doc.fileName,
      correctAnswer: doc.expected ?? null,
      ...(doc.expectedNotSure?.length ? { notSure: doc.expectedNotSure } : {}),
      latestExtraction: latest
        ? {
            model: latest.model,
            promptVersion: latest.promptVersion,
            schemaVersion: latest.schemaVersion,
            status: latest.status,
            error: latest.error,
            output: latest.output,
            costUsd: latest.costUsd,
            ...comparison,
          }
        : null,
      ...(include_text ? { text, textNote } : {}),
    };
  }),
);

server.registerTool(
  "upload_documents",
  {
    title: "Upload documents",
    description:
      "Adds files from this computer to an extractor: PDF, JPEG, PNG, WebP, or text files (.txt, .md, .json, .csv, .eml, .html). " +
      "Skips files whose name matches an existing document's title, so it's safe to run again on the same folder.",
    inputSchema: { slug: z.string(), paths: z.array(z.string()).min(1).max(100) },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  tool(async ({ slug, paths }: { slug: string; paths: string[] }) => {
    const e = await extractorBySlug(slug);
    const existing = new Set((await convex.query(api.documents.list, { extractorId: e._id })).map((d) => d.title));
    const results: Array<{ path: string; result: string; documentId?: string }> = [];

    for (const path of paths) {
      const extension = extname(path).toLowerCase();
      const title = basename(path).replace(/\.[a-z0-9]+$/i, "");
      if (existing.has(title)) {
        results.push({ path, result: "skipped: already uploaded" });
        continue;
      }
      try {
        const file = Bun.file(path);
        if (!(await file.exists())) throw new UserError("file not found");
        let documentId: string;
        if (TEXT_EXTENSIONS.has(extension)) {
          documentId = await convex.mutation(api.documents.createFromText, {
            extractorId: e._id,
            title,
            text: await file.text(),
            format: extension === ".json" ? "json" : undefined,
          });
        } else {
          const mimeType = MIME_BY_EXTENSION[extension];
          if (!mimeType || !ACCEPTED_MIME_TYPES.includes(mimeType)) throw new UserError(`unsupported file type ${extension || "(none)"}`);
          const uploadUrl = await convex.mutation(api.documents.generateUploadUrl, {});
          const response = await fetch(uploadUrl, { method: "POST", headers: { "Content-Type": mimeType }, body: file });
          if (!response.ok) throw new UserError(`upload failed (${response.status})`);
          const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
          documentId = await convex.mutation(api.documents.createFromFile, {
            extractorId: e._id,
            storageId,
            fileName: basename(path),
          });
        }
        existing.add(title);
        results.push({ path, result: "uploaded", documentId });
      } catch (error) {
        const message = error instanceof ConvexError ? String(error.data) : error instanceof Error ? error.message : String(error);
        results.push({ path, result: `failed: ${message}` });
      }
    }
    return results;
  }),
);

server.registerTool(
  "set_correct_answer",
  {
    title: "Set correct answer",
    description:
      "Saves the correct answer for a document: a JSON object with one key per field, as the user's records say. Leave out empty values. " +
      "Use null to clear it. Answers that don't fit the extractor's fields are refused with the reasons. " +
      "When the correct value of a field isn't known, list its path in not_sure (e.g. \"items[1].price\"): it isn't scored, instead of counting a model's value as wrong. " +
      "Only use answers from the user or their records, never a model's output.",
    inputSchema: {
      document_id: z.string(),
      answer: z.record(z.string(), z.unknown()).nullable(),
      not_sure: z.array(z.string()).optional().describe("Paths of fields whose correct value isn't known. Replaces the current list."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  tool(async ({ document_id, answer, not_sure }: { document_id: string; answer: Record<string, unknown> | null; not_sure?: string[] }) => {
    const id = document_id as Id<"documents">;
    const doc = await convex.query(api.documents.get, { id });
    if (!doc) throw new UserError(`No document ${document_id}.`);
    let expected: Record<string, unknown> | null = null;
    if (answer !== null) {
      const extractor = (await convex.query(api.extractors.list, {})).find((e) => e._id === doc.extractorId);
      const e = await extractorBySlug(extractor!.slug);
      const problems = answerProblems(e.latestSchema.fields, answer);
      if (problems.length) throw new UserError(`Not saved. The answer doesn't fit the fields:\n- ${problems.join("\n- ")}`);
      expected = completeAnswer(e.latestSchema.fields, answer);
    }
    await convex.mutation(api.documents.setExpected, { id, expected, ...(not_sure ? { notSure: not_sure } : {}) });
    return { documentId: id, title: doc.title, saved: answer === null ? "cleared" : "saved", ...(not_sure?.length ? { notSure: not_sure } : {}) };
  }),
);

server.registerTool(
  "save_version",
  {
    title: "Save a new version",
    description:
      "Saves a new prompt and/or new fields for an extractor. Fields use the same JSON as get_extractor returns. " +
      "Saving the same content again reuses the existing version. Run run_check afterwards to see the effect.",
    inputSchema: { slug: z.string(), prompt: z.string().optional(), fields: z.array(z.unknown()).optional() },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  tool(async ({ slug, prompt, fields }: { slug: string; prompt?: string; fields?: unknown[] }) => {
    if (prompt === undefined && fields === undefined) throw new UserError("Pass a prompt, fields, or both.");
    const e = await extractorBySlug(slug);
    if (fields) {
      const problems = validateFields(fields as Field[]);
      if (problems.length) throw new UserError(`Fields not saved:\n- ${problems.join("\n- ")}`);
    }
    if (prompt !== undefined && !prompt.trim()) throw new UserError("The prompt can't be empty.");
    const promptVersion = prompt !== undefined ? await convex.mutation(api.versions.savePrompt, { extractorId: e._id, text: prompt }) : e.latestPrompt.version;
    const schemaVersion = fields ? await convex.mutation(api.versions.saveSchema, { extractorId: e._id, fields }) : e.latestSchema.version;
    return { promptVersion, schemaVersion };
  }),
);

server.registerTool(
  "extract",
  {
    title: "Extract one document",
    description:
      "Runs one extraction with the latest prompt and fields (or a draft prompt and fields, which are saved as versions) and waits for it. " +
      "Shows the output and, when the document has a correct answer, which fields are wrong.",
    inputSchema: {
      document_id: z.string(),
      model: z.string().optional().describe("Model id from list_models. Defaults to the extractor's default model."),
      prompt: z.string().optional(),
      fields: z.array(z.unknown()).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  tool(async ({ document_id, model, prompt, fields }: { document_id: string; model?: string; prompt?: string; fields?: unknown[] }) => {
    const id = document_id as Id<"documents">;
    const doc = await convex.query(api.documents.get, { id });
    if (!doc) throw new UserError(`No document ${document_id}.`);
    const slug = (await convex.query(api.extractors.list, {})).find((e) => e._id === doc.extractorId)!.slug;
    const e = await extractorBySlug(slug);
    const modelId = model ?? e.defaultModel;
    await checkModel(modelId);
    const useFields = (fields as Field[] | undefined) ?? e.latestSchema.fields;
    const problems = validateFields(useFields);
    if (problems.length) throw new UserError(`Fields have problems:\n- ${problems.join("\n- ")}`);

    const runId = await convex.mutation(api.runs.start, {
      documentId: id,
      prompt: prompt ?? e.latestPrompt.text,
      fields: useFields,
      model: modelId,
      source: "agent",
    });
    const run = await waitFor(180, async () => {
      const r = await convex.query(api.runs.get, { id: runId });
      return r && (r.status === "success" || r.status === "failed") ? r : null;
    });
    if (!run) return { runId, status: "still running", note: "Use read_document later to see the result." };
    return {
      model: modelId,
      promptVersion: run.prompt?.version,
      schemaVersion: run.schema?.version,
      status: run.status,
      error: run.error,
      output: run.output,
      costUsd: run.costUsd,
      latencyMs: run.latencyMs,
      ...(run.status === "success" && doc.expected !== undefined && run.schema
        ? wrongFields(run.schema.fields, doc.expected, run.output, doc.expectedNotSure)
        : {}),
    };
  }),
);

server.registerTool(
  "run_check",
  {
    title: "Run an accuracy check",
    description:
      "Runs the latest prompt and fields over every document that has a correct answer, once per model, and scores each field. " +
      "Waits up to about 4 minutes, then returns the report: accuracy, cost per document, the fields that fail most, and each wrong value. " +
      "If it's still running, call get_check with the check ids.",
    inputSchema: {
      slug: z.string(),
      models: z.array(z.string()).max(6).optional().describe("Model ids from list_models. Defaults to the extractor's default model."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  tool(async ({ slug, models }: { slug: string; models?: string[] }) => {
    const e = await extractorBySlug(slug);
    const modelIds = models?.length ? models : [e.defaultModel];
    for (const m of modelIds) await checkModel(m);
    const checkIds = await convex.mutation(api.evals.create, {
      extractorId: e._id,
      promptVersionId: e.latestPrompt._id,
      schemaVersionId: e.latestSchema._id,
      models: modelIds,
    });
    return await Promise.all(checkIds.map((checkId) => reportWhenDone(checkId, 240)));
  }),
);

async function reportWhenDone(checkId: Id<"evals">, seconds: number, allFields = false) {
  const check = await waitFor(seconds, async () => {
    const c = await convex.query(api.evals.get, { id: checkId });
    if (!c) throw new UserError(`No check ${checkId}.`);
    return c.summary.running === 0 ? c : null;
  }, 3000);
  const final = check ?? (await convex.query(api.evals.get, { id: checkId }))!;
  return checkReport(final, { allFields });
}

server.registerTool(
  "get_check",
  {
    title: "Get an accuracy check",
    description:
      "The report for one check: accuracy, cost, the fields that fail most, and each wrong value (or every value with all_fields). " +
      "Waits up to 2 minutes if it's still running.",
    inputSchema: { check_id: z.string(), all_fields: z.boolean().optional() },
    annotations: readOnly,
  },
  tool(async ({ check_id, all_fields }: { check_id: string; all_fields?: boolean }) =>
    reportWhenDone(check_id as Id<"evals">, 120, all_fields),
  ),
);

server.registerTool(
  "list_checks",
  {
    title: "List accuracy checks",
    description:
      "An extractor's recent checks, newest first: model, prompt and field versions, accuracy, cost per document, speed, " +
      "and how many documents it fixed or broke compared with the same model's previous check. Use it to compare models and versions.",
    inputSchema: { slug: z.string(), limit: z.number().int().min(1).max(50).optional() },
    annotations: readOnly,
  },
  tool(async ({ slug, limit = 15 }: { slug: string; limit?: number }) => {
    const e = await extractorBySlug(slug);
    const checks = await convex.query(api.evals.list, { extractorId: e._id });
    return checks.slice(0, limit).map((c) => ({
      checkId: c._id,
      model: c.model,
      promptVersion: c.promptVersion,
      schemaVersion: c.schemaVersion,
      when: new Date(c.createdAt).toISOString(),
      running: c.summary.running,
      ...(c.summary.importantTotalFields
        ? {
            importantFieldsCorrect: `${c.summary.importantMatchedFields}/${c.summary.importantTotalFields}`,
            documentsWithImportantFieldsRight: `${c.summary.importantPerfectDocs}/${c.summary.scoredDocs}`,
          }
        : {}),
      fieldsCorrect: `${c.summary.matchedFields}/${c.summary.totalFields}`,
      fieldAccuracy: c.summary.fieldAccuracy === null ? null : Number(c.summary.fieldAccuracy.toFixed(4)),
      perfectDocuments: `${c.summary.perfectDocs}/${c.summary.scoredDocs}`,
      failedRuns: c.summary.failed,
      avgCostUsd: c.summary.avgCostUsd === null ? null : Number(c.summary.avgCostUsd.toFixed(6)),
      medianLatencyMs: c.summary.p50LatencyMs,
      comparedWithPrevious: c.change,
    }));
  }),
);

await server.connect(new StdioServerTransport());
