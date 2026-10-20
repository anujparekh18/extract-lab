import { useState } from "react";
import { Link, Outlet, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge, EmptyState, Spinner } from "@/components/ui/misc";
import { Input, Label } from "@/components/ui/input";
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger, useConfirm } from "@/components/ui/overlay";
import { errorMessage } from "@/lib/errors";
import { ExtractorContext, type Extractor } from "@/components/extractor-context";

export const Route = createFileRoute("/x/$slug")({
  component: ExtractorLayout,
});

const TABS = [
  { to: "/x/$slug", label: "Playground", exact: true },
  { to: "/x/$slug/runs", label: "Runs", exact: false },
  { to: "/x/$slug/versions", label: "Versions", exact: false },
  { to: "/x/$slug/answers", label: "Correct answers", exact: false },
  { to: "/x/$slug/accuracy", label: "Accuracy", exact: false },
  { to: "/x/$slug/ship", label: "Use in code", exact: false },
] as const;

function ExtractorLayout() {
  const { slug } = Route.useParams();
  const extractor = useQuery(api.extractors.getBySlug, { slug });

  if (extractor === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (extractor === null) {
    return (
      <EmptyState
        className="h-full"
        title="This extractor doesn't exist"
        action={
          <Link to="/" className={buttonClass()}>
            All extractors
          </Link>
        }
      >
        It may have been deleted, or the link is wrong.
      </EmptyState>
    );
  }

  return (
    <ExtractorContext.Provider value={extractor}>
      <div className="flex h-full flex-col">
        <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-[14px] font-medium">{extractor.name}</h1>
            {extractor.published ? <Badge tone="ok">Published</Badge> : null}
          </div>
          <nav className="flex h-full items-stretch gap-1">
            {TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                params={{ slug }}
                activeOptions={{ exact: tab.exact, includeSearch: false }}
                className="relative flex items-center px-2.5 text-[13px] text-muted transition-colors hover:text-ink [&.active]:font-medium [&.active]:text-ink [&.active]:after:absolute [&.active]:after:inset-x-2 [&.active]:after:-bottom-px [&.active]:after:h-0.5 [&.active]:after:rounded-full [&.active]:after:bg-accent"
              >
                {tab.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto">
            <ExtractorMenu extractor={extractor} />
          </div>
        </header>
        <div className="min-h-0 flex-1">
          <Outlet />
        </div>
      </div>
    </ExtractorContext.Provider>
  );
}

function ExtractorMenu({ extractor }: { extractor: Extractor }) {
  const update = useMutation(api.extractors.update);
  const remove = useMutation(api.extractors.remove);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(extractor.name);
  const [description, setDescription] = useState(extractor.description ?? "");

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" icon aria-label="Extractor actions">
            <MoreHorizontal />
          </Button>
        </MenuTrigger>
        <MenuContent>
          <MenuItem
            icon={<Pencil />}
            onSelect={() => {
              setName(extractor.name);
              setDescription(extractor.description ?? "");
              setRenaming(true);
            }}
          >
            Rename…
          </MenuItem>
          <MenuItem
            danger
            icon={<Trash2 />}
            onSelect={async () => {
              const ok = await confirm({
                title: `Delete ${extractor.name}?`,
                body: "This deletes its documents, correct answers, versions, runs, and accuracy checks. It can't be undone.",
                confirmLabel: "Delete extractor",
                danger: true,
              });
              if (!ok) return;
              try {
                await remove({ id: extractor._id });
                toast.success(`Deleted ${extractor.name}`);
                await navigate({ to: "/" });
              } catch (error) {
                toast.error(errorMessage(error));
              }
            }}
          >
            Delete…
          </MenuItem>
        </MenuContent>
      </Menu>
      <Dialog
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename extractor"
        description={
          <>
            The URL and API path stay <code className="font-mono">/{extractor.slug}</code>.
          </>
        }
        footer={
          <>
            <Button onClick={() => setRenaming(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!name.trim()}
              onClick={async () => {
                try {
                  await update({ id: extractor._id, name, description });
                  setRenaming(false);
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="rename-name">Name</Label>
            <Input id="rename-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label htmlFor="rename-description" hint="Optional">
              Description
            </Label>
            <Input id="rename-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
      </Dialog>
    </>
  );
}
