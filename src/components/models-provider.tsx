import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useAction, useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { ModelsContext } from "@/lib/hooks";
import { buildCatalog, setModelCatalog } from "@/lib/models";

/**
 * Loads the model catalog (synced from models.dev, plus Setup page edits) and keeps the
 * synchronous helpers in lib/models, like `modelLabel`, in step with it. On a fresh install it
 * starts the first download so nobody waits for the daily sync.
 */
export function ModelsProvider({ children }: { children: ReactNode }) {
  const data = useQuery(api.models.list, {});
  const status = useQuery(api.modelCatalog.status, {});
  const refresh = useAction(api.modelCatalog.refresh);
  const requested = useRef(false);

  useEffect(() => {
    if (!status || status.attemptedAt !== null || requested.current) return;
    requested.current = true;
    refresh({}).catch(() => {
      // The built-in models keep working; Setup shows the sync error.
    });
  }, [status, refresh]);

  const catalog = useMemo(() => data ?? buildCatalog([]), [data]);
  // Updated during render, before children read it, so labels never lag a render behind.
  setModelCatalog(catalog);
  return <ModelsContext.Provider value={catalog}>{children}</ModelsContext.Provider>;
}
