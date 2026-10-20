import { useEffect, useState, type ReactNode } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { Menu as MenuIcon, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Plus, Settings2, Sun, X } from "lucide-react";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/cn";
import { modKey, useHotkey, useSetup, useTheme, type ThemeChoice } from "@/lib/hooks";
import { Button } from "./ui/button";
import { Spinner, Tooltip } from "./ui/misc";
import { NewExtractorDialog } from "./new-extractor-dialog";
import { ExtractMark, MiraiCredit } from "./brand";

const COLLAPSED_KEY = "extract-lab:sidebar-collapsed";

/** Whether the sidebar is collapsed to a rail on wide screens, remembered in this browser. */
function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(false);
  // Read after mount so the server render and the first client render agree.
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
    } catch {
      // Storage blocked: start expanded.
    }
  }, []);
  const toggle = () =>
    setCollapsed((current) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1");
      } catch {
        // Storage blocked: the choice lasts until reload.
      }
      return !current;
    });
  return [collapsed, toggle] as const;
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, toggleCollapsed] = useSidebarCollapsed();
  useHotkey("mod+\\", toggleCollapsed);
  return (
    <div className="flex h-dvh overflow-hidden">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 w-60 shrink-0 border-r border-line bg-panel transition-transform md:static md:translate-x-0",
          mobileOpen ? "translate-x-0 shadow-pop" : "-translate-x-full",
          collapsed && "md:hidden",
        )}
      >
        <div className="fade-in h-full">
          <Sidebar onNavigate={() => setMobileOpen(false)} onCollapse={toggleCollapsed} />
        </div>
      </aside>
      {collapsed ? (
        <aside className="fade-in hidden w-12 shrink-0 border-r border-line bg-panel md:block">
          <Rail onExpand={toggleCollapsed} />
        </aside>
      ) : null}
      {mobileOpen ? (
        <div className="fixed inset-0 z-20 bg-black/20 md:hidden" onClick={() => setMobileOpen(false)} />
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 items-center gap-2 border-b border-line bg-panel px-3 md:hidden">
          <Button variant="ghost" size="sm" icon aria-label="Open menu" onClick={() => setMobileOpen(true)}>
            <MenuIcon />
          </Button>
          <Wordmark />
        </div>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </div>
  );
}

function Wordmark() {
  return (
    <Link to="/" className="flex items-center gap-2 text-[14px] font-medium tracking-[-0.01em] text-ink">
      <ExtractMark />
      extract lab
    </Link>
  );
}

