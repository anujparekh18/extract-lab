import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { EmptyState, NoticeBanner, TooltipHint } from "@/components/ui/feedback";

export const Route = createFileRoute("/")({
  component: DocTypeHubPage,
});

type Notice = {
  type: "success" | "error";
  text: string;
};

function DocTypeHubPage() {
  const docTypes = useQuery(api.docTypes.listForHub, {});

  const createDocType = useMutation(api.docTypes.create);
  const updateDocTypeName = useMutation(api.docTypes.updateName);
  const deleteDocType = useMutation(api.docTypes.remove);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [newDocTypeName, setNewDocTypeName] = useState("");
  const [newDocTypeKey, setNewDocTypeKey] = useState("");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filteredDocTypes = useMemo(() => {
    const term = search.trim().toLowerCase();
    const items = docTypes ?? [];

    if (!term) return items;

    return items.filter((docType: any) => {
      return (
        docType.name.toLowerCase().includes(term) ||
        docType.key.toLowerCase().includes(term)
      );
    });
  }, [docTypes, search]);

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

  async function handleCreateDocType(event: React.FormEvent) {
    event.preventDefault();
    await withFeedback(async () => {
      await createDocType({
        name: newDocTypeName,
        key: newDocTypeKey,
      });

      setNewDocTypeName("");
      setNewDocTypeKey("");
    }, "Doc type created.");
  }

  return (
    <main className="mx-auto max-w-300 px-4 py-6 md:px-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Extract Lab</h1>
          <p className="mt-1 text-sm text-gray-600">
            Build, test, and compare structured document extraction workflows using LLMs.
          </p>
        </div>
        <div className="badge bg-teal-50 text-teal-800">Doc Type Hub</div>
      </header>

      <NoticeBanner notice={notice} />

      <section className="panel p-4">
        <h2 className="text-base font-semibold">Create Doc Type</h2>
        <p className="mt-1 text-xs text-gray-600">
          A Doc Type groups Documents, Prompts, Schema Versions, and Runs for one extraction workflow.
        </p>
        <form onSubmit={handleCreateDocType} className="mt-3 grid gap-2 md:grid-cols-[1fr_1fr_auto]">
          <input
            className="input"
            placeholder="Name (e.g. Invoice)"
            value={newDocTypeName}
            onChange={(event) => setNewDocTypeName(event.target.value)}
          />
          <input
            className="input font-mono"
            placeholder="Key (e.g. invoice)"
            value={newDocTypeKey}
            onChange={(event) => setNewDocTypeKey(event.target.value)}
          />
          <button className="btn btn-primary" type="submit">
            Create
          </button>
        </form>
      </section>

      <section className="panel mt-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">Doc Types</h2>
          <div className="text-xs text-gray-600">{filteredDocTypes.length} shown</div>
        </div>

        <div className="mt-3">
          <input
            className="input"
            placeholder="Search by name or key"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <div className="mt-4 space-y-2">
          {filteredDocTypes.map((docType: any) => {
            const isExpanded = Boolean(expanded[docType._id]);
            const hasLinks =
              docType.documentCount > 0 || docType.promptCount > 0 || docType.runCount > 0;
            const canDelete = docType.canDelete ?? !hasLinks;
            const deleteDisabledReason =
              docType.deletionDisabledReason ??
              (hasLinks ? "Delete linked Documents, Prompts, and Runs first." : "");

            return (
              <div key={docType._id} className="rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <button
                    type="button"
                    className="flex-1 text-left"
                    onClick={() => {
                      setExpanded((previous) => ({
                        ...previous,
                        [docType._id]: !previous[docType._id],
                      }));
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="font-medium">{docType.name}</div>
                      <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">{docType.key}</code>
                      <span
                        className={`badge ${
                          docType.isSchemaSupported
                            ? "bg-emerald-50 text-emerald-800"
                            : "bg-gray-50 text-gray-700"
                        }`}
                      >
                        {docType.isSchemaSupported ? "Schema ready" : "No schema yet"}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-gray-600">
                      {docType.documentCount} Documents • {docType.promptCount} Prompts • {docType.runCount} Runs
                    </div>
                    <div className="mt-1 text-xs text-gray-500">
                      Last activity: {formatDate(docType.lastActivityAt)}
                    </div>
                  </button>

                  <div className="flex gap-2">
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => {
                        setExpanded((previous) => ({
                          ...previous,
                          [docType._id]: !previous[docType._id],
                        }));
                      }}
                    >
                      {isExpanded ? "Hide" : "Details"}
                    </button>
                    <Link
                      to="/doc-types/$docTypeKey"
                      params={{ docTypeKey: docType.key }}
                      search={{ tab: "docs" }}
                      className="btn btn-primary"
                    >
                      Open Workspace
                    </Link>
                  </div>
                </div>

                {isExpanded ? (
                  <div className="mt-3 space-y-3 rounded-md border border-gray-200 bg-gray-50 p-3">
                    <div className="text-xs text-gray-600">
                      {docType.isSchemaSupported
                        ? `Schema Versions: ${docType.schemaVersions.join(", ")}`
                        : "Runs are unavailable until this Doc Type is added to the schema registry. You can still add Documents and Prompts."}
                    </div>
                    <div className="text-xs text-gray-500">
                      Created: {formatDate(docType.createdAt)} • Updated: {formatDate(docType.updatedAt)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={async () => {
                          const nextName = window.prompt("New Doc Type name", docType.name);
                          if (!nextName) return;

                          await withFeedback(async () => {
                            await updateDocTypeName({ id: docType._id, name: nextName });
                          }, "Doc type name updated.");
                        }}
                      >
                        Rename
                      </button>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        disabled={!canDelete}
                        title={canDelete ? "Delete Doc Type" : deleteDisabledReason}
                        onClick={async () => {
                          await withFeedback(async () => {
                            await deleteDocType({ id: docType._id });
                          }, "Doc type deleted.");
                        }}
                      >
                        Delete
                      </button>
                      <TooltipHint reason={!canDelete ? deleteDisabledReason : null} />
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}

          {filteredDocTypes.length === 0 ? (
            <EmptyState
              title={search.trim() ? "No Doc Types match your search" : "Create your first Doc Type"}
              description={
                search.trim()
                  ? "Clear the search to see all Doc Types, or create a new one above."
                  : "Start with Invoice if you want to try the bundled example workflow."
              }
            />
          ) : null}
        </div>
      </section>
    </main>
  );
}

function formatDate(ts: number | undefined) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}
