/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as docTypes from "../docTypes.js";
import type * as documents from "../documents.js";
import type * as prompts from "../prompts.js";
import type * as runExecution from "../runExecution.js";
import type * as runs from "../runs.js";
import type * as schemaSupport from "../schemaSupport.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  docTypes: typeof docTypes;
  documents: typeof documents;
  prompts: typeof prompts;
  runExecution: typeof runExecution;
  runs: typeof runs;
  schemaSupport: typeof schemaSupport;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
