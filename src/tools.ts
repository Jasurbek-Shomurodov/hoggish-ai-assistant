import { asSchema, type FlexibleSchema } from 'ai';

/** A generated file (e.g. an Excel export) streamed to the browser as base64. */
export interface AssistantFile {
  fileName: string;
  mimeType: string;
  data: Uint8Array | ArrayBuffer;
}

export interface ToolRunOptions {
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
export interface AssistantTool<INPUT = any> {
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

export type AssistantTools = Record<string, AssistantTool<any>>;

/** Identity helper that infers the input type from the schema. */
export function defineTool<INPUT>(tool: AssistantTool<INPUT>): AssistantTool<INPUT> {
  return tool;
}

/** Throw from `execute` to show the model a safe error message it can act on. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export interface ToolOutcome {
  /** JSON-serialisable value handed back to the model. */
  result: unknown;
  isError?: boolean;
}

export async function needsConfirmation(tool: AssistantTool, input: unknown): Promise<boolean> {
  if (typeof tool.needsConfirmation === 'function') return Boolean(await tool.needsConfirmation(input));
  return Boolean(tool.needsConfirmation);
}

/** Validates input against the tool's schema, returning the parsed value. */
export async function validateToolInput(tool: AssistantTool, input: unknown): Promise<{ ok: true; value: unknown } | { ok: false; message: string }> {
  const schema = asSchema(tool.inputSchema);
  if (!schema.validate) return { ok: true, value: input };
  const result = await schema.validate(input);
  if (result.success) return { ok: true, value: result.value };
  return { ok: false, message: result.error instanceof Error ? result.error.message : 'Invalid input' };
}

/** Runs one tool; thrown errors become error results the model can see. */
export async function executeTool(
  tool: AssistantTool,
  input: unknown,
  options: ToolRunOptions,
  onError?: (error: unknown) => void,
): Promise<ToolOutcome> {
  try {
    const result = await tool.execute(input, options);
    return { result: result === undefined ? null : result };
  } catch (error) {
    if (options.signal.aborted) throw error;
    if (error instanceof ToolError) return { result: error.message, isError: true };
    onError?.(error);
    return { result: 'The tool failed. Tell the user it could not be completed.', isError: true };
  }
}

/** Base64 without Node's Buffer, so it runs in Deno, edge runtimes and browsers. */
export function toBase64(data: Uint8Array | ArrayBuffer): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}
