# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.0.0] - 2026-09-24

### Changed

- First stable release. The code is unchanged from 0.2.0; the version now states
  what was already true of it — the tool surface, tool argument shapes,
  environment variable names and response envelopes are settled, and breaking any
  of them from here on requires a major bump.

## [0.2.0] - 2026-09-20

### Added

- In-chat Google login via `@a1-x-tech/mcp-google-auth` — 6 new onboarding
  tools: `auth_status`, `setup_instructions`, `set_client`, `start_login`
  (deliberately not read-only), `finish_login`, `logout`. The flow is loopback
  `127.0.0.1` + PKCE against a user-owned Desktop OAuth client; the code is
  exchanged locally and the client secret never passes through the chat. Each
  tool has a capability page under `docs/capabilities/`.
- Tokens from a login are stored per server in
  `~/.config/mcp-google-gmail/credentials.json` (0600) and re-read on every
  call, so a login finished mid-session works without restarting the AI client.
  `GOOGLE_GMAIL_OAUTH_PORT` pins the loopback listener port for SSH forwarding.
- `finish_login` verifies a fresh login against **Gmail API** itself rather than
  Google's identity endpoint: OIDC answers even when the API is switched off in
  the Cloud project, which would make a broken setup look connected. A 403 that
  says the API is disabled is translated into the actual fix — enable it in the
  same project as the OAuth client.

### Changed

- The client accepts the component's `TokenProvider` as a fallback token
  source: environment credentials (the refresh triple or `GOOGLE_GMAIL_ACCESS_TOKEN`)
  keep absolute priority and behave exactly as before; the stored in-chat login
  is used only when the environment carries no credentials. The single 401
  re-mint + replay works for provider-backed tokens too, and is skipped when
  nothing can be re-minted.
- The unconfigured `initialize` instructions lead with the in-chat login
  (`setup_instructions` → `set_client` → `start_login` → `finish_login`, no
  restart needed); setting the environment variables + restart remains the
  documented alternative.

## [0.1.0] — 2026-08-30

### Added

- First release: a full MCP server for the Gmail API v1 (stdio, TypeScript,
  `@modelcontextprotocol/sdk` + `zod`), one mailbox (`users/me`), degraded start
  without credentials (the server completes the MCP handshake and carries the
  fix into the session instead of dying).
- Tools (18):
  - `list_messages` — Gmail-query search with metadata hydration (from/subject/
    date/snippet per hit); `get_message` — decoded headers (RFC 2047), text/HTML
    bodies (base64url + charset), attachment metadata, bounded by
    `max_body_chars` with truncation flags;
  - `send_message` — direct send with threaded-reply support (thread_id +
    In-Reply-To/References), header-injection guard, never retried after
    ambiguous failures;
  - `modify_message` / `modify_thread` — normalized read/starred/archived flags
    plus arbitrary label ids, mapped to UNREAD/STARRED/INBOX operations;
  - `manage_trash` — reversible trash/untrash for messages and threads; no
    permanent message delete tool by design;
  - drafts lifecycle: `create_draft`, `list_drafts`, `get_draft`,
    `update_draft` (full replacement), `send_draft`, `delete_draft` (permanent);
  - `list_threads`, `get_thread` — conversation search and fully decoded reads;
  - `list_labels`, `manage_labels` — label vocabulary, counts, create/update/
    delete with normalized visibility values;
  - `get_profile` — mailbox identity and the cheapest credential check;
  - `raw_request` — escape hatch to any Gmail API v1 path (SSRF-guarded,
    GET/POST/PUT/PATCH/DELETE).
- OAuth2 refresh flow: access tokens minted from
  `GOOGLE_GMAIL_CLIENT_ID`/`_CLIENT_SECRET`/`_REFRESH_TOKEN`, cached until just
  before expiry, deduped across concurrent requests and re-minted once on a 401;
  a static `GOOGLE_GMAIL_ACCESS_TOKEN` works as an alternative. Recommended
  minimal scope: `gmail.modify`.
- Resilience: request timeout covering body reads, `Retry-After`-aware backoff,
  429 retried for every method, 5xx/network retries gated to reads so a send is
  never replayed (a duplicate email cannot be unsent).
- Explicit MCP annotations per tool, pinned by tests; sending is deliberately
  annotated destructive so clients gate it behind confirmation.
- Anonymous usage telemetry (event/tool names and versions only; opt out with
  `ASKADS_TELEMETRY=0`), including degraded-start events.
- Offline test suite (100+ tests): mocked-fetch client tests incl. the OAuth
  flow and MIME build/decode, fake-server tool tests, pinned annotations,
  capability-docs coverage, plus a dist smoke test that spawns the built binary
  and performs a real MCP handshake over stdio.
- Live smoke: read-only profile fetch by default; opt-in
  `GOOGLE_GMAIL_SMOKE_WRITE=1` exercises the write path on a disposable draft
  with cleanup after success and failure.
- CI (Node 20/22/24: typecheck + build + tests) and a daily live health check
  that skips itself when repo secrets are absent.

### Fixed

- `list_messages` hydration no longer fires the whole page of metadata reads at
  once (bounded to 8 parallel GETs — a 100-hit page burst ~500 quota units
  instantly) and no longer fails the entire page when a message is deleted
  between the search and its metadata read: the racing 404 is skipped and the
  rest of the page is returned.
- `send_message` accepts cc-only/bcc-only sends: `to` is now optional and the
  requirement is at least one recipient across `to`/`cc`/`bcc`, matching what
  Gmail itself allows (previously only `create_draft` + `send_draft` could do
  this).

[1.0.0]: https://github.com/A1-x-Tech/mcp-google-gmail/releases/tag/v1.0.0
[0.2.0]: https://github.com/A1-x-Tech/mcp-google-gmail/releases/tag/v0.2.0
[0.1.0]: https://github.com/A1-x-Tech/mcp-google-gmail/releases/tag/v0.1.0
