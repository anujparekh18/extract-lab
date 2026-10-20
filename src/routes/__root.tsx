import type { ReactNode } from "react";
import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { Toaster } from "sonner";
import appCss from "@/styles.css?url";
import { AppShell } from "@/components/app-shell";
import { ModelsProvider } from "@/components/models-provider";
import { ConfirmProvider } from "@/components/ui/overlay";
import { TooltipProvider } from "@/components/ui/misc";
import { THEME_BOOT_SCRIPT } from "@/lib/hooks";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "extract lab" },
      {
        name: "description",
        content: "Turn documents into reliable JSON: try prompts and schemas, check them against correct answers, and ship.",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "icon",
        href: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256'%3E%3Crect x='12' y='12' width='232' height='232' rx='44' fill='%230a0a0a'/%3E%3Cg fill='none' stroke='white' stroke-width='24' stroke-linecap='round'%3E%3Cpath d='M66 84h124M66 128h58M66 172h124'/%3E%3C/g%3E%3Ccircle cx='176' cy='128' r='18' fill='white'/%3E%3C/svg%3E",
      },
    ],
    scripts: [{ children: THEME_BOOT_SCRIPT }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      {convexClient ? (
        <ConvexProvider client={convexClient}>
          <ModelsProvider>
            <TooltipProvider>
              <ConfirmProvider>
                <AppShell>
                  <Outlet />
                </AppShell>
              </ConfirmProvider>
            </TooltipProvider>
          </ModelsProvider>
        </ConvexProvider>
      ) : (
        <MissingEnv />
      )}
      <Toaster
        position="bottom-right"
        toastOptions={{
          className: "!bg-panel !text-ink !border-line !shadow-pop !font-sans !text-[13px]",
        }}
      />
    </RootDocument>
  );
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function MissingEnv() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24">
      <h1 className="text-lg font-medium">Connect Convex to start</h1>
      <p className="mt-2 text-muted">Extract Lab stores documents and runs in Convex. In this folder, run:</p>
      <pre className="mt-4 rounded-lg border border-line bg-sunken p-4 text-xs leading-6">
        {"bunx convex dev          # creates a project, writes .env.local\nbun run dev              # in a second terminal"}
      </pre>
      <p className="mt-4 text-xs text-muted">
        Then restart the dev server so it picks up <code>VITE_CONVEX_URL</code>.
      </p>
    </main>
  );
}
