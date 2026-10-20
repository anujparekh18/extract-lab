import { useMemo, useState } from "react";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowUpRight, Rocket } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useExtractor } from "@/components/extractor-context";
import { Button } from "@/components/ui/button";
import { Label, Segmented } from "@/components/ui/input";
import { Badge, Spinner } from "@/components/ui/misc";
import { Select } from "@/components/ui/overlay";
import { CodeBlock } from "@/components/code-block";
import { ModelPicker } from "@/components/model-picker";
import { RunStatusDot } from "@/components/run-status";
import { AccuracyBar } from "@/components/accuracy-bar";
import { curlSnippets, jsonSchemaSnippet, pythonSnippet, typescriptSnippet } from "@/lib/codegen";
import { errorMessage } from "@/lib/errors";
import { formatDateTime, formatMs, formatRelative, formatUsd } from "@/lib/format";
import { useSetup } from "@/lib/hooks";
import { modelLabel } from "@/lib/models";
import { API_RETENTION_LABELS, DEFAULT_API_RETENTION, type ApiRetention } from "@/lib/retention";

export const Route = createFileRoute("/x/$slug/ship")({
  component: ShipPage,
});

type Lang = "typescript" | "python" | "curl" | "jsonschema";

function ShipPage() {
  const extractor = useExtractor();
  const prompts = useQuery(api.versions.prompts, { extractorId: extractor._id });
  const schemas = useQuery(api.versions.schemas, { extractorId: extractor._id });
  const evals = useQuery(api.evals.list, { extractorId: extractor._id });
  const apiRuns = useQuery(api.api.recentApiRuns, { extractorId: extractor._id });
  const publish = useMutation(api.endpoint.publish);
  const releases = useQuery(api.endpoint.releases, { extractorId: extractor._id });
  const setRetention = useMutation(api.endpoint.setRetention);
  const setup = useSetup();

  const published = extractor.published;
  const [promptId, setPromptId] = useState<string | undefined>(published?.promptVersionId);
  const [schemaId, setSchemaId] = useState<string | undefined>(published?.schemaVersionId);
  const [model, setModel] = useState(published?.model ?? extractor.defaultModel);
  const [lang, setLang] = useState<Lang>("typescript");
  const [publishing, setPublishing] = useState(false);

  const prompt = prompts?.find((p) => p._id === (promptId ?? prompts[0]?._id));
  const schema = schemas?.find((s) => s._id === (schemaId ?? schemas[0]?._id));
  const matchingEval = evals?.find(
    (e) => e.promptVersionId === prompt?._id && e.schemaVersionId === schema?._id && e.model === model && e.summary.running === 0,
  );
  const isPublishedSelection =
    published &&
    published.promptVersionId === prompt?._id &&
    published.schemaVersionId === schema?._id &&
    published.model === model;

  // Cloud deployments serve HTTP routes on .convex.site, next to the .convex.cloud API URL.
  const siteUrl =
    (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
    (import.meta.env.VITE_CONVEX_URL as string | undefined)?.replace(/\.convex\.cloud\/?$/, ".convex.site") ??
    "https://<deployment>.convex.site";
  const endpoint = `${siteUrl}/extract/${extractor.slug}`;

  const code = useMemo(() => {
    if (!prompt || !schema) return "";
    if (lang === "typescript") return typescriptSnippet({ name: extractor.name, prompt: prompt.text, fields: schema.fields, model });
    const version = published?.release;
    if (lang === "python") {
      return pythonSnippet({ name: extractor.name, fields: schema.fields, endpoint, apiKeyRequired: setup.apiKeyRequired, version });
    }
    if (lang === "jsonschema") return jsonSchemaSnippet(schema.fields);
    const c = curlSnippets(endpoint, setup.apiKeyRequired, version);
    return [
      "# Send a PDF or image. The response waits up to 30 seconds (max 60) for the result:",
      '#   200 { "id", "status": "succeeded", "data", "checks", "meta" }   finished in time',
      '#   202 { "id", "status": "queued" | "running", "poll_url" }        still working: poll it',
      "# The same Idempotency-Key returns the same run, so retries never pay twice.",
      version ? `# version=${version} pins this release; leave it out to always get the live one.` : null,
      c.file,
      "",
      "# Poll a run that wasn't ready (GET its poll_url) until status is succeeded or failed",
      c.poll,
      "",
      "# Text",
      c.text,
      "",
      "# JSON your app already has",
      c.json,
      "",
      "# A file by URL",
      c.url,
    ]
      .filter((line) => line !== null)
      .join("\n");
  }, [lang, prompt, schema, model, extractor.name, endpoint, setup.apiKeyRequired, published?.release]);

  if (!prompts || !schemas) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-8">
        <header>
          <h2 className="text-lg font-medium tracking-[-0.015em]">Use in code</h2>
          <p className="mt-1 max-w-2xl text-muted">
            Pin the version you tested, then call it from your app: copy the typed code, or send documents to this
            extractor's HTTP endpoint.
          </p>
        </header>

        <section className="mt-6 rounded-lg border border-line bg-panel">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div>
              <h3 className="text-[13px] font-medium">Version to ship</h3>
              <p className="text-xs text-muted">
                {published
                  ? `The endpoint serves ${published.release ? `version ${published.release}` : "the published version"}: ${modelLabel(published.model)}, published ${formatRelative(published.publishedAt)}.`
                  : "Nothing published yet. The endpoint returns 409 until you publish."}
              </p>
            </div>
            {published ? <Badge tone="ok">Live</Badge> : <Badge>Not published</Badge>}
          </div>
          <div className="grid gap-4 px-4 py-4 md:grid-cols-[1fr_1fr_1.3fr]">
            <div>
              <Label>Prompt</Label>
              <Select
                value={prompt?._id}
                onValueChange={setPromptId}
                options={prompts.map((p, i) => ({ value: p._id, label: `v${p.version}${i === 0 ? " (latest)" : ""}` }))}
              />
            </div>
            <div>
              <Label>Schema</Label>
              <Select
                value={schema?._id}
                onValueChange={setSchemaId}
                options={schemas.map((s, i) => ({ value: s._id, label: `v${s.version}${i === 0 ? " (latest)" : ""}` }))}
              />
            </div>
            <div>
              <Label>Model</Label>
              <ModelPicker value={model} onChange={setModel} className="w-full" />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <div className="text-xs text-muted">
              {matchingEval ? (
                <span className="flex items-center gap-3">
                  Checked on this exact version:
                  <Link
                    to="/x/$slug/accuracy/$checkId"
                    params={{ slug: extractor.slug, checkId: matchingEval._id }}
                    className="hover:opacity-80"
                  >
                    <AccuracyBar value={matchingEval.summary.fieldAccuracy} />
                  </Link>
                </span>
              ) : (
                <>
                  This exact version hasn't been checked yet.{" "}
                  <Link to="/x/$slug/accuracy" params={{ slug: extractor.slug }} className="link">
                    Check it first
                  </Link>{" "}
                  to know how often it's right.
                </>
              )}
            </div>
            <Button
              variant="primary"
              loading={publishing}
              disabled={!prompt || !schema || Boolean(isPublishedSelection)}
              onClick={async () => {
                if (!prompt || !schema) return;
                setPublishing(true);
                try {
                  const release = await publish({
                    id: extractor._id,
                    promptVersionId: prompt._id,
                    schemaVersionId: schema._id as Id<"schemaVersions">,
                    model,
                  });
                  toast.success(`Published as version ${release}: prompt v${prompt.version}, schema v${schema.version}, ${modelLabel(model)}`);
                } catch (error) {
                  toast.error(errorMessage(error));
                } finally {
                  setPublishing(false);
                }
              }}
            >
              <Rocket /> {isPublishedSelection ? "Published" : published ? "Publish this version" : "Publish"}
            </Button>
          </div>
          {releases && releases.length > 0 ? (
            <div className="border-t border-line px-4 py-3">
              <div className="text-xs text-muted">
                Every publish gets a version number. Callers get the live one unless they pin another with{" "}
                <code className="font-mono text-ink-2">version</code>.
              </div>
              <ul className="mt-2 flex flex-col gap-1 text-xs">
                {releases.map((r) => (
                  <li key={r.number} className="tabular flex items-center gap-3">
                    <span className="w-16 font-medium text-ink-2">Version {r.number}</span>
                    <span className="font-mono text-2xs text-muted">
                      prompt v{r.promptVersion} · schema v{r.schemaVersion}
                    </span>
                    <span className="text-muted">{modelLabel(r.model)}</span>
                    <span className="text-faint">{formatRelative(r.createdAt)}</span>
                    {published?.release === r.number ? <Badge tone="ok">Live</Badge> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-medium">Code</h3>
              <p className="text-xs text-muted">
                {lang === "typescript"
                  ? "Calls the model directly with the exact prompt and schema you tested. No dependency on Extract Lab."
                  : lang === "python"
                    ? "Pydantic types for the output, calling the HTTP endpoint below and polling until the result is ready."
                    : lang === "curl"
                      ? "Start an extraction, wait up to 60 seconds for it, and poll if it takes longer."
                      : "For providers or tools that take JSON Schema directly."}
              </p>
            </div>
            <Segmented<Lang>
              value={lang}
              onChange={setLang}
              options={[
                { value: "typescript", label: "TypeScript" },
                { value: "python", label: "Python" },
                { value: "curl", label: "HTTP" },
                { value: "jsonschema", label: "JSON Schema" },
              ]}
            />
          </div>
          {lang === "curl" || lang === "python" ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel px-3 py-2 text-xs">
              <Badge tone="accent">POST</Badge>
              <code className="min-w-0 flex-1 truncate font-mono text-ink">{endpoint}</code>
              {setup.apiKeyRequired ? (
                <span className="text-muted">Requires EXTRACT_LAB_API_KEY</span>
              ) : (
                <span className="text-warn">Open to anyone with the URL. Set EXTRACT_LAB_API_KEY before sharing it.</span>
              )}
            </div>
          ) : null}
          <CodeBlock code={code} className="mt-3" maxHeight={560} />
        </section>

        <section className="mt-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-[13px] font-medium">Recent API calls</h3>
              <p className="text-xs text-muted">
                Documents sent to the endpoint and their answers are stored in your Convex deployment, then deleted after
                this long. Add one to the test set to keep it.
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-muted">
              Keep API documents
              <Select<ApiRetention>
                size="sm"
                value={extractor.apiRetention ?? DEFAULT_API_RETENTION}
                onValueChange={async (retention) => {
                  try {
                    await setRetention({ id: extractor._id, retention });
                    toast.success(`API documents: ${API_RETENTION_LABELS[retention].toLowerCase()}`);
                  } catch (error) {
                    toast.error(errorMessage(error));
                  }
                }}
                options={(Object.keys(API_RETENTION_LABELS) as ApiRetention[]).map((value) => ({ value, label: API_RETENTION_LABELS[value] }))}
              />
            </label>
          </div>
          <div className="mt-3 overflow-hidden rounded-lg border border-line bg-panel">
            {apiRuns === undefined ? (
              <div className="flex h-20 items-center justify-center text-muted">
                <Spinner />
              </div>
            ) : apiRuns.length === 0 ? (
              <p className="px-4 py-6 text-center text-xs text-muted">
                Calls to the endpoint show up here with their output, latency, and cost.
              </p>
            ) : (
              apiRuns.map((run) => (
                <details key={run._id} className="group border-b border-line/70 last:border-0">
                  <summary className="tabular flex cursor-pointer list-none items-center gap-3 px-4 py-2 text-xs hover:bg-sunken/60">
                    <RunStatusDot status={run.status} />
                    <span className="text-ink-2">{formatDateTime(run.createdAt)}</span>
                    {run.release ? <span className="font-mono text-2xs text-muted">v{run.release}</span> : null}
                    <span className="text-muted">{modelLabel(run.model)}</span>
                    {run.status === "failed" ? <Badge tone="bad">Failed</Badge> : null}
                    {run.failedChecks > 0 ? (
                      <Badge tone="warn">
                        {run.failedChecks} {run.failedChecks === 1 ? "check" : "checks"} failed
                      </Badge>
                    ) : null}
                    {run.purged ? <Badge>Deleted</Badge> : null}
                    {run.error ? <span className="truncate text-bad">{run.error}</span> : null}
                    <span className="ml-auto text-muted">{formatMs(run.latencyMs)}</span>
                    <span className="w-16 text-right text-muted">{formatUsd(run.costUsd)}</span>
                  </summary>
                  <div className="border-t border-line bg-sunken">
                    {run.purged ? (
                      <p className="px-4 py-3 text-xs text-muted">The document and its answers were deleted after the retention period.</p>
                    ) : (
                      <pre className="max-h-72 overflow-auto px-4 py-3 font-mono text-[11.5px] text-ink-2">
                        {JSON.stringify(run.output ?? null, null, 2)}
                      </pre>
                    )}
                    <div className="flex justify-end border-t border-line/70 px-3 py-1.5">
                      <Link
                        to="/x/$slug/runs"
                        params={{ slug: extractor.slug }}
                        search={{ source: "api", run: run._id }}
                        className="inline-flex items-center gap-1 text-xs link"
                      >
                        Open in Runs <ArrowUpRight className="size-3" />
                      </Link>
                    </div>
                  </div>
                </details>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
