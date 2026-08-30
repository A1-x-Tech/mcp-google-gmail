import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleGmailClient } from "../client.js";
import { DESTRUCTIVE, fail, labelIdSchema, ok, READ_ONLY } from "./util.js";

export function registerLabelTools(server: McpServer, client: GoogleGmailClient): void {
  server.registerTool(
    "list_labels",
    {
      title: "List labels",
      annotations: READ_ONLY,
      description:
        "Without label_id: lists every label in the mailbox — system labels (INBOX, SENT, DRAFT, SPAM, TRASH, UNREAD, STARRED, IMPORTANT, CATEGORY_*) and user labels with their ids — the vocabulary that list_messages label_ids and modify_message add/remove_label_ids speak. With label_id: fetches that one label including its counts (messagesTotal, messagesUnread, threadsTotal, threadsUnread), which the plain list does not carry.",
      inputSchema: {
        label_id: labelIdSchema().optional().describe("Fetch one label with counts instead of listing all."),
      },
    },
    async ({ label_id }) => {
      try {
        return ok(await (label_id ? client.getLabel(label_id) : client.listLabels()));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "manage_labels",
    {
      title: "Create, rename or delete a label",
      // delete removes the label from every message it was applied to, so the
      // whole tool carries the destructive, non-idempotent hints.
      annotations: DESTRUCTIVE,
      description:
        'Manages user labels. action=create needs name (nest with "/", e.g. "Clients/Acme" — the parent must already exist). action=update needs label_id plus at least one of name, label_list_visibility (show | show_if_unread | hide — the label in the sidebar) or message_list_visibility (show | hide — its messages in the list); only the provided fields change. action=delete needs label_id and removes the label from EVERY message it was applied to — the messages survive, the label and its message-associations do not; this cannot be undone. System labels (INBOX, STARRED, ...) cannot be created, renamed or deleted. To apply/remove labels on mail, use modify_message or modify_thread, not this tool.',
      inputSchema: {
        action: z.enum(["create", "update", "delete"]).describe("What to do with the label."),
        label_id: labelIdSchema().optional().describe("update/delete: the user label to target."),
        name: z
          .string()
          .min(1)
          .optional()
          .describe('create (required) / update: the label name, e.g. "Invoices" or nested "Clients/Acme".'),
        label_list_visibility: z
          .enum(["show", "show_if_unread", "hide"])
          .optional()
          .describe("Sidebar visibility of the label itself."),
        message_list_visibility: z
          .enum(["show", "hide"])
          .optional()
          .describe("Whether the label's messages show in the message list."),
      },
    },
    async ({ action, label_id, name, label_list_visibility, message_list_visibility }) => {
      try {
        switch (action) {
          case "create":
            if (!name) return fail(new Error('action "create" requires name.'));
            return ok(
              await client.createLabel({
                name,
                labelListVisibility: label_list_visibility,
                messageListVisibility: message_list_visibility,
              }),
            );
          case "update":
            if (!label_id) return fail(new Error('action "update" requires label_id.'));
            return ok(
              await client.updateLabel(label_id, {
                name,
                labelListVisibility: label_list_visibility,
                messageListVisibility: message_list_visibility,
              }),
            );
          case "delete":
            if (!label_id) return fail(new Error('action "delete" requires label_id.'));
            return ok((await client.deleteLabel(label_id)) ?? { deleted: true });
        }
      } catch (e) {
        return fail(e);
      }
    },
  );
}
