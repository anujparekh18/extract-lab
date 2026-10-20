import { useMemo } from "react";
import { cn } from "@/lib/cn";

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

/** Pretty JSON with light syntax colouring. No dependencies, safe for large outputs. */
export function JsonView({ value, className }: { value: unknown; className?: string }) {
  const parts = useMemo(() => {
    const text = value === undefined ? "" : JSON.stringify(value, null, 2);
    const out: Array<{ text: string; className?: string }> = [];
    let last = 0;
    for (const match of text.matchAll(TOKEN)) {
      const index = match.index ?? 0;
      if (index > last) out.push({ text: text.slice(last, index) });
      if (match[1] && match[2]) {
        out.push({ text: match[1], className: "text-ink-2" });
        out.push({ text: match[2] });
      } else if (match[1]) out.push({ text: match[1], className: "text-ok" });
      else if (match[3]) out.push({ text: match[0], className: "text-warn" });
      else if (match[0] === "null") out.push({ text: match[0], className: "text-faint" });
      else out.push({ text: match[0], className: "text-accent" });
      last = index + match[0].length;
    }
    if (last < text.length) out.push({ text: text.slice(last) });
    return out;
  }, [value]);

  return (
    <pre className={cn("whitespace-pre-wrap break-words font-mono text-[12px] leading-[19px] text-muted", className)}>
      {parts.map((part, i) =>
        part.className ? (
          <span key={i} className={part.className}>
            {part.text}
          </span>
        ) : (
          part.text
        ),
      )}
    </pre>
  );
}
