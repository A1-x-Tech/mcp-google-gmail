#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GoogleGmailClient } from "./client.js";
import { ConfigError, DEFAULT_BASE, hasCredentials, loadConfig } from "./config.js";
import { instrumentToolCalls, Telemetry } from "./telemetry.js";
import type { GoogleGmailConfig } from "./types.js";
import { registerMessageTools } from "./tools/messages.js";
import { registerThreadTools } from "./tools/threads.js";
import { registerDraftTools } from "./tools/drafts.js";
import { registerLabelTools } from "./tools/labels.js";
import { registerProfileTools } from "./tools/profile.js";
import { registerRawTool } from "./tools/raw.js";

/**
 * Prose handed to the calling model in the `initialize` result — the only place
 * it learns what the tool list cannot say: which mailbox this is, what cannot
 * be undone, and the behaviours that make a naive loop expensive, lossy or
 * duplicating.
 */
const INSTRUCTIONS =
  "Gmail API v1 works on ONE mailbox — the account that granted the OAuth token; there is no " +
  "cross-account access. Search uses Gmail query syntax (from:, subject:, is:unread, label:, " +
  "newer_than:7d ...). Read/unread, star and archive are label operations (UNREAD/STARRED/INBOX) " +
  "via modify_message; get label ids from list_labels. SENDING IS IRREVERSIBLE: send_message and " +
  "send_draft fire immediately, and a failed-looking send is never retried by this server — check " +
  "list_messages in:sent (or whether the draft disappeared) before re-sending, or you will double-" +
  "send. For consequential mail prefer create_draft + human review + send_draft. Replies thread " +
  "only when thread_id, in_reply_to (the RFC messageId from get_message) and a matching \"Re: \" " +
  "subject all line up. manage_trash is reversible for ~30 days; delete_draft is permanent; there " +
  "is deliberately no permanent message delete (raw_request can, but needs the full mail scope). " +
  "get_message returns attachment METADATA only — content goes through raw_request. Watch quotas: " +
  "roughly 250 API units/second per user (a send costs 100, a get 5) and ~500 sends/day on consumer " +
  "accounts (~2000 on Workspace). If auth suddenly dies, the OAuth consent screen is usually still " +
  "in Testing, where refresh tokens expire after 7 days.";

/**
 * Prepended to INSTRUCTIONS when no credentials are configured. The model reads
 * this before it picks a tool, so an unconfigured session opens with the fix
 * rather than with a failed call. There is no in-chat login here: credentials
 * come only from the environment, so the fix is an operator action + restart.
 */
const UNCONFIGURED_PREFIX =
  "ATTENTION: Gmail is not connected yet — no credentials are configured, so every " +
  "tool call will fail. The operator must set GOOGLE_GMAIL_CLIENT_ID + " +
  "GOOGLE_GMAIL_CLIENT_SECRET + GOOGLE_GMAIL_REFRESH_TOKEN (recommended), or " +
  "GOOGLE_GMAIL_ACCESS_TOKEN with a short-lived access token, in the MCP client's " +
  "server config and restart this server — the variables are read only at startup. ";

/** Reads the package version so the server reports its real version to MCP clients. */
function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof pkg.version === "string" ? pkg.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Loads the config without dying on a bad value. A server that exits here never
 * completes the MCP handshake, so the user sees a dead server and no reason.
 * Instead the problem is carried into the session, where the model can read it
 * and relay it: the config degrades to "no credentials" and every tool call
 * fails with the actionable message.
 */
function loadConfigOrDegraded(telemetry: Telemetry): {
  config: GoogleGmailConfig;
  problem?: ConfigError;
} {
  try {
    return { config: loadConfig() };
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    console.error(`Error: ${err.message}`);
    // Fire-and-forget now that the process survives: the historical
    // `startup_failed` funnel stays comparable, but nothing blocks startup.
    telemetry.send("startup_failed", { reason: err.reason });
    return {
      config: { apiBase: process.env.GOOGLE_GMAIL_API_BASE || DEFAULT_BASE },
      problem: err,
    };
  }
}

async function main(): Promise<void> {
  // Anonymous usage pings (ids/names/versions only, never data or arguments);
  // opt out with ASKADS_TELEMETRY=0. Built before the config so missing
  // credentials can be reported; wired to the server before tools register.
  const telemetry = new Telemetry(readVersion());
  const { config, problem } = loadConfigOrDegraded(telemetry);
  const client = new GoogleGmailClient(config);

  // Decided once, at startup: credentials come only from the environment, so
  // "restart after setting the variables" is the accurate advice to give.
  const connected = hasCredentials(config);

  const server = new McpServer(
    {
      name: "mcp-google-gmail",
      version: readVersion(),
    },
    // Surfaces in the initialize result, before the client sees a single tool.
    {
      instructions: connected
        ? INSTRUCTIONS
        : UNCONFIGURED_PREFIX + (problem ? `Configuration problem: ${problem.message} ` : "") + INSTRUCTIONS,
    },
  );

  instrumentToolCalls(server, telemetry);
  server.server.oninitialized = () => {
    telemetry.setClientInfo(server.server.getClientVersion());
    // Split on purpose: `server_start` keeps meaning "a usable install started",
    // so the unconfigured case gets its own event instead of inflating that number.
    if (connected) telemetry.send("server_start");
    else telemetry.send("unconfigured_start", { reason: problem?.reason ?? "missing_credentials" });
  };

  registerMessageTools(server, client);
  registerThreadTools(server, client);
  registerDraftTools(server, client);
  registerLabelTools(server, client);
  registerProfileTools(server, client);
  registerRawTool(server, client);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `mcp-google-gmail running on stdio${connected ? "" : " (no credentials — set the environment variables and restart)"}`,
  );
}

main().catch((err) => {
  console.error("Fatal error starting mcp-google-gmail:", err);
  process.exit(1);
});
