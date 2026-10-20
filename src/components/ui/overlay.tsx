import { createContext, useCallback, useContext, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Dialog as D, DropdownMenu as M, Popover as P, Select as S } from "radix-ui";
import { Check, ChevronDown, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

// ---------------------------------------------------------------------------
// Dialog
// ---------------------------------------------------------------------------

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = "max-w-lg",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]" />
        <D.Content
          className={cn(
            "pop-in fixed left-1/2 top-[12vh] z-50 flex max-h-[76vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-xl border border-line bg-panel shadow-pop outline-none",
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
            <div>
              <D.Title className="text-[15px] font-medium">{title}</D.Title>
              {description ? <D.Description className="mt-0.5 text-xs text-muted">{description}</D.Description> : null}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="sm" icon aria-label="Close">
                <X />
              </Button>
            </D.Close>
          </div>
          {children ? <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div> : null}
          {footer ? <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

// ---------------------------------------------------------------------------
// Confirm (imperative)
// ---------------------------------------------------------------------------

type ConfirmOptions = {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  danger?: boolean;
};

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(value: boolean) => void>(() => {});

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current(value);
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={options !== null}
        onOpenChange={(open) => !open && close(false)}
        title={options?.title ?? ""}
        width="max-w-md"
        footer={
          <>
            <Button onClick={() => close(false)}>Cancel</Button>
            <Button variant={options?.danger ? "danger" : "primary"} onClick={() => close(true)} autoFocus>
              {options?.confirmLabel}
            </Button>
          </>
        }
      >
        {options?.body ? <div className="text-[13px] leading-5 text-ink-2">{options.body}</div> : null}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

/**
 * Non-modal on purpose: a modal menu that opens a dialog from one of its items can leave
 * `pointer-events: none` on <body> after the dialog closes, freezing the whole page.
 */
export function Menu(props: ComponentProps<typeof M.Root>) {
  return <M.Root modal={false} {...props} />;
}
export const MenuTrigger = M.Trigger;

export function MenuContent({ children, align = "end" }: { children: ReactNode; align?: "start" | "end" }) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={4}
        collisionPadding={8}
        className="pop-in z-50 min-w-44 rounded-lg border border-line bg-panel p-1 shadow-pop"
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
  icon,
}: {
  children: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        "flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 data-[highlighted]:bg-hover [&_svg]:size-4 [&_svg]:text-muted",
        danger ? "text-bad [&_svg]:!text-bad" : "text-ink",
      )}
    >
      {icon}
      {children}
    </M.Item>
  );
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-line" />;
}

// ---------------------------------------------------------------------------
// Popover
// ---------------------------------------------------------------------------

export const Popover = P.Root;
export const PopoverTrigger = P.Trigger;
export function PopoverContent({
  children,
  align = "start",
  className,
}: {
  children: ReactNode;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  return (
    <P.Portal>
      <P.Content
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn("pop-in z-50 rounded-lg border border-line bg-panel shadow-pop outline-none", className)}
      >
        {children}
      </P.Content>
    </P.Portal>
  );
}

// ---------------------------------------------------------------------------
// Select
// ---------------------------------------------------------------------------

export function Select<T extends string>({
  value,
  onValueChange,
  options,
  placeholder,
  className,
  size = "md",
  ariaLabel,
}: {
  value: T | undefined;
  onValueChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; disabled?: boolean }>;
  placeholder?: string;
  className?: string;
  size?: "sm" | "md";
  ariaLabel?: string;
}) {
  return (
    <S.Root value={value} onValueChange={(v) => onValueChange(v as T)}>
      <S.Trigger
        aria-label={ariaLabel}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-md border border-line bg-panel px-2.5 text-left text-ink outline-none hover:border-line-strong focus:border-accent data-[placeholder]:text-faint",
          size === "sm" ? "h-7 text-xs" : "h-8 text-[13px]",
          className,
        )}
      >
        <span className="truncate">
          <S.Value placeholder={placeholder} />
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted" />
      </S.Trigger>
      <S.Portal>
        <S.Content
          position="popper"
          sideOffset={4}
          collisionPadding={8}
          className="pop-in z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-lg border border-line bg-panel shadow-pop"
        >
          <S.Viewport className="p-1">
            {options.map((option) => (
              <S.Item
                key={option.value}
                value={option.value}
                disabled={option.disabled}
                className="relative flex h-8 cursor-pointer select-none items-center rounded-md pl-7 pr-2 text-[13px] text-ink outline-none data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[highlighted]:bg-hover"
              >
                <S.ItemIndicator className="absolute left-2 inline-flex">
                  <Check className="size-3.5 text-accent" />
                </S.ItemIndicator>
                <S.ItemText>{option.label}</S.ItemText>
              </S.Item>
            ))}
          </S.Viewport>
        </S.Content>
      </S.Portal>
    </S.Root>
  );
}
