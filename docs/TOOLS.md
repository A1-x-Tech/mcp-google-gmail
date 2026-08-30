# Tools

For task-oriented guidance, open the [MCP capability catalog](./capabilities/index.md). This page remains the technical reference for schemas and API responses.

Gmail mixes reads with irreversible writes, so every tool carries explicit MCP
annotations: reads are `readOnlyHint`; sending and permanent deletion are
destructive and non-idempotent; label/trash changes are idempotent-but-
overwriting. Inputs use a normalized snake_case vocabulary; the client maps
them to the API's wire values (system label ids, `labelShowIfUnread`,
base64url `raw` MIME) and handles OAuth entirely on its own.

Ids: `message_id`/`thread_id` come from `list_messages`/`list_threads` (or a
decoded message's `id`/`threadId`), `draft_id` from `list_drafts`/`create_draft`,
`label_id` from `list_labels`. The RFC `Message-ID` **header** (used for reply
threading via `in_reply_to`) is a different thing — read it from a decoded
message's `headers.messageId`.

## Messages

| Tool | Description |
|---|---|
| `list_messages` | Searches with Gmail **query syntax** (`from:`, `subject:`, `is:unread`, `label:`, `has:attachment`, `newer_than:7d`, ...) and/or `label_ids`. By default each hit is hydrated with one metadata read (from/to/subject/date/snippet), throttled to a few reads in parallel; a hit deleted mid-search (404) is skipped, not a page failure. `include_metadata: false` returns bare ids in a single request. `page_size` ≤ 100 (default 25), paginate via `page_token`. |
| `get_message` | One message decoded: RFC 2047 headers, text body (base64url + charset decoded), HTML only when there is no text part or `include_html: true`, attachment **metadata** (`filename`, `mimeType`, `sizeBytes`, `attachmentId`) — content via `raw_request`. Bodies truncate at `max_body_chars` (default 50000) with `textTruncated`/`htmlTruncated` flags. `metadata_only: true` skips bodies. |
| `send_message` | Sends immediately and irreversibly. Needs at least one recipient across `to`/`cc`/`bcc` (bcc-only is allowed) + a subject or body; `body_text` + `body_html` become multipart/alternative. Replies need `thread_id` + `in_reply_to` (the RFC `headers.messageId` from `get_message`) + the original subject with `Re: `. **Never retried** after a 5xx/timeout — check `in:sent` before re-sending. |
| `modify_message` | Normalized state flags — `read`, `starred`, `archived` — plus `add_label_ids`/`remove_label_ids`. Mapped to `UNREAD`/`STARRED`/`INBOX` label operations by the client; at least one change required. |
| `manage_trash` | `action: trash \| untrash`, `target: message \| thread` (default message). Trash is **reversible** for ~30 days; there is deliberately no permanent-delete tool. `untrash` does not restore `INBOX` — follow with `modify_message archived: false`. |

## Threads

| Tool | Description |
|---|---|
| `list_threads` | Same query syntax; returns thread ids + snippets (no hydration needed). `page_size` ≤ 500. |
| `get_thread` | Whole conversation, every message decoded like `get_message` (oldest first). `max_body_chars` applies per message. |
| `modify_thread` | The `modify_message` flags applied to every message in the thread at once. |

## Drafts

| Tool | Description |
|---|---|
| `create_draft` | Creates a draft (all fields optional; reply drafts take `thread_id` + `in_reply_to`). Returns the `draft_id` the other draft tools need. |
| `list_drafts` | Draft ids + underlying message ids; `query` filters with Gmail query syntax. |
| `get_draft` | One draft with its message decoded. |
| `update_draft` | **Replaces** the whole draft message — the API has no partial draft edit; omitted fields are dropped. Read with `get_draft` first. |
| `send_draft` | Sends the draft as stored, irreversibly; the draft disappears. Never retried — if unclear, check whether the draft is gone. |
| `delete_draft` | **Permanent** — drafts skip the trash. |

## Labels

| Tool | Description |
|---|---|
| `list_labels` | All labels (system + user) with ids; with `label_id` fetches one label including its counts (`messagesTotal`, `messagesUnread`, ...). |
| `manage_labels` | `action: create` (needs `name`; nest with `/`), `update` (patch of `name` / `label_list_visibility` `show\|show_if_unread\|hide` / `message_list_visibility` `show\|hide`), `delete` (removes the label from every message; irreversible). System labels cannot be managed. |

## Profile

| Tool | Description |
|---|---|
| `get_profile` | `emailAddress`, `messagesTotal`, `threadsTotal`, `historyId` — the cheapest credential check and the way to learn the user's own address. |

## Escape hatch

| Tool | Description |
|---|---|
| `raw_request` | Calls any Gmail API v1 path directly (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`, default GET) — attachment content, `history.list`, `batchModify`, settings endpoints. A path resolving to a foreign origin is rejected (SSRF guard), so the Bearer token never leaves `gmail.googleapis.com`. Permanent message deletion additionally needs the full `https://mail.google.com/` scope. |

## Notes

- **Retry policy:** 429 is retried with backoff for every method (the request was rejected
  before executing); 5xx and network errors are retried **only for GET** — replaying a send
  after an ambiguous failure would double-send, and an email cannot be unsent.
- **OAuth:** access tokens are minted from the refresh token automatically, cached until ~60s
  before expiry, and re-minted once on a 401. Minimal scope:
  `https://www.googleapis.com/auth/gmail.modify` (no permanent delete, no settings).
- **Quotas:** ~250 API quota units/second/user (`messages.send` costs 100, `messages.get` 5,
  `messages.list` 5); consumer accounts send ~500 emails/day, Workspace ~2000.
- **One mailbox:** every call is `users/me` — the account that granted the token.

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_GMAIL_CLIENT_ID` | yes* | — | OAuth2 client id (refresh flow). |
| `GOOGLE_GMAIL_CLIENT_SECRET` | yes* | — | OAuth2 client secret (refresh flow). Secret. |
| `GOOGLE_GMAIL_REFRESH_TOKEN` | yes* | — | OAuth2 refresh token (refresh flow). Secret. |
| `GOOGLE_GMAIL_ACCESS_TOKEN` | yes* | — | Alternative: static access token (~1 h lifetime). Secret. |
| `GOOGLE_GMAIL_API_BASE` | no | `https://gmail.googleapis.com` | API root override. |
| `GOOGLE_GMAIL_TIMEOUT_MS` | no | `60000` | Per-request timeout, ms. |
| `GOOGLE_GMAIL_MAX_RETRIES` | no | `3` | Retries on transient errors. |

\* Either the refresh triple together, or the static access token.
