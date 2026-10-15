import { FlexibleSchema } from 'ai';

/** A generated file (e.g. an Excel export) streamed to the browser as base64. */
interface AssistantFile {
    fileName: string;
    mimeType: string;
    data: Uint8Array | ArrayBuffer;
}
interface ToolRunOptions {
    signal: AbortSignal;
    toolCallId: string;
    /** Sends a file to the browser alongside the tool result. */
    attachFile: (file: AssistantFile) => void;
}
/**
 * A tool the model may call. Tools are read-only by default: they run as soon
 * as the model calls them. Set `needsConfirmation` for anything that changes
 * data, sends messages or spends money; the user then confirms first.
 *
 * Authorization is the tool's job: `execute` must only do what the signed-in
 * user may do (scope queries by the user's tenant, rely on database policies).
 */
interface AssistantTool<INPUT = any> {
    description: string;
    /** Zod (v3.25+ or v4), Standard Schema, or AI SDK `jsonSchema(...)`. */
    inputSchema: FlexibleSchema<INPUT>;
    /** Returns a JSON-serialisable result for the model. */
    execute: (input: INPUT, options: ToolRunOptions) => unknown;
    /** True (or a predicate on the input) to require a user confirmation first. */
    needsConfirmation?: boolean | ((input: INPUT) => boolean | Promise<boolean>);
    /** One line shown on the confirmation prompt, e.g. "Record a 50 000 expense for rent". */
    describe?: (input: INPUT) => string | Promise<string>;
}
type AssistantTools = Record<string, AssistantTool<any>>;
/** Identity helper that infers the input type from the schema. */
declare function defineTool<INPUT>(tool: AssistantTool<INPUT>): AssistantTool<INPUT>;
/** Throw from `execute` to show the model a safe error message it can act on. */
declare class ToolError extends Error {
    constructor(message: string);
}
/** Base64 without Node's Buffer, so it runs in Deno, edge runtimes and browsers. */
declare function toBase64(data: Uint8Array | ArrayBuffer): string;

export { ToolError as T, defineTool as d, toBase64 as t };
export type { AssistantFile as A, AssistantTools as a, AssistantTool as b, ToolRunOptions as c };
