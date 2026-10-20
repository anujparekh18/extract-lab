import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { fail, getExtractorBySlug, isActive, requireExtractor, schemaFields } from "./helpers";
import { queueRun } from "./runs";
import { parseModelId } from "../src/lib/models";
import { checkRules } from "../src/lib/rules";
import { API_RETENTION_MS, DEFAULT_API_RETENTION } from "../src/lib/retention";
import { internal } from "./_generated/api";
import { apiRetention } from "./schema";

/** A retried request with the same Idempotency-Key gets the original run back for this long. */
const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Releases: every configuration ever published, numbered per extractor
// ---------------------------------------------------------------------------

async function releasesOf(ctx: { db: QueryCtx["db"] }, extractorId: Id<"extractors">) {
  return await ctx.db
    .query("releases")
    .withIndex("by_extractor", (q) => q.eq("extractorId", extractorId))
    .collect();
}

/** The release for this prompt, schema, and model: an existing one, or a new number. */
async function releaseFor(
  ctx: MutationCtx,
  extractorId: Id<"extractors">,
  config: { promptVersionId: Id<"promptVersions">; schemaVersionId: Id<"schemaVersions">; model: string },
) {
  const all = await releasesOf(ctx, extractorId);
  const same = all.find(
    (r) => r.promptVersionId === config.promptVersionId && r.schemaVersionId === config.schemaVersionId && r.model === config.model,
  );
  if (same) return same.number;
  const number = all.reduce((max, r) => Math.max(max, r.number), 0) + 1;
  await ctx.db.insert("releases", { extractorId, number, ...config, createdAt: Date.now() });
  return number;
}

/** Makes this prompt, schema, and model what the endpoint serves. Republishing an older setup reuses its number. */
export const publish = mutation({
  args: {
    id: v.id("extractors"),
    promptVersionId: v.id("promptVersions"),
    schemaVersionId: v.id("schemaVersions"),
    model: v.string(),
  },
  handler: async (ctx, args) => {
    await requireExtractor(ctx, args.id);
    const [prompt, schema] = await Promise.all([ctx.db.get(args.promptVersionId), ctx.db.get(args.schemaVersionId)]);
    if (!prompt || prompt.extractorId !== args.id) fail("Prompt version not found.");
    if (!schema || schema.extractorId !== args.id) fail("Schema version not found.");
    if (!parseModelId(args.model)) fail("Unknown model.");
    const config = { promptVersionId: args.promptVersionId, schemaVersionId: args.schemaVersionId, model: args.model };
    const release = await releaseFor(ctx, args.id, config);
    await ctx.db.patch(args.id, { published: { ...config, release, publishedAt: Date.now() }, updatedAt: Date.now() });
    return release;
  },
});

export const releases = query({
  args: { extractorId: v.id("extractors") },
  handler: async (ctx, { extractorId }) => {
    const all = await releasesOf(ctx, extractorId);
    return await Promise.all(
      all
        .sort((a, b) => b.number - a.number)
        .map(async (r) => ({
          number: r.number,
          model: r.model,
          createdAt: r.createdAt,
          promptVersion: (await ctx.db.get(r.promptVersionId))?.version ?? 0,
          schemaVersion: (await ctx.db.get(r.schemaVersionId))?.version ?? 0,
        })),
    );
  },
});

// ---------------------------------------------------------------------------
// Used by the HTTP endpoint (convex/http.ts)
// ---------------------------------------------------------------------------

type StartResult =
  | { ok: true; runId: Id<"runs">; duplicate: boolean }
  | { ok: false; status: number; error: string };

/**
 * Starts a run for an endpoint request, in one transaction: picks the release, honours the
 * Idempotency-Key, saves the document, and queues the run. The run continues even if the caller
 * disconnects.
 */
