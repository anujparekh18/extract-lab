import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const runStatus = v.union(
  v.literal("queued"),
  v.literal("running"),
  v.literal("success"),
  v.literal("failed"),
);

/** Where a run came from: the playground, an accuracy check, the HTTP endpoint, or a coding agent (MCP). */
/** How long documents sent to the HTTP endpoint (and their outputs) are kept. Default: 30 days. */
export const apiRetention = v.union(v.literal("none"), v.literal("7d"), v.literal("30d"), v.literal("forever"));

export const runSource = v.union(v.literal("playground"), v.literal("eval"), v.literal("api"), v.literal("agent"));

export const sourcesValidator = v.object({
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed")),
  /** Record<path, { quote: string | null; found?: boolean }> */
  fields: v.optional(v.any()),
  model: v.optional(v.string()),
  costUsd: v.optional(v.number()),
  error: v.optional(v.string()),
});

/** No longer written: Jev verification results on older runs. Kept so those runs still validate. */
export const verificationValidator = v.object({
  status: v.union(v.literal("running"), v.literal("done"), v.literal("failed"), v.literal("skipped")),
  /** path -> { risk, checks } */
  fields: v.optional(v.any()),
  maxRisk: v.optional(v.number()),
  flagged: v.optional(v.number()),
  model: v.optional(v.string()),
  inputTokens: v.optional(v.number()),
  costUsd: v.optional(v.number()),
  latencyMs: v.optional(v.number()),
  truncated: v.optional(v.boolean()),
  error: v.optional(v.string()),
});

