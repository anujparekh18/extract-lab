import { z } from "zod";
import { InvoiceSchema } from "./schemas/invoice";

export const schemaRegistry = {
  invoice: {
    v1: InvoiceSchema,
  }
} as const;

export type DocTypeKey = keyof typeof schemaRegistry;

export function listSchemaSupport() {
  return Object.entries(schemaRegistry).map(([docTypeKey, versionsMap]) => ({
    docTypeKey,
    versions: Object.keys(versionsMap).sort(),
  }));
}

export function hasSchemaVersion(docTypeKey: string, schemaVersion: string) {
  const docTypeEntry = (
    schemaRegistry as Record<string, Record<string, z.ZodTypeAny>>
  )[docTypeKey];
  if (!docTypeEntry) return false;
  return Boolean(docTypeEntry[schemaVersion]);
}

export function getSchema(docTypeKey: string, schemaVersion: string) {
  const docTypeEntry = (
    schemaRegistry as Record<string, Record<string, z.ZodTypeAny>>
  )[docTypeKey];
  if (!docTypeEntry) return null;
  return docTypeEntry[schemaVersion] ?? null;
}

export function getSchemaJsonSchema(docTypeKey: string, schemaVersion: string) {
  const schema = getSchema(docTypeKey, schemaVersion);
  if (!schema) return null;
  return z.toJSONSchema(schema);
}
