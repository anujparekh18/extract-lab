import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { ACCEPTED_MIME_TYPES, MAX_FILE_BYTES } from "./documents";

/**
 * POST /extract/<slug>   Starts an extraction with the extractor's published version.
 * GET  /runs/<id>        The run's status, and its result once finished.
 *
 * Send the document as a multipart form (`file`, `text`, `json`, or `url` field), as JSON
 * ({ "text" | "json" | "url": ... }), or as a raw PDF/image/text body. Options go in the form,
 * the JSON body, or the query string:
 *
 *   wait=<seconds>   Hold the request up to this long (max 60) and return the result if it's ready.
 *                    Otherwise, or without it, the response is 202 with the run id to poll.
 *   version=<n>      Run release n instead of the current one.
 *
 * An `Idempotency-Key` header makes retries safe: the same key returns the original run.
 * If EXTRACT_LAB_API_KEY is set in Convex env, send it as `Authorization: Bearer <key>`.
 */
const http = httpRouter();

const MAX_WAIT_SECONDS = 60;
const POLL_INTERVAL_MS = 500;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const URL_TIMEOUT_MS = 30_000;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Expose-Headers": "Location, Retry-After, Idempotent-Replayed",
};

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...cors, ...headers },
  });
}

/** Compares in time that doesn't depend on where the strings differ. */
function sameSecret(a: string, b: string) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function unauthorized(request: Request) {
  const required = process.env.EXTRACT_LAB_API_KEY;
  if (!required) return null;
  const sent = request.headers.get("Authorization") ?? "";
  return sameSecret(sent, `Bearer ${required}`) ? null : json(401, { error: "Missing or invalid API key." });
}

class BadRequest extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Input = { text?: string; isJson?: boolean; file?: { blob: Blob; mimeType: string } };
type Options = { wait?: string; version?: string };

function mimeOf(value: string | null) {
  return (value ?? "").split(";")[0].trim().toLowerCase().replace("image/jpg", "image/jpeg");
}

async function download(url: string): Promise<Input> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequest(400, `"${url}" isn't a valid URL.`);
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new BadRequest(400, "Only http and https URLs can be downloaded.");
  const response = await fetch(parsed, { signal: AbortSignal.timeout(URL_TIMEOUT_MS) }).catch(() => null);
  if (!response?.ok) throw new BadRequest(400, `Couldn't download ${url}${response ? ` (${response.status})` : ""}.`);
  if (Number(response.headers.get("Content-Length") ?? 0) > MAX_FILE_BYTES) throw new BadRequest(413, "The file is larger than 30 MB.");
  const mimeType = mimeOf(response.headers.get("Content-Type"));
  if (mimeType.startsWith("text/")) return { text: await response.text() };
  return { file: { blob: await response.blob(), mimeType } };
}

/** Reads the document and the options from whichever request format was used. */
async function readRequest(request: Request): Promise<{ input: Input; options: Options }> {
  const query = new URL(request.url).searchParams;
  const options: Options = { wait: query.get("wait") ?? undefined, version: query.get("version") ?? undefined };
  const contentType = mimeOf(request.headers.get("Content-Type"));

  if (contentType === "multipart/form-data") {
    const form = await request.formData().catch(() => null);
    if (!form) throw new BadRequest(400, "Couldn't read the form.");
    const field = (name: string) => {
      const value = form.get(name);
      return typeof value === "string" && value.trim() ? value : undefined;
    };
    options.wait = field("wait") ?? options.wait;
    options.version = field("version") ?? options.version;
    const file = form.get("file");
    if (file && typeof file !== "string") return { input: { file: { blob: file, mimeType: mimeOf(file.type) } }, options };
    if (field("json")) {
      try {
        return { input: { text: JSON.stringify(JSON.parse(field("json")!), null, 2), isJson: true }, options };
      } catch {
        throw new BadRequest(400, "The json field isn't valid JSON.");
      }
    }
    if (field("text")) return { input: { text: field("text") }, options };
    if (field("url")) return { input: await download(field("url")!), options };
    throw new BadRequest(400, "Send the document in a file, text, json, or url field.");
  }

  if (contentType === "application/json") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") throw new BadRequest(400, "The body isn't valid JSON.");
    if (body.wait !== undefined) options.wait = String(body.wait);
    if (body.version !== undefined) options.version = String(body.version);
    if (body.json !== undefined && typeof body.json === "object" && body.json !== null) {
      return { input: { text: JSON.stringify(body.json, null, 2), isJson: true }, options };
    }
    if (typeof body.text === "string" && body.text.trim()) return { input: { text: body.text }, options };
    if (typeof body.url === "string") return { input: await download(body.url), options };
    throw new BadRequest(400, 'Send { "text": "..." }, { "json": {...} }, or { "url": "..." }.');
  }

  if (contentType === "text/plain") return { input: { text: await request.text() }, options };
  return { input: { file: { blob: await request.blob(), mimeType: contentType } }, options };
}

