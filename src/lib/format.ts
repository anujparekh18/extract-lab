export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** $0.0021, $0.12, $4.50 — enough precision to compare per-document costs. */
export function formatUsd(value: number | undefined | null) {
  if (value === undefined || value === null) return "—";
  if (value === 0) return "$0";
  if (value < 0.0001) return "<$0.0001";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

/** Cost of running this per-document cost on 1,000 documents. */
export function formatPer1k(value: number | undefined | null) {
  if (value === undefined || value === null) return "—";
  return `${formatUsd(value * 1000)} / 1k docs`;
}

export function formatMs(ms: number | undefined | null) {
  if (ms === undefined || ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}

export function formatTokens(value: number | undefined | null) {
  if (value === undefined || value === null) return "—";
  if (value < 1000) return String(value);
  return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
}

export function formatPercent(value: number | undefined | null, digits = 0) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatRelative(ts: number | undefined | null, now = Date.now()) {
  if (!ts) return "—";
  const seconds = Math.round((ts - now) / 1000);
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(seconds / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86_400) return relative.format(Math.round(seconds / 86_400), "day");
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(ts: number | undefined | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
