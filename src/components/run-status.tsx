import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import type { Doc } from "@convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { Badge, Spinner } from "./ui/misc";

type Status = Doc<"runs">["status"];

export function RunStatusDot({ status }: { status: Status }) {
  if (status === "queued" || status === "running") {
    return <span className="pulse-dot size-1.5 rounded-full bg-accent" aria-label="Running" />;
  }
  if (status === "failed") return <span className="size-1.5 rounded-full bg-bad" aria-label="Last run failed" />;
  return <span className="size-1.5 rounded-full bg-ok" aria-label="Last run succeeded" />;
}

export function RunStatusBadge({ status, className }: { status: Status; className?: string }) {
  if (status === "queued") {
    return (
      <Badge className={className}>
        <CircleDashed /> Queued
      </Badge>
    );
  }
  if (status === "running") {
    return (
      <Badge tone="accent" className={className}>
        <Spinner className="size-3" /> Running
      </Badge>
    );
  }
  if (status === "failed") {
    return (
      <Badge tone="bad" className={className}>
        <XCircle /> Failed
      </Badge>
    );
  }
  return (
    <Badge tone="ok" className={className}>
      <CheckCircle2 /> Done
    </Badge>
  );
}

export function ScoreBadge({ matched, total, className }: { matched: number; total: number; className?: string }) {
  const accuracy = total ? matched / total : 1;
  const tone = accuracy === 1 ? "ok" : accuracy >= 0.8 ? "warn" : "bad";
  return (
    <Badge tone={tone} className={cn("tabular", className)} title="Answers that match this document's correct answer">
      {matched}/{total} correct
    </Badge>
  );
}
