# Gmail: Send an email — MCP tool

**Gmail MCP tool:** Sends an email from the authenticated mailbox — immediately and irreversibly.

Technical name: `send_message`

## What task it solves

> I want to send an email or answer one in its thread.

Composes an RFC 2822 message (text, HTML or both) and sends it as the user, optionally threaded into an existing conversation.

## When to use it

When the user has approved the exact content and recipients. For anything consequential, prefer [create_draft](./create-draft.md) → human review → [send_draft](./send-draft.md); a draft can be edited or discarded, a sent email cannot.

## What to provide

- `to` — **optional** (at least one recipient across `to`/`cc`/`bcc` overall). Addresses like `user@example.com` or `Name <user@example.com>`.
- `cc`, `bcc` — **optional**. Additional recipients; a bcc-only send (no `to` at all) is allowed — Gmail delivers it without a `To` header.
- `subject` — **optional**. For replies: the original subject with `Re: `.
- `body_text`, `body_html` — **optional** (at least a subject or a body overall). Both together become multipart/alternative.
- `thread_id`, `in_reply_to`, `references` — **optional**. For replies: the original message's `threadId` and `headers.messageId` from [get_message](./get-message.md). Gmail threads the reply only when thread id, In-Reply-To and a matching subject all line up.

## What it returns

The sent message's `id`, `threadId` and `labelIds` (it lands in SENT).

## What changes in Gmail

A real email leaves the mailbox the moment the call succeeds. **This cannot be undone** — there is no unsend through the API.

## Example request

> Reply to Anna's last email: thank her for the report and confirm the Thursday meeting. Show me the text before sending.

## Errors and limitations

At least one recipient (in `to`, `cc` or `bcc`) and at least a subject or a body are required. Never retried after a timeout or 5xx — the email may already be out; check `list_messages` with `in:sent` before re-sending. Consumer accounts send ~500 emails/day (Workspace ~2000); exceeding the limit disables sending for hours. Line breaks in addresses or the subject are rejected (header-injection guard). Sending requires the `gmail.modify` (or broader) scope. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Create a draft](./create-draft.md) + [Send a draft](./send-draft.md) — the review-first path.
- [Read a message](./get-message.md) — source of `thread_id`/`in_reply_to` for replies.

## Technical details

- **Impact:** destructive operation
- **Group:** Messages
- **Description source:** `send_message` registration in `src/tools/messages.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