export default defineSchema({
  extractors: defineTable({
    slug: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    defaultModel: v.string(),
    /** The configuration served by the HTTP endpoint and shown in "Use in code". */
    published: v.optional(
      v.object({
        promptVersionId: v.id("promptVersions"),
        schemaVersionId: v.id("schemaVersions"),
        model: v.string(),
        /** Its number in `releases`. Missing on extractors published before releases existed. */
        release: v.optional(v.number()),
        /** No longer used: older extractors were published with Jev verification on or off. */
        verify: v.optional(v.boolean()),
        publishedAt: v.number(),
      }),
    ),
    apiRetention: v.optional(apiRetention),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_slug", ["slug"]),

  promptVersions: defineTable({
    extractorId: v.id("extractors"),
    version: v.number(),
    text: v.string(),
    hash: v.string(),
    createdAt: v.number(),
  })
    .index("by_extractor", ["extractorId", "version"])
    .index("by_extractor_hash", ["extractorId", "hash"]),

  schemaVersions: defineTable({
    extractorId: v.id("extractors"),
    version: v.number(),
    /** Field[] (see src/lib/fields.ts) */
    fields: v.any(),
    hash: v.string(),
    createdAt: v.number(),
  })
    .index("by_extractor", ["extractorId", "version"])
    .index("by_extractor_hash", ["extractorId", "hash"]),

  /**
   * Every configuration ever published, numbered per extractor. The endpoint serves the current one;
   * callers can pin an older one with `version`.
   */
  releases: defineTable({
    extractorId: v.id("extractors"),
    number: v.number(),
    promptVersionId: v.id("promptVersions"),
    schemaVersionId: v.id("schemaVersions"),
    model: v.string(),
    createdAt: v.number(),
  }).index("by_extractor", ["extractorId", "number"]),

  documents: defineTable({
    extractorId: v.id("extractors"),
    title: v.string(),
    kind: v.union(v.literal("file"), v.literal("text")),
    /** Documents sent to the HTTP endpoint are kept out of the test set. */
    origin: v.optional(v.literal("api")),
    /** Text documents holding JSON; `text` is pretty-printed, validated JSON. */
    format: v.optional(v.literal("json")),
    fileName: v.optional(v.string()),
    mimeType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    storageId: v.optional(v.id("_storage")),
    text: v.optional(v.string()),
    /** Plain-text transcription of a file, for the Text view and agents. */
    transcript: v.optional(
      v.object({
        status: v.union(v.literal("running"), v.literal("ready"), v.literal("failed")),
        text: v.optional(v.string()),
        model: v.optional(v.string()),
        costUsd: v.optional(v.number()),
        error: v.optional(v.string()),
      }),
    ),
    /** The correct output for this document. Makes it a test case. */
    expected: v.optional(v.any()),
    /** Paths of the expected output whose correct value isn't known, so they aren't scored (e.g. `items[1].price`). */
    expectedNotSure: v.optional(v.array(v.string())),
    expectedUpdatedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_extractor", ["extractorId", "createdAt"]),

  runs: defineTable({
    extractorId: v.id("extractors"),
    documentId: v.id("documents"),
    promptVersionId: v.id("promptVersions"),
    schemaVersionId: v.id("schemaVersions"),
    model: v.string(),
    source: runSource,
    evalId: v.optional(v.id("evals")),
    /** Endpoint runs: the release they ran, and the caller's Idempotency-Key. */
    release: v.optional(v.number()),
    idempotencyKey: v.optional(v.string()),
    /** When the retention period deleted this endpoint run's document and output. */
    purgedAt: v.optional(v.number()),
    /** No longer written: whether older runs were verified with Jev. */
    verify: v.optional(v.boolean()),

    status: runStatus,
    output: v.optional(v.any()),
    error: v.optional(v.string()),
    validationErrors: v.optional(v.array(v.string())),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    costUsd: v.optional(v.number()),
    latencyMs: v.optional(v.number()),
    /** No longer written (see verificationValidator). */
    verification: v.optional(verificationValidator),
    /** No longer written: older runs stored a quote per field here. Kept so those runs still validate. */
    sources: v.optional(sourcesValidator),

    createdAt: v.number(),
    startedAt: v.optional(v.number()),
    finishedAt: v.optional(v.number()),
  })
    .index("by_document", ["documentId", "createdAt"])
    .index("by_extractor", ["extractorId", "createdAt"])
    .index("by_eval", ["evalId"])
    .index("by_idempotency_key", ["extractorId", "idempotencyKey"])
    .index("by_status", ["status"]),

  evals: defineTable({
    extractorId: v.id("extractors"),
    promptVersionId: v.id("promptVersions"),
    schemaVersionId: v.id("schemaVersions"),
    model: v.string(),
    /** No longer written: whether older checks verified fields with Jev. */
    verify: v.optional(v.boolean()),
    documentIds: v.array(v.id("documents")),
    /** "auto" when started by saving a new version rather than by hand. */
    trigger: v.optional(v.union(v.literal("manual"), v.literal("auto"))),
    createdAt: v.number(),
  }).index("by_extractor", ["extractorId", "createdAt"]),

  /** Edits to the built-in models (label, prices, hidden) and models added from the Setup page. */
  modelSettings: defineTable({
    /** `provider/model`. */
    modelId: v.string(),
    label: v.optional(v.string()),
    input: v.optional(v.number()),
    output: v.optional(v.number()),
    hidden: v.optional(v.boolean()),
    custom: v.boolean(),
    updatedAt: v.number(),
  }).index("by_model", ["modelId"]),

  /** The latest download of the models.dev catalog (one row), already filtered to extraction models. */
  modelCatalog: defineTable({
    source: v.string(),
    /** When a download last succeeded. */
    syncedAt: v.optional(v.number()),
    /** When a download was last tried, successful or not. */
    attemptedAt: v.number(),
    error: v.optional(v.string()),
    models: v.array(
      v.object({
        id: v.string(),
        provider: v.union(v.literal("google"), v.literal("openai"), v.literal("anthropic")),
        model: v.string(),
        label: v.string(),
        input: v.number(),
        output: v.number(),
        files: v.union(v.literal("pdf"), v.literal("image"), v.literal("text")),
        releaseDate: v.optional(v.string()),
        deprecated: v.optional(v.boolean()),
      }),
    ),
  }),
});
