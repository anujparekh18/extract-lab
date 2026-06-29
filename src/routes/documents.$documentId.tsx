import { Link, createFileRoute } from "@tanstack/react-router";
import { diffLines } from "diff";
import { useEffect, useState, type CSSProperties } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  COST_CURRENCY_LABEL,
  DEFAULT_MODEL,
  GOOGLE_PROVIDER,
  SUPPORTED_GOOGLE_MODELS,
  buildCostBreakdown,
  formatCost,
  formatExchangeRateLabel,
  formatModelOptionLabel,
  resolveRunCostUsd,
} from "@/extraction/models";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/documents/$documentId")({
  component: DocumentDetailPage,
});

const EMPTY_OPTION = "__empty__";
const DOCUMENT_PREVIEW_HEIGHT_PX = 820;
const VALIDATED_OUTPUT_HEIGHT_PX = 720;
const COMPARE_OUTPUT_HEIGHT_PX = 520;
const PROMPT_SNAPSHOT_MAX_HEIGHT_PX = 180;
const DIFF_BLOCK_DEFAULT_MAX_HEIGHT_PX = 340;

type Notice = {
  type: "success" | "error";
  text: string;
};

function DocumentDetailPage() {
  const { documentId } = Route.useParams();

  const document = useQuery(api.documents.get, { id: documentId as any });
  const docType = useQuery(
    api.docTypes.getByKey,
    document ? { key: document.docTypeKey } : "skip",
  );
  const prompts = useQuery(
    api.prompts.listByDocType,
    document ? { docTypeKey: document.docTypeKey } : "skip",
  );

  const inProgressRuns = useQuery(api.runs.listInProgress, {});

  const createRun = useMutation(api.runs.createAndQueue);
  const deleteRun = useMutation(api.runs.remove);
  const updateDocumentTitle = useMutation(api.documents.updateTitle);

  const [notice, setNotice] = useState<Notice | null>(null);

  const [showPreview, setShowPreview] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  const [selectedPromptId, setSelectedPromptId] = useState("");
  const [selectedSchemaVersion, setSelectedSchemaVersion] = useState("");
  const [model, setModel] = useState(DEFAULT_MODEL);

  const [runPage, setRunPage] = useState(1);
  const [runSort, setRunSort] = useState<"asc" | "desc">("desc");
  const [selectedRunId, setSelectedRunId] = useState("");
  const [comparisonA, setComparisonA] = useState("");
  const [comparisonB, setComparisonB] = useState("");
  const [showPromptDiff, setShowPromptDiff] = useState(false);

  const runsPageData = useQuery(
    api.runs.listByDocumentPage,
    document
      ? {
          documentId: document._id,
          page: runPage,
          pageSize: 20,
          sort: runSort,
        }
      : "skip",
  );

  const preview = useQuery(
    api.documents.getPreviewUrl,
    showPreview ? { id: documentId as any } : "skip",
  );

  const runsForPage = runsPageData?.items ?? [];

  useEffect(() => {
    if (!prompts || prompts.length === 0) {
      setSelectedPromptId("");
      return;
    }

    const exists = prompts.some((prompt: any) => prompt._id === selectedPromptId);
    if (!exists) {
      setSelectedPromptId(prompts[0]._id);
    }
  }, [prompts, selectedPromptId]);

  const availableSchemaVersions = docType?.schemaVersions ?? [];

  useEffect(() => {
    if (availableSchemaVersions.length === 0) {
      setSelectedSchemaVersion("");
      return;
    }

    if (!selectedSchemaVersion || !availableSchemaVersions.includes(selectedSchemaVersion)) {
      setSelectedSchemaVersion(availableSchemaVersions[0]);
    }
  }, [availableSchemaVersions, selectedSchemaVersion]);

  useEffect(() => {
    const availableRunIds = new Set((runsPageData?.items ?? []).map((run: any) => run._id));
    if (selectedRunId && !availableRunIds.has(selectedRunId)) {
      setSelectedRunId("");
    }
    if (comparisonA && !availableRunIds.has(comparisonA)) {
      setComparisonA("");
    }
    if (comparisonB && !availableRunIds.has(comparisonB)) {
      setComparisonB("");
    }
  }, [runsPageData, selectedRunId, comparisonA, comparisonB]);

  useEffect(() => {
    if (document) {
      setTitleDraft(getDocumentTitle(document));
    }
  }, [document]);

  useEffect(() => {
    setShowPromptDiff(false);
  }, [comparisonA, comparisonB]);

  const hasGlobalRunInProgress = (inProgressRuns?.length ?? 0) > 0;
  const isSchemaSupported = availableSchemaVersions.length > 0;

  const runDisabledReason = !document
    ? "Document not found."
    : !docType
      ? "Doc type not found."
      : !isSchemaSupported
        ? `Run disabled: '${document.docTypeKey}' has no schema support in code registry.`
        : !selectedPromptId
          ? "Select a prompt."
          : !selectedSchemaVersion
            ? "Select a schema version."
            : hasGlobalRunInProgress
              ? "An extraction is already in progress. Only one extraction can run at a time."
              : "";

  const selectedRun = runsForPage.find((run: any) => run._id === selectedRunId) ?? null;
  const runA = runsForPage.find((run: any) => run._id === comparisonA) ?? null;
  const runB = runsForPage.find((run: any) => run._id === comparisonB) ?? null;

  const jsonTextA = toJsonText(runA?.parsedOutput);
  const jsonTextB = toJsonText(runB?.parsedOutput);

  async function withFeedback(task: () => Promise<void>, successText: string) {
    try {
      await task();
      setNotice({ type: "success", text: successText });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Something went wrong.",
      });
    }
  }

  async function handleRun() {
    if (runDisabledReason || !document) return;

    await withFeedback(async () => {
      await createRun({
        documentId: document._id,
        promptId: selectedPromptId as any,
        schemaVersion: selectedSchemaVersion,
        provider: GOOGLE_PROVIDER,
        model,
      });
      setRunPage(1);
    }, "Run started.");
  }

  async function handleSaveTitle() {
    if (!document || !titleDraft.trim()) return;

    setSavingTitle(true);
    await withFeedback(async () => {
      await updateDocumentTitle({
        id: document._id,
        title: titleDraft,
      });
      setEditingTitle(false);
    }, "Title updated.");
    setSavingTitle(false);
  }

  if (document === undefined) {
    return (
      <main className="mx-auto max-w-300 px-4 py-6 md:px-8">
        <div className="panel p-6 text-sm text-gray-600">Loading document...</div>
      </main>
    );
  }

  if (document === null) {
    return (
      <main className="mx-auto max-w-250 px-4 py-6 md:px-8">
        <div className="panel p-6">
          <h1 className="text-lg font-semibold">Document not found</h1>
          <Link to="/" className="btn btn-primary mt-4">
            Back To Hub
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-300 px-4 py-6 md:px-8">
      <header className="mb-4">
        <div className="text-sm text-gray-600">
          <Link to="/" className="text-teal-700 underline underline-offset-2">
            Doc Type Hub
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <Link
            to="/doc-types/$docTypeKey"
            params={{ docTypeKey: document.docTypeKey }}
            search={{ tab: "docs" }}
            className="text-teal-700 underline underline-offset-2"
          >
            {docType?.name ?? document.docTypeKey}
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <span>{getDocumentTitle(document)}</span>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2">
          {editingTitle ? (
            <>
              <input
                className="input max-w-130"
                value={titleDraft}
                onChange={(event) => setTitleDraft(event.target.value)}
                placeholder="Document title"
              />
              <button className="btn btn-primary" type="button" onClick={handleSaveTitle} disabled={savingTitle || !titleDraft.trim()}>
                {savingTitle ? "Saving..." : "Save"}
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={() => {
                  setTitleDraft(getDocumentTitle(document));
                  setEditingTitle(false);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <h1 className="text-2xl font-semibold">{getDocumentTitle(document)}</h1>
              <button className="btn btn-secondary" type="button" onClick={() => setEditingTitle(true)}>
                Rename
              </button>
            </>
          )}
        </div>
        <p className="mt-1 text-xs text-gray-600">{formatDocumentMeta(document)}</p>
      </header>

      {notice ? (
        <div
          className={`mb-4 rounded-md border px-3 py-2 text-sm ${
            notice.type === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-900"
              : "border-red-200 bg-red-50 text-red-900"
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {(inProgressRuns?.length ?? 0) > 0 ? (
        <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <div className="font-medium">Global extraction in progress.</div>
          <div className="mt-1 text-xs">
            {`${inProgressRuns?.[0]?.documentFileName ?? "Unknown document"} (${inProgressRuns?.[0]?.status ?? "running"})`}
          </div>
        </div>
      ) : null}

      <section className="space-y-4">
        <section className="panel p-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Document Preview</h2>
            <button className="btn btn-secondary" type="button" onClick={() => setShowPreview((prev) => !prev)}>
              {showPreview ? "Hide" : "Show"}
            </button>
          </div>

          {showPreview ? (
            <div className="mt-3">
              {(document.sourceType ?? "file") === "text" ? (
                <pre
                  className="overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-3 text-sm"
                  style={{ maxHeight: `${DOCUMENT_PREVIEW_HEIGHT_PX}px` }}
                >
                  {document.textContent ?? preview?.textContent ?? ""}
                </pre>
              ) : preview?.url ? (
                preview.mimeType === "application/pdf" ? (
                  <iframe
                    title="Document preview"
                    src={preview.url}
                    className="w-full rounded border"
                    style={{ height: `${DOCUMENT_PREVIEW_HEIGHT_PX}px` }}
                  />
                ) : (
                  <img
                    src={preview.url}
                    alt={getDocumentTitle(document)}
                    className="w-full rounded border object-contain"
                    style={{ maxHeight: `${DOCUMENT_PREVIEW_HEIGHT_PX}px` }}
                  />
                )
              ) : (
                <div className="rounded border border-dashed border-gray-300 px-3 py-8 text-center text-sm text-gray-600">
                  Preview unavailable.
                </div>
              )}
            </div>
          ) : (
            <p className="mt-2 text-xs text-gray-600">Preview is hidden.</p>
          )}
        </section>

        <section className="panel p-4">
          <h2 className="text-base font-semibold">Run Extraction</h2>
          <p className="mt-1 text-xs text-gray-600">One prompt per run. Global extraction lock is enabled.</p>

          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-5">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Prompt</label>
              <Select
                value={selectedPromptId || EMPTY_OPTION}
                onValueChange={(value) => setSelectedPromptId(value === EMPTY_OPTION ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select prompt" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_OPTION}>Select prompt</SelectItem>
                  {(prompts ?? []).map((prompt: any) => (
                    <SelectItem key={prompt._id} value={prompt._id}>
                      {prompt.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-600">Schema Version</label>
              <Select
                value={selectedSchemaVersion || EMPTY_OPTION}
                onValueChange={(value) => setSelectedSchemaVersion(value === EMPTY_OPTION ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select schema version" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_OPTION}>Select schema version</SelectItem>
                  {availableSchemaVersions.map((version: string) => (
                    <SelectItem key={version} value={version}>
                      {version}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="mb-1 block text-xs text-gray-600">Model</label>
              <Select value={model} onValueChange={setModel}>
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_GOOGLE_MODELS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {formatModelOptionLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>

          <div className="mt-3 flex items-center gap-3">
            <button className="btn btn-primary" onClick={handleRun} disabled={Boolean(runDisabledReason)}>
              Run Extraction
            </button>
            <div className="text-xs text-gray-600">Provider: `{GOOGLE_PROVIDER}`</div>
          </div>

          {runDisabledReason ? <p className="mt-2 text-sm text-amber-700">{runDisabledReason}</p> : null}
        </section>

        <section className="panel p-4">
          <div>
            <h2 className="text-base font-semibold">Run History</h2>
            <p className="mt-1 text-xs text-gray-600">
              Select one run to inspect output. Use the compare section below for side-by-side diffs.
            </p>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-gray-600">{getDocumentTitle(document)}</div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-600">Sort</label>
              <div className="w-42.5">
                <Select
                  value={runSort}
                  onValueChange={(value) => {
                    setRunSort(value as "asc" | "desc");
                    setRunPage(1);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Sort" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="desc">Newest First</SelectItem>
                    <SelectItem value="asc">Oldest First</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-[11px] text-gray-500">{formatExchangeRateLabel()}</div>
            </div>
          </div>

          <div className="mt-3 rounded-lg border border-gray-200">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left text-xs text-gray-600">
                  <th className="px-2 py-2">Select</th>
                  <th className="px-2 py-2">Time</th>
                  <th className="px-2 py-2">Status</th>
                  <th className="px-2 py-2">Prompt</th>
                  <th className="px-2 py-2">Schema</th>
                  <th className="px-2 py-2">Model</th>
                  <th className="px-2 py-2">Total Tokens</th>
                  <th className="px-2 py-2">Cost ({COST_CURRENCY_LABEL})</th>
                  <th className="px-2 py-2">Latency</th>
                  <th className="px-2 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {runsForPage.map((run: any) => {
                  const isSelected = selectedRunId === run._id;
                  const estimatedCostUsd = resolveRunCostUsd(run);
                  const costBreakdown = buildCostBreakdown(run, estimatedCostUsd);

                  return (
                    <tr
                      key={run._id}
                      className={`cursor-pointer border-b align-top ${isSelected ? "bg-teal-50/40" : ""}`}
                      onClick={() => setSelectedRunId((prev) => (prev === run._id ? "" : run._id))}
                    >
                      <td className="px-2 py-2">
                        <span
                          className={`inline-flex h-4 w-4 items-center justify-center rounded border text-[10px] font-semibold ${
                            isSelected ? "border-teal-600 bg-teal-600 text-white" : "border-gray-300 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs">{formatDate(run.createdAt)}</td>
                      <td className="px-2 py-2">
                        <span
                          className={`badge ${
                            run.status === "success"
                              ? "bg-emerald-50 text-emerald-800"
                              : run.status === "failed"
                                ? "bg-red-50 text-red-800"
                                : "bg-amber-50 text-amber-800"
                          }`}
                        >
                          {run.status}
                        </span>
                      </td>
                      <td className="px-2 py-2 text-xs">
                        <div className="max-w-55 truncate" title={run.promptName ?? "Unknown prompt"}>
                          {run.promptName ?? "-"}
                        </div>
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{run.schemaSnapshot?.schemaVersion ?? "-"}</td>
                      <td className="px-2 py-2 font-mono text-xs">{run.modelSnapshot?.model ?? "-"}</td>
                      <td className="px-2 py-2">{formatTokenCount(run.totalTokens)}</td>
                      <td className="px-2 py-2">
                        {estimatedCostUsd === undefined ? (
                          "-"
                        ) : (
                          <div className="group relative inline-block">
                            <span className="cursor-help underline decoration-dotted underline-offset-2">
                              {formatCost(estimatedCostUsd)}
                            </span>
                            {costBreakdown ? (
                              <div className="invisible absolute left-0 top-full z-20 mt-1 w-85 rounded-md border border-gray-200 bg-white p-2 text-[11px] text-gray-700 shadow-lg group-hover:visible">
                                <div>
                                  input_token ({formatTokenCount(costBreakdown.inputTokens)}) * input_rate ($
                                  {costBreakdown.inputRate}) = ${costBreakdown.inputCost.toFixed(6)} /
                                  ₹{costBreakdown.inputCostInr.toFixed(4)}
                                </div>
                                <div className="mt-1">
                                  output_token ({formatTokenCount(costBreakdown.outputTokens)}) * output_rate ($
                                  {costBreakdown.outputRate}) = $
                                  {costBreakdown.outputCost.toFixed(6)} / ₹{costBreakdown.outputCostInr.toFixed(4)}
                                </div>
                                <div className="mt-1 border-t border-gray-200 pt-1 font-medium">
                                  total = ${costBreakdown.totalCostUsd.toFixed(6)} / ₹{costBreakdown.totalCostInr.toFixed(4)}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        )}
                      </td>
                      <td className="px-2 py-2">{run.latencyMs ? `${run.latencyMs} ms` : "-"}</td>
                      <td className="px-2 py-2">
                        <div className="flex gap-1">
                          <button
                            className="btn btn-secondary"
                            type="button"
                            title="Set this run as Compare A"
                            onClick={(event) => {
                              event.stopPropagation();
                              setComparisonA(run._id);
                            }}
                          >
                            Set A
                          </button>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            title="Set this run as Compare B"
                            onClick={(event) => {
                              event.stopPropagation();
                              setComparisonB(run._id);
                            }}
                          >
                            Set B
                          </button>
                          <button
                            className="btn btn-secondary"
                            type="button"
                            title="Delete this run"
                            disabled={run.status === "queued" || run.status === "running"}
                            onClick={async (event) => {
                              event.stopPropagation();
                              const confirmed = window.confirm(
                                "Delete this run? This action cannot be undone.",
                              );
                              if (!confirmed) return;
                              await withFeedback(async () => {
                                await deleteRun({ id: run._id });
                              }, "Run deleted.");
                            }}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}

                {runsForPage.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-2 py-5 text-sm text-gray-600">
                      No runs on this page.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
            <div>
              Page {runsPageData?.page ?? 1} of {runsPageData?.pageCount ?? 1}
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!runsPageData?.hasPrevPage}
                onClick={() => setRunPage((prev) => Math.max(1, prev - 1))}
              >
                Prev
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!runsPageData?.hasNextPage}
                onClick={() => setRunPage((prev) => prev + 1)}
              >
                Next
              </button>
            </div>
          </div>

          {selectedRun ? (
            <div className="mt-4 rounded-lg border border-gray-200 bg-white p-3">
              <h3 className="text-sm font-semibold">Selected Run Output</h3>
              <p className="mt-1 text-xs text-gray-600">
                {formatDate(selectedRun.createdAt)} • {selectedRun.status} • {selectedRun.modelSnapshot?.model}
              </p>
              <div className="mt-3">
                <div className="mb-1 text-xs font-medium text-gray-700">Validated Output</div>
                <pre className="overflow-auto rounded bg-gray-50 p-3 text-xs" style={{ height: `${VALIDATED_OUTPUT_HEIGHT_PX}px` }}>
                  {toJsonText(selectedRun.parsedOutput)}
                </pre>
              </div>
              {(selectedRun.validationErrors?.length ?? 0) > 0 ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3">
                  <div className="text-xs font-medium text-red-900">Validation Errors</div>
                  <ul className="mt-1 list-disc pl-5 text-xs text-red-800">
                    {(selectedRun.validationErrors ?? []).map((error: string, index: number) => (
                      <li key={`${error}-${index}`}>{error}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 text-sm text-gray-600">Click a run row to check it and inspect output. Click again to uncheck.</p>
          )}
        </section>

        <section className="panel p-4">
          <div>
            <h2 className="text-base font-semibold">Compare Runs</h2>
            <p className="mt-1 text-xs text-gray-600">Select two runs (A and B) to compare side by side.</p>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs text-gray-600">Run A</label>
              <Select
                value={comparisonA || EMPTY_OPTION}
                onValueChange={(value) => setComparisonA(value === EMPTY_OPTION ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Run A" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_OPTION}>Select Run A</SelectItem>
                  {runsForPage.map((run: any) => (
                    <SelectItem key={run._id} value={run._id}>
                      {formatDate(run.createdAt)} • {run.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-gray-600">Run B</label>
              <Select
                value={comparisonB || EMPTY_OPTION}
                onValueChange={(value) => setComparisonB(value === EMPTY_OPTION ? "" : value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select Run B" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={EMPTY_OPTION}>Select Run B</SelectItem>
                  {runsForPage.map((run: any) => (
                    <SelectItem key={run._id} value={run._id}>
                      {formatDate(run.createdAt)} • {run.status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {runA && runB ? (
            <div className="mt-5 space-y-4 rounded-lg border border-gray-200 bg-white p-3">
              <h3 className="text-sm font-semibold">Compare Runs (A → B)</h3>

              <details className="rounded-md border border-gray-200 bg-gray-50 p-3">
                <summary className="cursor-pointer text-sm font-medium">Prompt Snapshots</summary>
                <div className="mt-2 grid gap-3 md:grid-cols-2">
                  <div>
                    <div className="mb-1 text-xs font-medium text-gray-700">Run A Prompt</div>
                    <pre className="overflow-auto rounded bg-white p-2 text-xs" style={{ maxHeight: `${PROMPT_SNAPSHOT_MAX_HEIGHT_PX}px` }}>
                      {runA.promptSnapshot ?? ""}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 text-xs font-medium text-gray-700">Run B Prompt</div>
                    <pre className="overflow-auto rounded bg-white p-2 text-xs" style={{ maxHeight: `${PROMPT_SNAPSHOT_MAX_HEIGHT_PX}px` }}>
                      {runB.promptSnapshot ?? ""}
                    </pre>
                  </div>
                </div>

                <div className="mt-3">
                  <button className="btn btn-secondary" onClick={() => setShowPromptDiff((prev) => !prev)}>
                    {showPromptDiff ? "Hide Prompt Diff" : "Show Prompt Diff"}
                  </button>
                </div>

                {showPromptDiff ? (
                  <div className="mt-3 rounded border border-gray-200 bg-white p-3">
                    <div className="text-xs font-medium text-gray-700">Prompt Diff (A → B)</div>
                    <DiffBlock oldText={runA.promptSnapshot ?? ""} newText={runB.promptSnapshot ?? ""} />
                  </div>
                ) : null}
              </details>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <h4 className="text-sm font-semibold">Run A Output</h4>
                  <pre className="mt-2 overflow-auto rounded bg-gray-50 p-3 text-xs" style={{ height: `${COMPARE_OUTPUT_HEIGHT_PX}px` }}>
                    {jsonTextA}
                  </pre>
                </div>
                <div className="rounded-lg border border-gray-200 bg-white p-3">
                  <h4 className="text-sm font-semibold">Run B Output</h4>
                  <pre className="mt-2 overflow-auto rounded bg-gray-50 p-3 text-xs" style={{ height: `${COMPARE_OUTPUT_HEIGHT_PX}px` }}>
                    {jsonTextB}
                  </pre>
                </div>
              </div>

              <div className="rounded-lg border border-gray-200 bg-white p-3">
                <h4 className="text-sm font-semibold">JSON Diff (A → B)</h4>
                <DiffBlock
                  oldText={jsonTextA}
                  newText={jsonTextB}
                  preClassName="mt-2 overflow-auto rounded bg-gray-50 p-3 text-xs"
                  preStyle={{ height: `${COMPARE_OUTPUT_HEIGHT_PX}px` }}
                />
              </div>
            </div>
          ) : (
            <p className="mt-5 text-sm text-gray-600">Select two runs (A and B) to compare.</p>
          )}
        </section>
      </section>
    </main>
  );
}

function DiffBlock({
  oldText,
  newText,
  preClassName,
  preStyle,
}: {
  oldText: string;
  newText: string;
  preClassName?: string;
  preStyle?: CSSProperties;
}) {
  const parts = diffLines(oldText || "", newText || "");

  return (
    <pre
      className={preClassName ?? "mt-2 overflow-auto rounded bg-gray-50 p-3 text-xs"}
      style={preStyle ?? { maxHeight: `${DIFF_BLOCK_DEFAULT_MAX_HEIGHT_PX}px` }}
    >
      {parts.map((part, index) => {
        const className = part.added
          ? "bg-emerald-100 text-emerald-900"
          : part.removed
            ? "bg-red-100 text-red-900"
            : "text-gray-700";

        return (
          <span key={index} className={className}>
            {part.value}
          </span>
        );
      })}
    </pre>
  );
}

function toJsonText(value: unknown) {
  if (value === undefined || value === null) return "No parsed output";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatDate(ts: number | undefined) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function getDocumentTitle(document: any) {
  return document.title ?? document.fileName ?? "Untitled document";
}

function formatDocumentMeta(document: any) {
  if ((document.sourceType ?? "file") === "text") {
    const characterCount = document.textContent?.length ?? 0;
    return `Text • ${characterCount.toLocaleString()} characters`;
  }

  const parts = [
    document.fileName,
    document.fileSize === undefined ? undefined : formatBytes(document.fileSize),
    document.mimeType,
  ].filter(Boolean);

  return parts.join(" • ") || "File";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTokenCount(value: number | undefined) {
  if (value === undefined || value === null) return "-";
  return value.toLocaleString();
}
