import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleGmailClient } from "../client.js";
import {
  DESTRUCTIVE,
  draftIdSchema,
  fail,
  gmailQuerySchema,
  maxBodyCharsSchema,
  ok,
  READ_ONLY,
  recipientSchema,
  threadIdSchema,
  UPDATE,
  WRITE,
} from "./util.js";

/** The shared outgoing-email fields (create_draft and update_draft take the same shape). */
function emailFields() {
  return {
    to: z.array(recipientSchema()).optional().describe("Primary recipients (optional for a draft)."),
    cc: z.array(recipientSchema()).optional().describe("Carbon-copy recipients."),
    bcc: z.array(recipientSchema()).optional().describe("Blind-copy recipients."),
    subject: z
      .string()
      .regex(/^[^\r\n]*$/, "Must be a single line")
      .optional()
      .describe("The subject line."),
    body_text: z.string().optional().describe("Plain-text body."),
    body_html: z.string().optional().describe("HTML body (multipart/alternative when body_text is also set)."),
    thread_id: threadIdSchema()
      .optional()
      .describe("Make it a reply draft in this thread (pair with in_reply_to and a matching subject)."),
    in_reply_to: z
      .string()
      .optional()
      .describe("RFC Message-ID of the message being replied to (headers.messageId from get_message)."),
    references: z.string().optional().describe("Explicit References header chain (defaults to in_reply_to)."),
  };
}

interface EmailArgs {
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  body_text?: string;
  body_html?: string;
  thread_id?: string;
  in_reply_to?: string;
  references?: string;
}

function toEmailParams(a: EmailArgs) {
  return {
    to: a.to,
    cc: a.cc,
    bcc: a.bcc,
    subject: a.subject,
    bodyText: a.body_text,
    bodyHtml: a.body_html,
    threadId: a.thread_id,
    inReplyTo: a.in_reply_to,
    references: a.references,
  };
}

export function registerDraftTools(server: McpServer, client: GoogleGmailClient): void {
  server.registerTool(
    "create_draft",
    {
      title: "Create a draft",
      annotations: WRITE,
      description:
        "Creates a draft email in the mailbox without sending anything. All fields are optional — an empty draft is legal — but a useful one carries to[], subject and a body. For a reply draft set thread_id, in_reply_to (headers.messageId of the message being answered, via get_message) and the original subject with \"Re: \". Returns the draft id (needed by update_draft/send_draft/delete_draft) and the underlying message id/threadId. Drafting first and sending with send_draft after a human look is the safe path for consequential mail — prefer it over send_message when in doubt.",
      inputSchema: emailFields(),
    },
    async (args) => {
      try {
        return ok(await client.createDraft(toEmailParams(args)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_drafts",
    {
      title: "List drafts",
      annotations: READ_ONLY,
      description:
        "Lists the mailbox's drafts: draft id plus the underlying message's id and threadId (no subjects — read one with get_draft). query filters with Gmail query syntax (e.g. subject:invoice); paginate with page_token from nextPageToken.",
      inputSchema: {
        query: gmailQuerySchema().optional(),
        page_size: z.number().int().min(1).max(500).optional().describe("Drafts per page (1..500, API default 100)."),
        page_token: z.string().optional().describe("nextPageToken from the previous page."),
      },
    },
    async ({ query, page_size, page_token }) => {
      try {
        return ok(await client.listDrafts({ query, pageSize: page_size, pageToken: page_token }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_draft",
    {
      title: "Read a draft",
      annotations: READ_ONLY,
      description:
        "Fetches one draft with its message decoded like get_message: headers (to, cc, subject, ...), text body, HTML only on request, attachment metadata. Use it to show the user what send_draft would send, or to read the current content before update_draft (updates REPLACE the whole draft).",
      inputSchema: {
        draft_id: draftIdSchema(),
        include_html: z
          .boolean()
          .optional()
          .describe("Return the decoded HTML body even when a text body exists (default false)."),
        max_body_chars: maxBodyCharsSchema(),
      },
    },
    async ({ draft_id, include_html, max_body_chars }) => {
      try {
        return ok(await client.getDraft(draft_id, { includeHtml: include_html, maxBodyChars: max_body_chars }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "update_draft",
    {
      title: "Update a draft",
      annotations: UPDATE,
      description:
        "REPLACES a draft's entire message — the Gmail API has no partial draft edit, so omitted fields are dropped, not kept. Read the current content with get_draft first, then pass the complete new state (recipients, subject, body, and thread_id/in_reply_to for reply drafts). The draft id stays the same; the underlying message id changes. Returns the updated draft.",
      inputSchema: { draft_id: draftIdSchema(), ...emailFields() },
    },
    async (args) => {
      try {
        const { draft_id, ...rest } = args;
        return ok(await client.updateDraft(draft_id, toEmailParams(rest)));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "send_draft",
    {
      title: "Send a draft",
      // Sending is externally irreversible — annotate for the worst case.
      annotations: DESTRUCTIVE,
      description:
        "Sends an existing draft exactly as it is stored, immediately and irreversibly; the draft disappears from the drafts list and becomes a sent message (returned id/threadId). Verify the content with get_draft before calling this. NEVER retried after a timeout or 5xx (a duplicate email cannot be unsent): if the outcome is unclear, check list_drafts (the draft is gone if it was sent) or list_messages in:sent before considering anything else. Daily sending limits apply (~500/day consumer, ~2000/day Workspace).",
      inputSchema: { draft_id: draftIdSchema() },
    },
    async ({ draft_id }) => {
      try {
        return ok(await client.sendDraft(draft_id));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_draft",
    {
      title: "Delete a draft",
      annotations: DESTRUCTIVE,
      description:
        "PERMANENTLY deletes a draft — drafts skip the trash, so there is no undo and no manage_trash recovery. Confirm with get_draft before deleting anything the user might still want. Returns empty on success.",
      inputSchema: { draft_id: draftIdSchema() },
    },
    async ({ draft_id }) => {
      try {
        return ok((await client.deleteDraft(draft_id)) ?? { deleted: true });
      } catch (e) {
        return fail(e);
      }
    },
  );
}
