import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleGmailClient } from "../client.js";
import {
  DESTRUCTIVE,
  fail,
  gmailQuerySchema,
  labelIdSchema,
  maxBodyCharsSchema,
  messageIdSchema,
  ok,
  READ_ONLY,
  recipientSchema,
  threadIdSchema,
  UPDATE,
} from "./util.js";

export function registerMessageTools(server: McpServer, client: GoogleGmailClient): void {
  server.registerTool(
    "list_messages",
    {
      title: "Search and list messages",
      annotations: READ_ONLY,
      description:
        "Searches the mailbox with Gmail query syntax and returns one summary per message: id, threadId, labelIds, snippet, from, to, subject, date, internalDate. Filter with query (same operators as the Gmail search box: from:, to:, subject:, is:unread, is:starred, has:attachment, label:, newer_than:7d, before:/after:) and/or label_ids (all must match). Spam and trash are excluded unless include_spam_trash=true. Paginate with page_token from nextPageToken; page_size defaults to 25 (max 100 — each summary costs one metadata read, throttled to a few at a time). A message deleted between the search and its metadata read is skipped, so a page can hold slightly fewer summaries than page_size. Set include_metadata=false to get bare ids only (cheapest). resultSizeEstimate is an estimate, not an exact count. Read a full body with get_message; read a whole conversation with get_thread.",
      inputSchema: {
        query: gmailQuerySchema().optional(),
        label_ids: z
          .array(labelIdSchema())
          .optional()
          .describe("Only messages carrying ALL of these label ids (see list_labels)."),
        page_size: z.number().int().min(1).max(100).optional().describe("Messages per page (1..100, default 25)."),
        page_token: z.string().optional().describe("nextPageToken from the previous page."),
        include_spam_trash: z.boolean().optional().describe("Also search SPAM and TRASH (default false)."),
        include_metadata: z
          .boolean()
          .optional()
          .describe("false = bare ids only, no per-message metadata reads (default true)."),
      },
    },
    async ({ query, label_ids, page_size, page_token, include_spam_trash, include_metadata }) => {
      try {
        return ok(
          await client.listMessages({
            query,
            labelIds: label_ids,
            pageSize: page_size ?? 25,
            pageToken: page_token,
            includeSpamTrash: include_spam_trash,
            hydrate: include_metadata,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_message",
    {
      title: "Read a message",
      annotations: READ_ONLY,
      description:
        "Fetches one message fully decoded: headers (from, to, cc, subject, date, messageId, inReplyTo, references — RFC 2047 words decoded), the plain-text body (base64/charset decoded), the HTML body when there is no text part or include_html=true, and attachment METADATA (filename, mimeType, sizeBytes, attachmentId — never the content; download bytes via raw_request users/me/messages/<id>/attachments/<attachmentId> if truly needed). Bodies are truncated at max_body_chars (default 50000) with textTruncated/htmlTruncated flags. metadata_only=true skips bodies entirely. To reply later, keep headers.messageId (for in_reply_to) and threadId.",
      inputSchema: {
        message_id: messageIdSchema(),
        include_html: z
          .boolean()
          .optional()
          .describe("Return the decoded HTML body even when a text body exists (default false)."),
        max_body_chars: maxBodyCharsSchema(),
        metadata_only: z.boolean().optional().describe("Headers and structure only, no body content."),
      },
    },
    async ({ message_id, include_html, max_body_chars, metadata_only }) => {
      try {
        return ok(
          await client.getMessage(message_id, {
            includeHtml: include_html,
            maxBodyChars: max_body_chars,
            metadataOnly: metadata_only,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "send_message",
    {
      title: "Send an email",
      // Sending is externally irreversible — an email cannot be unsent — so the
      // tool is annotated for its worst case, not its mechanics.
      annotations: DESTRUCTIVE,
      description:
        "Sends an email from the authenticated mailbox, immediately and irreversibly. Requires at least one recipient across to/cc/bcc (a bcc-only send is fine — to may be omitted) and at least a subject or a body; body_text and body_html together become multipart/alternative. TO REPLY IN A THREAD: call get_message on the message being answered first, then pass its threadId as thread_id, its headers.messageId as in_reply_to, and the same subject prefixed with \"Re: \" — Gmail threads the reply only when all three line up. Returns the sent message's id, threadId and labelIds. NEVER retried after a timeout or 5xx (a duplicate email cannot be unsent): if the outcome is unclear, search list_messages with in:sent before considering a re-send. Everyday accounts can send ~500 emails/day (Workspace ~2000); exceeding it disables sending for hours.",
      inputSchema: {
        to: z
          .array(recipientSchema())
          .optional()
          .describe("Primary recipients. Optional when cc or bcc carries at least one recipient (bcc-only send)."),
        cc: z.array(recipientSchema()).optional().describe("Carbon-copy recipients."),
        bcc: z.array(recipientSchema()).optional().describe("Blind-copy recipients."),
        subject: z
          .string()
          .regex(/^[^\r\n]*$/, "Must be a single line")
          .optional()
          .describe('The subject line. For replies use the original subject with "Re: ".'),
        body_text: z.string().optional().describe("Plain-text body."),
        body_html: z.string().optional().describe("HTML body (sent as multipart/alternative when body_text is also set)."),
        thread_id: threadIdSchema()
          .optional()
          .describe("Reply into this thread (pair with in_reply_to and a matching subject)."),
        in_reply_to: z
          .string()
          .optional()
          .describe("RFC Message-ID of the message being replied to (headers.messageId from get_message)."),
        references: z
          .string()
          .optional()
          .describe("Explicit References header chain (defaults to in_reply_to)."),
      },
    },
    async ({ to, cc, bcc, subject, body_text, body_html, thread_id, in_reply_to, references }) => {
      try {
        if (!to?.length && !cc?.length && !bcc?.length) {
          return fail(new Error("Provide at least one recipient in to, cc or bcc."));
        }
        if (subject === undefined && body_text === undefined && body_html === undefined) {
          return fail(new Error("Provide at least a subject or a body (body_text/body_html)."));
        }
        return ok(
          await client.sendMessage({
            to,
            cc,
            bcc,
            subject,
            bodyText: body_text,
            bodyHtml: body_html,
            threadId: thread_id,
            inReplyTo: in_reply_to,
            references,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "modify_message",
    {
      title: "Change message labels / state",
      annotations: UPDATE,
      description:
        "Changes a message's state via Gmail labels: read=true/false marks read/unread, starred=true/false stars/unstars, archived=true removes it from the inbox (archived=false moves it back), and add_label_ids/remove_label_ids apply or strip any labels from list_labels (e.g. a user label, or IMPORTANT). At least one change is required; applying the same change twice is harmless. This never deletes anything — use manage_trash for the trash. Returns the message's new id/labelIds.",
      inputSchema: {
        message_id: messageIdSchema(),
        read: z.boolean().optional().describe("true = mark read, false = mark unread."),
        starred: z.boolean().optional().describe("true = star, false = unstar."),
        archived: z.boolean().optional().describe("true = archive (remove from inbox), false = move back to inbox."),
        add_label_ids: z.array(labelIdSchema()).optional().describe("Label ids to add."),
        remove_label_ids: z.array(labelIdSchema()).optional().describe("Label ids to remove."),
      },
    },
    async ({ message_id, read, starred, archived, add_label_ids, remove_label_ids }) => {
      try {
        return ok(
          await client.modifyMessage(message_id, {
            read,
            starred,
            archived,
            addLabelIds: add_label_ids,
            removeLabelIds: remove_label_ids,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "manage_trash",
    {
      title: "Trash or restore mail",
      // Reversible (Gmail keeps trashed mail ~30 days) and idempotent, but it
      // does hide mail from the user — destructiveHint stays on via UPDATE.
      annotations: UPDATE,
      description:
        "Moves a message or a whole thread to the Gmail trash, or restores it. action=trash is REVERSIBLE: Gmail keeps trashed mail for about 30 days, then deletes it permanently; action=untrash restores it before that happens. target=message (default) uses a message id, target=thread trashes/restores every message in the thread. This server intentionally has no permanent-delete tool — the trash is the safety net. Note: untrash does not re-add INBOX; follow up with modify_message archived=false if it should reappear in the inbox.",
      inputSchema: {
        action: z.enum(["trash", "untrash"]).describe("trash = move to trash (reversible), untrash = restore."),
        id: z.string().min(1).describe("The message id (target=message) or thread id (target=thread)."),
        target: z
          .enum(["message", "thread"])
          .optional()
          .describe("What the id refers to (default message)."),
      },
    },
    async ({ action, id, target }) => {
      try {
        const onThread = target === "thread";
        if (action === "trash") {
          return ok(await (onThread ? client.trashThread(id) : client.trashMessage(id)));
        }
        return ok(await (onThread ? client.untrashThread(id) : client.untrashMessage(id)));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
