import { useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ArrowLeft, ChevronRight, ExternalLink, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useExtractor } from "@/components/extractor-context";
import { AccuracyBar } from "@/components/accuracy-bar";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState, Spinner, Tooltip } from "@/components/ui/misc";
import { Select, useConfirm } from "@/components/ui/overlay";
import { FieldTable } from "@/components/field-table";
import { RunStatusBadge } from "@/components/run-status";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatMs, formatPer1k, formatPercent, formatRelative, formatUsd } from "@/lib/format";
import { modelLabel } from "@/lib/models";
import { diffChecks, previousCheck, type CheckDiff, type CheckDoc, type FieldChange } from "@/lib/check-diff";

export const Route = createFileRoute("/x/$slug/accuracy/$checkId")({
  // `vs` picks the check to compare with; by default it's the same model's previous check, and "none" turns it off.
  validateSearch: (search: Record<string, unknown>): { vs?: string } =>
    typeof search.vs === "string" ? { vs: search.vs } : {},
  component: CheckDetailPage,
});

const NO_COMPARISON = "none";

type EvalResult = NonNullable<FunctionReturnType<typeof api.evals.get>>;

function shapeAccuracy(result: EvalResult | null | undefined) {
  const map = new Map<string, { matched: number; total: number; important: boolean }>();
  if (!result) return map;
  for (const doc of result.docs) {
    for (const field of doc.fields) {
      const entry = map.get(field.shape) ?? { matched: 0, total: 0, important: field.important };
      entry.total++;
      if (field.status === "match" && doc.run?.status === "success") entry.matched++;
      map.set(field.shape, entry);
    }
  }
  return map;
}

