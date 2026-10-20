import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

const field =
  "w-full rounded-md border border-line bg-panel px-2.5 text-[13px] text-ink placeholder:text-faint outline-none transition-colors hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={cn(field, "h-8", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(field, "py-2 leading-5", className)} {...props} />;
}

export function Label({
  children,
  hint,
  htmlFor,
  className,
}: {
  children: ReactNode;
  hint?: ReactNode;
  htmlFor?: string;
  className?: string;
}) {
  return (
    <label htmlFor={htmlFor} className={cn("mb-1.5 flex items-baseline justify-between gap-2", className)}>
      <span className="text-xs font-medium text-ink-2">{children}</span>
      {hint ? <span className="text-2xs text-muted">{hint}</span> : null}
    </label>
  );
}

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  label,
  id,
}: {
  checked: boolean;
  onCheckedChange: (value: boolean) => void;
  disabled?: boolean;
  label?: string;
  id?: string;
}) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
        checked ? "bg-accent" : "bg-line-strong",
      )}
    >
      <span
        className={cn(
          "inline-block size-3 rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** A compact segmented control. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string }>;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-md bg-sunken p-0.5", className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          title={option.title}
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-[5px] font-medium transition-colors [&_svg]:size-3.5",
            size === "sm" ? "h-6 px-2 text-xs" : "h-7 px-2.5 text-xs",
            value === option.value ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
