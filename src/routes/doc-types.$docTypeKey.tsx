import { Link, Outlet, createFileRoute, useLocation } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import {
  EmptyState,
  HelperCallout,
  NoticeBanner,
  TooltipHint,
} from "@/components/ui/feedback";

export const Route = createFileRoute("/doc-types/$docTypeKey")({
  validateSearch: (search: Record<string, unknown>) => ({
    tab: search.tab === "prompts" ? "prompts" : undefined,
  }),
  component: DocTypePage,
});

type Notice = {
  type: "success" | "error";
  text: string;
};

function DocTypePage() {
  const { docTypeKey } = Route.useParams();
  const { tab } = Route.useSearch();
  const location = useLocation();
  const activeTab = tab ?? "docs";

  const docType = useQuery(api.docTypes.getByKey, { key: docTypeKey });
  const limits = useQuery(api.documents.limits, {});
  const prompts = useQuery(api.prompts.listByDocType, { docTypeKey });

  const createDocument = useMutation(api.documents.create);
  const createTextDocument = useMutation(api.documents.createText);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const deleteDocument = useMutation(api.documents.remove);
  const deletePrompt = useMutation(api.prompts.remove);

  const [notice, setNotice] = useState<Notice | null>(null);

  const [docSearch, setDocSearch] = useState("");
  const [docPage, setDocPage] = useState(1);
  const [createMode, setCreateMode] = useState<"file" | "text">("file");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [textTitle, setTextTitle] = useState(() => buildTextInputTitle());
  const [textContent, setTextContent] = useState("");
  const [creatingText, setCreatingText] = useState(false);

  const [promptSearch, setPromptSearch] = useState("");

  const docsPageData = useQuery(api.documents.listByDocTypePage, {
    docTypeKey,
    search: docSearch,
    page: docPage,
    pageSize: 50,
  });

  const docsForPage = docsPageData?.items ?? [];
  const isPromptChildRoute = location.pathname.includes("/prompts/");
  const showInvoiceQuickStart =
    docType?.key === "invoice" &&
    docType.documentCount === 0 &&
    docType.promptCount === 0 &&
    docType.runCount === 0;

  const filteredPrompts = useMemo(() => {
    const term = promptSearch.trim().toLowerCase();
    const list = prompts ?? [];
    if (!term) return list;

    return list.filter((prompt: any) => {
      return (
        prompt.name.toLowerCase().includes(term) ||
        prompt.text.toLowerCase().includes(term)
      );
    });
  }, [promptSearch, prompts]);

  useEffect(() => {
    setDocPage(1);
  }, [docSearch]);

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

  async function handleUploadDocument() {
    if (!uploadFile) {
      setNotice({ type: "error", text: "Select a file first." });
      return;
    }

    setUploading(true);
    try {
      const uploadUrl = await generateUploadUrl({});
      const result = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": uploadFile.type || "application/octet-stream" },
        body: uploadFile,
      });

      if (!result.ok) {
        throw new Error("Upload failed.");
      }

      const uploaded = await result.json();
      await createDocument({
        docTypeKey,
        fileName: uploadFile.name,
        title: uploadFile.name,
        mimeType: uploadFile.type,
        fileSize: uploadFile.size,
        storageId: uploaded.storageId,
      });

      setUploadFile(null);
      setDocPage(1);
      setNotice({ type: "success", text: "Document uploaded." });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Document upload failed.",
      });
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateTextDocument() {
    if (!textContent.trim()) {
      setNotice({ type: "error", text: "Enter text first." });
      return;
    }

    setCreatingText(true);
    try {
      await createTextDocument({
        docTypeKey,
        title: textTitle,
        textContent,
      });

      setTextTitle(buildTextInputTitle());
      setTextContent("");
      setDocPage(1);
      setNotice({ type: "success", text: "Text document created." });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Text document creation failed.",
      });
    } finally {
      setCreatingText(false);
    }
  }

  if (docType === undefined) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
        <div className="panel p-6 text-sm text-gray-600">Loading Doc Type...</div>
      </main>
    );
  }

  if (docType === null) {
    return (
      <main className="mx-auto max-w-[1000px] px-4 py-8 md:px-8">
        <div className="panel p-6">
          <h1 className="text-lg font-semibold">Doc Type not found</h1>
          <p className="mt-2 text-sm text-gray-600">The requested Doc Type does not exist or was deleted.</p>
          <Link to="/" className="btn btn-primary mt-4">
            Back to Hub
          </Link>
        </div>
      </main>
    );
  }

  if (isPromptChildRoute) {
    return <Outlet />;
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-6 md:px-8">
      <header className="mb-4">
        <div className="text-sm text-gray-600">
          <Link to="/" className="text-teal-700 underline underline-offset-2">
            Doc Type Hub
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{docType.key}</code>
        </div>
        <h1 className="mt-1 text-2xl font-semibold">{docType.name}</h1>
        <p className="mt-1 text-xs text-gray-600">
          {docType.documentCount} Documents • {docType.promptCount} Prompts • {docType.runCount} Runs • Last activity{" "}
          {formatDate(docType.lastActivityAt)}
        </p>
      </header>

      <NoticeBanner notice={notice} />

      <section className="panel p-3">
        <div className="flex gap-2">
          <Link
            to="/doc-types/$docTypeKey"
            params={{ docTypeKey }}
            search={{ tab: "docs" }}
            className={`btn ${activeTab === "docs" ? "btn-primary" : "btn-secondary"}`}
          >
            Documents
          </Link>
          <Link
            to="/doc-types/$docTypeKey"
            params={{ docTypeKey }}
            search={{ tab: "prompts" }}
            className={`btn ${activeTab === "prompts" ? "btn-primary" : "btn-secondary"}`}
          >
            Prompts
          </Link>
        </div>
      </section>

      {!docType.isSchemaSupported ? (
        <HelperCallout title="Schema Version not available" className="mt-4">
          <p className="text-xs text-gray-600">
            Runs are disabled until <code>src/extraction/schema-registry.ts</code> includes this Doc Type.
            You can still add Documents and Prompts while schema support is being wired up.
          </p>
        </HelperCallout>
      ) : null}

      {showInvoiceQuickStart ? (
        <HelperCallout title="Invoice quick start" className="mt-4">
          <ol className="grid gap-2 text-xs text-gray-600 md:grid-cols-3">
            <li>
              <span className="font-medium text-gray-900">1. Add a Document</span>
              <br />
              Upload <code>examples/invoice/sample-invoice.jpg</code> or paste your own invoice text.
            </li>
            <li>
              <span className="font-medium text-gray-900">2. Add a Prompt</span>
              <br />
              Create a Prompt using <code>examples/invoice/sample-prompt.md</code>.
            </li>
            <li>
              <span className="font-medium text-gray-900">3. Run extraction</span>
              <br />
              Open the Document, choose a Prompt, Schema Version, and Model, then start a Run.
            </li>
          </ol>
        </HelperCallout>
      ) : null}

      {activeTab === "docs" ? (
        <section className="panel mt-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Documents</h2>
            <div className="text-xs text-gray-500">{docsPageData?.total ?? 0} total</div>
          </div>

          <p className="mt-1 text-xs text-gray-600">{formatDocumentLimits(limits)}</p>

          <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-gray-50 p-3">
            <div className="flex gap-2">
              <button
                className={`btn ${createMode === "file" ? "btn-primary" : "btn-secondary"}`}
                type="button"
                onClick={() => setCreateMode("file")}
              >
                Upload File
              </button>
              <button
                className={`btn ${createMode === "text" ? "btn-primary" : "btn-secondary"}`}
                type="button"
                onClick={() => setCreateMode("text")}
              >
                Paste Text
              </button>
            </div>

            {createMode === "file" ? (
              <>
                <div
                  className={`mt-3 rounded-md border p-4 text-center text-sm ${
                    dragActive ? "border-teal-500 bg-teal-50" : "border-gray-300 bg-white"
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragActive(false);
                    const file = event.dataTransfer.files?.[0] ?? null;
                    if (file) setUploadFile(file);
                  }}
                >
                  Drop a PDF or image here, or choose a file.
                </div>

                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_auto]">
                  <input
                    className="input"
                    type="file"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
                    onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                  />
                  <button className="btn btn-primary" onClick={handleUploadDocument} disabled={uploading || !uploadFile}>
                    {uploading ? "Uploading..." : "Upload"}
                  </button>
                </div>

                <div className="mt-2 text-xs text-gray-600">
                  {uploadFile
                    ? `Selected: ${uploadFile.name}`
                    : showInvoiceQuickStart
                      ? "Try examples/invoice/sample-invoice.jpg for the sample flow."
                      : "No file selected."}
                </div>
              </>
            ) : (
              <div className="mt-3 space-y-2">
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Title</label>
                  <input
                    className="input"
                    value={textTitle}
                    onChange={(event) => setTextTitle(event.target.value)}
                    placeholder="Text document title"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs text-gray-600">Text</label>
                  <textarea
                    className="input min-h-[220px]"
                    value={textContent}
                    onChange={(event) => setTextContent(event.target.value)}
                    placeholder="Paste raw Document text here."
                  />
                </div>
                <button className="btn btn-primary" onClick={handleCreateTextDocument} disabled={creatingText || !textContent.trim()}>
                  {creatingText ? "Creating..." : "Create Document"}
                </button>
              </div>
            )}
          </div>

          <div className="mt-4">
            <input
              className="input"
              placeholder="Search Documents"
              value={docSearch}
              onChange={(event) => setDocSearch(event.target.value)}
            />
          </div>

          {docsForPage.length > 0 ? (
            <div className="mt-3 overflow-x-auto rounded-lg border border-gray-200">
              <table className="w-full min-w-[760px] border-collapse text-sm">
                <thead>
                  <tr className="border-b bg-gray-50 text-left text-xs text-gray-600">
                    <th className="px-2 py-2">Document</th>
                    <th className="px-2 py-2">Status</th>
                    <th className="px-2 py-2">Runs</th>
                    <th className="px-2 py-2">Added</th>
                    <th className="px-2 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docsForPage.map((doc: any) => {
                    const canDelete = doc.canDelete ?? doc.runCount === 0;
                    const deleteDisabledReason =
                      doc.deletionDisabledReason ?? (canDelete ? "" : "Delete Runs first.");

                    return (
                      <tr key={doc._id} className="border-b align-top">
                        <td className="px-2 py-2">
                          <div className="max-w-[280px] truncate font-medium">{doc.title ?? doc.fileName ?? "Untitled document"}</div>
                          <div className="mt-0.5 text-xs text-gray-500">{formatDocumentMeta(doc)}</div>
                        </td>
                        <td className="px-2 py-2">{renderDocumentStatus(doc)}</td>
                        <td className="px-2 py-2">{doc.runCount}</td>
                        <td className="px-2 py-2 text-xs text-gray-600">{formatDate(doc.createdAt)}</td>
                        <td className="px-2 py-2">
                          <div className="flex items-center gap-2">
                            <Link to="/documents/$documentId" params={{ documentId: doc._id }} className="btn btn-primary">
                              Open
                            </Link>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              disabled={!canDelete}
                              title={canDelete ? "Delete Document" : deleteDisabledReason}
                              onClick={async () => {
                                await withFeedback(async () => {
                                  await deleteDocument({ id: doc._id });
                                }, "Document deleted.");
                              }}
                            >
                              Delete
                            </button>
                            <TooltipHint reason={!canDelete ? deleteDisabledReason : null} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              className="mt-3"
              title={docSearch.trim() ? "No Documents match your search" : "Add a Document to start testing"}
              description={
                docSearch.trim()
                  ? "Clear the search to show all Documents for this Doc Type."
                  : showInvoiceQuickStart
                    ? "Upload examples/invoice/sample-invoice.jpg, or paste invoice text, then open the Document to run extraction."
                    : "Upload a supported file or paste raw text above. Each Run starts from one Document."
              }
            />
          )}

          <div className="mt-2 flex items-center justify-between text-xs text-gray-600">
            <div>
              Page {docsPageData?.page ?? 1} of {docsPageData?.pageCount ?? 1}
            </div>
            <div className="flex gap-2">
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!docsPageData?.hasPrevPage}
                onClick={() => setDocPage((prev) => Math.max(1, prev - 1))}
              >
                Prev
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={!docsPageData?.hasNextPage}
                onClick={() => setDocPage((prev) => prev + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel mt-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-semibold">Prompts</h2>
            <Link
              to="/doc-types/$docTypeKey/prompts/new"
              params={{ docTypeKey }}
              search={{ tab: "prompts" }}
              className="btn btn-primary"
            >
              New Prompt
            </Link>
          </div>

          <div className="mt-3">
            <input
              className="input"
              placeholder="Search Prompts"
              value={promptSearch}
              onChange={(event) => setPromptSearch(event.target.value)}
            />
          </div>

          <div className="mt-4 space-y-2">
            {filteredPrompts.map((prompt: any) => {
              const canDelete = prompt.canDelete ?? true;
              const deleteDisabledReason = prompt.deletionDisabledReason ?? "";

              return (
                <div key={prompt._id} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{prompt.name}</div>
                      <div className="mt-1 line-clamp-3 text-xs text-gray-600">{prompt.text}</div>
                      <div className="mt-1 text-xs text-gray-500">Updated: {formatDate(prompt.updatedAt)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        to="/doc-types/$docTypeKey/prompts/$promptId/view"
                        params={{ docTypeKey, promptId: prompt._id }}
                        search={{ tab: "prompts" }}
                        className="btn btn-secondary"
                      >
                        View
                      </Link>
                      <Link
                        to="/doc-types/$docTypeKey/prompts/$promptId/edit"
                        params={{ docTypeKey, promptId: prompt._id }}
                        search={{ tab: "prompts" }}
                        className="btn btn-secondary"
                      >
                        Edit
                      </Link>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={!canDelete}
                        title={canDelete ? "Delete Prompt" : deleteDisabledReason}
                        onClick={async () => {
                          await withFeedback(async () => {
                            await deletePrompt({ id: prompt._id });
                          }, "Prompt deleted.");
                        }}
                      >
                        Delete
                      </button>
                      <TooltipHint reason={!canDelete ? deleteDisabledReason : null} />
                    </div>
                  </div>
                </div>
              );
            })}

            {filteredPrompts.length === 0 ? (
              <EmptyState
                title={promptSearch.trim() ? "No Prompts match your search" : "Create a Prompt"}
                description={
                  promptSearch.trim()
                    ? "Clear the search to show all Prompts for this Doc Type."
                    : showInvoiceQuickStart
                      ? "Use examples/invoice/sample-prompt.md as the starting Prompt for the bundled Invoice example."
                      : "A Prompt tells the Model what to extract. You need at least one Prompt before you can create a Run."
                }
              >
                {!promptSearch.trim() ? (
                  <Link
                    to="/doc-types/$docTypeKey/prompts/new"
                    params={{ docTypeKey }}
                    search={{ tab: "prompts" }}
                    className="btn btn-primary"
                  >
                    New Prompt
                  </Link>
                ) : null}
              </EmptyState>
            ) : null}
          </div>
        </section>
      )}
    </main>
  );
}

function renderDocumentStatus(doc: any) {
  if (doc.hasActiveRun) return <span className="badge bg-amber-50 text-amber-800">In progress</span>;
  if (doc.latestRunStatus === "success") return <span className="badge bg-emerald-50 text-emerald-800">Success</span>;
  if (doc.latestRunStatus === "failed") return <span className="badge bg-red-50 text-red-800">Failed</span>;
  return <span className="badge">No Runs</span>;
}

function formatDate(ts: number | undefined) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDocumentLimits(limits: any) {
  if (!limits) return "Accepted files: PDF, JPEG, PNG, WebP.";

  const maxMb = limits.maxFileSizeBytes / 1024 / 1024;
  return `Accepted files: PDF, JPEG, PNG, WebP. Max ${maxMb}MB.`;
}

function formatDocumentMeta(doc: any) {
  if ((doc.sourceType ?? "file") === "text") {
    const characterCount = doc.textLength ?? doc.textContent?.length ?? 0;
    return `Text • ${characterCount.toLocaleString()} characters`;
  }

  return doc.fileSize === undefined ? "File" : formatBytes(doc.fileSize);
}

function buildTextInputTitle() {
  return `Text input - ${new Date().toLocaleString()}`;
}
