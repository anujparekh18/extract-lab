import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import { cn } from "@/lib/cn";
import { countFields } from "@/lib/fields";
import { TEMPLATES, defaultExtractorName } from "@/lib/templates";
import { errorMessage } from "@/lib/errors";
import { useCreateExtractor } from "@/lib/create-extractor";
import { Button } from "./ui/button";
import { Input, Label } from "./ui/input";
import { Dialog } from "./ui/overlay";

export function NewExtractorDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const create = useCreateExtractor();
  const navigate = useNavigate();
  const [templateId, setTemplateId] = useState("invoice");
  const [name, setName] = useState("");
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  const existing = useQuery(api.extractors.list, {});
  const template = TEMPLATES.find((t) => t.id === templateId)!;
  const effectiveName = nameTouched
    ? name
    : template.id === "blank"
      ? ""
      : defaultExtractorName(template.name, existing?.map((e) => e.name) ?? []);

  async function submit() {
    setSaving(true);
    try {
      const slug = await create({ name: effectiveName, templateId });
      onOpenChange(false);
      setName("");
      setNameTouched(false);
      await navigate({ to: "/x/$slug", params: { slug } });
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
      title="New extractor"
      description="An extractor is one prompt + schema that turns a kind of document into JSON."
      width="max-w-2xl"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="primary" loading={saving} disabled={!effectiveName.trim()} onClick={submit}>
            Create extractor
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (effectiveName.trim()) submit();
        }}
      >
        <Label>Start from</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTemplateId(t.id)}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                templateId === t.id ? "border-accent bg-accent-soft/60 ring-1 ring-accent" : "border-line hover:border-line-strong hover:bg-hover",
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-medium text-ink">{t.name}</span>
                {t.id !== "blank" ? (
                  <span className="text-2xs text-muted">
                    {countFields(t.fields)} fields · {t.samples.length} {t.samples.length === 1 ? "sample" : "samples"}
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-xs leading-[18px] text-muted">{t.description}</p>
            </button>
          ))}
        </div>
        {template.samples.length > 0 ? (
          <p className="mt-3 text-xs text-muted">
            Samples come with correct answers, so you can check accuracy straight away.
          </p>
        ) : null}

        <div className="mt-5">
          <Label htmlFor="extractor-name">Name</Label>
          <Input
            id="extractor-name"
            autoFocus
            value={effectiveName}
            placeholder="e.g. Vendor invoices"
            onChange={(event) => {
              setNameTouched(true);
              setName(event.target.value);
            }}
          />
        </div>
      </form>
    </Dialog>
  );
}

