import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { FileQuestion, MoreHorizontal, Pencil, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { errorMessage } from "@/lib/errors";
import { formatBytes, formatUsd } from "@/lib/format";
import { modelLabel } from "@/lib/models";
import { Button } from "../ui/button";
import { JsonView } from "../json-view";
import { Badge } from "../ui/misc";
import { Segmented } from "../ui/input";
import { EmptyState, Spinner } from "../ui/misc";
import { Menu, MenuContent, MenuItem, MenuTrigger, useConfirm } from "../ui/overlay";
import { CollapseButton } from "./collapsible";

type View = "original" | "text";

export function DocumentViewer({
  documentId,
  onDeleted,
  onCollapse,
}: {
  documentId: Id<"documents">;
  onDeleted: () => void;
  onCollapse?: () => void;
}) {
  const document = useQuery(api.documents.get, { id: documentId });
  const rename = useMutation(api.documents.rename);
  const remove = useMutation(api.documents.remove);
  const requestTranscript = useMutation(api.documents.requestTranscript);
  const confirm = useConfirm();
  const [view, setView] = useState<View>("original");
  const [zoom, setZoom] = useState(1);
  const [editingTitle, setEditingTitle] = useState(false);

  if (document === undefined) {
    return (
      <div className="flex h-full items-center justify-center text-muted">
        <Spinner />
      </div>
    );
  }
  if (document === null) return <EmptyState className="h-full" icon={<FileQuestion />} title="Document not found" />;

  const isFile = document.kind === "file";
  const isImage = isFile && document.mimeType?.startsWith("image/");
  const transcript = document.transcript;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
        {editingTitle ? (
          <input
            autoFocus
            defaultValue={document.title}
            className="h-7 min-w-0 flex-1 rounded border border-accent bg-panel px-2 text-[13px] font-medium outline-none"
            onKeyDown={(e) => {
              if (e.key === "Escape") setEditingTitle(false);
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            onBlur={async (e) => {
              setEditingTitle(false);
              const title = e.currentTarget.value.trim();
              if (title && title !== document.title) {
                try {
                  await rename({ id: document._id, title });
                } catch (error) {
                  toast.error(errorMessage(error));
                }
              }
            }}
          />
        ) : (
          <button
            type="button"
            onDoubleClick={() => setEditingTitle(true)}
            title="Double-click to rename"
            className="min-w-0 truncate text-left text-[13px] font-medium"
          >
            {document.title}
          </button>
        )}
        {document.format === "json" ? <Badge>JSON</Badge> : null}
        <span className="tabular hidden shrink-0 text-2xs text-faint lg:inline">
          {isFile ? [document.fileName, document.fileSize ? formatBytes(document.fileSize) : null].filter(Boolean).join(" · ") : `${document.text?.length.toLocaleString()} chars`}
        </span>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isImage && view === "original" ? (
            <>
              <Button variant="ghost" size="sm" icon aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>
                <ZoomOut />
              </Button>
              <Button variant="ghost" size="sm" icon aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>
                <ZoomIn />
              </Button>
            </>
          ) : null}
          {isFile ? (
            <Segmented<View>
              size="sm"
              value={view}
              onChange={setView}
              options={[
                { value: "original", label: "Original" },
                { value: "text", label: "Text", title: "Plain-text transcription by a cheap model" },
              ]}
            />
          ) : null}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="sm" icon aria-label="Document actions">
                <MoreHorizontal />
              </Button>
            </MenuTrigger>
            <MenuContent>
              <MenuItem icon={<Pencil />} onSelect={() => setEditingTitle(true)}>
                Rename
              </MenuItem>
              <MenuItem
                danger
                icon={<Trash2 />}
                onSelect={async () => {
                  const ok = await confirm({
                    title: `Delete "${document.title}"?`,
                    body: "Its runs and correct answer are deleted too.",
                    confirmLabel: "Delete document",
                    danger: true,
                  });
                  if (!ok) return;
                  try {
                    await remove({ id: document._id });
                    onDeleted();
                  } catch (error) {
                    toast.error(errorMessage(error));
                  }
                }}
              >
                Delete
              </MenuItem>
            </MenuContent>
          </Menu>
          {onCollapse ? <CollapseButton label="the document" onClick={onCollapse} /> : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-sunken">
        {!isFile && document.format === "json" ? (
          <JsonView value={safeParse(document.text)} className="mx-auto max-w-3xl p-6 text-[12.5px] leading-[20px]" />
        ) : !isFile ? (
          <pre className="mx-auto max-w-3xl whitespace-pre-wrap break-words p-6 font-mono text-[12.5px] leading-[20px] text-ink">
            {document.text}
          </pre>
        ) : view === "text" ? (
          transcript?.status === "ready" ? (
            <div className="mx-auto max-w-3xl p-6">
              <p className="mb-3 text-2xs text-faint">
                Transcribed by {modelLabel(transcript.model ?? "")} · {formatUsd(transcript.costUsd)}
              </p>
              <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[20px] text-ink">
                {transcript.text}
              </pre>
            </div>
          ) : transcript?.status === "running" ? (
            <EmptyState className="h-full" icon={<Spinner />} title="Reading the document…" />
          ) : (
            <EmptyState
              className="h-full"
              title={transcript?.status === "failed" ? "Couldn't transcribe this file" : "No text version yet"}
              action={
                <Button size="sm" onClick={() => requestTranscript({ id: document._id }).catch((e) => toast.error(errorMessage(e)))}>
                  {transcript?.status === "failed" ? "Try again" : "Transcribe"}
                </Button>
              }
            >
              {transcript?.error ??
                "A plain-text copy made by a cheap model, for reading and searching. Coding agents read documents this way too. It can contain small reading mistakes."}
            </EmptyState>
          )
        ) : !document.url ? (
          <EmptyState className="h-full" title="File unavailable" />
        ) : document.mimeType === "application/pdf" ? (
          <iframe title={document.title} src={document.url} className="h-full w-full border-0 bg-panel" />
        ) : (
          <div className="flex min-h-full items-start justify-center p-6">
            <img
              src={document.url}
              alt={document.title}
              style={{ width: `${zoom * 100}%`, maxWidth: zoom === 1 ? "100%" : "none" }}
              className="rounded border border-line bg-panel shadow-sm"
            />
          </div>
        )}
      </div>
    </div>
  );
}

function safeParse(text: string | undefined) {
  try {
    return JSON.parse(text ?? "null");
  } catch {
    return text;
  }
}
