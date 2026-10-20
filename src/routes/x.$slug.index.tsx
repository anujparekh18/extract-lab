import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { useExtractor, type Extractor } from "@/components/extractor-context";
import { DocumentsPane } from "@/components/playground/documents-pane";
import { DocumentViewer } from "@/components/playground/document-viewer";
import { EditorPane } from "@/components/playground/editor-pane";
import { ResultPane } from "@/components/playground/result-pane";
import { COLLAPSED_PX, CollapsedPane } from "@/components/playground/collapsible";
import { EmptyState } from "@/components/ui/misc";
import { errorMessage } from "@/lib/errors";
import { hashString, stableStringify, validateFields, type Field } from "@/lib/fields";
import { useHotkey, useSetup } from "@/lib/hooks";
import { draftKey, type Draft } from "@/lib/draft";
import { fileProblem, getModelInfo, modelLabel } from "@/lib/models";

export const Route = createFileRoute("/x/$slug/")({
  validateSearch: (search: Record<string, unknown>): { doc?: string } =>
    typeof search.doc === "string" ? { doc: search.doc } : {},
  component: PlaygroundPage,
});

function PlaygroundPage() {
  const extractor = useExtractor();
  // Remount per extractor so drafts never leak between them.
  return <Playground key={extractor._id} extractor={extractor} />;
}

function initialDraft(extractor: Extractor): Draft {
  const fallback: Draft = {
    prompt: extractor.latestPrompt?.text ?? "",
    fields: (extractor.latestSchema?.fields as Field[] | undefined) ?? [],
    model: extractor.defaultModel,
  };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(draftKey(extractor._id));
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Draft> & { base?: { prompt: string; fields: string } };
    const draft = { ...fallback, ...saved };
    // Parts the user never edited follow the latest version instead of the one they started from.
    if (saved.base) {
      if (hashString(draft.prompt) === saved.base.prompt) draft.prompt = fallback.prompt;
      if (hashString(stableStringify(draft.fields)) === saved.base.fields) draft.fields = fallback.fields;
    }
    return { prompt: draft.prompt, fields: draft.fields, model: draft.model };
  } catch {
    return fallback;
  }
}

