import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GoogleGmailClient } from "../client.js";
import { fail, ok, READ_ONLY } from "./util.js";

export function registerProfileTools(server: McpServer, client: GoogleGmailClient): void {
  server.registerTool(
    "get_profile",
    {
      title: "Get the mailbox profile",
      annotations: READ_ONLY,
      description:
        "Returns the authenticated mailbox's profile: emailAddress (the user's own address — useful for send-to-self checks and for recognizing the user's messages in threads), messagesTotal, threadsTotal and historyId. The cheapest way to verify that the OAuth credentials work.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.getProfile());
      } catch (e) {
        return fail(e);
      }
    },
  );
}
