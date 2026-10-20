import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./ui/button";

export function CopyButton({ text, label = "Copy", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="ghost"
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // Clipboard blocked; nothing else to do.
        }
      }}
    >
      {copied ? <Check /> : <Copy />}
      {copied ? "Copied" : label}
    </Button>
  );
}

export function CodeBlock({ code, className, maxHeight }: { code: string; className?: string; maxHeight?: number }) {
  return (
    <div className={cn("relative rounded-lg border border-line bg-sunken", className)}>
      <CopyButton text={code} className="absolute right-2 top-2 bg-sunken/90" />
      <pre
        className="overflow-auto p-4 pr-24 font-mono text-[12px] leading-[19px] text-ink-2"
        style={maxHeight ? { maxHeight } : undefined}
      >
        {code}
      </pre>
    </div>
  );
}
