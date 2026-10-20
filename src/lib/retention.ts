/** How long documents sent to the HTTP endpoint, and what was extracted from them, are kept. */
export type ApiRetention = "none" | "7d" | "30d" | "forever";

export const DEFAULT_API_RETENTION: ApiRetention = "30d";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Age at which an endpoint document is deleted; null keeps it. "none" still waits an hour so callers can poll. */
export const API_RETENTION_MS: Record<ApiRetention, number | null> = {
  none: HOUR,
  "7d": 7 * DAY,
  "30d": 30 * DAY,
  forever: null,
};

export const API_RETENTION_LABELS: Record<ApiRetention, string> = {
  none: "Don't keep (deleted after 1 hour)",
  "7d": "7 days",
  "30d": "30 days",
  forever: "Forever",
};
