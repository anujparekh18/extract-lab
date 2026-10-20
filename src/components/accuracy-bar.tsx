import { cn } from "@/lib/cn";
import { formatPercent } from "@/lib/format";

/** "25/26 correct" with a bar; falls back to a percentage when counts aren't known. */
export function AccuracyBar({
  value,
  matched,
  total,
  className,
}: {
  value: number | null;
  matched?: number;
  total?: number;
  className?: string;
}) {
  if (value === null) return <span className="text-faint">—</span>;
  const tone = value >= 0.98 ? "bg-ok" : value >= 0.85 ? "bg-warn" : "bg-bad";
  const counted = matched !== undefined && total !== undefined;
  return (
    <div className={cn("flex items-center gap-2.5", className)} title={counted ? formatPercent(value, 1) : undefined}>
      <span className="tabular min-w-12 whitespace-nowrap text-[13px] font-medium text-ink">
        {counted ? `${matched}/${total}` : formatPercent(value, 1)}
      </span>
      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-line">
        <span className={cn("block h-full rounded-full", tone)} style={{ width: `${value * 100}%` }} />
      </span>
    </div>
  );
}
