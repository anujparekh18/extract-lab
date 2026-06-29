import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { NoticeBanner } from "@/components/ui/feedback";

export const Route = createFileRoute("/doc-types/$docTypeKey/prompts/$promptId/edit")({
  component: EditPromptPage,
});

type Notice = {
  type: "success" | "error";
  text: string;
};

function EditPromptPage() {
  const navigate = useNavigate();
  const { docTypeKey, promptId } = Route.useParams();

  const docType = useQuery(api.docTypes.getByKey, { key: docTypeKey });
  const prompt = useQuery(api.prompts.get, { id: promptId as any });
  const updatePrompt = useMutation(api.prompts.update);

  const [notice, setNotice] = useState<Notice | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!prompt) return;
    setName(prompt.name);
    setText(prompt.text);
  }, [prompt]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();

    setSaving(true);
    try {
      await updatePrompt({
        id: promptId as any,
        name,
        text,
      });

      setNotice({ type: "success", text: "Prompt updated." });
      await navigate({
        to: "/doc-types/$docTypeKey",
        params: { docTypeKey },
        search: { tab: "prompts" },
      });
    } catch (error) {
      setNotice({
        type: "error",
        text: error instanceof Error ? error.message : "Failed to update Prompt.",
      });
    } finally {
      setSaving(false);
    }
  }

  if (docType === undefined || prompt === undefined) {
    return (
      <main className="mx-auto max-w-[1000px] px-4 py-6 md:px-8">
        <div className="panel p-6 text-sm text-gray-600">Loading Prompt...</div>
      </main>
    );
  }

  if (docType === null || prompt === null || prompt.docTypeKey !== docTypeKey) {
    return (
      <main className="mx-auto max-w-[1000px] px-4 py-6 md:px-8">
        <div className="panel p-6">
          <h1 className="text-lg font-semibold">Prompt not found</h1>
          <p className="mt-2 text-sm text-gray-600">The Prompt could not be loaded for this Doc Type.</p>
          <Link to="/doc-types/$docTypeKey" params={{ docTypeKey }} search={{ tab: "prompts" }} className="btn btn-primary mt-4">
            Back to Prompts
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
          <span>Edit</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold">Edit Prompt</h1>
      </header>

      <NoticeBanner notice={notice} />

      <section className="panel p-4">
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-gray-600">Prompt Name</label>
            <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="Prompt name" />
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
              {saving ? "Saving..." : "Update Prompt"}
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