export const start = internalMutation({
  args: {
    slug: v.string(),
    version: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
    text: v.optional(v.string()),
    format: v.optional(v.literal("json")),
    storageId: v.optional(v.id("_storage")),
    mimeType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<StartResult> => {
    const extractor = await getExtractorBySlug(ctx, args.slug);
    if (!extractor) return { ok: false, status: 404, error: `No extractor named "${args.slug}".` };
    const published = extractor.published;
    if (!published) {
      return { ok: false, status: 409, error: `"${args.slug}" has no published version. Publish one from the "Use in code" tab.` };
    }

    if (args.idempotencyKey) {
      const previous = await ctx.db
        .query("runs")
        .withIndex("by_idempotency_key", (q) => q.eq("extractorId", extractor._id).eq("idempotencyKey", args.idempotencyKey))
        .order("desc")
        .first();
      if (previous && Date.now() - previous.createdAt < IDEMPOTENCY_WINDOW_MS) {
        return { ok: true, runId: previous._id, duplicate: true };
      }
    }

    // Extractors published before releases existed get theirs on first use.
    let current = published.release;
    if (current === undefined) {
      current = await releaseFor(ctx, extractor._id, published);
      await ctx.db.patch(extractor._id, { published: { ...published, release: current } });
    }
    let release: Pick<Doc<"releases">, "number" | "promptVersionId" | "schemaVersionId" | "model"> = { ...published, number: current };
    if (args.version !== undefined && args.version !== current) {
      const pinned = await ctx.db
        .query("releases")
        .withIndex("by_extractor", (q) => q.eq("extractorId", extractor._id).eq("number", args.version!))
        .unique();
      if (!pinned) return { ok: false, status: 404, error: `"${args.slug}" has no version ${args.version}. The current one is ${current}.` };
      release = pinned;
    }

    const now = Date.now();
    const documentId = await ctx.db.insert("documents", {
      extractorId: extractor._id,
      title: `API request ${new Date(now).toISOString()}`,
      kind: args.storageId ? "file" : "text",
      format: args.format,
      origin: "api",
      text: args.text,
      storageId: args.storageId,
      mimeType: args.mimeType,
      fileSize: args.fileSize,
      createdAt: now,
      updatedAt: now,
    });
    const document = (await ctx.db.get(documentId))!;
    const runId = await queueRun(ctx, {
      document,
      promptVersionId: release.promptVersionId,
      schemaVersionId: release.schemaVersionId,
      model: release.model,
      source: "api",
      release: release.number,
      idempotencyKey: args.idempotencyKey,
    });
    return { ok: true, runId, duplicate: false };
  },
});

/**
 * What the endpoint returns for a run: its status, and once finished, the data, field checks, and
 * details. Only runs started through the endpoint can be read this way.
 */
export const result = internalQuery({
  args: { runId: v.string() },
  handler: async (ctx, args) => {
    const runId = ctx.db.normalizeId("runs", args.runId);
    const run = runId ? await ctx.db.get(runId) : null;
    if (!run || run.source !== "api") return null;
    const base = { id: run._id, created_at: new Date(run.createdAt).toISOString() };
    if (isActive(run.status)) return { ...base, status: run.status, finished: false as const };
    if (run.purgedAt) {
      return {
        ...base,
        status: "expired" as const,
        finished: true as const,
        error: "This result was deleted: the extractor keeps endpoint documents for a limited time.",
      };
    }

    const [prompt, schema] = await Promise.all([ctx.db.get(run.promptVersionId), ctx.db.get(run.schemaVersionId)]);
    const meta = {
      version: run.release ?? null,
      model: run.model,
      prompt_version: prompt?.version ?? null,
      schema_version: schema?.version ?? null,
      latency_ms: run.latencyMs ?? null,
      cost_usd: run.costUsd ?? null,
    };
    if (run.status === "failed") {
      return {
        ...base,
        status: "failed" as const,
        finished: true as const,
        error: run.error ?? "Extraction failed.",
        validation_errors: run.validationErrors,
        meta,
      };
    }
    const failures = schema ? checkRules(schemaFields(schema), run.output) : [];
    return {
      ...base,
      status: "succeeded" as const,
      finished: true as const,
      data: run.output ?? null,
      checks: { passed: failures.length === 0, failures },
      meta,
    };
  },
});

// ---------------------------------------------------------------------------
// Retention: endpoint documents and their outputs are deleted after a while
// ---------------------------------------------------------------------------

export const setRetention = mutation({
  args: { id: v.id("extractors"), retention: apiRetention },
  handler: async (ctx, { id, retention }) => {
    await requireExtractor(ctx, id);
    await ctx.db.patch(id, { apiRetention: retention, updatedAt: Date.now() });
  },
});

/** Per run of the cleanup, so one mutation stays small. More are picked up right away. */
const PURGE_BATCH = 100;

/**
 * Deletes endpoint documents older than their extractor's retention period: the document, its
 * file, and the extracted output. The run's details (status, version, cost, time) stay.
 * Documents someone added to the test set are no longer endpoint documents, so they're kept.
 */
export const purgeExpired = internalMutation({
  args: {},
  handler: async (ctx) => {
    let purged = 0;
    for (const extractor of await ctx.db.query("extractors").collect()) {
      const keepFor = API_RETENTION_MS[extractor.apiRetention ?? DEFAULT_API_RETENTION];
      if (keepFor === null) continue;
      const cutoff = Date.now() - keepFor;
      const expired = await ctx.db
        .query("documents")
        .withIndex("by_extractor", (q) => q.eq("extractorId", extractor._id).lt("createdAt", cutoff))
        .filter((q) => q.eq(q.field("origin"), "api"))
        .take(PURGE_BATCH - purged);
      for (const document of expired) {
        const runs = await ctx.db
          .query("runs")
          .withIndex("by_document", (q) => q.eq("documentId", document._id))
          .collect();
        if (runs.some((run) => isActive(run.status))) continue;
        for (const run of runs) {
          await ctx.db.patch(run._id, { output: undefined, validationErrors: undefined, purgedAt: Date.now() });
        }
        if (document.storageId) await ctx.storage.delete(document.storageId);
        await ctx.db.delete(document._id);
        purged++;
      }
      if (purged >= PURGE_BATCH) break;
    }
    if (purged >= PURGE_BATCH) await ctx.scheduler.runAfter(0, internal.endpoint.purgeExpired, {});
    return purged;
  },
});
