# Gmail: Create a draft — MCP tool

**Gmail MCP tool:** Creates a draft email in the mailbox without sending anything.

Technical name: `create_draft`

## What task it solves

> I want to prepare an email before it goes out.

A draft holds the composed email where the user can see, edit and approve it — the safe intermediate step between "write this" and "send this".

## When to use it

For any consequential email: draft first, let a human review, then [send_draft](./send-draft.md). Also for reply drafts the user will finish in Gmail themselves.

## What to provide

All fields are optional — an empty draft is legal — but a useful one carries:

- `to`, `cc`, `bcc` — recipients.
- `subject` — the subject line.
- `body_text` / `body_html` — the content (both together become multipart/alternative).
- `thread_id`, `in_reply_to`, `references` — for a reply draft: the original's `threadId` and `headers.messageId` from [get_message](./get-message.md), plus the original subject with `Re: `.

## What it returns

The `draft_id` (needed by get/update/send/delete draft tools) and the underlying message's `id`/`threadId`.

## What changes in Gmail

A new draft appears in the mailbox's Drafts. Nothing is sent; the draft can be edited or deleted freely.

## Example request

> Draft a polite follow-up to the supplier asking about the delivery date — I'll review it before it's sent.

## Errors and limitations

Line breaks in addresses or the subject are rejected (header-injection guard). Attachments cannot be added through this tool. The draft's recipients are stored but unused until it is sent. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Read a draft](./get-draft.md) — verify the content.
- [Update a draft](./update-draft.md) — replace the content.
- [Send a draft](./send-draft.md) — the moment it becomes real mail.

## Technical details

- **Impact:** changes data
- **Group:** Drafts
- **Description source:** `create_draft` registration in `src/tools/drafts.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
