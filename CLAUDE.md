# CLAUDE.md — mcp-google-gmail

MCP server for the Gmail API v1 (TypeScript, stdio). Mixed read/write: tools
cover message/thread search and decoded reading, sending (direct and via
drafts), the full draft lifecycle, labels and the reversible trash;
`raw_request` is the escape hatch. The server talks to
`https://gmail.googleapis.com` (always `users/me` — one mailbox) with a Bearer
token; the token is minted from an OAuth2 refresh token via
`https://oauth2.googleapis.com/token` (or a static `GOOGLE_GMAIL_ACCESS_TOKEN`,
mostly for testing). There is deliberately no permanent message delete — the
trash is the safety net.

## Commands

```bash
npm run dev        # run from source (tsx watch)
npm test           # unit tests + dist smoke, no network
npm run typecheck  # types for src + tests
npm run build      # emit dist/
npm run smoke      # live check: read-only profile fetch; GOOGLE_GMAIL_SMOKE_WRITE=1 adds a disposable-draft roundtrip with cleanup in finally
```

## Architecture

- `src/config.ts` — env → config. Credentials: either the refresh triple
  `GOOGLE_GMAIL_CLIENT_ID` + `GOOGLE_GMAIL_CLIENT_SECRET` + `GOOGLE_GMAIL_REFRESH_TOKEN`
  (all three or `ConfigError` `incomplete_oauth_config`) or `GOOGLE_GMAIL_ACCESS_TOKEN`;
  optional `GOOGLE_GMAIL_API_BASE`, `GOOGLE_GMAIL_TIMEOUT_MS`, `GOOGLE_GMAIL_MAX_RETRIES`.
  No credentials at all is NOT an error: the fields stay `undefined` and the server starts
  degraded. Also home to `CredentialsError` / `MISSING_CREDENTIALS_MESSAGE` (opens with the
  historical startup error verbatim, then names the variables and the restart) and
  `hasCredentials()`.
- `src/client.ts` — all HTTP and all wire mapping. Token lifecycle (cache until ~60s before
  expiry, dedupe concurrent refreshes, one forced re-mint + replay on 401); `request()`
  resolves the path against the base and rejects foreign origins (SSRF guard), enforces an
  AbortController timeout that also covers reading the body, retries 429 always but 5xx/network
  errors **only for GET** — replaying a send after an ambiguous failure would double-send —
  and throws `GoogleGmailError(status, body)`. The MIME layer lives here too:
  `buildMimeMessage()` (RFC 2822 with base64 bodies, multipart/alternative, RFC 2047 subject,
  header-injection guard, reply headers) and `decodeMessage()` (base64url + charset decode,
  RFC 2047 header decode, attachment metadata, `maxBodyChars` truncation with flags).
  `buildLabelChanges()` maps the normalized `read`/`starred`/`archived` flags to
  `UNREAD`/`STARRED`/`INBOX` label operations.
- `src/tools/messages.ts` — `list_messages` (search + metadata hydration), `get_message`,
  `send_message`, `modify_message`, `manage_trash` (trash/untrash × message/thread).
  `src/tools/threads.ts` — `list_threads`, `get_thread`, `modify_thread`.
  `src/tools/drafts.ts` — `create_draft`, `list_drafts`, `get_draft`, `update_draft`
  (full replacement — the API has no partial draft edit), `send_draft`, `delete_draft`
  (permanent — drafts skip the trash).
  `src/tools/labels.ts` — `list_labels` (list, or one label with counts), `manage_labels`
  (create/update/delete). `src/tools/profile.ts` — `get_profile`.
  `src/tools/raw.ts` — `raw_request` (GET/POST/PUT/PATCH/DELETE). `src/tools/util.ts` —
  `ok`/`fail`, the four annotation presets (`READ_ONLY`/`WRITE`/`UPDATE`/`DESTRUCTIVE`) and
  shared zod schema factories (`messageIdSchema`, `recipientSchema`, `gmailQuerySchema`, ...).
- `src/index.ts` — wires every `register*` into the McpServer. `loadConfigOrDegraded()`
  catches `ConfigError`, pings `startup_failed` (fire-and-forget) and degrades the config to
  "no credentials"; an unconfigured start prepends `UNCONFIGURED_PREFIX` — plus
  `Configuration problem: <message>` when a ConfigError was caught — to the initialize
  `instructions`, and `oninitialized` sends `server_start` for a configured install or
  `unconfigured_start` (with the reason) otherwise.
- `src/telemetry.ts` — anonymous usage pings (ids/names/versions only, never mail or
  arguments; fire-and-forget, must never block or throw; opt-out `ASKADS_TELEMETRY=0`).
  `server_start` means "a usable install started"; `unconfigured_start` is a degraded start
  and `startup_failed` a malformed config caught at load — both carry a `reason` from a
  closed vocabulary (`missing_credentials`, `incomplete_oauth_config`) — never a variable's
  name or value.

## Conventions (do not break)

