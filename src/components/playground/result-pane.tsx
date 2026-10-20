import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Braces, History, MoreHorizontal, RotateCcw, Target, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { emptyValue, type Field } from "@/lib/fields";
import { errorMessage } from "@/lib/errors";
import { formatMs, formatRelative, formatTokens, formatUsd } from "@/lib/format";
import { modelLabel } from "@/lib/models";
import { setAtPath } from "@/lib/paths";
import { Button } from "../ui/button";
import { useExtractor } from "../extractor-context";
import { AnswerEditor, ExpectedJsonDialog } from "../answer-editor";
import { CollapseButton } from "./collapsible";
import { Segmented } from "../ui/input";
import { EmptyState, Spinner, Tooltip } from "../ui/misc";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  useConfirm,
} from "../ui/overlay";
import { FieldTable, buildRows, rowNeedsLook } from "../field-table";
import { JsonView } from "../json-view";
import { RunStatusDot, ScoreBadge } from "../run-status";

type RunListItem = FunctionReturnType<typeof api.runs.listByDocument>[number];
type RunDetail = NonNullable<FunctionReturnType<typeof api.runs.get>>;
type Tab = "fields" | "json";

type View = "run" | "answer";

export function ResultPane({
  documentId,
  focusRunId,
  onLoadRun,
  onCollapse,
}: {
  documentId: Id<"documents">;
  /** The run just started from the editor; selected automatically. */
  focusRunId: Id<"runs"> | null;
  onLoadRun: (run: RunDetail) => void;
  onCollapse?: () => void;
}) {
  const runs = useQuery(api.runs.listByDocument, { documentId });
  const document = useQuery(api.documents.get, { id: documentId });
  const [view, setView] = useState<View>("run");
  const [tab, setTab] = useState<Tab>("fields");
  const [issuesOnly, setIssuesOnly] = useState(false);

  // The run just started from the editor, otherwise the latest run. Older runs live in the Runs tab.
  const effectiveId = focusRunId && runs?.some((r) => r._id === focusRunId) ? focusRunId : (runs?.[0]?._id ?? null);
  const run = useQuery(api.runs.get, effectiveId ? { id: effectiveId } : "skip");
  // A new run is what you want to see, even if the correct answer was open.
  useEffect(() => {
    if (focusRunId) setView("run");
  }, [focusRunId]);
  const listItem = runs?.find((r) => r._id === effectiveId);

  if (runs === undefined || document === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (document === null) return null;
  const hasExpected = document.expected !== undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-2">
        <Segmented<View>
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { value: "run", label: "Latest run" },
            {
              value: "answer",
              label: (
                <span className="flex items-center gap-1">
                  Correct answer
                  {hasExpected ? <Target className="size-3 text-accent" aria-label="Saved" /> : null}
                </span>
              ),
              title: hasExpected ? "The saved correct answer for this document" : "This document has no correct answer yet",
            },
          ]}
        />
        <div className="ml-auto flex items-center gap-1">
          {runs.length ? <AllRunsLink documentId={documentId} count={runs.length} /> : null}
          {onCollapse ? <CollapseButton label="the results" vertical onClick={onCollapse} /> : null}
        </div>
      </div>

      {view === "answer" ? (
        <CorrectAnswerView
          document={document}
          latestRun={run && listItem ? { run, number: runs.length - runs.indexOf(listItem) } : null}
        />
      ) : runs.length === 0 || !effectiveId ? (
        <EmptyState className="min-h-0 flex-1" icon={<Braces />} title="No runs on this document yet">
          Press Run to extract it with the prompt and schema above. Results appear here field by field.
        </EmptyState>
      ) : (
        <>
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-line/70 px-3">
            {listItem ? <RunHeading run={listItem} number={runs.length - runs.indexOf(listItem)} /> : null}
            {listItem?.score ? <ScoreBadge matched={listItem.score.matched} total={listItem.score.total} /> : null}
            <div className="ml-auto flex items-center gap-1">
              {run?.status === "success" ? (
                <Segmented<Tab>
                  size="sm"
                  value={tab}
                  onChange={setTab}
                  options={[
                    { value: "fields", label: "Fields" },
                    { value: "json", label: "JSON" },
                  ]}
                />
              ) : null}
              {run ? <RunMenu run={run} document={document} onLoadRun={onLoadRun} /> : null}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {!run ? (
              <div className="flex h-full items-center justify-center text-muted">
                <Spinner />
              </div>
            ) : run.status === "queued" || run.status === "running" ? (
              <RunningState run={run} />
            ) : run.status === "failed" ? (
              <FailedState run={run} />
            ) : tab === "json" ? (
              <JsonView value={run.output} className="p-4" />
            ) : (
              <FieldsView
                run={run}
                document={document}
                issuesOnly={issuesOnly}
                setIssuesOnly={setIssuesOnly}
              />
            )}
          </div>

          {run && run.status !== "queued" && run.status !== "running" ? <RunFooter run={run} /> : null}
        </>
      )}
    </div>
  );
}

