import { useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowRight, KeyRound, Plus } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/misc";
import { NewExtractorDialog } from "@/components/new-extractor-dialog";
import { useSetup } from "@/lib/hooks";
import { formatRelative } from "@/lib/format";
import { TEMPLATES, defaultExtractorName } from "@/lib/templates";
import { errorMessage } from "@/lib/errors";
import { useCreateExtractor } from "@/lib/create-extractor";

export const Route = createFileRoute("/")({
  component: HomePage,
});

const LOOP = [
  { title: "Try", body: "Run a prompt and schema on a document. See every field next to the source." },
  { title: "Save correct answers", body: "Fix what the model got wrong and save it. Do this for a handful of documents." },
  { title: "Check accuracy", body: "Check any change against those answers: what got fixed, what broke." },
  { title: "Ship", body: "Copy typed code for your app, or call the built-in HTTP endpoint." },
];

function HomePage() {
  const extractors = useQuery(api.extractors.list, {});
  const setup = useSetup();
  const [creating, setCreating] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-10">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-xl font-medium tracking-[-0.015em]">Extractors</h1>
            <p className="mt-1 text-muted">Turn documents into JSON your code can trust, and know how often it's right.</p>
          </div>
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus />
            New extractor
          </Button>
        </header>

        {!setup.loading && setup.availableModels.length === 0 ? (
          <div className="mt-6 flex items-start gap-3 rounded-lg border border-warn/30 bg-warn-soft px-4 py-3">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-warn" />
            <div className="text-[13px]">
              <div className="font-medium text-ink">Add a model API key to run extractions</div>
              <p className="mt-0.5 text-ink-2">
                Keys live in your Convex deployment, never in the browser.{" "}
                <Link to="/setup" className="link font-medium">
                  See setup
                </Link>
              </p>
            </div>
          </div>
        ) : null}

        <ol className="mt-8 grid overflow-hidden rounded-lg border border-line bg-panel sm:grid-cols-2 lg:grid-cols-4">
          {LOOP.map((step, index) => (
            <li key={step.title} className="border-line p-4 max-lg:[&:nth-child(-n+2)]:border-b sm:[&:not(:last-child)]:border-r max-sm:border-b">
              <div className="flex items-center gap-2">
                <span className="tabular font-mono text-2xs text-faint">{String(index + 1).padStart(2, "0")}</span>
                <span className="text-[13px] font-medium">{step.title}</span>
              </div>
              <p className="mt-1.5 text-xs leading-[18px] text-muted">{step.body}</p>
            </li>
          ))}
        </ol>

        <div className="rule-dashed mt-10" aria-hidden />

        <section className="mt-8">
          {extractors === undefined ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-lg bg-sunken" />
              ))}
            </div>
          ) : extractors.length === 0 ? (
            <QuickStart />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {extractors.map((extractor) => (
                <Link
                  key={extractor._id}
                  to="/x/$slug"
                  params={{ slug: extractor.slug }}
                  className="group rounded-lg border border-line bg-panel p-4 transition-colors hover:border-line-strong"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-[14px] font-medium text-ink">{extractor.name}</div>
                      <div className="mt-0.5 font-mono text-2xs text-faint">/{extractor.slug}</div>
                    </div>
                    {extractor.isPublished ? <Badge tone="ok">Published</Badge> : null}
                  </div>
                  {extractor.description ? (
                    <p className="mt-2 line-clamp-2 text-xs leading-[18px] text-muted">{extractor.description}</p>
                  ) : null}
                  <div className="tabular mt-4 flex items-center gap-4 text-xs text-muted">
                    <span>
                      <span className="font-medium text-ink-2">{extractor.fieldCount}</span>{" "}
                      {extractor.fieldCount === 1 ? "field" : "fields"}
                    </span>
                    <span>
                      <span className="font-medium text-ink-2">{extractor.documentCount}</span>{" "}
                      {extractor.documentCount === 1 ? "document" : "documents"}
                    </span>
                    <span>
                      <span className="font-medium text-ink-2">{extractor.testCaseCount}</span>{" "}
                      with {extractor.testCaseCount === 1 ? "answer" : "answers"}
                    </span>
                    <span className="ml-auto text-faint">{formatRelative(extractor.lastActivityAt)}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <NewExtractorDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function QuickStart() {
  const existingNames = useQuery(api.extractors.list, {})?.map((e) => e.name) ?? [];
  const create = useCreateExtractor();
  const navigate = useNavigate();
  const [busy, setBusy] = useState<string | null>(null);
  const templates = TEMPLATES.filter((t) => t.id !== "blank");

  async function start(templateId: string, name: string) {
    setBusy(templateId);
    try {
      const slug = await create({ name, templateId });
      await navigate({ to: "/x/$slug", params: { slug } });
    } catch (error) {
      toast.error(errorMessage(error));
      setBusy(null);
    }
  }

  return (
    <div>
      <h2 className="text-[14px] font-medium">Start with an example</h2>
      <p className="mt-0.5 text-xs text-muted">Each one includes sample documents with correct answers, so you can check accuracy straight away.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={busy !== null}
            onClick={() => start(t.id, defaultExtractorName(t.name, existingNames))}
            className="group flex items-start justify-between gap-4 rounded-lg border border-line bg-panel p-4 text-left transition-colors hover:border-accent disabled:opacity-60"
          >
            <div>
              <div className="text-[14px] font-medium">{t.name}</div>
              <p className="mt-1 text-xs leading-[18px] text-muted">{t.description}</p>
            </div>
            <span className={buttonClass({ variant: "ghost", size: "sm", icon: true, className: "group-hover:text-accent" })}>
              <ArrowRight />
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
