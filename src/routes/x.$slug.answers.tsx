import { useCallback, useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { ChevronLeft, ChevronRight, Inbox, Play, Target } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useExtractor } from "@/components/extractor-context";
import { AnswerEditor } from "@/components/answer-editor";
import { DocumentViewer } from "@/components/playground/document-viewer";
import { ModelPicker } from "@/components/model-picker";
import { RunStatusDot } from "@/components/run-status";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/input";
import { EmptyState, Spinner, Tooltip } from "@/components/ui/misc";
import { useConfirm } from "@/components/ui/overlay";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import type { Field } from "@/lib/fields";
import { useMediaQuery, useSetup } from "@/lib/hooks";
import { modelLabel } from "@/lib/models";

type Filter = "all" | "missing" | "saved";

export const Route = createFileRoute("/x/$slug/answers")({
  validateSearch: (search: Record<string, unknown>): { doc?: string; show?: Filter } => {
    const out: { doc?: string; show?: Filter } = {};
    if (typeof search.doc === "string") out.doc = search.doc;
    if (search.show === "missing" || search.show === "saved") out.show = search.show;
    return out;
  },
  component: AnswersPage,
});

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || Boolean(el.closest("[role=dialog]"));
}

/**
 * Every document's correct answer, next to the document: type it in, fix a model's draft, or mark
 * values nobody knows as "not sure". These answers are what accuracy checks score against.
 */
function AnswersPage() {
  const extractor = useExtractor();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const documents = useQuery(api.documents.list, { extractorId: extractor._id });
  const wide = useMediaQuery("(min-width: 1024px)");
  const filter: Filter = search.show ?? "all";

  const all = documents ?? [];
  const missingCount = all.filter((d) => !d.hasExpected).length;
  const shown = all.filter((d) => (filter === "missing" ? !d.hasExpected : filter === "saved" ? d.hasExpected : true));
  const current = shown.find((d) => d._id === search.doc) ?? shown[0];
  const index = current ? shown.indexOf(current) : -1;

  const select = useCallback(
    (id: string | undefined) => navigate({ search: (prev) => ({ ...prev, doc: id }), replace: true }),
    [navigate],
  );
  const go = useCallback(
    (step: number) => {
      if (index < 0 || shown.length === 0) return;
      select(shown[(index + step + shown.length) % shown.length]._id);
    },
    [index, shown, select],
  );

  // Arrows move between documents, unless you're typing in the form.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  if (documents === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (all.length === 0) {
    return (
      <EmptyState className="h-full" icon={<Inbox />} title="No documents yet">
        Upload documents in the playground, then come back here to give each one its correct answer.
      </EmptyState>
    );
  }

  const saved = all.length - missingCount;
  const toolbar = (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">
          {saved} of {all.length} documents have a correct answer
        </div>
        <div className="mt-1 flex items-center gap-2">
          <span className="h-1 w-32 overflow-hidden rounded-full bg-line">
            <span className="block h-full rounded-full bg-ok" style={{ width: `${(saved / all.length) * 100}%` }} />
          </span>
          <span className="text-2xs text-muted">Accuracy checks score extractions against these.</span>
        </div>
      </div>
      <Segmented<Filter>
        size="sm"
        value={filter}
        onChange={(show) => navigate({ search: (prev) => ({ ...prev, show: show === "all" ? undefined : show }), replace: true })}
        options={[
          { value: "all", label: `All ${all.length}` },
          { value: "missing", label: `Needs an answer ${missingCount}` },
          { value: "saved", label: `Saved ${saved}` },
        ]}
      />
      <DraftExtraction documents={all.filter((d) => !d.hasExpected && !d.lastRun).map((d) => d._id)} />
    </div>
  );

  const list = (
    <div className="h-full overflow-y-auto p-1.5">
      {shown.length === 0 ? (
        <p className="px-2 py-3 text-xs text-muted">{filter === "missing" ? "Every document has a correct answer." : "No documents."}</p>
      ) : (
        shown.map((doc) => (
          <button
            key={doc._id}
            type="button"
            onClick={() => select(doc._id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12.5px]",
              doc._id === current?._id ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-hover",
            )}
          >
            {doc.hasExpected ? (
              <Target className="size-3 shrink-0 text-accent" aria-label="Has a correct answer" />
            ) : (
              <span className="size-3 shrink-0 rounded-full border border-dashed border-faint" aria-label="Needs a correct answer" />
            )}
            <span className="min-w-0 flex-1 truncate">{doc.title}</span>
            {doc.notSureCount ? (
              <Tooltip content={`${doc.notSureCount} ${doc.notSureCount === 1 ? "value is" : "values are"} marked not sure`}>
                <span className="tabular shrink-0 text-2xs text-warn">?{doc.notSureCount}</span>
              </Tooltip>
            ) : null}
          </button>
        ))
      )}
    </div>
  );

  const editor = current ? (
    <AnswerPanel
      key={current._id}
      documentId={current._id}
      title={current.title}
      position={{ index, count: shown.length }}
      onPrev={() => go(-1)}
      onNext={() => go(1)}
    />
  ) : null;
  const viewer = current ? <DocumentViewer documentId={current._id} onDeleted={() => go(1)} /> : null;

  return (
    <div className="flex h-full flex-col">
      {toolbar}
      {wide ? (
        <div className="grid min-h-0 flex-1 grid-cols-[230px_minmax(0,1fr)_minmax(440px,1fr)]">
          <div className="min-h-0 border-r border-line bg-panel">{list}</div>
          <div className="min-h-0">{viewer}</div>
          <div className="min-h-0 border-l border-line bg-panel">{editor}</div>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="h-56 border-b border-line bg-panel">{list}</div>
          <div className="h-[380px] border-b border-line">{viewer}</div>
          <div className="h-[640px] bg-panel">{editor}</div>
        </div>
      )}
    </div>
  );
}

