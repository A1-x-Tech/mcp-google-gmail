import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

/**
 * Schema factories, not shared consts: reusing one zod object across two fields
 * makes zod-to-json-schema dedupe them into a `$ref`, which some tool-schema
 * consumers (OpenAI Apps review) don't dereference and flag as `any`. A fresh
 * object per field keeps each one inlined with its type + pattern.
 */
export const messageIdSchema = () =>
  z.string().min(1).describe("The message id from list_messages/get_thread output (not the RFC Message-ID header).");

export const threadIdSchema = () =>
  z.string().min(1).describe("The thread id from list_threads or from a message's threadId field.");

export const draftIdSchema = () => z.string().min(1).describe("The draft id from list_drafts or create_draft output.");

export const labelIdSchema = () =>
  z
    .string()
    .min(1)
    .describe(
      'A label id from list_labels — system ids like "INBOX", "UNREAD", "STARRED", "SPAM", "TRASH" or a user label id like "Label_123".',
    );

/** One email header recipient — "Name <a@b.c>" or a bare address; line breaks are rejected (header injection). */
export const recipientSchema = () =>
  z
    .string()
    .min(1)
    .regex(/^[^\r\n]+$/, "Must be a single-line address")
    .describe('An address like "user@example.com" or "Name <user@example.com>".');

/** Gmail search query — the same syntax as the Gmail search box. */
export const gmailQuerySchema = () =>
  z
    .string()
    .min(1)
    .describe(
      'Gmail query syntax, e.g. "from:amy@example.com is:unread newer_than:7d has:attachment subject:invoice". Same operators as the Gmail search box.',
    );

/** Truncation limit for decoded bodies. */
export const maxBodyCharsSchema = () =>
  z
    .number()
    .int()
    .min(100)
    .optional()
    .describe("Truncate each decoded body at this many characters (default 50000; a truncation flag is set when cut).");

/** Wraps a value as a compact-JSON tool result (compact: the consumer is an LLM). */
export function ok(data: unknown): CallToolResult {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return { content: [{ type: "text", text: text ?? "null" }] };
}

export function fail(err: unknown): CallToolResult {
  let message = err instanceof Error ? err.message : String(err);
  // Surface the underlying cause (e.g. the network error behind a timeout) — no
  // secrets live in cause, and it makes failures far easier to diagnose.
  if (err instanceof Error && err.cause instanceof Error) message += ` (${err.cause.message})`;
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

/**
 * MCP tool annotations — hints the consuming client can use to gate or label a
 * tool. All four hints are set explicitly on every tool: some clients (OpenAI
 * Apps review) require readOnlyHint, destructiveHint and openWorldHint on each.
 *
 * Gmail mixes reads with irreversible writes, so each tool picks one of four
 * presets: READ_ONLY (pure reads), WRITE (creates new state; replaying
 * duplicates it), UPDATE (overwrites existing state; replaying the same change
 * converges — includes the reversible trash) and DESTRUCTIVE (irreversible:
 * sending mail, deleting drafts/labels — annotate for the worst case so
 * clients gate these behind confirmation).
 */
export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;

export const UPDATE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;

export const DESTRUCTIVE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;
