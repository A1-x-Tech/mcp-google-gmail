import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { GoogleGmailClient, HttpMethod } from "../client.js";
import { DESTRUCTIVE, fail, ok } from "./util.js";

export function registerRawTool(server: McpServer, client: GoogleGmailClient): void {
  server.registerTool(
    "raw_request",
    {
      title: "Raw Gmail API call",
      // Full API surface incl. permanent deletion and settings — annotate for
      // the worst case a call can do, not the average.
      annotations: DESTRUCTIVE,
      description:
        'Escape hatch to call any Gmail API v1 path directly, for requests the typed tools don\'t cover — e.g. downloading attachment content ("gmail/v1/users/me/messages/<messageId>/attachments/<attachmentId>", returns base64url data), history.list for incremental sync ("gmail/v1/users/me/history?startHistoryId=..."), batchModify, or settings endpoints (filters, forwarding, vacation). The path may carry a query string. The Bearer token is added automatically; the method defaults to GET. CAUTION: this bypasses the typed tools\' guard rails — users/me/messages/<id> DELETE is a PERMANENT delete that skips the trash (needs the full https://mail.google.com/ scope); prefer manage_trash.',
      inputSchema: {
        path: z
          .string()
          .min(1)
          .describe('API path relative to https://gmail.googleapis.com, e.g. "gmail/v1/users/me/history?startHistoryId=123".'),
        method: z
          .enum(["GET", "POST", "PUT", "PATCH", "DELETE"])
          .optional()
          .describe("HTTP method. Defaults to GET."),
        body: z.record(z.any()).optional().describe("JSON request body (POST/PUT/PATCH)."),
      },
    },
    async ({ path, method, body }) => {
      try {
        const m = (method ?? "GET") as HttpMethod;
        return ok(await client.request(m, path, body));
      } catch (e) {
        return fail(e);
      }
    },
  );
}
