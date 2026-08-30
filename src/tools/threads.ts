import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleGmailClient } from "../client.js";
import {
  fail,
  gmailQuerySchema,
  labelIdSchema,
  maxBodyCharsSchema,
  ok,
  READ_ONLY,
  threadIdSchema,
  UPDATE,
} from "./util.js";

export function registerThreadTools(server: McpServer, client: GoogleGmailClient): void {
  server.registerTool(
    "list_threads",
    {
      title: "Search and list threads",
      annotations: READ_ONLY,
      description:
        "Searches conversations (threads) with the same Gmail query syntax as list_messages and returns id, snippet (of the latest message) and historyId per thread. Use this instead of list_messages when the unit of work is a conversation — triaging an inbox, finding a discussion to reply into. Filter with query and/or label_ids; paginate with page_token from nextPageToken (page_size max 500). Read the full conversation with get_thread.",
      inputSchema: {
        query: gmailQuerySchema().optional(),
        label_ids: z
          .array(labelIdSchema())
          .optional()
          .describe("Only threads carrying ALL of these label ids (see list_labels)."),
        page_size: z.number().int().min(1).max(500).optional().describe("Threads per page (1..500, API default 100)."),
        page_token: z.string().optional().describe("nextPageToken from the previous page."),
        include_spam_trash: z.boolean().optional().describe("Also search SPAM and TRASH (default false)."),
      },
    },
    async ({ query, label_ids, page_size, page_token, include_spam_trash }) => {
      try {
        return ok(
          await client.listThreads({
            query,
            labelIds: label_ids,
            pageSize: page_size,
            pageToken: page_token,
            includeSpamTrash: include_spam_trash,
          }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_thread",
    {
      title: "Read a whole conversation",
      annotations: READ_ONLY,
      description:
        "Fetches a conversation with every message decoded like get_message: headers, text bodies (HTML only when a message has no text part or include_html=true), attachment metadata and truncation flags. Messages come oldest-first. To reply to the conversation, take the LAST message's threadId, headers.messageId and subject and pass them to send_message (thread_id, in_reply_to, subject with \"Re: \"). Long threads can be large — lower max_body_chars (it applies per message) when only the gist is needed.",
      inputSchema: {
        thread_id: threadIdSchema(),
        include_html: z
          .boolean()
          .optional()
          .describe("Return decoded HTML bodies even when a text body exists (default false)."),
        max_body_chars: maxBodyCharsSchema(),
      },
    },
    async ({ thread_id, include_html, max_body_chars }) => {
      try {
        return ok(
          await client.getThread(thread_id, { includeHtml: include_html, maxBodyChars: max_body_chars }),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "modify_thread",
    {
      title: "Change thread labels / state",
      annotations: UPDATE,
      description:
        "Applies the same normalized state changes as modify_message — read/unread, starred, archived, add_label_ids/remove_label_ids — to EVERY message in a conversation at once. Use it to mark a whole conversation read or archive it in one call instead of looping over messages. At least one change is required; repeating the same change is harmless. Returns the thread's new id and message label state.",
      inputSchema: {
        thread_id: threadIdSchema(),
        read: z.boolean().optional().describe("true = mark the whole thread read, false = unread."),
        starred: z.boolean().optional().describe("true = star, false = unstar."),
        archived: z.boolean().optional().describe("true = archive (remove from inbox), false = move back to inbox."),
        add_label_ids: z.array(labelIdSchema()).optional().describe("Label ids to add to every message."),
        remove_label_ids: z.array(labelIdSchema()).optional().describe("Label ids to remove from every message."),
      },
    },
    async ({ thread_id, read, starred, archived, add_label_ids, remove_label_ids }) => {
      try {
        return ok(
          await client.modifyThread(thread_id, {
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
}
