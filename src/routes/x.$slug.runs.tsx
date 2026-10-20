import { useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ChevronRight, ExternalLink, FlaskConical, History, Play, RotateCcw, Star, Trash2, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useExtractor } from "@/components/extractor-context";
import { FieldTable, buildRows } from "@/components/field-table";
import { JsonView } from "@/components/json-view";
import { RunStatusBadge } from "@/components/run-status";
import { Button, buttonClass } from "@/components/ui/button";
import { Segmented } from "@/components/ui/input";
import { EmptyState, Spinner, Tooltip } from "@/components/ui/misc";
import { Select, useConfirm } from "@/components/ui/overlay";
import { cn } from "@/lib/cn";
import { compareOutputs, formatLeafValue, type FieldStatus } from "@/lib/compare";
import { storeDraft } from "@/lib/draft";
import { errorMessage } from "@/lib/errors";
import type { Field } from "@/lib/fields";
import { formatDateTime, formatMs, formatRelative, formatTokens, formatUsd } from "@/lib/format";
import { modelLabel } from "@/lib/models";

type Search = { doc?: string; run?: string; model?: string; prompt?: string; source?: string };

export const Route = createFileRoute("/x/$slug/runs")({
  validateSearch: (search: Record<string, unknown>): Search => {
    const out: Search = {};
    for (const key of ["doc", "run", "model", "prompt", "source"] as const) {
      if (typeof search[key] === "string" && search[key]) out[key] = search[key] as string;
    }
    return out;
  },
  component: RunsPage,
});

type RunRow = FunctionReturnType<typeof api.runs.listByExtractor>["rows"][number];
type RunDetail = NonNullable<FunctionReturnType<typeof api.runs.get>>;

const ALL = "all";

const SOURCE_LABELS: Record<RunRow["source"], string> = {
  playground: "Playground",
  eval: "Accuracy check",
  api: "API",
  agent: "Agent (MCP)",
};

