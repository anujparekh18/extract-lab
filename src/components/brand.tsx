import { cn } from "@/lib/cn";

/**
 * Extract Lab's mark, drawn in the Mirai Gadget Lab tile style: an ink soft-square with
 * round strokes at the lab's micro-mark weight. Three document lines, one value picked out.
 * Keep in sync with the favicon in routes/__root.tsx.
 */
export function ExtractMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={cn("size-5", className)} aria-hidden="true">
      <rect x="12" y="12" width="232" height="232" rx="44" className="fill-ink" />
      <g fill="none" className="stroke-bg" strokeWidth="24" strokeLinecap="round">
        <path d="M66 84h124" />
        <path d="M66 128h58" />
        <path d="M66 172h124" />
      </g>
      <circle cx="176" cy="128" r="18" className="fill-bg" />
    </svg>
  );
}

/** The lab's 未 micro glyph, in currentColor. Geometry from miraigadgetlab.com's brand kit. */
export function MiraiGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 256 256" className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round">
        <path d="M128 55v148" />
        <path d="M70 87h116" />
        <path d="M58 130h140" />
        <path d="M125 142c-12 21-29 38-51 52" />
        <path d="M131 142c13 20 31 37 54 50" />
      </g>
    </svg>
  );
}

export const MIRAI_URL = "https://www.miraigadgetlab.com";

/** "a mirai gadget lab product", as every lab product signs itself. */
export function MiraiCredit({ className }: { className?: string }) {
  return (
    <a
      href={MIRAI_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={cn("inline-flex items-center gap-1.5 font-mono text-[10.5px] text-faint transition-colors hover:text-ink", className)}
    >
      <span className="flex size-3.5 items-center justify-center rounded-[3px] bg-ink text-bg">
        <MiraiGlyph className="size-2.5" />
      </span>
      a mirai gadget lab product
    </a>
  );
}