- **Never exit because of configuration.** A server that dies before the MCP handshake leaves
  the user with a red cross and no reason — telemetry across this line of servers showed that
  state accounted for nearly every unconfigured install, and almost none of them recovered.
  Missing credentials are a survivable state: start, answer initialize (with the unconfigured
  prefix in `instructions`) and tools/list, and let the first tool call fail with
  `CredentialsError` — its message names the variables to set and says to restart, because
  credentials come only from the environment. `config.test.ts`, `client.test.ts` and
  `test/dist-smoke.test.js` pin this.
- **Credential failures are not transport failures.** `CredentialsError` is thrown in
  `accessToken()` before any fetch — before the retry/backoff loop, the token mint and the
  401 replay — because retrying it burns seconds of backoff before the user sees the one
  message that helps. Pinned by the "fetch never called" assertion in `client.test.ts`.
- **Never retry a write on 5xx/network errors.** Only 429 (rejected before executing) and GET
  are safe; the gate lives in `request()` and is pinned by tests. For Gmail this is not
  bureaucracy: a replayed send is a **double-sent email that cannot be unsent**.
- **Sending is annotated DESTRUCTIVE**, not WRITE — an email is externally irreversible, so
  `send_message`/`send_draft` must be gated by clients like a deletion. Pinned in
  `annotations.test.ts`; tool descriptions steer recovery to `in:sent` / list_drafts checks,
  never to a blind re-send.
- **No permanent message delete tool, ever.** `manage_trash` is the removal path (reversible
  ~30 days). `raw_request` can technically delete (and says so with a warning); don't add a
  typed tool for it.
- **Wire mapping lives in the client, not the tools.** Tools accept the normalized snake_case
  vocabulary (`read`/`starred`/`archived` flags, `show_if_unread`, `body_text`) and must not
  build MIME, touch base64url or know wire enums (`labelShowIfUnread`, `raw`) — add any
  mapping in `client.ts`.
- **Auth is the client's job.** Tools never see tokens; the Bearer header, refresh, caching
  and the 401 replay all live in `request()`/`accessToken()`.
- **Decoded output is bounded.** `decodeMessage` truncates bodies at `maxBodyChars` (default
  50000) with explicit `*Truncated` flags and returns attachment **metadata** only — a
  newsletter must not silently flood the model's context, and attachment bytes go through
  `raw_request` deliberately.
- **Header values are injection-checked.** `buildMimeMessage` throws on CR/LF in addresses,
  subject and reply headers; the zod schemas reject them earlier. Never "sanitize" silently.
- **Validate inputs with zod** in `inputSchema`; reuse the shared schema **factories** in
  `util.ts` (a fresh schema per field avoids `$ref` dedup in the JSON schema).
- **Annotations are pinned per tool** in `annotations.test.ts` — changing one is a conscious
  decision that updates the map, with all four hints always set.
- **Output compact JSON via `ok`** — the consumer is an LLM; pretty-printing burns tokens.
  Describe result fields in the tool `description` (the only place the external model reads).
- **No secrets or mail content in logs/errors.** Error messages carry only Google's error
  envelope text; telemetry carries only event/tool names and versions.

## Adding a tool

Before changing the tool registry, read [the MCP capability documentation contract](docs/CAPABILITY-DOCUMENTATION.md). Every registered tool must have exactly one task-oriented page in `docs/capabilities/`; update that page, the index, and the coverage test in the same change.

1. Add (or extend) `src/tools/<name>.ts` with `register<Name>Tools(server, client)`.
2. If it hits a new endpoint, add a method to `src/client.ts` with the wire mapping.
3. Import and call the register fn in `src/index.ts`.
4. Add a `*.test.ts` using the mock-fetch (client) / fake-client (tools) harness — no
   network — and add the tool + hints to `annotations.test.ts` and `test/dist-smoke.test.js`.
5. `npm run typecheck && npm test`.

## Releasing

Keep the version in sync across **all** channels in one go (`git push --follow-tags` pushes
the tag but does **not** create a GitHub Release; the registry is immutable per version):

1. Bump `version` in **three places, identically**: `package.json`, and in `server.json`
   **both** the root `version` **and** `packages[0].version`. `mcpName` in `package.json` must
   match `name` in `server.json` (`io.github.A1-x-Tech/mcp-google-gmail`). Verify:
   `grep -n '"version"' package.json server.json`.
   > ⚠️ `mcp-publisher` publishes the **root** `server.json.version`. A stale root makes
   > `mcp-publisher publish` fail with a misleading `400 cannot publish duplicate version`
   > while `npm publish` succeeds.
2. Update `CHANGELOG.md`, then `npm publish` (runs typecheck + tests + build via
   `prepublishOnly` / `prepare`).
3. `git commit`, `git tag -a vX.Y.Z -m vX.Y.Z`, `git push origin main --follow-tags`.
4. **GitHub Release:** `gh release create vX.Y.Z --title vX.Y.Z --generate-notes --verify-tag`.
5. **Official MCP registry:** `mcp-publisher publish` (login with
   `mcp-publisher login github --token "$(gh auth token)"`).