function RunsPage() {
  const extractor = useExtractor();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const data = useQuery(api.runs.listByExtractor, { extractorId: extractor._id });
  const documents = useQuery(api.documents.list, { extractorId: extractor._id });
  // Two runs ticked for comparison, oldest pick first.
  const [picked, setPicked] = useState<Id<"runs">[]>([]);

  const setSearch = (patch: Partial<Search>) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  const rows = data?.rows ?? [];
  // Runs are numbered per document, oldest first, the same way in every view.
  const numbers = useMemo(() => {
    const map = new Map<string, number>();
    const byDoc = new Map<string, RunRow[]>();
    for (const row of rows) byDoc.set(row.documentId, [...(byDoc.get(row.documentId) ?? []), row]);
    for (const list of byDoc.values()) {
      list.sort((a, b) => a.createdAt - b.createdAt).forEach((row, i) => map.set(row._id, i + 1));
    }
    return map;
  }, [rows]);
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) map.set(row.documentId, (map.get(row.documentId) ?? 0) + 1);
    return map;
  }, [rows]);

  const inDoc = search.doc ? rows.filter((r) => r.documentId === search.doc) : rows;
  const visible = inDoc.filter(
    (r) =>
      (!search.model || r.model === search.model) &&
      (!search.prompt || String(r.promptVersion) === search.prompt) &&
      (!search.source || r.source === search.source),
  );
  const models = unique(inDoc.map((r) => r.model));
  const prompts = unique(inDoc.map((r) => r.promptVersion)).sort((a, b) => b - a);
  const sources = unique(inDoc.map((r) => r.source));
  const filtered = Boolean(search.model || search.prompt || search.source);
  const selectedDoc = documents?.find((d) => d._id === search.doc);

  const togglePick = (id: Id<"runs">) =>
    setPicked((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id].slice(-2),
    );

  if (data === undefined || documents === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-line bg-panel md:flex">
        <div className="flex h-10 shrink-0 items-center border-b border-line px-3 eyebrow text-faint">Documents</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
          <DocButton active={!search.doc} label="All documents" count={rows.length} onClick={() => setSearch({ doc: undefined, run: undefined })} />
          {documents.map((d) => (
            <DocButton
              key={d._id}
              active={search.doc === d._id}
              label={d.title}
              count={counts.get(d._id) ?? 0}
              onClick={() => setSearch({ doc: d._id, run: undefined })}
            />
          ))}
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="px-6 py-6">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-medium tracking-[-0.015em]">{selectedDoc ? selectedDoc.title : "All runs"}</h2>
              <p className="mt-0.5 text-xs text-muted">
                Every extraction, with the model, prompt and fields it used and how it compares with the correct answer. Open a run
                to see its answers; tick two to compare them.
              </p>
            </div>
            <Link
              to="/x/$slug"
              params={{ slug: extractor.slug }}
              search={search.doc ? { doc: search.doc } : {}}
              className={buttonClass({ size: "sm" })}
            >
              <Play /> New run in playground
            </Link>
          </header>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <FilterSelect
              label="Model"
              value={search.model}
              options={models.map((m) => ({ value: m, label: modelLabel(m) }))}
              onChange={(model) => setSearch({ model })}
            />
            <FilterSelect
              label="Prompt"
              value={search.prompt}
              options={prompts.map((p) => ({ value: String(p), label: `Prompt v${p}` }))}
              onChange={(prompt) => setSearch({ prompt })}
            />
            <FilterSelect
              label="From"
              value={search.source}
              options={sources.map((s) => ({ value: s, label: SOURCE_LABELS[s] }))}
              onChange={(source) => setSearch({ source })}
            />
            {filtered ? (
              <Button variant="ghost" size="sm" onClick={() => setSearch({ model: undefined, prompt: undefined, source: undefined })}>
                <X /> Clear filters
              </Button>
            ) : null}
            <span className="tabular ml-auto text-xs text-muted">
              {visible.length} {visible.length === 1 ? "run" : "runs"}
              {data.limited ? " (latest 300)" : ""}
            </span>
          </div>

          {/* Always there, so ticking a run doesn't push the table down under the cursor. */}
          <ComparePanel
            ids={picked}
            numbers={numbers}
            rows={rows}
            onRemove={(id) => setPicked((current) => current.filter((x) => x !== id))}
            onClear={() => setPicked([])}
          />

          <div className="mt-4 overflow-hidden rounded-lg border border-line bg-panel">
            {visible.length === 0 ? (
              <EmptyState
                icon={<History />}
                title={rows.length === 0 ? "No runs yet" : filtered ? "No runs match these filters" : "No runs on this document yet"}
              >
                {rows.length === 0 || !filtered ? "Runs from the playground, accuracy checks and the API all show up here." : null}
              </EmptyState>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] text-[12.5px]">
                  <thead>
                    <tr className="whitespace-nowrap border-b border-line text-left eyebrow text-faint">
                      <th className="w-8 py-2 pl-3 font-normal">
                        <Tooltip content="Tick two runs to compare them">
                          <span className="cursor-help">Vs</span>
                        </Tooltip>
                      </th>
                      <th className="py-2 pl-1 pr-2 font-normal">Run</th>
                      {search.doc ? null : <th className="px-2 py-2 font-normal">Document</th>}
                      <th className="px-2 py-2 font-normal">Model</th>
                      <th className="px-2 py-2 font-normal">Prompt</th>
                      <th className="px-2 py-2 font-normal">Fields</th>
                      <th className="px-2 py-2 font-normal">
                        <Tooltip content="Compared with the document's current correct answer. ★ counts important fields only.">
                          <span className="cursor-help">Correct</span>
                        </Tooltip>
                      </th>
                      <th className="px-2 py-2 text-right font-normal">Cost</th>
                      <th className="px-2 py-2 text-right font-normal">Time</th>
                      <th className="px-2 py-2 font-normal">When</th>
                      <th className="px-2 py-2 font-normal">From</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => {
                      const open = search.run === row._id;
                      return (
                        <RunTableRow
                          key={row._id}
                          row={row}
                          number={numbers.get(row._id) ?? 0}
                          showDocument={!search.doc}
                          open={open}
                          picked={picked.includes(row._id)}
                          onToggle={() => setSearch({ run: open ? undefined : row._id })}
                          onPick={() => togglePick(row._id)}
                          slug={extractor.slug}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function DocButton({ active, label, count, onClick }: { active: boolean; label: string; count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-hover",
        active ? "bg-accent-soft font-medium text-ink" : "text-ink-2",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className={cn("tabular text-2xs", count ? "text-muted" : "text-faint")}>{count}</span>
    </button>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="w-48">
      <Select
        size="sm"
        ariaLabel={`Filter by ${label.toLowerCase()}`}
        value={value ?? ALL}
        onValueChange={(v) => onChange(v === ALL ? undefined : v)}
        options={[{ value: ALL, label: `${label}: all` }, ...options.map((o) => ({ value: o.value, label: `${label}: ${o.label}` }))]}
      />
    </div>
  );
}

function RunTableRow({
  row,
  number,
  showDocument,
  open,
  picked,
  onToggle,
  onPick,
  slug,
}: {
  row: RunRow;
  number: number;
  showDocument: boolean;
  open: boolean;
  picked: boolean;
  onToggle: () => void;
  onPick: () => void;
  slug: string;
}) {
  const columns = showDocument ? 12 : 11;
  return (
    <>
      <tr
        onClick={onToggle}
        className={cn(
          "cursor-pointer whitespace-nowrap border-b border-line/70 hover:bg-sunken/60",
          open && "bg-sunken/60",
          picked && "bg-accent-soft/50",
        )}
      >
        <td className="py-2 pl-3" onClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={picked}
            onChange={onPick}
            aria-label={`Compare run ${number}`}
            className="size-3.5 cursor-pointer accent-[var(--color-accent)]"
          />
        </td>
        <td className="tabular py-2 pl-1 pr-2 font-medium">#{number}</td>
        {showDocument ? <td className="max-w-[220px] truncate px-2 py-2 text-ink-2">{row.documentTitle}</td> : null}
        <td className="px-2 py-2">{modelLabel(row.model)}</td>
        <td className="tabular px-2 py-2 font-mono text-[11.5px] text-ink-2">v{row.promptVersion}</td>
        <td className="tabular px-2 py-2 font-mono text-[11.5px] text-ink-2">v{row.schemaVersion}</td>
        <td className="px-2 py-2">
          <ScoreCell row={row} />
        </td>
        <td className="tabular px-2 py-2 text-right text-ink-2">{row.status === "success" ? formatUsd(row.costUsd) : "—"}</td>
        <td className="tabular px-2 py-2 text-right text-ink-2">{formatMs(row.latencyMs)}</td>
        <td className="px-2 py-2 text-muted">
          <Tooltip content={formatDateTime(row.createdAt)}>
            <span>{formatRelative(row.createdAt)}</span>
          </Tooltip>
        </td>
        <td className="px-2 py-2 text-muted" onClick={(e) => e.stopPropagation()}>
          {row.source === "eval" && row.evalId ? (
            <Link to="/x/$slug/accuracy/$checkId" params={{ slug, checkId: row.evalId }} className="hover:text-ink hover:underline">
              Accuracy check
            </Link>
          ) : row.source === "api" && row.release ? (
            `API · v${row.release}`
          ) : (
            SOURCE_LABELS[row.source]
          )}
        </td>
        <td className="pr-3">
          <ChevronRight className={cn("size-3.5 text-faint transition-transform", open && "rotate-90")} />
        </td>
      </tr>
      {open ? (
        <tr className="border-b border-line">
          <td colSpan={columns} className="bg-bg/40 p-0">
            <RunDetailPanel runId={row._id} documentId={row.documentId} number={number} slug={slug} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ScoreCell({ row }: { row: RunRow }) {
  if (row.status !== "success") return <RunStatusBadge status={row.status} />;
  if (!row.score) {
    return (
      <Tooltip content="This document has no correct answer yet, so the run can't be scored.">
        <span className="cursor-help text-faint">No answer</span>
      </Tooltip>
    );
  }
  const { matched, total, importantMatched, importantTotal } = row.score;
  const tone = (a: number, b: number) => (a === b ? "text-ok" : "text-bad");
  return (
    <span className="tabular">
      {importantTotal > 0 ? (
        <span className={cn("font-medium", tone(importantMatched, importantTotal))}>
          <Star className="mr-0.5 inline size-3 -translate-y-px fill-current" aria-label="Important fields" />
          {importantMatched}/{importantTotal}
          <span className="font-normal text-faint"> · </span>
        </span>
      ) : null}
      <span className={cn(importantTotal > 0 ? "text-ink-2" : cn("font-medium", tone(matched, total)))}>
        {matched}/{total}
      </span>
    </span>
  );
}

type DetailTab = "answers" | "json" | "prompt" | "document";

function RunDetailPanel({ runId, documentId, number, slug }: { runId: Id<"runs">; documentId: Id<"documents">; number: number; slug: string }) {
  const extractor = useExtractor();
  const navigate = useNavigate();
  const run = useQuery(api.runs.get, { id: runId });
  const document = useQuery(api.documents.get, { id: documentId });
  const removeRun = useMutation(api.runs.remove);
  const addToTestSet = useMutation(api.documents.addToTestSet);
  const confirm = useConfirm();
  const [tab, setTab] = useState<DetailTab>("answers");

  if (run === undefined || document === undefined) {
    return (
      <div className="flex h-24 items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (run === null) return <p className="px-4 py-3 text-xs text-muted">This run was deleted.</p>;

  const active = run.status === "queued" || run.status === "running";
  const fields = run.schema?.fields ?? [];
  const expected = document?.expected;
  // Documents sent to the HTTP endpoint aren't in the playground's list until added to the test set.
  const fromApi = run.source === "api";
  const apiDocument = document?.origin === "api" ? document : null;
  const tabs: Array<{ value: DetailTab; label: string }> = [
    ...(run.status === "failed" ? [{ value: "answers" as const, label: "Error" }] : []),
    ...(run.status === "success"
      ? run.purgedAt
        ? [{ value: "answers" as const, label: "Answers" }]
        : [
            { value: "answers" as const, label: "Answers" },
            { value: "json" as const, label: "JSON" },
          ]
      : []),
    { value: "prompt", label: "Prompt" },
    ...(apiDocument ? [{ value: "document" as const, label: "Document" }] : []),
  ];
  const shownTab = tabs.some((t) => t.value === tab) ? tab : tabs[0].value;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line px-4 py-2 text-2xs text-muted">
        <span className="font-medium text-ink-2">Run #{number}</span>
        <span>{formatDateTime(run.createdAt)}</span>
        <span>
          {formatTokens(run.inputTokens)} in · {formatTokens(run.outputTokens)} out
        </span>
        {fromApi ? (
          <span className="text-ink-2">
            From an API call{run.release ? ` · version ${run.release}` : ""}
            {run.purgedAt ? ` · document and answers deleted ${formatRelative(run.purgedAt)} (retention)` : ""}
          </span>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {tabs.length > 1 ? <Segmented<DetailTab> size="sm" value={shownTab} onChange={setTab} options={tabs} /> : null}
          <Tooltip content="Open the playground with this run's prompt, fields and model, ready to run again or change.">
            <Button
              size="sm"
              variant="ghost"
              disabled={!run.prompt || !run.schema}
              onClick={() => {
                if (!run.prompt || !run.schema) return;
                storeDraft(extractor._id, { prompt: run.prompt.text, fields: run.schema.fields as Field[], model: run.model });
                toast.success(`Loaded prompt v${run.prompt.version}, schema v${run.schema.version} and ${modelLabel(run.model)}`);
                navigate({ to: "/x/$slug", params: { slug }, search: { doc: documentId } });
              }}
            >
              <RotateCcw /> Load in playground
            </Button>
          </Tooltip>
          {apiDocument ? (
            <Tooltip content="Move this document into the test set, give it a correct answer, and every later accuracy check includes it. It's then kept for good.">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  try {
                    await addToTestSet({ id: apiDocument._id });
                    toast.success("Added to the test set. Give it a correct answer so checks can score it.");
                    navigate({ to: "/x/$slug/answers", params: { slug }, search: { doc: apiDocument._id } });
                  } catch (error) {
                    toast.error(errorMessage(error));
                  }
                }}
              >
                <FlaskConical /> Add to test set
              </Button>
            </Tooltip>
          ) : document ? (
            <Link to="/x/$slug" params={{ slug }} search={{ doc: documentId }} className={buttonClass({ size: "sm", variant: "ghost" })}>
              Open document <ExternalLink />
            </Link>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            icon
            aria-label="Delete run"
            disabled={active}
            onClick={async () => {
              const ok = await confirm({
                title: `Delete run #${number}?`,
                body: "Its answers are deleted. The document and its correct answer stay.",
                confirmLabel: "Delete run",
                danger: true,
              });
              if (!ok) return;
              try {
                await removeRun({ id: run._id });
              } catch (error) {
                toast.error(errorMessage(error));
              }
            }}
          >
            <Trash2 />
          </Button>
        </div>
      </div>

      {active ? (
        <div className="flex items-center gap-2 px-4 py-4 text-xs text-muted">
          <Spinner /> {run.status === "queued" ? "Waiting to start…" : `Extracting with ${modelLabel(run.model)}…`}
        </div>
      ) : run.status === "failed" && shownTab === "answers" ? (
        <div className="m-4 rounded-lg border border-bad/30 bg-bad-soft px-4 py-3 text-[13px] text-bad">
          <div className="flex items-center gap-2 font-medium">
            <TriangleAlert className="size-4" /> {run.error ?? "Extraction failed."}
          </div>
          {run.validationErrors?.length ? (
            <ul className="mt-2 space-y-0.5 font-mono text-[11.5px] text-ink-2">
              {run.validationErrors.slice(0, 20).map((e, i) => (
                <li key={i}>{e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : shownTab === "document" && apiDocument ? (
        <ApiDocumentView document={apiDocument} />
      ) : shownTab === "prompt" ? (
        <div className="p-4">
          <div className="mb-1 eyebrow text-faint">
            Prompt v{run.prompt?.version} · schema v{run.schema?.version} ({fields.length} top-level fields)
          </div>
          <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel p-3 font-mono text-[12px] leading-[19px] text-ink-2">
            {run.prompt?.text}
          </pre>
        </div>
      ) : run.purgedAt ? (
        <p className="px-4 py-4 text-xs text-muted">
          The answers were deleted with the document, after the extractor's retention period. Change how long API documents are kept in Use in code.
        </p>
      ) : shownTab === "json" ? (
        <JsonView value={run.output} className="max-h-[560px] overflow-auto p-4" />
      ) : (
        <FieldTable
          rows={buildRows(fields, run.output, expected, document?.expectedNotSure)}
          showExpected={expected !== undefined}
          emptyHint="No fields."
        />
      )}
    </div>
  );
}

/** The document an API call sent, shown as-is: the file, or the text or JSON. */
function ApiDocumentView({ document }: { document: NonNullable<FunctionReturnType<typeof api.documents.get>> }) {
  if (document.kind === "text") {
    return (
      <pre className="m-4 max-h-[560px] overflow-auto whitespace-pre-wrap rounded-md border border-line bg-panel p-3 font-mono text-[12px] leading-[19px] text-ink-2">
        {document.text}
      </pre>
    );
  }
  if (!document.url) return <p className="px-4 py-4 text-xs text-muted">The file is no longer available.</p>;
  return (
    <div className="p-4">
      {document.mimeType === "application/pdf" ? (
        <iframe title={document.title} src={document.url} className="h-[560px] w-full rounded-md border border-line bg-panel" />
      ) : (
        <img src={document.url} alt={document.title} className="max-h-[560px] rounded-md border border-line" />
      )}
      <a href={document.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-xs link">
        Open the file <ExternalLink className="size-3" />
      </a>
    </div>
  );
}

/** Two runs side by side, field by field, with the correct answer when the document has one. */
function ComparePanel({
  ids,
  numbers,
  rows,
  onRemove,
  onClear,
}: {
  ids: Id<"runs">[];
  numbers: Map<string, number>;
  rows: RunRow[];
  onRemove: (id: Id<"runs">) => void;
  onClear: () => void;
}) {
  const [onlyDifferences, setOnlyDifferences] = useState(true);
  const items = ids.map((id) => rows.find((r) => r._id === id)).filter((r): r is RunRow => Boolean(r));
  // Oldest on the left, so the comparison reads "before → after".
  const [a, b] = [...items].sort((x, y) => x.createdAt - y.createdAt);
  const runA = useQuery(api.runs.get, a ? { id: a._id } : "skip");
  const runB = useQuery(api.runs.get, b ? { id: b._id } : "skip");
  const document = useQuery(api.documents.get, a ? { id: a.documentId } : "skip");

  const label = (row: RunRow) => `#${numbers.get(row._id)} ${modelLabel(row.model)} · prompt v${row.promptVersion}`;

  return (
    <section className={cn("mt-4 overflow-hidden rounded-lg border bg-panel", items.length ? "border-accent/40" : "border-line border-dashed")}>
      <div className={cn("flex min-h-10 flex-wrap items-center gap-2 px-4 py-2 text-xs", items.length === 2 && "border-b border-line")}>
        <span className="font-medium">Compare</span>
        {items.map((row) => (
          <span key={row._id} className="flex items-center gap-1 rounded-md bg-sunken px-2 py-0.5 text-ink-2">
            {label(row)}
            <button type="button" onClick={() => onRemove(row._id)} aria-label="Remove from comparison" className="text-faint hover:text-ink">
              <X className="size-3" />
            </button>
          </span>
        ))}
        {items.length === 0 ? (
          <span className="text-muted">Tick two runs of the same document to see their answers side by side.</span>
        ) : items.length < 2 ? (
          <span className="text-muted">Tick one more run to compare.</span>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {a && b ? (
            <Segmented<"diff" | "all">
              size="sm"
              value={onlyDifferences ? "diff" : "all"}
              onChange={(v) => setOnlyDifferences(v === "diff")}
              options={[
                { value: "diff", label: "Differences" },
                { value: "all", label: "All fields" },
              ]}
            />
          ) : null}
          {items.length ? (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear
            </Button>
          ) : null}
        </div>
      </div>
      {!a || !b ? null : a.documentId !== b.documentId ? (
        <p className="px-4 py-3 text-xs text-muted">
          These runs are on different documents ({a.documentTitle} and {b.documentTitle}). Pick two runs on the same document.
        </p>
      ) : runA === undefined || runB === undefined || document === undefined ? (
        <div className="flex h-20 items-center justify-center text-muted">
          <Spinner />
        </div>
      ) : !runA || !runB ? (
        <p className="px-4 py-3 text-xs text-muted">One of these runs was deleted.</p>
      ) : (
        <CompareTable
          a={runA}
          b={runB}
          labelA={label(a)}
          labelB={label(b)}
          expected={document?.expected}
          notSure={document?.expectedNotSure}
          onlyDifferences={onlyDifferences}
        />
      )}
    </section>
  );
}

function CompareTable({
  a,
  b,
  labelA,
  labelB,
  expected,
  notSure,
  onlyDifferences,
}: {
  a: RunDetail;
  b: RunDetail;
  labelA: string;
  labelB: string;
  expected: unknown;
  /** Fields whose correct value isn't known: shown, but not marked right or wrong. */
  notSure?: string[];
  onlyDifferences: boolean;
}) {
  // Compare with the newer run's fields, which is what you'd keep if it's better.
  const fields = (b.schema?.fields ?? a.schema?.fields ?? []) as Field[];
  const hasExpected = expected !== undefined;
  const pairs = compareOutputs(fields, a.output, b.output).fields;
  const statusesA = new Map(hasExpected ? compareOutputs(fields, expected, a.output, notSure).fields.map((f) => [f.path, f]) : []);
  const statusesB = new Map(hasExpected ? compareOutputs(fields, expected, b.output, notSure).fields.map((f) => [f.path, f]) : []);
  const differing = pairs.filter((p) => p.status !== "match");
  const shown = onlyDifferences ? differing : pairs;
  const score = (m: Map<string, { status: FieldStatus }>) => {
    const all = [...m.values()];
    return `${all.filter((f) => f.status === "match").length}/${all.length} correct`;
  };

  const columns = hasExpected
    ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]"
    : "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]";

  return (
    <div className="text-[12.5px]">
      <p className="px-4 py-2 text-xs text-ink-2">
        {differing.length === 0 ? "Both runs gave the same answers." : `${differing.length} ${differing.length === 1 ? "field differs" : "fields differ"}.`}
        {hasExpected ? (
          <span className="text-muted">
            {" "}
            {labelA}: {score(statusesA)}. {labelB}: {score(statusesB)}.
          </span>
        ) : null}
      </p>
      {shown.length === 0 ? null : (
        <>
          <div className={cn("grid gap-3 border-y border-line px-4 py-1.5 eyebrow text-faint", columns)}>
            <span>Field</span>
            <span className="truncate">{labelA}</span>
            <span className="truncate">{labelB}</span>
            {hasExpected ? <span>Correct answer</span> : null}
          </div>
          {shown.map((pair) => {
            const sa = statusesA.get(pair.path);
            const sb = statusesB.get(pair.path);
            const correct = sa?.expected ?? sb?.expected;
            return (
              <div
                key={pair.path}
                className={cn("grid gap-3 border-b border-line/70 px-4 py-1.5", columns, pair.status !== "match" && "bg-warn-soft/30")}
              >
                <span className="flex min-w-0 items-start gap-1 break-all font-mono text-[12px] text-ink-2">
                  {pair.path}
                  {pair.important ? <Star className="mt-0.5 size-3 shrink-0 fill-current" aria-label="Important" /> : null}
                </span>
                <CompareValue value={pair.expected} status={sa?.status} />
                <CompareValue value={pair.actual} status={sb?.status} />
                {hasExpected ? <span className="break-words text-ink-2">{formatLeafValue(correct)}</span> : null}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function CompareValue({ value, status }: { value: unknown; status: FieldStatus | undefined }) {
  return (
    <span
      className={cn(
        "break-words",
        status === undefined ? "text-ink" : status === "match" ? "text-ok" : "text-bad",
      )}
    >
      {formatLeafValue(value)}
    </span>
  );
}

function unique<T>(values: T[]) {
  return [...new Set(values)];
}