function AnswerPanel({
  documentId,
  title,
  position,
  onPrev,
  onNext,
}: {
  documentId: Id<"documents">;
  title: string;
  position: { index: number; count: number };
  onPrev: () => void;
  onNext: () => void;
}) {
  const extractor = useExtractor();
  const document = useQuery(api.documents.get, { id: documentId });
  const runs = useQuery(api.runs.listByDocument, { documentId });
  const latest = runs?.find((r) => r.status === "success");
  const latestRun = useQuery(api.runs.get, latest ? { id: latest._id } : "skip");
  const fields = (extractor.latestSchema?.fields as Field[] | undefined) ?? [];

  const loading = document === undefined || runs === undefined || (latest !== undefined && latestRun === undefined);
  const draft =
    latestRun && latest
      ? { value: latestRun.output, label: `run #${runs!.length - runs!.indexOf(latest)} (${modelLabel(latest.model)}, prompt v${latest.promptVersion})` }
      : undefined;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
        <Button variant="ghost" size="sm" icon aria-label="Previous document" onClick={onPrev}>
          <ChevronLeft />
        </Button>
        <span className="tabular text-xs text-muted">
          {position.index + 1} of {position.count}
        </span>
        <Button variant="ghost" size="sm" icon aria-label="Next document" onClick={onNext}>
          <ChevronRight />
        </Button>
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{title}</span>
        {runs?.some((r) => r.status === "queued" || r.status === "running") ? (
          <span className="flex shrink-0 items-center gap-1.5 text-2xs text-muted">
            <RunStatusDot status="running" /> Extracting a draft
          </span>
        ) : null}
      </div>
      {loading ? (
        <div className="flex flex-1 items-center justify-center text-muted">
          <Spinner />
        </div>
      ) : document === null ? (
        <EmptyState className="flex-1" title="Document not found" />
      ) : (
        <AnswerEditor document={document} fields={fields} draft={draft} className="min-h-0 flex-1" />
      )}
    </div>
  );
}

/** Optional: let a model fill in first drafts for documents that have neither an answer nor a run. */
function DraftExtraction({ documents }: { documents: Id<"documents">[] }) {
  const extractor = useExtractor();
  const setup = useSetup();
  const extractMany = useMutation(api.review.extractMany);
  const confirm = useConfirm();
  const [model, setModel] = useState(extractor.defaultModel);
  const [busy, setBusy] = useState(false);
  if (documents.length === 0) return null;

  return (
    <div className="ml-auto flex flex-wrap items-center gap-2">
      <ModelPicker value={model} onChange={setModel} className="w-48" />
      <Tooltip content="Optional. A model's output gives you a draft to check instead of typing every value. You can also just type answers in.">
        <span>
          <Button
            loading={busy}
            onClick={async () => {
              if (!setup.isModelAvailable(model)) {
                toast.error(`No API key for ${modelLabel(model)}. Pick another model or open Setup.`);
                return;
              }
              const ok = await confirm({
                title: `Extract drafts for ${documents.length} ${documents.length === 1 ? "document" : "documents"}?`,
                body: `Runs ${modelLabel(model)} with prompt v${extractor.latestPrompt?.version} on the documents that have no answer and no run yet. Each extraction is billed by the provider.`,
                confirmLabel: "Extract drafts",
              });
              if (!ok) return;
              setBusy(true);
              try {
                await extractMany({ extractorId: extractor._id, documentIds: documents, model });
              } catch (error) {
                toast.error(errorMessage(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? null : <Play />} Extract drafts ({documents.length})
          </Button>
        </span>
      </Tooltip>
    </div>
  );
}
