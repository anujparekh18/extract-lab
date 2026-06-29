import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export const Route = createFileRoute("/doc-types/$docTypeKey/prompts/$promptId/view")({
  component: ViewPromptPage,
});

function ViewPromptPage() {
  const { docTypeKey, promptId } = Route.useParams();

  const docType = useQuery(api.docTypes.getByKey, { key: docTypeKey });
  const prompt = useQuery(api.prompts.get, { id: promptId as any });

  if (docType === undefined || prompt === undefined) {
    return (
      <main className="mx-auto max-w-250 px-4 py-6 md:px-8">
        <div className="panel p-6 text-sm text-gray-600">Loading prompt...</div>
      </main>
    );
  }

  if (docType === null || prompt === null || prompt.docTypeKey !== docTypeKey) {
    return (
      <main className="mx-auto max-w-250 px-4 py-6 md:px-8">
        <div className="panel p-6">
          <h1 className="text-lg font-semibold">Prompt not found</h1>
          <p className="mt-2 text-sm text-gray-600">The prompt could not be loaded for this doc type.</p>
          <Link
            to="/doc-types/$docTypeKey"
            params={{ docTypeKey }}
            search={{ tab: "prompts" }}
            className="btn btn-primary mt-4"
          >
            Back To Prompts
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-250 px-4 py-6 md:px-8">
      <header className="mb-4">
        <div className="text-sm text-gray-600">
          <Link to="/" className="text-teal-700 underline underline-offset-2">
            Doc Type Hub
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <Link
            to="/doc-types/$docTypeKey"
            params={{ docTypeKey }}
            search={{ tab: "prompts" }}
            className="text-teal-700 underline underline-offset-2"
          >
            {docType.name} Prompts
          </Link>
          <span className="mx-2 text-gray-400">/</span>
          <span>View</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold">{prompt.name}</h1>
        <p className="mt-1 text-xs text-gray-500">
          Created: {formatDate(prompt.createdAt)} • Updated: {formatDate(prompt.updatedAt)}
        </p>
      </header>

      <section className="panel p-4">
        <div className="mb-2 text-xs font-medium text-gray-700">Prompt Text</div>
        <div className="max-h-[70vh] overflow-auto rounded-lg border border-gray-200 bg-gray-50 p-4">
          <article className="markdown text-sm">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{prompt.text}</ReactMarkdown>
          </article>
        </div>

        <div className="mt-4 flex gap-2">
          <Link
            to="/doc-types/$docTypeKey/prompts/$promptId/edit"
            params={{ docTypeKey, promptId }}
            search={{ tab: "prompts" }}
            className="btn btn-primary"
          >
            Edit Prompt
          </Link>
          <Link
            to="/doc-types/$docTypeKey"
            params={{ docTypeKey }}
            search={{ tab: "prompts" }}
            className="btn btn-secondary"
          >
            Back To Prompts
          </Link>
        </div>
      </section>
    </main>
  );
}

function formatDate(ts: number | undefined) {
  if (!ts) return "-";
  return new Date(ts).toLocaleString();
}
