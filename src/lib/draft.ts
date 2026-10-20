import type { Field } from "./fields";

/** What the playground runs: the prompt and fields being edited, and the model. */
export type Draft = {
  prompt: string;
  fields: Field[];
  model: string;
};

/** Where the playground keeps an extractor's unsaved draft, so a refresh doesn't lose edits. */
export function draftKey(extractorId: string) {
  return `extract-lab:draft:${extractorId}`;
}

/** Puts a draft in the playground, for opening it from another page. Returns false when storage is unavailable. */
export function storeDraft(extractorId: string, draft: Draft) {
  try {
    window.localStorage.setItem(draftKey(extractorId), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/** The draft the playground will open with: the stored one if there is one, else `fallback`. */
export function readDraft(extractorId: string, fallback: Draft): Draft {
  try {
    const raw = window.localStorage.getItem(draftKey(extractorId));
    if (!raw) return fallback;
    const saved = JSON.parse(raw) as Partial<Draft>;
    return {
      prompt: saved.prompt ?? fallback.prompt,
      fields: saved.fields ?? fallback.fields,
      model: saved.model ?? fallback.model,
    };
  } catch {
    return fallback;
  }
}
