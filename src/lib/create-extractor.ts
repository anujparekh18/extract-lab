import { useMutation } from "convex/react";
import { toast } from "sonner";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { getTemplate } from "./templates";

/**
 * Creates an extractor from a template. Text samples are added by the server; file samples
 * (a PDF, a photo) live in `public/samples`, so the browser uploads them and saves their
 * correct answers. A failed sample upload doesn't stop the extractor from being created.
 */
export function useCreateExtractor() {
  const create = useMutation(api.extractors.create);
  const generateUploadUrl = useMutation(api.documents.generateUploadUrl);
  const createFromFile = useMutation(api.documents.createFromFile);
  const setExpected = useMutation(api.documents.setExpected);

  return async function createExtractor(args: { name: string; templateId: string }) {
    const { slug, extractorId } = await create(args);
    const files = (getTemplate(args.templateId)?.samples ?? []).filter((s) => s.file !== undefined);
    // Uploaded newest-first order puts files at the top of the list, so the first document a new user opens is a real file.
    for (const sample of [...files].reverse()) {
      try {
        await uploadSample(extractorId, sample.file!, sample.title, sample.expected);
      } catch {
        toast.error(`Couldn't add the sample "${sample.title}". You can upload your own documents instead.`);
      }
    }
    return slug;
  };

  async function uploadSample(extractorId: Id<"extractors">, path: string, title: string, expected: unknown) {
    const file = await fetch(path);
    if (!file.ok) throw new Error(`${path}: ${file.status}`);
    const blob = await file.blob();
    const url = await generateUploadUrl({});
    const upload = await fetch(url, { method: "POST", headers: { "Content-Type": blob.type }, body: blob });
    if (!upload.ok) throw new Error(`Upload failed (${upload.status})`);
    const { storageId } = (await upload.json()) as { storageId: Id<"_storage"> };
    const fileName = path.split("/").pop() ?? "sample";
    const id = await createFromFile({ extractorId, storageId, fileName, title });
    await setExpected({ id, expected });
  }
}
