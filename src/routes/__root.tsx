import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRoute,
} from "@tanstack/react-router";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import appCss from "@/styles.css?url";

const convexUrl = import.meta.env.VITE_CONVEX_URL as string | undefined;
const convexClient = convexUrl ? new ConvexReactClient(convexUrl) : null;

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Extract Lab" },
      {
        name: "description",
        content: "An open-source workbench for building, testing, and comparing structured document extraction workflows using LLMs.",
      },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      {convexClient ? (
        <ConvexProvider client={convexClient}>
          <Outlet />
        </ConvexProvider>
      ) : (
        <MissingEnv />
      )}
    </RootDocument>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
    <main className="mx-auto max-w-3xl px-4 py-20">
      <div className="panel p-6">
        <h1 className="text-xl font-semibold">Missing `VITE_CONVEX_URL`</h1>
        <p className="mt-3 text-sm text-gray-600">
          Run `bunx convex dev` and copy generated environment variables into `.env.local`.
        </p>
      </div>
    </main>
  );
}
