import type { ReactNode } from "react";

type Notice = {
  type: "success" | "error";
  text: string;
};

export function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;

  return (
    <div
      className={`mb-4 rounded-md border px-3 py-2 text-sm ${
        notice.type === "success"
          ? "border-emerald-200 bg-emerald-50 text-emerald-900"
          : "border-red-200 bg-red-50 text-red-900"
      }`}
    >
      {notice.text}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-6 text-sm",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="font-medium text-gray-900">{title}</div>
      <p className="mt-1 max-w-2xl text-gray-600">{description}</p>
      {children ? <div className="mt-3 flex flex-wrap gap-2">{children}</div> : null}
    </div>
  );
}

export function TooltipHint({
  reason,
  label = "i",
}: {
  reason?: string | null;
  label?: string;
}) {
  if (!reason) return null;

  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        className="inline-flex h-8 min-w-8 items-center justify-center rounded-md border border-gray-200 bg-gray-50 px-2 text-xs font-semibold text-gray-600 hover:bg-white focus:outline-none focus:ring-2 focus:ring-teal-600/25"
        aria-label={reason}
        title={reason}
      >
        {label}
      </button>
      <span className="pointer-events-none invisible absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-md border border-gray-200 bg-white px-3 py-2 text-xs font-normal leading-snug text-gray-700 opacity-0 shadow-lg transition group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        {reason}
      </span>
    </span>
  );
}

export function HelperCallout({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="font-medium text-gray-900">{title}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}
