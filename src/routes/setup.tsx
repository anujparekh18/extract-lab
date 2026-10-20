import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, ChevronRight, CircleDashed, ExternalLink } from "lucide-react";
import { CopyButton } from "@/components/code-block";
import { Spinner } from "@/components/ui/misc";
import { ModelSettings } from "@/components/model-settings";
import { cn } from "@/lib/cn";
import { useModels, useSetup } from "@/lib/hooks";
import { PROVIDERS, pickerModels } from "@/lib/models";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});

function SetupPage() {
  const setup = useSetup();
  // Same count the Models list shows before "Show older".
  const models = pickerModels(useModels());
  const count = (provider: string) => models.filter((m) => m.provider === provider).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-medium tracking-[-0.015em]">Setup</h1>
        <p className="mt-1 text-muted">Keys live in your Convex deployment and never reach the browser.</p>

        {setup.loading ? (
          <div className="mt-10 flex justify-center text-muted">
            <Spinner />
          </div>
        ) : (
          <>
            <Section title="API keys" description="Add at least one model provider. The rest are optional.">
              {Object.values(PROVIDERS).map((provider) => (
                <KeyRow
                  key={provider.id}
                  title={provider.label}
                  summary={`${count(provider.id)} models`}
                  ok={Boolean(setup.providers?.[provider.id])}
                  envVar={provider.envVar}
                  href={provider.keyUrl}
                />
              ))}
              <KeyRow
                title="Endpoint key"
                summary="Optional · protects the HTTP endpoint"
                ok={setup.apiKeyRequired}
                okLabel="Required"
                missingLabel="Open"
                envVar="EXTRACT_LAB_API_KEY"
                value="$(openssl rand -hex 24)"
              />
            </Section>

            <Section title="Models" description="Synced daily from models.dev. Hide models you don't use or correct a price; your edits win.">
              <ModelSettings />
            </Section>
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-[14px] font-medium">{title}</h2>
      <p className="mt-0.5 text-xs text-muted">{description}</p>
      <div className="mt-3 overflow-hidden rounded-lg border border-line bg-panel">{children}</div>
    </section>
  );
}

/** One key: a single line when it's set; a missing one expands to the command that sets it. */
function KeyRow({
  title,
  summary,
  ok,
  envVar,
  href,
  value = "<your key>",
  okLabel = "Connected",
  missingLabel = "Not set",
}: {
  title: string;
  summary: string;
  ok: boolean;
  envVar: string;
  href?: string;
  value?: string;
  okLabel?: string;
  missingLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const command = `bunx convex env set ${envVar} ${value}`;
  const status = (
    <>
      {ok ? <CheckCircle2 className="size-4 shrink-0 text-ok" /> : <CircleDashed className="size-4 shrink-0 text-faint" />}
      <span className="shrink-0 text-[13px] font-medium">{title}</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted">{summary}</span>
      <span className={cn("shrink-0 text-xs", ok ? "text-ok" : "text-faint")}>{ok ? okLabel : missingLabel}</span>
    </>
  );

  if (ok) return <div className="flex items-center gap-3 border-b border-line/70 px-4 py-2.5 last:border-0">{status}</div>;

  return (
    <div className="border-b border-line/70 last:border-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-sunken/60"
      >
        {status}
        <ChevronRight className={cn("size-3.5 shrink-0 text-faint transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-11">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-md bg-sunken py-1 pl-3 pr-1">
            <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{command}</code>
            <CopyButton text={command} />
          </div>
          {href ? (
            <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs link">
              Get a key <ExternalLink className="size-3" />
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