function Playground({ extractor }: { extractor: Extractor }) {
  const navigate = useNavigate({ from: "/x/$slug/" });
  const { doc } = Route.useSearch();
  const documents = useQuery(api.documents.list, { extractorId: extractor._id });
  const startRun = useMutation(api.runs.start);
  const savePrompt = useMutation(api.versions.savePrompt);
  const saveSchema = useMutation(api.versions.saveSchema);
  const setup = useSetup();

  const [draft, setDraft] = useState<Draft>(() => initialDraft(extractor));
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [focusRunId, setFocusRunId] = useState<Id<"runs"> | null>(null);
  // Each pane can fold away to make room for the others.
  const docsPanel = useCollapsible();
  const viewerPanel = useCollapsible();
  const editorPanel = useCollapsible();
  const resultPanel = useCollapsible();

  const latestFields = (extractor.latestSchema?.fields as Field[] | undefined) ?? [];
  const promptDirty = draft.prompt !== (extractor.latestPrompt?.text ?? "");
  const schemaDirty = stableStringify(draft.fields) !== stableStringify(latestFields);

  // When a new version is saved elsewhere (another tab, an eval, the API), follow it
  // unless the draft has edits of its own.
  const seenLatest = useRef({ prompt: extractor.latestPrompt?.text ?? "", fields: stableStringify(latestFields) });
  useEffect(() => {
    const prompt = extractor.latestPrompt?.text ?? "";
    const fields = stableStringify(latestFields);
    const seen = seenLatest.current;
    if (prompt === seen.prompt && fields === seen.fields) return;
    setDraft((d) => ({
      ...d,
      prompt: d.prompt === seen.prompt ? prompt : d.prompt,
      fields: stableStringify(d.fields) === seen.fields ? latestFields : d.fields,
    }));
    seenLatest.current = { prompt, fields };
  }, [extractor.latestPrompt?.text, latestFields]);

  // Keep a local copy of the draft so a refresh doesn't lose unsaved edits.
  useEffect(() => {
    try {
      if (promptDirty || schemaDirty) {
        const base = { prompt: hashString(seenLatest.current.prompt), fields: hashString(seenLatest.current.fields) };
        window.localStorage.setItem(draftKey(extractor._id), JSON.stringify({ ...draft, base }));
      }
      else window.localStorage.removeItem(draftKey(extractor._id));
    } catch {
      // Storage unavailable; drafts just won't survive a refresh.
    }
  }, [draft, promptDirty, schemaDirty, extractor._id]);


  const selectedId = useMemo(() => {
    if (!documents) return undefined;
    const match = documents.find((d) => d._id === doc);
    return (match ?? documents[0])?._id;
  }, [documents, doc]);

  const selectDocument = useCallback(
    (id: Id<"documents"> | undefined) => navigate({ search: id ? { doc: id } : {}, replace: true }),
    [navigate],
  );

  const patchDraft = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);

  const schemaErrors = validateFields(draft.fields);
  const selectedDoc = documents?.find((d) => d._id === selectedId);
  const fileIssue = selectedDoc?.kind === "file" ? fileProblem(getModelInfo(draft.model), selectedDoc.mimeType) : null;
  const canRun = !selectedId
    ? { ok: false, reason: "Add a document first." }
    : !draft.prompt.trim()
      ? { ok: false, reason: "Write a prompt first." }
      : schemaErrors.length > 0
        ? { ok: false, reason: schemaErrors[0] }
        : !setup.loading && !setup.isModelAvailable(draft.model)
          ? { ok: false, reason: `No API key for ${modelLabel(draft.model)}. Pick another model or open Setup.` }
          : fileIssue
            ? { ok: false, reason: fileIssue }
            : { ok: true };

  const runningRef = useRef(false);
  async function run() {
    if (!canRun.ok || !selectedId || runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      const runId = await startRun({
        documentId: selectedId,
        prompt: draft.prompt,
        fields: draft.fields,
        model: draft.model,
      });
      setFocusRunId(runId);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      runningRef.current = false;
      setRunning(false);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const messages: string[] = [];
      if (promptDirty) messages.push(`prompt v${await savePrompt({ extractorId: extractor._id, text: draft.prompt })}`);
      if (schemaDirty) messages.push(`schema v${await saveSchema({ extractorId: extractor._id, fields: draft.fields })}`);
      if (!messages.length) return;
      toast.success(`Saved ${messages.join(" and ")}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  useHotkey("mod+enter", () => run());
  useHotkey("mod+s", () => {
    if ((promptDirty || schemaDirty) && schemaErrors.length === 0) save();
  });

  const editor = (
    <EditorPane
      extractorId={extractor._id}
      draft={draft}
      onChange={patchDraft}
      latestPromptVersion={extractor.latestPrompt?.version ?? 0}
      latestSchemaVersion={extractor.latestSchema?.version ?? 0}
      onSave={save}
      saving={saving}
      onRun={run}
      running={running}
      canRun={canRun}
      documentTitle={selectedDoc?.title}
      onCollapse={editorPanel.collapse}
    />
  );

  const result = selectedId ? (
    <ResultPane
      documentId={selectedId}
      focusRunId={focusRunId}
      onCollapse={resultPanel.collapse}
      onLoadRun={(loaded) => {
        setDraft((d) => ({
          ...d,
          prompt: loaded.prompt?.text ?? d.prompt,
          fields: loaded.schema?.fields ?? d.fields,
          model: loaded.model,
        }));
        toast.success(`Loaded prompt v${loaded.prompt?.version}, schema v${loaded.schema?.version}, ${modelLabel(loaded.model)}`);
      }}
    />
  ) : (
    <EmptyState className="h-full" icon={<FileText />} title="Add a document to run against" />
  );

  const docs = (
    <DocumentsPane
      extractorId={extractor._id}
      documents={documents}
      selectedId={selectedId}
      onSelect={selectDocument}
      onCollapse={docsPanel.collapse}
    />
  );
  const viewer = selectedId ? (
    <DocumentViewer
      documentId={selectedId}
      onCollapse={viewerPanel.collapse}
      onDeleted={() => selectDocument(documents?.find((d) => d._id !== selectedId)?._id)}
    />
  ) : (
    <EmptyState className="h-full bg-sunken" icon={<FileText />} title="No document selected">
      Upload a PDF or image, or paste text, from the list on the left.
    </EmptyState>
  );

  return (
    <>
      <div className="hidden h-full lg:block">
        <Group orientation="horizontal" className="h-full">
          <Panel {...docsPanel.props} defaultSize={236} minSize={160} maxSize={360} className="border-r border-line">
            {docsPanel.collapsed ? (
              <CollapsedPane label="Documents" detail={documents ? `${documents.length}` : undefined} onExpand={docsPanel.expand} />
            ) : (
              <div className="fade-in h-full">{docs}</div>
            )}
          </Panel>
          <Handle />
          <Panel {...viewerPanel.props} minSize={240}>
            {viewerPanel.collapsed ? (
              <CollapsedPane label="Document" detail={selectedDoc?.title} onExpand={viewerPanel.expand} />
            ) : (
              <div className="fade-in h-full">{viewer}</div>
            )}
          </Panel>
          <Handle />
          <Panel defaultSize="46%" minSize={360} className="border-l border-line">
            <Group orientation="vertical" className="h-full">
              <Panel {...editorPanel.props} defaultSize="46%" minSize={160}>
                {editorPanel.collapsed ? (
                  <CollapsedPane vertical label="Prompt and schema" detail={`prompt v${extractor.latestPrompt?.version ?? 0} · schema v${extractor.latestSchema?.version ?? 0}`} onExpand={editorPanel.expand} />
                ) : (
                  <div className="fade-in h-full">{editor}</div>
                )}
              </Panel>
              <Handle vertical />
              <Panel {...resultPanel.props} minSize={160} className="border-t border-line bg-panel">
                {resultPanel.collapsed ? (
                  <CollapsedPane vertical label="Results" detail="Latest run and correct answer" onExpand={resultPanel.expand} />
                ) : (
                  <div className="fade-in h-full">{result}</div>
                )}
              </Panel>
            </Group>
          </Panel>
        </Group>
      </div>
      <div className="h-full overflow-y-auto lg:hidden">
        <div className="h-56 border-b border-line">{docs}</div>
        <div className="h-[420px] border-b border-line">{viewer}</div>
        <div className="h-[420px] border-b border-line">{editor}</div>
        <div className="h-[520px] bg-panel">{result}</div>
      </div>
    </>
  );
}

/** A pane that folds to a thin strip, by its own button or by dragging its edge past the minimum. */
function useCollapsible() {
  const ref = usePanelRef();
  const [collapsed, setCollapsed] = useState(false);
  const read = () => setCollapsed(Boolean(ref.current?.isCollapsed()));
  return {
    collapsed,
    // Read the state right away too: onResize relies on a ResizeObserver, which can lag or pause.
    collapse: () => {
      ref.current?.collapse();
      read();
    },
    expand: () => {
      ref.current?.expand();
      read();
    },
    props: {
      panelRef: ref,
      collapsible: true,
      collapsedSize: COLLAPSED_PX,
      onResize: read,
    },
  };
}

function Handle({ vertical }: { vertical?: boolean }) {
  return (
    <Separator
      className={
        vertical
          ? "relative h-px bg-transparent after:absolute after:inset-x-0 after:-top-1 after:h-2 hover:bg-accent data-[separator=active]:bg-accent"
          : "relative w-px bg-transparent after:absolute after:inset-y-0 after:-left-1 after:w-2 hover:bg-accent data-[separator=active]:bg-accent"
      }
    />
  );
}
