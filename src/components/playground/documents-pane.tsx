import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation } from "convex/react";
import { Braces, ClipboardPaste, FileImage, FileText, Plus, Target, Upload } from "lucide-react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { cn } from "@/lib/cn";
import { errorMessage } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { looksLikeJson, parseJsonInput } from "@/lib/json-input";
import { Button } from "../ui/button";
import { Input, Label, Textarea } from "../ui/input";
import { Dialog, Menu, MenuContent, MenuItem, MenuTrigger } from "../ui/overlay";
import { Spinner, Tooltip } from "../ui/misc";
import { RunStatusDot } from "../run-status";
import { CollapseButton } from "./collapsible";
import { useExtractor } from "../extractor-context";

export type DocumentListItem = FunctionReturnType<typeof api.documents.list>[number];

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.json,application/pdf,image/jpeg,image/png,image/webp,application/json";

export function useDocumentUpload(
  extractorId: Id<"extractors">,
  onCreated: (id: Id<"documents">) => void,
  /** Offered after adding several documents at once, e.g. to review them in a row. */
  batchAction?: { label: string; onClick: () => void },
) {
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createFromFile = useMutation(api.documents.createFromFile);
  const createFromText = useMutation(api.documents.createFromText);
  const [uploading, setUploading] = useState(0);

  async function upload(files: File[]) {
    if (files.length === 0) return;
    setUploading((n) => n + files.length);
    let lastId: Id<"documents"> | null = null;
    for (const file of files) {
      try {
        if (file.type === "application/json" || file.name.toLowerCase().endsWith(".json")) {
          lastId = await createFromText({
            extractorId,
            title: file.name.replace(/\.json$/i, ""),
            text: await file.text(),
            format: "json",
          });
          continue;
        }
        const url = await generateUploadUrl({});
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!response.ok) throw new Error(`Upload of ${file.name} failed (${response.status}).`);
        const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
        lastId = await createFromFile({ extractorId, storageId, fileName: file.name });
      } catch (error) {
        toast.error(errorMessage(error));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (lastId) {
      onCreated(lastId);
      if (files.length === 1) toast.success(`Added ${files[0].name}`);
      else toast.success(`Added ${files.length} documents`, batchAction ? { action: batchAction } : undefined);
    }
  }

  return { upload, uploading };
}

export function DocumentsPane({
  extractorId,
  documents,
  selectedId,
  onSelect,
  onCollapse,
}: {
  extractorId: Id<"extractors">;
  documents: DocumentListItem[] | undefined;
  selectedId: Id<"documents"> | undefined;
  onSelect: (id: Id<"documents">) => void;
  onCollapse?: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [pasting, setPasting] = useState(false);
  const extractor = useExtractor();
  const navigate = useNavigate();
  const { upload, uploading } = useDocumentUpload(extractorId, onSelect, {
    label: "Add correct answers",
    onClick: () => navigate({ to: "/x/$slug/answers", params: { slug: extractor.slug } }),
  });
  const testCases = documents?.filter((d) => d.hasExpected).length ?? 0;

  return (
    <div
      className={cn("relative flex h-full flex-col bg-panel", dragging && "ring-2 ring-inset ring-accent")}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        upload(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line pl-3 pr-1.5">
        <div className="text-xs font-medium text-ink-2">
          Documents{" "}
          {documents ? (
            <span className="tabular font-normal text-faint">
              {documents.length}
              {testCases ? ` · ${testCases} with answers` : ""}
            </span>
          ) : null}
        </div>
        <div className="flex items-center">
        <Menu>
          <MenuTrigger asChild>
            <Button variant="ghost" size="sm" icon aria-label="Add document">
              {uploading ? <Spinner /> : <Plus />}
            </Button>
          </MenuTrigger>
          <MenuContent>
            <MenuItem icon={<Upload />} onSelect={() => fileInput.current?.click()}>
              Upload files…
            </MenuItem>
            <MenuItem icon={<ClipboardPaste />} onSelect={() => setPasting(true)}>
              Paste text…
            </MenuItem>
          </MenuContent>
        </Menu>
        {onCollapse ? <CollapseButton label="the document list" onClick={onCollapse} /> : null}
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            upload(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {documents === undefined ? (
          <div className="space-y-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-md bg-sunken" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-3 text-center">
            <p className="text-xs leading-[18px] text-muted">Drop PDFs, images, or JSON files here, or paste text to get started.</p>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => fileInput.current?.click()}>
                <Upload /> Upload
              </Button>
              <Button size="sm" onClick={() => setPasting(true)}>
                <ClipboardPaste /> Paste
              </Button>
            </div>
          </div>
        ) : (
          documents.map((doc) => (
            <button
              key={doc._id}
              type="button"
              onClick={() => onSelect(doc._id)}
              className={cn(
                "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                selectedId === doc._id ? "bg-accent-soft" : "hover:bg-hover",
              )}
            >
              <span className="mt-0.5 text-faint [&_svg]:size-3.5">
                {doc.format === "json" ? <Braces /> : doc.kind === "text" ? <FileText /> : <FileImage />}
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-[12.5px]", selectedId === doc._id ? "font-medium text-ink" : "text-ink-2")}>
                  {doc.title}
                </span>
                <span className="tabular block truncate text-2xs text-faint">
                  {doc.kind === "text"
                    ? `${doc.format === "json" ? "JSON · " : ""}${(doc.textLength ?? 0).toLocaleString()} chars`
                    : `${doc.mimeType === "application/pdf" ? "PDF" : "Image"}${doc.fileSize ? ` · ${formatBytes(doc.fileSize)}` : ""}`}
                </span>
              </span>
              <span className="mt-1 flex items-center gap-1.5">
                {doc.hasExpected ? (
                  <Tooltip content="Has a correct answer, so it counts toward accuracy">
                    <Target className="size-3 text-accent" aria-label="Has a correct answer" />
                  </Tooltip>
                ) : null}
                {doc.lastRun ? <RunStatusDot status={doc.lastRun.status} /> : null}
              </span>
            </button>
          ))
        )}
      </div>
      {dragging ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent-soft/80 text-xs font-medium text-accent">
          Drop to add documents
        </div>
      ) : null}
      <PasteDialog open={pasting} onOpenChange={setPasting} extractorId={extractorId} onCreated={onSelect} />
    </div>
  );
}

function PasteDialog({
  open,
  onOpenChange,
  extractorId,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  extractorId: Id<"extractors">;
  onCreated: (id: Id<"documents">) => void;
}) {
  const create = useMutation(api.documents.createFromText);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [asJson, setAsJson] = useState(true);
  const json = looksLikeJson(text) ? parseJsonInput(text) : null;
  const saveAsJson = asJson && json?.ok === true;

  async function submit() {
    setSaving(true);
    try {
      const id = await create({ extractorId, title, text, format: saveAsJson ? "json" : undefined });
      onCreated(id);
      onOpenChange(false);
      setTitle("");
      setText("");
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Paste text"
      description="Emails, HTML, OCR output, chat logs, or JSON your app already has."
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!text.trim()} onClick={submit}>
            Add document
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div>
          <Label htmlFor="paste-title" hint="Defaults to the first line">
            Title
          </Label>
          <Input id="paste-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="paste-text">Text</Label>
          <Textarea
            id="paste-text"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-72 resize-y font-mono text-[12px]"
          />
          {json ? (
            json.ok ? (
              <label className="mt-2 flex items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  className="mt-0.5 accent-[var(--c-accent)]"
                  checked={asJson}
                  onChange={(e) => setAsJson(e.target.checked)}
                />
                <span>
                  <span className="font-medium text-ink-2">Save as JSON</span>
                  <span className="block text-muted">
                    Validated, shown formatted, and sent to the model compactly.
                    {json.notes.length ? ` ${json.notes.join(" ")}` : ""}
                  </span>
                </span>
              </label>
            ) : (
              <p className="mt-2 text-xs text-muted">
                Looks like JSON but doesn't parse ({json.error}). It will be saved as plain text.
              </p>
            )
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
