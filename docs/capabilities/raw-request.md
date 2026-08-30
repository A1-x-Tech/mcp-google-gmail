# Gmail: Raw Gmail API call — MCP tool

**Gmail MCP tool:** Escape hatch to call any Gmail API v1 path directly when the typed tools don't cover a request.

Technical name: `raw_request`

## What task it solves

> I want to reach a Gmail API endpoint the typed tools don't expose.

Direct access to the full API surface: attachment content, history-based incremental sync, batch modifications, mailbox settings.

## When to use it

Only when a typed tool cannot do the job — e.g. downloading attachment bytes (`gmail/v1/users/me/messages/<messageId>/attachments/<attachmentId>`), `history.list` for incremental sync, `messages/batchModify`, or settings endpoints (filters, forwarding, vacation responder).

## What to provide

- `path` — **required**. Relative to `https://gmail.googleapis.com`, may carry a query string, e.g. `gmail/v1/users/me/history?startHistoryId=123`.
- `method` — **optional**. `GET` (default), `POST`, `PUT`, `PATCH` or `DELETE`.
- `body` — **optional**. JSON request body for POST/PUT/PATCH.

## What it returns

The raw JSON the endpoint responds with — wire format, undecoded (attachment data arrives base64url-encoded).

## What changes in Gmail

Whatever the chosen endpoint does — from nothing (reads) to irreversible changes. The tool is annotated for its worst case; treat every non-GET call as consequential.

## Example request

> Download the PDF attachment from that message and tell me its size.

## Errors and limitations

Bypasses the typed tools' guard rails: `users/me/messages/<id>` DELETE is a PERMANENT delete that skips the trash (and additionally needs the full `https://mail.google.com/` scope) — prefer [manage_trash](./manage-trash.md). Paths resolving to a foreign origin are rejected (SSRF guard), so the Bearer token never leaves `gmail.googleapis.com`. Non-GET calls are never retried after ambiguous failures. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Read a message](./get-message.md) — supplies the `attachmentId` for attachment downloads.
- [Trash or restore mail](./manage-trash.md) — the reversible alternative to raw deletion.

## Technical details

- **Impact:** destructive operation
- **Group:** Additional API methods
- **Description source:** `raw_request` registration in `src/tools/raw.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
