"use node";

import { v } from "convex/values";
import { APICallError, NoObjectGeneratedError, Output, generateText, type FilePart, type TextPart } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { internalAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import { fieldsToZod, type Field } from "../src/lib/fields";
import {
  PROVIDERS,
  cheapModels,
  estimateCostUsd,
  fileProblem,
  getModelInfo,
  parseModelId,
  type CatalogModel,
  type ProviderId,
} from "../src/lib/models";
import { compactJson } from "../src/lib/json-input";

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

class SetupError extends Error {}

function languageModel(modelId: string) {
  const parsed = parseModelId(modelId);
  if (!parsed) throw new SetupError(`Unknown model "${modelId}".`);
  const apiKey = process.env[PROVIDERS[parsed.provider].envVar];
  if (!apiKey) {
    throw new SetupError(
      `${PROVIDERS[parsed.provider].label} isn't set up. Run: bunx convex env set ${PROVIDERS[parsed.provider].envVar} <your key>`,
    );
  }
  const factories: Record<ProviderId, (model: string) => Parameters<typeof generateText>[0]["model"]> = {
    google: (model) => createGoogleGenerativeAI({ apiKey })(model),
    openai: (model) => createOpenAI({ apiKey })(model),
    anthropic: (model) => createAnthropic({ apiKey })(model),
  };
  return factories[parsed.provider](parsed.model);
}

/** Model names and prices, as edited on the Setup page. */
async function loadCatalog(ctx: ActionCtx): Promise<CatalogModel[]> {
  return await ctx.runQuery(internal.models.catalogInternal, {});
}

function hasKey(modelId: string) {
  const parsed = parseModelId(modelId);
  return Boolean(parsed && process.env[PROVIDERS[parsed.provider].envVar]);
}

// ---------------------------------------------------------------------------
// Document content
// ---------------------------------------------------------------------------

type UserContent = Array<TextPart | FilePart>;

async function documentContent(ctx: ActionCtx, document: Doc<"documents">): Promise<UserContent> {
  if (document.kind === "text") {
    if (!document.text?.trim()) throw new SetupError("This document has no text.");
    if (document.format === "json") {
      // Stored pretty for people; sent compact to save tokens.
      return [{ type: "text", text: `<document format="json">\n${compactJson(JSON.parse(document.text))}\n</document>` }];
    }
    return [{ type: "text", text: `<document>\n${document.text}\n</document>` }];
  }
  if (!document.storageId || !document.mimeType) throw new SetupError("This document's file is missing.");
  const blob = await ctx.storage.get(document.storageId);
  if (!blob) throw new SetupError("This document's file is missing.");
  return [{ type: "file", data: new Uint8Array(await blob.arrayBuffer()), mediaType: document.mimeType }];
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

type ExtractResult = {
  status: "success" | "failed";
  output?: unknown;
  error?: string;
  validationErrors?: string[];
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  latencyMs: number;
};

async function extract(
  ctx: ActionCtx,
  args: { document: Doc<"documents">; prompt: string; fields: Field[]; model: string },
): Promise<ExtractResult> {
  const startedAt = Date.now();
  const catalog = await loadCatalog(ctx);
  try {
    const problem = args.document.kind === "file" ? fileProblem(getModelInfo(args.model, catalog), args.document.mimeType) : null;
    if (problem) throw new SetupError(problem);
    const content = await documentContent(ctx, args.document);
    const result = await generateText({
      model: languageModel(args.model),
      instructions: args.prompt,
      output: Output.object({ schema: fieldsToZod(args.fields) }),
      messages: [
        {
          role: "user",
          content: [...content, { type: "text", text: "Extract the data from this document." }],
        },
      ],
      maxRetries: 2,
    });
    const usage = { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens };
    return {
      status: "success",
      output: result.output,
      ...usage,
      costUsd: estimateCostUsd(args.model, usage, catalog),
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return { ...describeFailure(error, args.model, catalog), latencyMs: Date.now() - startedAt };
  }
}

function describeFailure(error: unknown, modelId: string, catalog: CatalogModel[]): Omit<ExtractResult, "latencyMs"> {
  if (error instanceof SetupError) return { status: "failed", error: error.message };

  if (NoObjectGeneratedError.isInstance(error)) {
    const usage = { inputTokens: error.usage?.inputTokens, outputTokens: error.usage?.outputTokens };
    return {
      status: "failed",
      error: "The model's output doesn't match the schema.",
      validationErrors: zodIssues(error.cause) ?? [error.cause instanceof Error ? error.cause.message : "Output could not be parsed."],
      output: tryParse(error.text),
      ...usage,
      costUsd: estimateCostUsd(modelId, usage, catalog),
    };
  }

  if (APICallError.isInstance(error)) {
    const provider = parseModelId(modelId)?.provider;
    const label = provider ? PROVIDERS[provider].label : "The provider";
    if (error.statusCode === 401 || error.statusCode === 403) {
      return { status: "failed", error: `${label} rejected the API key (${error.statusCode}).` };
    }
    if (error.statusCode === 404) {
      return { status: "failed", error: `${label} doesn't recognise the model "${parseModelId(modelId)?.model}".` };
    }
    if (error.statusCode === 429) {
      return { status: "failed", error: `${label} rate limit reached. Wait a moment and run again.` };
    }
    return { status: "failed", error: `${label} error${error.statusCode ? ` ${error.statusCode}` : ""}: ${error.message}` };
  }

  return { status: "failed", error: error instanceof Error ? error.message : "Extraction failed." };
}

function zodIssues(cause: unknown): string[] | undefined {
  let current = cause as { issues?: Array<{ path?: PropertyKey[]; message?: string }>; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 4; depth++) {
    if (Array.isArray(current.issues) && current.issues.length > 0) {
      return current.issues.map((issue) => {
        const path = issue.path?.length ? issue.path.map(String).join(".") : "(root)";
        return `${path}: ${issue.message ?? "invalid value"}`;
      });
    }
    current = current.cause as typeof current;
  }
  return undefined;
}

function tryParse(text: string | undefined) {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Transcription (files -> text, for the Text view and agents)
// ---------------------------------------------------------------------------

/** How many cheap models a helper job tries before giving up. */
const HELPER_MODEL_ATTEMPTS = 3;

class HelperModelError extends Error {
  constructor(
    readonly cause: unknown,
    readonly modelId: string,
  ) {
    super("Helper model failed");
  }
}

/**
 * Runs a helper job (reading a file as text) with the cheapest model that works. Catalogs
 * can list models a provider has retired or a key can't use, so a "model not found" moves on to
 * the next cheapest instead of failing.
 */
async function withCheapModel<T>(catalog: CatalogModel[], job: (modelId: string) => Promise<T>): Promise<{ modelId: string; result: T }> {
  const candidates = cheapModels(catalog, hasKey).slice(0, HELPER_MODEL_ATTEMPTS);
  if (candidates.length === 0) throw new SetupError("No model available. Add any provider key in Setup.");
  let last: HelperModelError | null = null;
  for (const candidate of candidates) {
    try {
      return { modelId: candidate.id, result: await job(candidate.id) };
    } catch (error) {
      last = new HelperModelError(error, candidate.id);
      if (!(APICallError.isInstance(error) && error.statusCode === 404)) break;
    }
  }
  throw last;
}

function helperFailure(error: unknown, catalog: CatalogModel[], fallback: string) {
  if (error instanceof HelperModelError) return describeFailure(error.cause, error.modelId, catalog).error ?? fallback;
  return error instanceof Error ? error.message : fallback;
}

async function ensureTranscript(ctx: ActionCtx, document: Doc<"documents">): Promise<string> {
  if (document.kind === "text") return document.text ?? "";
  if (document.transcript?.status === "ready" && document.transcript.text) return document.transcript.text;

  const catalog = await loadCatalog(ctx);
  if (cheapModels(catalog, hasKey).length === 0) {
    throw new SetupError("Reading files as text needs a model. Add any provider key.");
  }
  await ctx.runMutation(internal.documents.setTranscript, { id: document._id, transcript: { status: "running" } });
  try {
    const content = await documentContent(ctx, document);
    const { modelId, result } = await withCheapModel(catalog, (modelId) =>
      generateText({
        model: languageModel(modelId),
        instructions:
          "Transcribe every piece of text in the document, in reading order. Keep table rows on one line with columns separated by ' | '. Output only the transcription.",
        messages: [{ role: "user", content }],
        maxRetries: 2,
      }),
    );
    const text = result.text.trim();
    await ctx.runMutation(internal.documents.setTranscript, {
      id: document._id,
      transcript: {
        status: "ready",
        text,
        model: modelId,
        costUsd: estimateCostUsd(modelId, result.usage, catalog),
      },
    });
    return text;
  } catch (error) {
    const message = helperFailure(error, catalog, "Transcription failed.");
    await ctx.runMutation(internal.documents.setTranscript, {
      id: document._id,
      transcript: { status: "failed", error: message, model: error instanceof HelperModelError ? error.modelId : undefined },
    });
    throw new SetupError(`Couldn't read the file as text: ${message}`);
  }
}

export const transcribe = internalAction({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    const document = await ctx.runQuery(internal.documents.getInternal, { id: documentId });
    if (!document) return;
    try {
      await ensureTranscript(ctx, { ...document, transcript: undefined });
    } catch {
      // Recorded on the document by ensureTranscript.
    }
  },
});

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

export const run = internalAction({
  args: { runId: v.id("runs") },
  handler: async (ctx, { runId }) => {
    const claimed = await ctx.runMutation(internal.runs.markRunning, { runId });
    if (!claimed) return;
    const payload = await ctx.runQuery(internal.runs.getForExecution, { runId });
    if (!payload) {
      await ctx.runMutation(internal.runs.finish, { runId, status: "failed", error: "The document or its versions were deleted." });
      return;
    }
    const { run, document, prompt, fields } = payload;
    const result = await extract(ctx, { document, prompt, fields, model: run.model });
    await ctx.runMutation(internal.runs.finish, { runId, ...result });
  },
});