function parseWait(value: string | undefined) {
  if (value === undefined) return 0;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds < 0) throw new BadRequest(400, "wait is a number of seconds, 0 to 60.");
  return Math.min(seconds, MAX_WAIT_SECONDS);
}

function parseVersion(value: string | undefined) {
  if (value === undefined) return undefined;
  const version = Number(value);
  if (!Number.isInteger(version) || version < 1) throw new BadRequest(400, "version is a release number: 1, 2, 3…");
  return version;
}

/** The run as the API shows it: finished runs with their result, others with where to poll. */
async function respond(ctx: ActionCtx, request: Request, runId: string, extraHeaders: Record<string, string> = {}, pendingStatus = 202) {
  const result = await ctx.runQuery(internal.endpoint.result, { runId });
  if (!result) return json(404, { error: "No run with that id." });
  if (result.finished) {
    // Convex returns keys sorted; put them in reading order.
    const { id, status, created_at } = result;
    if (result.status === "expired") return json(200, { id, status, error: result.error, created_at }, extraHeaders);
    const m = result.meta;
    const meta = {
      version: m.version,
      model: m.model,
      prompt_version: m.prompt_version,
      schema_version: m.schema_version,
      latency_ms: m.latency_ms,
      cost_usd: m.cost_usd,
    };
    const body =
      result.status === "failed"
        ? { id, status, error: result.error, validation_errors: result.validation_errors, created_at, meta }
        : { id, status, data: result.data, checks: result.checks, created_at, meta };
    return json(200, body, extraHeaders);
  }
  const pollUrl = `${new URL(request.url).origin}/runs/${result.id}`;
  return json(
    pendingStatus,
    { id: result.id, status: result.status, created_at: result.created_at, poll_url: pollUrl },
    { Location: pollUrl, "Retry-After": "2", ...extraHeaders },
  );
}

http.route({
  pathPrefix: "/extract/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: cors })),
});

http.route({
  pathPrefix: "/runs/",
  method: "OPTIONS",
  handler: httpAction(async () => new Response(null, { status: 204, headers: cors })),
});

http.route({
  pathPrefix: "/extract/",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const denied = unauthorized(request);
    if (denied) return denied;

    const slug = new URL(request.url).pathname.replace(/^\/extract\//, "").replace(/\/$/, "");
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() || undefined;
    if (idempotencyKey && idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      return json(400, { error: `Idempotency-Key is at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.` });
    }

    let input: Input;
    let wait: number;
    let version: number | undefined;
    try {
      const read = await readRequest(request);
      input = read.input;
      wait = parseWait(read.options.wait);
      version = parseVersion(read.options.version);
    } catch (error) {
      if (error instanceof BadRequest) return json(error.status, { error: error.message });
      throw error;
    }

    let storageId: Id<"_storage"> | undefined;
    if (input.file) {
      if (!ACCEPTED_MIME_TYPES.includes(input.file.mimeType)) {
        return json(415, { error: `Unsupported type "${input.file.mimeType || "unknown"}". Send PDF, JPEG, PNG, WebP, or text.` });
      }
      if (input.file.blob.size > MAX_FILE_BYTES) return json(413, { error: "The file is larger than 30 MB." });
      storageId = await ctx.storage.store(input.file.blob);
    } else if (!input.text?.trim()) {
      return json(400, { error: "The document is empty." });
    }

    const started = await ctx.runMutation(internal.endpoint.start, {
      slug,
      version,
      idempotencyKey,
      text: input.text,
      format: input.isJson ? "json" : undefined,
      storageId,
      mimeType: input.file?.mimeType,
      fileSize: input.file?.blob.size,
    });
    if (!started.ok || started.duplicate) {
      // The file isn't needed: the request failed, or a retry is getting the original run.
      if (storageId) await ctx.storage.delete(storageId);
    }
    if (!started.ok) return json(started.status, { error: started.error });

    const replayed: Record<string, string> = started.duplicate ? { "Idempotent-Replayed": "true" } : {};
    const deadline = Date.now() + wait * 1000;
    while (Date.now() + POLL_INTERVAL_MS < deadline) {
      const result = await ctx.runQuery(internal.endpoint.result, { runId: started.runId });
      if (result?.finished) break;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    return await respond(ctx, request, started.runId, replayed);
  }),
});

http.route({
  pathPrefix: "/runs/",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const denied = unauthorized(request);
    if (denied) return denied;
    const runId = new URL(request.url).pathname.replace(/^\/runs\//, "").replace(/\/$/, "");
    return await respond(ctx, request, runId, {}, 200);
  }),
});

export default http;
