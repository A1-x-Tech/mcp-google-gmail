# Gmail: Send a draft — MCP tool

**Gmail MCP tool:** Sends an existing draft exactly as stored — immediately and irreversibly.

Technical name: `send_draft`

## What task it solves

> I want to send the email we prepared.

The final step of the safe sending path: a reviewed draft becomes real outgoing mail.

## When to use it

After [get_draft](./get-draft.md) showed the user exactly what will go out and they approved it. This is the preferred way to send anything consequential (versus [send_message](./send-message.md) directly).

## What to provide

- `draft_id` — **required**. The draft to send, as it is currently stored.

## What it returns

The sent message's `id` and `threadId`. The draft itself disappears — its id is consumed.

## What changes in Gmail

A real email leaves the mailbox; the draft moves out of Drafts into SENT. **This cannot be undone.**

## Example request

> The draft looks good — send it.

## Errors and limitations

Never retried after a timeout or 5xx: check whether the draft is gone from [list_drafts](./list-drafts.md) (gone = it was sent) before considering a re-send. Sends count against the daily limit (~500/day consumer, ~2000/day Workspace). The draft is sent **as stored** — last-second changes must go through update_draft first. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Read a draft](./get-draft.md) — the pre-send review.
- [Update a draft](./update-draft.md) — fix the content before sending.
- [Send an email](./send-message.md) — the direct, no-draft path.

## Technical details

- **Impact:** destructive operation
- **Group:** Drafts
- **Description source:** `send_draft` registration in `src/tools/drafts.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
