import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { GoogleGmailClient } from "../dist/client.js";
import { registerMessageTools } from "../dist/tools/messages.js";
import { registerThreadTools } from "../dist/tools/threads.js";
import { registerDraftTools } from "../dist/tools/drafts.js";
import { registerLabelTools } from "../dist/tools/labels.js";
import { registerProfileTools } from "../dist/tools/profile.js";
import { registerRawTool } from "../dist/tools/raw.js";

const ALL_TOOLS = [
  "create_draft",
  "delete_draft",
  "get_draft",
  "get_message",
  "get_profile",
  "get_thread",
  "list_drafts",
  "list_labels",
  "list_messages",
  "list_threads",
  "manage_labels",
  "manage_trash",
  "modify_message",
  "modify_thread",
  "raw_request",
  "send_draft",
  "send_message",
  "update_draft",
];

test("dist client rejects foreign-origin paths before sending the Bearer token", async () => {
  const original = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => {
    called = true;
    return new Response("{}", { status: 200 });
  };
  try {
    const client = new GoogleGmailClient({
      accessToken: "SECRET",
      apiBase: "https://gmail.googleapis.com",
      timeoutMs: 1000,
      maxRetries: 0,
    });
    await assert.rejects(() => client.request("GET", "https://example.invalid/steal"), /foreign origin/);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = original;
  }
});

test("dist client sends the Bearer token and JSON bodies", async () => {
  const original = globalThis.fetch;
  let seen;
  globalThis.fetch = async (url, init) => {
    seen = { url: String(url), auth: init.headers.Authorization, body: JSON.parse(init.body) };
    return new Response('{"id":"m-1"}', { status: 200 });
  };
  try {
    const client = new GoogleGmailClient({
      accessToken: "SECRET",
      apiBase: "https://gmail.googleapis.com",
      timeoutMs: 1000,
      maxRetries: 0,
    });
    await client.sendMessage({ to: ["smoke@example.com"], subject: "Smoke", bodyText: "hi" });
    assert.equal(seen.url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
    assert.equal(seen.auth, "Bearer SECRET");
    const mime = Buffer.from(seen.body.raw, "base64url").toString("utf8");
    assert.match(mime, /To: smoke@example\.com\r\n/);
    assert.match(mime, /Subject: Smoke\r\n/);
  } finally {
    globalThis.fetch = original;
  }
});

test("dist registers the expected tools", () => {
  const names = [];
  const server = {
    registerTool(name) {
      names.push(name);
    },
  };
  const client = {};

  registerMessageTools(server, client);
  registerThreadTools(server, client);
  registerDraftTools(server, client);
  registerLabelTools(server, client);
  registerProfileTools(server, client);
  registerRawTool(server, client);

  assert.deepEqual(names.sort(), ALL_TOOLS);
});

test("dist binary completes a real MCP handshake over stdio and lists every tool", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env: {
      ...process.env,
      GOOGLE_GMAIL_ACCESS_TOKEN: "test-token",
      ASKADS_TELEMETRY: "0", // keep the suite offline
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "dist-smoke", version: "0.0.0" });
  await client.connect(transport);
  try {
    const server = client.getServerVersion();
    assert.equal(server?.name, "mcp-google-gmail");
    assert.match(String(server?.version), /^\d+\.\d+\.\d+$/);

    // The instructions the calling model reads before it picks any tool.
    const instructions = client.getInstructions();
    assert.equal(typeof instructions, "string");
    assert.ok(instructions.trim().length > 0, "initialize result carries no instructions");
    assert.match(instructions, /Gmail API v1/);
    assert.match(instructions, /SENDING IS IRREVERSIBLE/);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ALL_TOOLS);

    const getMessage = tools.find((t) => t.name === "get_message");
    assert.equal(getMessage.annotations?.readOnlyHint, true);
    assert.ok(getMessage.inputSchema?.properties?.message_id, "input schema must reach the client");

    const sendMessage = tools.find((t) => t.name === "send_message");
    assert.equal(sendMessage.annotations?.destructiveHint, true, "send must be gated as destructive");
  } finally {
    await client.close();
  }
});

/**
 * The degraded-start contract: without any credentials the binary must start,
 * list every tool, open the instructions with the fix, and answer a tool call
 * with the actionable error — offline: the CredentialsError fires before any
 * fetch, so this test never touches the network.
 */
test("dist binary starts without credentials: handshake, tool list, actionable call error", async () => {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key, value]) => value !== undefined && !key.startsWith("GOOGLE_GMAIL_"),
    ),
  );
  env.ASKADS_TELEMETRY = "0"; // keep the suite offline
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../dist/index.js", import.meta.url))],
    env,
    stderr: "pipe",
  });
  const client = new Client({ name: "dist-smoke-unconfigured", version: "0.0.0" });
  await client.connect(transport);
  try {
    // The model must read the fix before it picks a tool.
    const instructions = client.getInstructions() ?? "";
    assert.match(instructions, /not connected/);
    assert.match(instructions, /GOOGLE_GMAIL_CLIENT_ID/);
    assert.match(instructions, /restart/);

    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ALL_TOOLS);

    // A tool call fails with the exact message instead of killing the server.
    const result = await client.callTool({ name: "get_profile", arguments: {} });
    assert.equal(result.isError, true);
    const text = result.content.map((c) => c.text ?? "").join(" ");
    assert.match(text, /Google OAuth credentials are required: set GOOGLE_GMAIL_CLIENT_ID/);
    assert.match(text, /restart the server/);
  } finally {
    await client.close();
  }
});
