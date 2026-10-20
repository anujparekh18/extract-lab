import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { FlaskConical, Play, Search, Target } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useExtractor } from "@/components/extractor-context";
import { AccuracyBar } from "@/components/accuracy-bar";
import { Button, buttonClass } from "@/components/ui/button";
import { Label } from "@/components/ui/input";
import { Badge, EmptyState, Spinner, Tooltip } from "@/components/ui/misc";
import { Dialog, Select } from "@/components/ui/overlay";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatMs, formatPer1k, formatRelative, formatUsd } from "@/lib/format";
import { useModels, useSetup } from "@/lib/hooks";
import { modelLabel, pickerModels } from "@/lib/models";
import { FileSupportBadge, formatPrice } from "@/components/model-picker";

export const Route = createFileRoute("/x/$slug/accuracy/")({
  component: AccuracyPage,
});

function AccuracyPage() {
  const extractor = useExtractor();
  const evals = useQuery(api.evals.list, { extractorId: extractor._id });
  const testSet = useQuery(api.evals.testSet, { extractorId: extractor._id });
  const [creating, setCreating] = useState(false);

  const hasImportant = Boolean(evals?.some((e) => e.summary.importantTotalFields > 0));
  // Best: most important answers right, then most answers right overall.
  const score = (e: NonNullable<typeof evals>[number]) => [e.summary.importantAccuracy ?? -1, e.summary.fieldAccuracy ?? 0];
  const bestId = evals
    ?.filter((e) => e.summary.running === 0 && e.summary.fieldAccuracy !== null)
    .reduce<NonNullable<typeof evals>[number] | null>((best, e) => {
      if (!best) return e;
      const [a1, a2] = score(e);
      const [b1, b2] = score(best);
      return a1 > b1 || (a1 === b1 && a2 > b2) ? e : best;
    }, null)?._id;
  const bestScore = evals?.find((e) => e._id === bestId);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium tracking-[-0.015em]">Accuracy</h2>
            <p className="mt-1 max-w-2xl text-muted">
              Run every document that has a correct answer and see how often each setup gets it right. Compare prompts,
              schemas, and models to know whether a change helped, and which model is good enough for the price.
            </p>
          </div>
          {evals?.length ? (
            <Button variant="primary" onClick={() => setCreating(true)} disabled={!testSet?.withExpected}>
              <Play /> Check all documents
            </Button>
          ) : null}
        </header>

        {testSet && testSet.total > 0 ? <AnswerCoverage extractorSlug={extractor.slug} {...testSet} /> : null}

        <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel">
          {evals === undefined ? (
            <div className="flex h-40 items-center justify-center text-muted">
              <Spinner />
            </div>
          ) : evals.length === 0 ? (
            testSet?.withExpected ? (
              <EmptyState
                icon={<FlaskConical />}
                title="Check how often it's right"
                action={
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Play /> Check all documents
                  </Button>
                }
              >
                {testSet.withExpected} {testSet.withExpected === 1 ? "document has" : "documents have"} a correct answer. A
                check runs all of them and compares every field.
              </EmptyState>
            ) : (
              <EmptyState
                icon={<Target />}
                title="Save a few correct answers first"
                action={
                  <Link to="/x/$slug" params={{ slug: extractor.slug }} className={buttonClass({ variant: "primary" })}>
                    Open playground
                  </Link>
                }
              >
                Run a document in the playground, fix anything that's wrong, and save it as the correct answer. You check a
                few documents by hand so you can trust the model on the rest.
              </EmptyState>
            )
          ) : (
            <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-[12.5px]">
              <thead>
                <tr className="whitespace-nowrap border-b border-line text-left eyebrow text-faint">
                  <th className="px-4 py-2 font-normal">Setup</th>
                  {hasImportant ? (
                    <th className="px-4 py-2 font-normal">
                      <Tooltip content="Fields marked important in the schema. These must be right.">
                        <span className="cursor-help">Important fields</span>
                      </Tooltip>
                    </th>
                  ) : null}
                  <th className="px-4 py-2 font-normal">{hasImportant ? "All fields" : "Correct answers"}</th>
                  <th className="px-4 py-2 font-normal">Since last check</th>
                  <th className="px-4 py-2 text-right font-normal">
                    <Tooltip content="Documents where every answer is correct">
                      <span className="cursor-help">All correct</span>
                    </Tooltip>
                  </th>
                  <th className="px-4 py-2 text-right font-normal">Cost / doc</th>
                  <th className="px-4 py-2 text-right font-normal">
                    <Tooltip content="Median time per document">
                      <span className="cursor-help">Usual time</span>
                    </Tooltip>
                  </th>
                  <th className="px-4 py-2 text-right font-normal">When</th>
                </tr>
              </thead>
              <tbody>
                {evals.map((e) => {
                  const s = e.summary;
                  const running = s.running > 0;
                  // Ties count as best too, so equally good setups are all marked.
                  const isBest =
                    !running &&
                    bestScore !== undefined &&
                    s.importantAccuracy === bestScore.summary.importantAccuracy &&
                    s.fieldAccuracy === bestScore.summary.fieldAccuracy;
                  return (
                    <tr key={e._id} className="group border-b border-line/70 last:border-0 hover:bg-sunken/60">
                      <td className="px-4 py-2.5">
                        <Link
                          to="/x/$slug/accuracy/$checkId"
                          params={{ slug: extractor.slug, checkId: e._id }}
                          className="block"
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-ink group-hover:underline">{modelLabel(e.model)}</span>
                            {isBest ? <Badge tone="ok">Best</Badge> : null}
                          </div>
                          <div className="mt-0.5 font-mono text-2xs text-muted">
                            prompt v{e.promptVersion} · schema v{e.schemaVersion}
                            {e.trigger === "auto" ? " · after save" : ""}
                          </div>
                        </Link>
                      </td>
                      {hasImportant ? (
                        <td className="px-4 py-2.5">
                          {running ? null : s.importantTotalFields ? (
                            <AccuracyBar
                              value={s.importantAccuracy}
                              matched={s.importantMatchedFields}
                              total={s.importantTotalFields}
                            />
                          ) : (
                            <Tooltip content="This schema version has no important fields.">
                              <span className="cursor-help text-faint">—</span>
                            </Tooltip>
                          )}
                        </td>
                      ) : null}
                      <td className="px-4 py-2.5">
                        {running ? (
                          <div className="flex items-center gap-2 text-xs text-muted">
                            <Spinner />
                            {s.finished} of {s.total} documents done
                          </div>
                        ) : (
                          <AccuracyBar value={s.fieldAccuracy} matched={s.matchedFields} total={s.totalFields} />
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        <ChangeSummary change={e.change} />
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-ink-2">
                        {s.scoredDocs ? `${s.perfectDocs} of ${s.scoredDocs}` : "—"}
                        {s.failed ? <div className="text-2xs text-bad">{s.failed} failed</div> : null}
                      </td>
                      <td className="tabular px-4 py-2.5 text-right">
                        <Tooltip content={formatPer1k(s.avgCostUsd)}>
                          <span className="cursor-help text-ink-2">{formatUsd(s.avgCostUsd)}</span>
                        </Tooltip>
                      </td>
                      <td className="tabular px-4 py-2.5 text-right text-ink-2">{formatMs(s.p50LatencyMs)}</td>
                      <td className="px-4 py-2.5 text-right text-2xs text-faint">{formatRelative(e.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          )}
        </div>
      </div>
      <NewEvalDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}


/** How many documents have correct answers, and a nudge when there are too few to trust the score. */
function AnswerCoverage({ extractorSlug, total, withExpected }: { extractorSlug: string; total: number; withExpected: number }) {
  const few = withExpected > 0 && withExpected < 5;
  return (
    <p className="mt-4 text-xs text-muted">
      <span className="font-medium text-ink-2">{withExpected}</span> of {total} documents have a correct answer.
      {few ? " With so few, one mistake moves the score a lot. Aim for 10 or more that cover your different layouts." : ""}
      {total > withExpected || few ? (
        <>
          {" "}
          <Link to="/x/$slug" params={{ slug: extractorSlug }} className="link">
            {total > withExpected ? "Add more in the playground" : "Add documents in the playground"}
          </Link>
          .
        </>
      ) : null}
    </p>
  );
}

function ChangeSummary({ change }: { change: { fixed: number; broke: number; promptVersion: number; schemaVersion: number } | null }) {
  if (!change) return <span className="text-faint">—</span>;
  const since = `vs prompt v${change.promptVersion} · schema v${change.schemaVersion}`;
  if (!change.fixed && !change.broke) {
    return (
      <Tooltip content={since}>
        <span className="cursor-help text-muted">No change</span>
      </Tooltip>
    );
  }
  return (
    <Tooltip content={since}>
      <span className="tabular flex cursor-help flex-wrap gap-x-2">
        {change.fixed ? <span className="text-ok">{change.fixed} fixed</span> : null}
        {change.broke ? <span className="font-medium text-bad">{change.broke} broke</span> : null}
      </span>
    </Tooltip>
  );
}

function NewEvalDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const extractor = useExtractor();
  const navigate = useNavigate();
  const prompts = useQuery(api.versions.prompts, { extractorId: extractor._id });
  const schemas = useQuery(api.versions.schemas, { extractorId: extractor._id });
  const testSet = useQuery(api.evals.testSet, { extractorId: extractor._id });
  const create = useMutation(api.evals.create);
  const setup = useSetup();
  const catalog = useModels();
  const [modelQuery, setModelQuery] = useState("");
  const [showAllModels, setShowAllModels] = useState(false);

  const [promptId, setPromptId] = useState<string | undefined>();
  const [schemaId, setSchemaId] = useState<string | undefined>();
  const [models, setModels] = useState<string[]>([extractor.defaultModel]);
  const modelOptions = pickerModels(catalog, { query: modelQuery, showAll: showAllModels, keep: models }).filter(
    (m) => setup.providers?.[m.provider],
  );
  const [saving, setSaving] = useState(false);

  const effectivePrompt = promptId ?? prompts?.[0]?._id;
  const effectiveSchema = schemaId ?? schemas?.[0]?._id;
  const runCount = (testSet?.withExpected ?? 0) * models.length;

  async function submit() {
    if (!effectivePrompt || !effectiveSchema) return;
    setSaving(true);
    try {
      const ids = await create({
        extractorId: extractor._id,
        promptVersionId: effectivePrompt as Id<"promptVersions">,
        schemaVersionId: effectiveSchema as Id<"schemaVersions">,
        models,
      });
      onOpenChange(false);
      if (ids.length === 1) {
        await navigate({ to: "/x/$slug/accuracy/$checkId", params: { slug: extractor.slug, checkId: ids[0] } });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Check all documents"
      description={`Runs the ${testSet?.withExpected ?? 0} documents that have a correct answer and compares every field. Pick several models to compare them on the same prompt and schema.`}
      width="max-w-xl"
      footer={
        <>
          <span className="mr-auto self-center text-xs text-muted">
            {runCount} {runCount === 1 ? "extraction" : "extractions"}
          </span>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={models.length === 0 || !runCount} onClick={submit}>
            <Play /> Start check
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Prompt</Label>
            <Select
              value={effectivePrompt}
              onValueChange={setPromptId}
              options={(prompts ?? []).map((p, i) => ({
                value: p._id,
                label: `v${p.version}${i === 0 ? " (latest)" : ""} · ${formatRelative(p.createdAt)}`,
              }))}
            />
          </div>
          <div>
            <Label>Schema</Label>
            <Select
              value={effectiveSchema}
              onValueChange={setSchemaId}
              options={(schemas ?? []).map((s, i) => ({
                value: s._id,
                label: `v${s.version}${i === 0 ? " (latest)" : ""} · ${formatRelative(s.createdAt)}`,
              }))}
            />
          </div>
        </div>

        <div>
          <Label hint={models.length > 1 ? `${models.length} selected · each gets its own row` : "Each model gets its own row"}>
            Models
          </Label>
          <div className="rounded-lg border border-line">
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="size-3.5 shrink-0 text-faint" />
              <input
                value={modelQuery}
                onChange={(e) => setModelQuery(e.target.value)}
                placeholder="Search models"
                aria-label="Search models"
                className="h-8 min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint"
              />
            </div>
            <div className="grid max-h-64 gap-1 overflow-y-auto p-1 sm:grid-cols-2">
              {modelOptions.map((model) => {
                const checked = models.includes(model.id);
                return (
                  <label
                    key={model.id}
                    className={cn(
                      "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[12.5px] hover:bg-hover",
                      checked && "bg-accent-soft",
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setModels((prev) => (e.target.checked ? [...prev, model.id] : prev.filter((m) => m !== model.id)))
                      }
                      className="accent-[var(--c-accent)]"
                    />
                    <span className="min-w-0 flex-1 truncate">{model.label}</span>
                    {model.files !== "pdf" ? <FileSupportBadge files={model.files} /> : null}
                    <span className="tabular shrink-0 text-2xs text-faint">{formatPrice(model)}</span>
                  </label>
                );
              })}
              {modelOptions.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted sm:col-span-2">No models match.</p>
              ) : null}
            </div>
            {!modelQuery ? (
              <button
                type="button"
                onClick={() => setShowAllModels((v) => !v)}
                className="flex h-7 w-full items-center justify-center border-t border-line text-2xs text-muted hover:bg-hover hover:text-ink"
              >
                {showAllModels ? "Show current models only" : "Show older models too"}
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-2xs text-muted">
            Only providers with an API key are listed. Prices are per 1M input / output tokens.
          </p>
        </div>
      </div>
    </Dialog>
  );
}