function Sidebar({ onNavigate, onCollapse }: { onNavigate: () => void; onCollapse: () => void }) {
  const extractors = useQuery(api.extractors.list, {});
  const activeRuns = useQuery(api.runs.activeCount, {});
  const params = useParams({ strict: false }) as { slug?: string };
  const [creating, setCreating] = useState(false);
  const setup = useSetup();
  const needsSetup = !setup.loading && setup.availableModels.length === 0;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 items-center justify-between px-4">
        <Wordmark />
        <Button variant="ghost" size="sm" icon aria-label="Close menu" className="md:hidden" onClick={onNavigate}>
          <X />
        </Button>
        <Tooltip content={<>Collapse sidebar ({modKey()} {"\\"})</>}>
          <Button variant="ghost" size="sm" icon aria-label="Collapse sidebar" className="hidden md:inline-flex" onClick={onCollapse}>
            <PanelLeftClose />
          </Button>
        </Tooltip>
      </div>

      <div className="px-3 pb-2">
        <Button className="w-full justify-start" onClick={() => setCreating(true)}>
          <Plus />
          New extractor
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="px-2 pb-1 pt-3 eyebrow text-faint">Extractors</div>
        {extractors === undefined ? (
          <div className="space-y-1 px-2 py-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-sunken" />
            ))}
          </div>
        ) : extractors.length === 0 ? (
          <p className="px-2 py-1 text-xs text-muted">None yet.</p>
        ) : (
          extractors.map((extractor) => (
            <Link
              key={extractor._id}
              to="/x/$slug"
              params={{ slug: extractor.slug }}
              onClick={onNavigate}
              className={cn(
                "group flex h-8 items-center justify-between gap-2 rounded-md px-2 text-[13px] transition-colors",
                params.slug === extractor.slug ? "bg-accent-soft font-medium text-ink" : "text-ink-2 hover:bg-hover hover:text-ink",
              )}
            >
              <span className="truncate">{extractor.name}</span>
              <span className="tabular text-2xs text-faint group-hover:text-muted">{extractor.documentCount || ""}</span>
            </Link>
          ))
        )}
      </nav>

      <div className="border-t border-line p-2">
        {activeRuns ? (
          <div className="mb-1 flex h-8 items-center gap-2 px-2 text-xs text-muted">
            <Spinner className="text-accent" />
            {activeRuns === 1 ? "1 extraction running" : `${activeRuns} extractions running`}
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <Link
            to="/setup"
            onClick={onNavigate}
            className="flex h-8 flex-1 items-center gap-2 rounded-md px-2 text-[13px] text-ink-2 hover:bg-hover hover:text-ink [&.active]:bg-hover [&.active]:text-ink"
          >
            <Settings2 className="size-4 text-muted" />
            Setup
            {needsSetup ? <span className="ml-auto size-1.5 rounded-full bg-warn" aria-label="Needs attention" /> : null}
          </Link>
          <ThemeToggle />
        </div>
        <MiraiCredit className="mt-1 px-2 py-1.5" />
      </div>
      <NewExtractorDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** The collapsed sidebar: the same destinations as icons, so collapsing never hides anything. */
function Rail({ onExpand }: { onExpand: () => void }) {
  const extractors = useQuery(api.extractors.list, {});
  const activeRuns = useQuery(api.runs.activeCount, {});
  const params = useParams({ strict: false }) as { slug?: string };
  const [creating, setCreating] = useState(false);
  const setup = useSetup();
  const needsSetup = !setup.loading && setup.availableModels.length === 0;

  return (
    <div className="flex h-full flex-col items-center py-2">
      <Tooltip content={<>Expand sidebar ({modKey()} {"\\"})</>} side="right">
        <Button variant="ghost" size="md" icon aria-label="Expand sidebar" onClick={onExpand}>
          <PanelLeftOpen />
        </Button>
      </Tooltip>
      <Tooltip content="New extractor" side="right">
        <Button variant="ghost" size="md" icon aria-label="New extractor" className="mt-1" onClick={() => setCreating(true)}>
          <Plus />
        </Button>
      </Tooltip>
      <nav className="mt-2 flex min-h-0 w-full flex-1 flex-col items-center gap-1 overflow-y-auto border-t border-line pt-2">
        {(extractors ?? []).map((extractor) => (
          <Tooltip key={extractor._id} content={extractor.name} side="right">
            <Link
              to="/x/$slug"
              params={{ slug: extractor.slug }}
              aria-label={extractor.name}
              className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md text-[12px] font-medium uppercase transition-colors",
                params.slug === extractor.slug ? "bg-accent-soft text-ink" : "text-muted hover:bg-hover hover:text-ink",
              )}
            >
              {initials(extractor.name)}
            </Link>
          </Tooltip>
        ))}
      </nav>
      <div className="flex flex-col items-center gap-1 border-t border-line pt-2">
        {activeRuns ? (
          <Tooltip content={activeRuns === 1 ? "1 extraction running" : `${activeRuns} extractions running`} side="right">
            <span className="flex size-8 items-center justify-center">
              <Spinner className="text-accent" />
            </span>
          </Tooltip>
        ) : null}
        <Tooltip content="Setup" side="right">
          <Link
            to="/setup"
            aria-label="Setup"
            className="relative flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink [&.active]:bg-hover [&.active]:text-ink"
          >
            <Settings2 className="size-4" />
            {needsSetup ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-warn" aria-label="Needs attention" /> : null}
          </Link>
        </Tooltip>
        <ThemeToggle />
      </div>
      <NewExtractorDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** "Support emails" → "SE", "Invoices" → "IN". */
function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "?").slice(0, 2).toUpperCase();
}

function ThemeToggle() {
  const [choice, setChoice] = useTheme();
  const order: ThemeChoice[] = ["system", "light", "dark"];
  const next = order[(order.indexOf(choice) + 1) % order.length];
  const Icon = choice === "dark" ? Moon : choice === "light" ? Sun : Monitor;
  return (
    <Tooltip content={`Theme: ${choice}. Switch to ${next}.`}>
      <Button variant="ghost" size="md" icon aria-label="Change theme" onClick={() => setChoice(next)}>
        <Icon />
      </Button>
    </Tooltip>
  );
}
