// Smoke test: runs one extraction on the first sample document of an extractor.
// Usage: bun scripts/smoke.ts <slug> [model]
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const url = process.env.VITE_CONVEX_URL;
if (!url) throw new Error("VITE_CONVEX_URL missing (.env.local)");
const client = new ConvexHttpClient(url);
const [slug = "receipts", model] = process.argv.slice(2);

const extractor = await client.query(api.extractors.getBySlug, { slug });
if (!extractor?.latestPrompt || !extractor.latestSchema) throw new Error(`No extractor "${slug}"`);
const docs = await client.query(api.documents.list, { extractorId: extractor._id });
const doc = docs[0];
console.log("document:", doc.title);
const runId = await client.mutation(api.runs.start, {
  documentId: doc._id,
  prompt: extractor.latestPrompt.text,
  fields: extractor.latestSchema.fields,
  model: model ?? extractor.defaultModel,
});
for (let i = 0; i < 90; i++) {
  const run = await client.query(api.runs.get, { id: runId });
  if (run && (run.status === "success" || run.status === "failed")) {
    const { prompt, schema, ...rest } = run;
    console.log(JSON.stringify(rest, null, 2));
    const history = await client.query(api.runs.listByDocument, { documentId: doc._id });
    console.log("score:", JSON.stringify(history.find((r) => r._id === runId)?.score));
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log("timed out");
