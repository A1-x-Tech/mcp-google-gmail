# Gmail: Read a message — MCP tool

**Gmail MCP tool:** Fetches one email fully decoded — headers, text/HTML bodies and attachment metadata.

Technical name: `get_message`

## What task it solves

> I want to read one email in full.

Turns the Gmail API's base64url/MIME wire format into readable text: RFC 2047 headers decoded, bodies charset-decoded, attachments listed by name and size.

## When to use it

After [list_messages](./list-messages.md) picked the message, or when the user pasted/named a specific email. To read a whole back-and-forth, use [get_thread](./get-thread.md) instead. Call it before replying — the reply needs this message's `threadId` and `headers.messageId`.

## What to provide

- `message_id` — **required**. From list_messages/get_thread output (not the RFC Message-ID header).
- `include_html` — **optional**. Return the decoded HTML body even when a text body exists (default false).
- `max_body_chars` — **optional**. Truncate each decoded body at this many characters (default 50000).
- `metadata_only` — **optional**. Headers and structure only, no body content.

## What it returns

`id`, `threadId`, `labelIds`, `snippet`, `internalDate` (ISO), decoded `headers` (from, to, cc, subject, date, messageId, inReplyTo, references), `text` (and `html` when applicable) with `textTruncated`/`htmlTruncated` flags, and `attachments[]` metadata: `filename`, `mimeType`, `sizeBytes`, `attachmentId`.

## What changes in Gmail

Nothing — reading through the API does not mark the message as read (that is a deliberate label operation via [modify_message](./modify-message.md)).

## Example request

> Open the latest email from the bank and tell me what it says; list any attached documents.

## Errors and limitations

Attachment **content** is never returned — only metadata; download bytes via [raw_request](./raw-request.md) (`users/me/messages/<id>/attachments/<attachmentId>`). Very large bodies arrive truncated with a flag — raise `max_body_chars` if the tail matters. A 404 usually means the id came from another mailbox or was permanently deleted. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Search and list messages](./list-messages.md) — find the id first.
- [Read a whole conversation](./get-thread.md) — every message of the thread at once.
- [Send an email](./send-message.md) — uses this tool's `threadId` + `headers.messageId` for replies.

## Technical details

- **Impact:** read-only
- **Group:** Messages
- **Description source:** `get_message` registration in `src/tools/messages.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
