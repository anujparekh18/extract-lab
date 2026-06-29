import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { NoticeBanner } from "@/components/ui/feedback";

export const Route = createFileRoute("/doc-types/$docTypeKey/prompts/new")({
  component: NewPromptPage,
});

type Notice = {
  type: "success" | "error";
  text: string;
};

function NewPromptPage() {
  const navigate = useNavigate();
  const { docTypeKey } = Route.useParams();

  const docType = useQuery(api.docTypes.getByKey, { key: docTypeKey });
  const createPrompt = useMutation(api.prompts.create);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    try {
      await createPrompt({
        docTypeKey,
        name,
        text,
      });

      setNotice({ type: "success", text: "Prompt created." });
      await navigate({
        to: "/doc-types/$docTypeKey",
        params: { docTypeKey },
        search: { tab: "prompts" },
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to create Prompt.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (docType === undefined) {
    return (
      <main className="mx-auto max-w-[1000px] px-4 py-6 md:px-8">
        <div className="panel p-6 text-sm text-gray-600">Loading Doc Type...</div>
      </main>
    );
  }

  if (docType === null) {
    return (
      <main className="mx-auto max-w-[1000px] px-4 py-6 md:px-8">
        <div className="panel p-6">
          <h1 className="text-lg font-semibold">Doc Type not found</h1>
          <Link to="/" className="btn btn-primary mt-4">
            Back to Hub
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1000px] px-4 py-6 md:px-8">
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
          <span>New</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold">New Prompt</h1>
      </header>

      <NoticeBanner notice={notice} />

      <section className="panel p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-600">Prompt Name</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Invoice extraction v1" />
          </div>

          <div>
            <label className="mb-1 block text-xs text-gray-600">Prompt Text</label>
            <textarea
              className="input min-h-[420px]"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Describe exactly what the Model should extract and how it should format the result."
            />
          </div>

          <div className="flex gap-2">
            <button className="btn btn-primary" type="submit" disabled={saving}>
              {saving ? "Saving..." : "Create Prompt"}
            </button>
            <Link to="/doc-types/$docTypeKey" params={{ docTypeKey }} search={{ tab: "prompts" }} className="btn btn-secondary">
              Cancel
            </Link>
          </div>
        </form>
      </section>
    </main>
  );
}
