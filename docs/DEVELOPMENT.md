# Development

## Requirements

- Node.js 20+ (the published package ships compiled `dist/`; `npx` needs no separate
  install). CI runs the suite on Node 20, 22 and 24.

## Commands

```bash
npm install
npm run dev        # run from source with tsx watch
npm test           # unit tests (node:test) + dist smoke, no network
npm run typecheck  # type-check src + tests (no emit)
npm run build      # clean dist/ and compile with tsc
npm run smoke      # live check (read-only by default; see below)
```

## Local run

```bash
npm run build
GOOGLE_GMAIL_CLIENT_ID=... GOOGLE_GMAIL_CLIENT_SECRET=... GOOGLE_GMAIL_REFRESH_TOKEN=... \
  node dist/index.js
# or, for a quick session with a short-lived token:
GOOGLE_GMAIL_ACCESS_TOKEN=$(gcloud auth print-access-token) node dist/index.js
# optional: GOOGLE_GMAIL_API_BASE, GOOGLE_GMAIL_TIMEOUT_MS, GOOGLE_GMAIL_MAX_RETRIES
```

## Live smoke

`npm run smoke` performs one live read: it fetches the mailbox profile (email address and
message counts), exercising the whole credential path without touching any mail.

Opt-in write scenario on a **disposable resource**: `GOOGLE_GMAIL_SMOKE_WRITE=1 npm run smoke`
additionally creates a clearly-labelled draft addressed to the mailbox itself, reads it back,
and deletes it in a `finally` block — the cleanup runs after success **and** after a failure,
so no smoke litter survives. Nothing is ever sent.

## OAuth scope

The recommended minimal scope is `https://www.googleapis.com/auth/gmail.modify` — it covers
every typed tool (read, send, drafts, labels, trash) while **excluding** permanent message
deletion and account settings, which need the full `https://mail.google.com/` scope this
server deliberately does not require. A refresh token minted with only `gmail.readonly` also
works for the read tools; write tools then fail with a 403 from Google.

## Tests

Unit tests mock `globalThis.fetch` (client) or use a fake server + fake client (tools), so
the whole suite runs offline — including the OAuth refresh flow, whose token endpoint is
served by the same fetch stub. `test/dist-smoke.test.js` additionally spawns the built
`dist/index.js` and performs a real MCP handshake over stdio through the official SDK,
asserting the server identity and the full tool list. Put a `*.test.ts` next to the code it
covers; `npm run typecheck && npm test` is the gate (also run by `prepublishOnly`).

## Usage telemetry

The server sends anonymous events to `usage.gistrec.cloud` (`server_start` when a client
connects to a configured install, `unconfigured_start` when a client connects to a server
without credentials, `tool_call` with the tool **name**, and `startup_failed` with a
fixed-vocabulary reason code when the configuration is malformed) to count active installs
and tool demand. An event carries only impersonal technical fields: a random installation id
(`~/.config/mcp-google-gmail/instance-id`), the package version, the AI client's name and
version from the MCP handshake, the Node.js version and the OS.

OAuth credentials, mail content, tool arguments and prompts are never sent or stored
(implementation: `src/telemetry.ts`). Sends run in the background with a 2 s timeout and are
silently skipped on any error. Opt out for all servers of this line at once:
`ASKADS_TELEMETRY=0`.
