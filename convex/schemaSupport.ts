import { query } from "./_generated/server";
import { listSchemaSupport } from "../src/extraction/schema-registry";

export const list = query({
  args: {},
  handler: async () => {
    return listSchemaSupport();
  },
});
