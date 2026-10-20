import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { Spinner } from "./misc";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

const base =
  "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 select-none";

const variants: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:bg-accent-hover disabled:hover:bg-accent",
  secondary: "border border-line bg-panel text-ink hover:bg-hover disabled:hover:bg-panel",
  ghost: "text-ink-2 hover:bg-hover hover:text-ink disabled:hover:bg-transparent",
  danger: "bg-bad text-white hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2 text-xs [&_svg]:size-3.5",
  md: "h-8 px-3 text-[13px] [&_svg]:size-4",
};

const iconSizes: Record<Size, string> = {
  sm: "size-7 [&_svg]:size-3.5",
  md: "size-8 [&_svg]:size-4",
};

export function buttonClass({
  variant = "secondary",
  size = "md",
  icon = false,
  className,
}: { variant?: Variant; size?: Size; icon?: boolean; className?: string } = {}) {
  return cn(base, variants[variant], icon ? iconSizes[size] : sizes[size], className);
}

export function Button({
  variant,
  size,
  icon,
  loading,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ComponentProps<"button"> & {
  variant?: Variant;
  size?: Size;
  /** Square icon-only button. Pass `aria-label`. */
  icon?: boolean;
  loading?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type={type}
      className={buttonClass({ variant, size, icon, className })}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}
