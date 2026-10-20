import { createContext, useContext } from "react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "@convex/_generated/api";

export type Extractor = NonNullable<FunctionReturnType<typeof api.extractors.getBySlug>>;

export const ExtractorContext = createContext<Extractor | null>(null);

export function useExtractor() {
  const extractor = useContext(ExtractorContext);
  if (!extractor) throw new Error("useExtractor must be used inside /x/$slug");
  return extractor;
}
