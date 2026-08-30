# <img src="./assets/a1-logo.svg" alt="A1" width="40"> Gmail MCP

[![CI](https://github.com/A1-x-Tech/mcp-google-gmail/actions/workflows/ci.yml/badge.svg)](https://github.com/A1-x-Tech/mcp-google-gmail/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

MCP server for the **Gmail API v1** (TypeScript, stdio): search, read and send email, manage
drafts, labels and the reversible trash from Claude, Cursor, Codex and other MCP clients.

> Technical README. Full product documentation and marketing are the next task; the technical
> reference lives in [docs/TOOLS.md](./docs/TOOLS.md) and the task-oriented catalog in
> [docs/capabilities/](./docs/capabilities/index.md).

## Tools (18)

| Group | Tools |
|---|---|
| Messages | `list_messages`, `get_message`, `send_message`, `modify_message`, `manage_trash` |
| Threads | `list_threads`, `get_thread`, `modify_thread` |
| Drafts | `create_draft`, `list_drafts`, `get_draft`, `update_draft`, `send_draft`, `delete_draft` |
| Labels | `list_labels`, `manage_labels` |
| Profile | `get_profile` |
| Escape hatch | `raw_request` |

Design highlights:

- **Gmail query syntax** everywhere (`from:`, `is:unread`, `newer_than:7d`, ...); message
  listings are hydrated with from/subject/date summaries.
- **Full decoding**: base64url/charset bodies, RFC 2047 headers, attachment metadata,
  bounded output (`max_body_chars` + truncation flags).
- **Sends are gated**: `send_message`/`send_draft` carry destructive annotations, are never
  retried after ambiguous failures, and the draft → review → send path is first-class.
- **Reversible trash**, no permanent message delete tool; `delete_draft` is the only
  permanent operation (drafts skip the trash by API design).
- **Degraded start**: without credentials the server still answers `initialize` and
  `tools/list`, and every call fails with the exact fix.

## Quick start

Requires Node.js 20+ and Google OAuth credentials with the Gmail API enabled
(recommended minimal scope: `https://www.googleapis.com/auth/gmail.modify`).

```jsonc
// MCP client config
{
  "mcpServers": {
    "gmail": {
      "command": "npx",
      "args": ["-y", "mcp-google-gmail@latest"],
      "env": {
        "GOOGLE_GMAIL_CLIENT_ID": "…",
        "GOOGLE_GMAIL_CLIENT_SECRET": "…",
        "GOOGLE_GMAIL_REFRESH_TOKEN": "…"
      }
    }
  }
}
```

Alternative for a quick session: `GOOGLE_GMAIL_ACCESS_TOKEN` with a short-lived token
(e.g. `gcloud auth print-access-token`). Optional: `GOOGLE_GMAIL_API_BASE`,
`GOOGLE_GMAIL_TIMEOUT_MS`, `GOOGLE_GMAIL_MAX_RETRIES`.

## Documentation

- [docs/TOOLS.md](./docs/TOOLS.md) — technical tool reference, retry policy, quotas, env vars.
- [docs/capabilities/index.md](./docs/capabilities/index.md) — task-oriented page per tool.
- [docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md) — build, tests, live smoke (incl. the opt-in
  disposable-draft write scenario), telemetry details.
- [docs/PUBLISHING.md](./docs/PUBLISHING.md) — release process across npm / GitHub / MCP registry.
- [CLAUDE.md](./CLAUDE.md) — architecture and engineering conventions.

## Telemetry

Anonymous usage pings (event/tool names, versions — never mail content, arguments or
credentials) to `usage.gistrec.cloud`. Opt out: `ASKADS_TELEMETRY=0`. Details in
[docs/DEVELOPMENT.md](./docs/DEVELOPMENT.md#usage-telemetry).

## License

[MIT](./LICENSE)