/** The document's correct answer on its own, as a form you can fill in or fix, next to the document. */
function CorrectAnswerView({
  document,
  latestRun,
}: {
  document: NonNullable<FunctionReturnType<typeof api.documents.get>>;
  latestRun: { run: RunDetail; number: number } | null;
}) {
  const extractor = useExtractor();
  const fields = (extractor.latestSchema?.fields as Field[] | undefined) ?? [];
  const draft =
    latestRun && latestRun.run.status === "success"
      ? { value: latestRun.run.output, label: `run #${latestRun.number} (${modelLabel(latestRun.run.model)})` }
      : undefined;
  return <AnswerEditor key={document._id} document={document} fields={fields} draft={draft} className="min-h-0 flex-1" />;
}

/** Which run is shown: its number, model and versions. */
function RunHeading({ run, number }: { run: RunListItem; number: number }) {
  return (
    <Tooltip content={`Run #${number} on this document, ${formatRelative(run.createdAt)}. Older runs are in the Runs tab.`}>
      <span className="flex min-w-0 cursor-default items-center gap-1.5 text-[12.5px]">
        <RunStatusDot status={run.status} />
        <span className="whitespace-nowrap font-medium">Run #{number}</span>
        <span className="truncate text-muted">
          {modelLabel(run.model)} · prompt v{run.promptVersion} · schema v{run.schemaVersion}
        </span>
      </span>
    </Tooltip>
  );
}

function AllRunsLink({ documentId, count }: { documentId: Id<"documents">; count: number }) {
  const { slug } = useParams({ from: "/x/$slug" });
  return (
    <Link
      to="/x/$slug/runs"
      params={{ slug }}
      search={{ doc: documentId }}
      className="flex h-7 items-center gap-1 whitespace-nowrap rounded-md px-2 text-xs text-muted hover:bg-hover hover:text-ink"
    >
      <History className="size-3.5" />
      All {count} {count === 1 ? "run" : "runs"}
    </Link>
  );
}

function RunningState({ run }: { run: RunDetail }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  const since = run.startedAt ?? run.createdAt;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <Spinner className="size-5 text-accent" />
      <div className="text-[13px] font-medium">
        {run.status === "queued" ? "Queued" : `Extracting with ${modelLabel(run.model)}`}
      </div>
      <div className="tabular text-xs text-muted">{((now - since) / 1000).toFixed(1)} s</div>
    </div>
  );
}

function FailedState({ run }: { run: RunDetail }) {
  return (
    <div className="space-y-4 p-4">
      <div className="rounded-lg border border-bad/30 bg-bad-soft px-4 py-3">
        <div className="flex items-center gap-2 text-[13px] font-medium text-bad">
          <TriangleAlert className="size-4" /> {run.error ?? "Extraction failed."}
        </div>
        {run.validationErrors?.length ? (
          <ul className="mt-2 space-y-0.5 font-mono text-[11.5px] text-ink-2">
            {run.validationErrors.slice(0, 20).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        ) : null}
        {run.error?.includes("isn't set up") ? (
          <Link to="/setup" className="mt-2 inline-block text-xs font-medium link">
            Open setup
          </Link>
        ) : null}
      </div>
      {run.output !== undefined ? (
        <div>
          <div className="mb-1 eyebrow text-faint">What the model returned</div>
          <JsonView value={run.output} />
        </div>
      ) : null}
    </div>
  );
}

function FieldsView({
  run,
  document,
  issuesOnly,
  setIssuesOnly,
}: {
  run: RunDetail;
  document: NonNullable<FunctionReturnType<typeof api.documents.get>>;
  issuesOnly: boolean;
  setIssuesOnly: (value: boolean) => void;
}) {
  const setExpected = useMutation(api.documents.setExpected);
  const fields = run.schema?.fields ?? [];
  const hasExpected = document.expected !== undefined;
  const rows = useMemo(
    () => buildRows(fields, run.output, document.expected, document.expectedNotSure),
    [fields, run.output, document.expected, document.expectedNotSure],
  );
  const issues = rows.filter(rowNeedsLook).length;

  async function saveExpected(value: unknown) {
    try {
      await setExpected({ id: document._id, expected: value });
      return true;
    } catch (error) {
      toast.error(errorMessage(error));
      return false;
    }
  }

  return (
    <div>
      {!hasExpected ? (
        <div className="flex items-center justify-between gap-3 border-b border-line bg-accent-soft/50 px-4 py-2">
          <p className="text-xs text-ink-2">
            <span className="font-medium text-ink">Is this right?</span> Save it as the correct answer, so every later change
            can be checked against it. If a value is wrong, hover it and click the pencil to fix it.
          </p>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              if (await saveExpected(run.output ?? emptyValue(fields))) {
                toast.success("Saved as the correct answer. This document now counts toward accuracy.");
              }
            }}
          >
            <Target /> Save as correct
          </Button>
        </div>
      ) : null}
      {hasExpected && issues > 0 ? (
        <div className="flex items-center justify-between px-4 pt-2">
          <span className="text-xs text-muted">
            {issues} {issues === 1 ? "field needs" : "fields need"} a look
          </span>
          <Segmented<"all" | "issues">
            size="sm"
            value={issuesOnly ? "issues" : "all"}
            onChange={(v) => setIssuesOnly(v === "issues")}
            options={[
              { value: "all", label: "All" },
              { value: "issues", label: "Needs a look" },
            ]}
          />
        </div>
      ) : null}
      <FieldTable
        rows={rows}
        showExpected={hasExpected}
        issuesOnly={issuesOnly}
        emptyHint="Every answer is correct."
        onEditExpected={
          hasExpected
            ? (path, value) => saveExpected(setAtPath(document.expected, path, value))
            : undefined
        }
        onFixOutput={
          hasExpected
            ? undefined
            : async (path, value) => {
                if (await saveExpected(setAtPath(run.output ?? emptyValue(fields), path, value))) {
                  toast.success("Saved the correct answer with your fix. Fix any other wrong values the same way.");
                }
              }
        }
      />
    </div>
  );
}

