import type { ReactNode } from "react";
import { ChevronUp, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "../ui/button";
import { Tooltip } from "../ui/misc";

/** Height or width of a collapsed playground pane, in pixels: room for its expand button. */
export const COLLAPSED_PX = 40;

/** The button in a pane's header that folds the pane away. Plain text, so it can't be mistaken for a menu. */
export function CollapseButton({ label, onClick }: { label: string; vertical?: boolean; onClick: () => void }) {
  return (
    <Tooltip content={`Hide ${label} to make room. Click its bar to bring it back.`}>
      <Button variant="ghost" size="sm" aria-label={`Hide ${label}`} onClick={onClick} className="px-2 text-muted">
        Hide
      </Button>
    </Tooltip>
  );
}

/**
 * What a collapsed pane shows: its name and a button to bring it back. Side-by-side panes fold
 * into a narrow column; stacked panes fold into a bar.
 */
export function CollapsedPane({
  label,
  detail,
  vertical,
  onExpand,
}: {
  label: string;
  /** Extra context, e.g. which document is open. */
  detail?: ReactNode;
  vertical?: boolean;
  onExpand: () => void;
}) {
  if (vertical) {
    return (
      <button
        type="button"
        onClick={onExpand}
        className="fade-in flex h-full w-full items-center gap-2 bg-panel px-3 text-left text-xs text-muted hover:bg-hover hover:text-ink"
        aria-label={`Show ${label}`}
      >
        <ChevronUp className="size-3.5 shrink-0" />
        <span className="font-medium text-ink-2">{label}</span>
        {detail ? <span className="min-w-0 truncate text-faint">{detail}</span> : null}
        <span className="ml-auto shrink-0 text-faint">Show</span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onExpand}
      className={cn("fade-in flex h-full w-full flex-col items-center gap-3 bg-panel py-2.5 text-xs text-muted hover:bg-hover hover:text-ink")}
      aria-label={`Show ${label}`}
    >
      <PanelLeftOpen className="size-4 shrink-0" />
      <span className="font-medium text-ink-2 [writing-mode:vertical-rl]">{label}</span>
      {detail ? <span className="min-h-0 truncate text-faint [writing-mode:vertical-rl]">{detail}</span> : null}
    </button>
  );
}