function CheckDetailPage() {
  const extractor = useExtractor();
  const { checkId } = Route.useParams();
  const { vs } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const result = useQuery(api.evals.get, { id: checkId as Id<"evals"> });
  const others = useQuery(api.evals.list, { extractorId: extractor._id });
  const current = others?.find((e) => e._id === checkId);
  // Default comparison: this model's previous check of a different version (list is newest first).
  const previous = current && others ? previousCheck(current, others.filter((e) => e.createdAt < current.createdAt)) : null;
  const baselineId = vs === NO_COMPARISON ? undefined : (vs ?? previous?._id);
  const baseline = useQuery(api.evals.get, baselineId ? { id: baselineId as Id<"evals"> } : "skip");
  const removeEval = useMutation(api.evals.remove);
  const confirm = useConfirm();
  const [openDoc, setOpenDoc] = useState<string | null>(null);

  const shapes = useMemo(() => shapeAccuracy(result), [result]);
  const baseShapes = useMemo(() => shapeAccuracy(baseline), [baseline]);

  if (result === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (result === null) return <EmptyState className="h-full" title="This check doesn't exist" />;

  const s = result.summary;
  const running = s.running > 0;
  const shapeRows = Array.from(shapes.entries())
    .map(([shape, v]) => ({ shape, accuracy: v.total ? v.matched / v.total : 1, ...v, base: baseShapes.get(shape) }))
    // Lowest first; on a tie, important fields first.
    .sort((a, b) => a.accuracy - b.accuracy || Number(b.important) - Number(a.important));
  const hasImportant = s.importantTotalFields > 0;
  const baseDocs = new Map(baseline?.docs.map((d) => [d.documentId, d]) ?? []);
  const compareOptions = (others ?? []).filter((e) => e._id !== checkId);
  const changes =
    baseline && !running && baseline.summary.running === 0 ? diffChecks(toCheckDocs(result.docs), toCheckDocs(baseline.docs)) : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link to="/x/$slug/accuracy" params={{ slug: extractor.slug }} className="inline-flex items-center gap-1 text-xs text-muted hover:text-ink">
            <ArrowLeft className="size-3.5" /> All checks
          </Link>
          <div className="flex items-center gap-2">
            {compareOptions.length ? (
              <div className="w-72">
                <Select
                  size="sm"
                  ariaLabel="Compare with another check"
                  placeholder="Compare with…"
                  value={baselineId ?? NO_COMPARISON}
                  onValueChange={(value) => navigate({ search: { vs: value }, replace: true })}
                  options={[
                    { value: NO_COMPARISON, label: "No comparison" },
                    ...compareOptions.map((e) => ({
                      value: e._id as string,
                      label: `Compare with ${modelLabel(e.model)} · prompt v${e.promptVersion} · schema v${e.schemaVersion}`,
                    })),
                  ]}
                />
              </div>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              icon
              aria-label="Delete check"
              disabled={running}
              onClick={async () => {
                const ok = await confirm({
                  title: "Delete this check?",
                  body: "Its runs are deleted too. Documents and correct answers stay.",
                  confirmLabel: "Delete check",
                  danger: true,
                });
                if (!ok) return;
                try {
                  await removeEval({ id: result.eval._id });
                  await navigate({ to: "/x/$slug/accuracy", params: { slug: extractor.slug } });
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              <Trash2 />
            </Button>
          </div>
        </div>

        <header className="mt-4">
          <h2 className="text-lg font-medium tracking-[-0.015em]">
            {modelLabel(result.eval.model)}{" "}
            <span className="font-mono text-[13px] font-normal text-muted">
              prompt v{result.promptVersion} · schema v{result.schemaVersion}
            </span>
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {formatRelative(result.eval.createdAt)} · {s.total} {s.total === 1 ? "document" : "documents"}
            {result.eval.trigger === "auto" ? " · started by saving a new version" : ""}
          </p>
        </header>

        <Headline summary={s} model={modelLabel(result.eval.model)} />

        {changes && baseline ? (
          <ChangeReport
            changes={changes}
            against={`${modelLabel(baseline.eval.model)} · prompt v${baseline.promptVersion} · schema v${baseline.schemaVersion}`}
            slug={extractor.slug}
          />
        ) : null}

        <div
          className={cn(
            "mt-5 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2",
            hasImportant ? "lg:grid-cols-5" : "lg:grid-cols-4",
          )}
        >
          {hasImportant ? (
            <Metric
              label="Important fields"
              value={`${s.importantMatchedFields} / ${s.importantTotalFields}`}
              sub={`${s.importantPerfectDocs} of ${s.scoredDocs} documents all right`}
              delta={baseline ? diff(s.importantAccuracy, baseline.summary.importantAccuracy) : undefined}
              hint="Only the fields marked important in the schema. These must be right."
            />
          ) : null}
          <Metric
            label={hasImportant ? "All fields" : "Correct answers"}
            value={s.totalFields ? `${s.matchedFields} / ${s.totalFields}` : "—"}
            sub={s.fieldAccuracy !== null ? formatPercent(s.fieldAccuracy, 1) : undefined}
            delta={baseline ? diff(s.fieldAccuracy, baseline.summary.fieldAccuracy) : undefined}
            hint="Every field on every document, compared with its correct answer."
          />
          <Metric
            label="Documents all correct"
            value={s.scoredDocs ? `${s.perfectDocs} / ${s.scoredDocs}` : "—"}
            hint="Documents where every answer is correct."
          />
          <Metric label="Cost per document" value={formatUsd(s.avgCostUsd)} sub={formatPer1k(s.avgCostUsd)} />
          <Metric
            label="Usual time"
            value={formatMs(s.p50LatencyMs)}
            sub={s.failed ? `${s.failed} failed` : undefined}
            hint="Median time per document."
          />
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
          <section>
            <h3 className="text-[13px] font-medium">Most often wrong</h3>
            <p className="mt-0.5 text-xs text-muted">How often each field is right. Start with the lowest.</p>
            <div className="mt-3 overflow-hidden rounded-lg border border-line bg-panel">
              {shapeRows.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted">{running ? "Waiting for results…" : "No scored fields."}</p>
              ) : (
                shapeRows.map((row) => (
                  <div key={row.shape} className="flex items-center gap-3 border-b border-line/70 px-3 py-1.5 last:border-0">
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2" title={row.shape}>
                      {row.shape}
                    </span>
                    {row.important ? <Star className="size-3 shrink-0 fill-current text-ink-2" aria-label="Important" /> : null}
                    {row.base ? <Delta value={diff(row.accuracy, row.base.total ? row.base.matched / row.base.total : null)} /> : null}
                    <span
                      className={cn(
                        "tabular w-10 text-right text-xs font-medium",
                        row.accuracy === 1 ? "text-ok" : row.accuracy >= 0.8 ? "text-warn" : "text-bad",
                      )}
                    >
                      {formatPercent(row.accuracy)}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <h3 className="text-[13px] font-medium">Documents</h3>
            <p className="mt-0.5 text-xs text-muted">Open one to see each wrong answer next to the correct one.</p>
            <div className="mt-3 overflow-hidden rounded-lg border border-line bg-panel">
              {result.docs.map((doc) => {
                const open = openDoc === doc.documentId;
                const importantWrong = doc.run?.status === "success" ? doc.importantTotal - doc.importantMatched : 0;
                const base = baseDocs.get(doc.documentId);
                return (
                  <div key={doc.documentId} className="border-b border-line/70 last:border-0">
                    <button
                      type="button"
                      onClick={() => setOpenDoc(open ? null : doc.documentId)}
                      aria-expanded={open}
                      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-sunken/60"
                    >
                      <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{doc.title}</span>
                      {doc.run && doc.run.status !== "success" ? (
                        <RunStatusBadge status={doc.run.status} />
                      ) : doc.accuracy !== null ? (
                        <>
                          {importantWrong > 0 ? (
                            <span className="flex shrink-0 items-center gap-1 text-2xs font-medium text-bad">
                              <Star className="size-3 fill-current" />
                              {importantWrong} wrong
                            </span>
                          ) : null}
                          {base?.accuracy != null ? <Delta value={diff(doc.accuracy, base.accuracy)} /> : null}
                          <AccuracyBar
                            value={doc.accuracy}
                            matched={doc.matched}
                            total={doc.total}
                            className="[&>span:last-child]:w-16"
                          />
                        </>
                      ) : (
                        <Spinner className="text-muted" />
                      )}
                    </button>
                    {open ? (
                      <div className="border-t border-line bg-bg/40">
                        {doc.run?.status === "failed" ? (
                          <p className="px-4 py-3 text-xs text-bad">{doc.run.error}</p>
                        ) : (
                          <FieldTable
                            rows={doc.fields.map((f) => ({
                              path: f.path,
                              spec: f.spec,
                              actual: f.actual,
                              expected: f.expected,
                              status: f.status,
                              ruleIssues: f.ruleIssues,
                              important: f.important,
                            }))}
                            showExpected
                            issuesOnly
                            emptyHint="Every answer is correct."
                          />
                        )}
                        <div className="flex justify-end px-3 py-2">
                          <Link
                            to="/x/$slug"
                            params={{ slug: extractor.slug }}
                            search={{ doc: doc.documentId }}
                            className={buttonClass({ size: "sm", variant: "ghost" })}
                          >
                            Open in playground <ExternalLink />
                          </Link>
                        </div>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** One sentence a person can read without knowing what an eval is. */
function Headline({ summary: s, model }: { summary: EvalResult["summary"]; model: string }) {
  if (s.running > 0) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[15px] text-ink-2">
        <Spinner /> Checking… {s.finished} of {s.total} documents done.
      </p>
    );
  }
  if (!s.totalFields) {
    return <p className="mt-4 text-[15px] text-ink-2">Nothing could be scored{s.failed ? `: ${s.failed} extractions failed` : ""}.</p>;
  }
  const docs = `${s.scoredDocs} ${s.scoredDocs === 1 ? "document" : "documents"}`;
  return (
    <p className="mt-4 text-[15px] leading-[24px] text-ink-2">
      {s.importantTotalFields ? (
        <>
          {model} got{" "}
          <span className="tabular font-medium text-ink">
            {s.importantMatchedFields} of {s.importantTotalFields}
          </span>{" "}
          important answers right across {docs}
          {s.importantMatchedFields === s.importantTotalFields ? (
            <span className="text-ok">, every one of them</span>
          ) : null}
          , and {s.matchedFields} of {s.totalFields} answers overall.{" "}
        </>
      ) : (
        <>
          {model} got{" "}
          <span className="tabular font-medium text-ink">
            {s.matchedFields} of {s.totalFields}
          </span>{" "}
          answers right across {docs}.{" "}
        </>
      )}
      {s.perfectDocs === s.scoredDocs
        ? "Every document is fully correct."
        : `${s.perfectDocs} of ${s.scoredDocs} ${s.perfectDocs === 1 ? "is" : "are"} fully correct.`}
      {s.failed ? <span className="text-bad"> {s.failed} failed to extract.</span> : null}
      {s.docsFailingRules ? (
        <span>
          {" "}
          <span className="text-bad">
            {s.docsFailingRules} {s.docsFailingRules === 1 ? "document breaks" : "documents break"} a field rule.
          </span>
        </span>
      ) : null}
    </p>
  );
}

const CHANGE_LIST_LIMIT = 8;

function ChangeReport({ changes, against, slug }: { changes: CheckDiff; against: string; slug: string }) {
  const { fixed, broke } = changes;
  return (
    <div className="mt-4 rounded-lg border border-line bg-panel px-4 py-3">
      <p className="text-[13px] text-ink-2">
        {broke.length === 0 && fixed.length === 0 ? (
          <>Same answers right and wrong as before.</>
        ) : broke.length === 0 ? (
          <>
            <span className="font-medium text-ok">Better:</span> fixed {fixed.length} {fixed.length === 1 ? "answer" : "answers"}, broke
            nothing.
          </>
        ) : fixed.length === 0 ? (
          <>
            <span className="font-medium text-bad">Worse:</span> broke {broke.length} {broke.length === 1 ? "answer" : "answers"} that
            used to be right.
          </>
        ) : (
          <>
            <span className="font-medium text-warn">Mixed:</span> fixed {fixed.length}, broke {broke.length}.
          </>
        )}{" "}
        <span className="text-muted">Compared with {against}.</span>
      </p>
      {broke.length || fixed.length ? (
        <div className="mt-2 grid gap-4 text-xs sm:grid-cols-2">
          {broke.length ? <ChangeList title="Broke" tone="text-bad" items={broke} slug={slug} /> : null}
          {fixed.length ? <ChangeList title="Fixed" tone="text-ok" items={fixed} slug={slug} /> : null}
        </div>
      ) : null}
    </div>
  );
}

function ChangeList({ title, tone, items, slug }: { title: string; tone: string; items: FieldChange[]; slug: string }) {
  return (
    <div>
      <div className={cn("eyebrow", tone)}>{title}</div>
      <ul className="mt-1 space-y-0.5">
        {items.slice(0, CHANGE_LIST_LIMIT).map((item) => (
          <li key={`${item.documentId}:${item.path}`} className="flex min-w-0 gap-1.5">
            <Link
              to="/x/$slug"
              params={{ slug }}
              search={{ doc: item.documentId }}
              className="min-w-0 truncate text-ink-2 hover:text-ink hover:underline"
            >
              {item.title}
            </Link>
            <span className="text-faint">→</span>
            <span className="min-w-0 truncate font-mono text-[11.5px] text-ink-2">{item.path}</span>
          </li>
        ))}
        {items.length > CHANGE_LIST_LIMIT ? <li className="text-muted">and {items.length - CHANGE_LIST_LIMIT} more</li> : null}
      </ul>
    </div>
  );
}

function toCheckDocs(docs: EvalResult["docs"]): CheckDoc[] {
  return docs.map((d) => ({
    documentId: d.documentId,
    title: d.title,
    accuracy: d.accuracy,
    fields: d.fields.map((f) => ({ path: f.path, status: f.status })),
  }));
}

function diff(a: number | null | undefined, b: number | null | undefined) {
  if (a === null || a === undefined || b === null || b === undefined) return null;
  return a - b;
}

function Delta({ value }: { value: number | null }) {
  if (value === null || Math.abs(value) < 0.0005) return <span className="tabular w-12 text-right text-2xs text-faint">±0</span>;
  return (
    <span className={cn("tabular w-12 text-right text-2xs font-medium", value > 0 ? "text-ok" : "text-bad")}>
      {value > 0 ? "+" : ""}
      {(value * 100).toFixed(1)}
    </span>
  );
}

function Metric({
  label,
  value,
  sub,
  hint,
  delta,
}: {
  label: string;
  value: string;
  sub?: string;
  hint?: string;
  delta?: number | null;
}) {
  return (
    <div className="bg-panel px-4 py-3">
      <Tooltip content={hint}>
        <div className={cn("eyebrow text-muted", hint && "cursor-help")}>{label}</div>
      </Tooltip>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="tabular text-xl font-medium tracking-[-0.015em]">{value}</span>
        {delta !== undefined ? <Delta value={delta} /> : null}
      </div>
      {sub ? <div className="tabular mt-0.5 text-2xs text-muted">{sub}</div> : null}
    </div>
  );
}
