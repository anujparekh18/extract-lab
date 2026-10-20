import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { buildCatalog, visibleModels, type CatalogModel, type ModelInfo } from "./models";

/** The model catalog from the database (see components/models-provider). Defaults until it loads. */
export const ModelsContext = createContext<CatalogModel[]>(buildCatalog([]));

/** Every model, including hidden ones. Use `visibleModels()` for pickers. */
export function useModels() {
  return useContext(ModelsContext);
}

/** Runs `handler` on a key combo like "mod+enter" or "mod+s". `mod` is ⌘ on macOS, Ctrl elsewhere. */
export function useHotkey(combo: string, handler: (event: KeyboardEvent) => void, enabled = true) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split("+");
    const key = parts.pop();
    const wantMod = parts.includes("mod");
    const wantShift = parts.includes("shift");
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (wantMod !== mod || wantShift !== event.shiftKey) return;
      if (event.key.toLowerCase() !== key) return;
      event.preventDefault();
      handlerRef.current(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [combo, enabled]);
}

export function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
}

export function modKey() {
  return isMac() ? "⌘" : "Ctrl";
}

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------

export type ThemeChoice = "system" | "light" | "dark";
const THEME_KEY = "extract-lab-theme";
const themeListeners = new Set<() => void>();

function readTheme(): ThemeChoice {
  try {
    const raw = window.localStorage.getItem(THEME_KEY);
    return raw === "light" || raw === "dark" ? raw : "system";
  } catch {
    return "system";
  }
}

export function applyTheme(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

export function useTheme() {
  const choice = useSyncExternalStore(
    (listener) => {
      themeListeners.add(listener);
      return () => themeListeners.delete(listener);
    },
    readTheme,
    () => "system" as ThemeChoice,
  );
  useEffect(() => {
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [choice]);
  const setChoice = useCallback((next: ThemeChoice) => {
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked.
    }
    applyTheme(next);
    themeListeners.forEach((listener) => listener());
  }, []);
  return [choice, setChoice] as const;
}

/** Runs before first paint (inlined in <head>) so the page never flashes the wrong theme. */
export const THEME_BOOT_SCRIPT = `(function(){try{var c=localStorage.getItem("${THEME_KEY}");var d=c==="dark"||(c!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.dataset.theme=d?"dark":"light"}catch(e){}})();`;

// ---------------------------------------------------------------------------
// Setup (which providers have keys)
// ---------------------------------------------------------------------------

export function useSetup() {
  const setup = useQuery(api.api.setup, {});
  const models = useModels();
  const available = (model: ModelInfo) => Boolean(setup?.providers[model.provider]);
  return {
    loading: setup === undefined,
    providers: setup?.providers,
    apiKeyRequired: setup?.apiKeyRequired ?? false,
    availableModels: visibleModels(models).filter(available),
    isModelAvailable: (id: string) => {
      const provider = id.split("/")[0] as keyof NonNullable<typeof setup>["providers"];
      return Boolean(setup?.providers[provider]);
    },
  };
}

// ---------------------------------------------------------------------------
// Media queries
// ---------------------------------------------------------------------------

/** Whether a CSS media query matches, e.g. "(min-width: 1024px)". False during server rendering. */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