function RunFooter({ run }: { run: RunDetail }) {
  return (
    <div className="tabular flex h-8 shrink-0 items-center gap-4 border-t border-line px-4 text-2xs text-muted">
      <span className="truncate text-ink-2">{modelLabel(run.model)}</span>
      <span>prompt v{run.prompt?.version}</span>
      <span>schema v{run.schema?.version}</span>
      <span className="ml-auto">{formatMs(run.latencyMs)}</span>
      <Tooltip content={`${formatTokens(run.inputTokens)} in · ${formatTokens(run.outputTokens)} out`}>
        <span className="cursor-help">{formatTokens((run.inputTokens ?? 0) + (run.outputTokens ?? 0))} tok</span>
      </Tooltip>
      <Tooltip content="Estimated from token usage">
        <span className="cursor-help">{formatUsd(run.costUsd)}</span>
      </Tooltip>
    </div>
  );
}

function RunMenu({
  run,
  document,
  onLoadRun,
}: {
  run: RunDetail;
  document: NonNullable<FunctionReturnType<typeof api.documents.get>>;
  onLoadRun: (run: RunDetail) => void;
}) {
  const setExpected = useMutation(api.documents.setExpected);
  const removeRun = useMutation(api.runs.remove);
  const confirm = useConfirm();
  const [editing, setEditing] = useState(false);
  const active = run.status === "queued" || run.status === "running";

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" icon aria-label="Run actions">
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem icon={<RotateCcw />} onSelect={() => onLoadRun(run)}>
            Load this run's prompt, schema, and model
          </MenuItem>
          <MenuSeparator />
          {run.status === "success" && document.expected !== undefined ? (
            <MenuItem
              icon={<Target />}
              onSelect={async () => {
                const ok = await confirm({
                  title: "Replace the correct answer?",
                  body: "Every field of the correct answer is overwritten with this run's answer.",
                  confirmLabel: "Replace",
                });
                if (ok) await setExpected({ id: document._id, expected: run.output });
              }}
            >
              Use this answer as the correct one
            </MenuItem>
          ) : null}
          <MenuItem icon={<Braces />} onSelect={() => setEditing(true)}>
            Edit correct answer as JSON…
          </MenuItem>
          {document.expected !== undefined ? (
            <MenuItem
              onSelect={async () => {
                const ok = await confirm({
                  title: "Remove the correct answer?",
                  body: "This document stops counting toward accuracy. Checks that already ran keep their scores.",
                  confirmLabel: "Remove",
                  danger: true,
                });
                if (ok) await setExpected({ id: document._id, expected: null });
              }}
            >
              Remove correct answer
            </MenuItem>
          ) : null}
          <MenuSeparator />
          <MenuItem
            danger
            icon={<Trash2 />}
            disabled={active}
            onSelect={async () => {
              try {
                await removeRun({ id: run._id });
              } catch (error) {
                toast.error(errorMessage(error));
              }
            }}
          >
            Delete run
          </MenuItem>
        </MenuContent>
      </Menu>
      <ExpectedJsonDialog
        open={editing}
        onOpenChange={setEditing}
        initial={document.expected ?? run.output ?? emptyValue(run.schema?.fields ?? [])}
        onSave={async (value) => {
          await setExpected({ id: document._id, expected: value });
          setEditing(false);
        }}
      />
    </>
  );
}
