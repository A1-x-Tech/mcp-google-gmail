# Gmail: Trash or restore mail — MCP tool

**Gmail MCP tool:** Moves a message or a whole thread to the Gmail trash, or restores it — the reversible way to remove mail.

Technical name: `manage_trash`

## What task it solves

> I want to get rid of mail without losing it forever.

The trash is Gmail's safety net: trashed mail disappears from view but can be restored for about 30 days.

## When to use it

Whenever the user says delete/remove about mail: trash it — do not look for a permanent delete (this server deliberately has none). `untrash` recovers something trashed by mistake.

## What to provide

- `action` — **required**. `trash` (reversible) or `untrash` (restore).
- `id` — **required**. The message id, or the thread id when `target=thread`.
- `target` — **optional**. `message` (default) or `thread` (every message in the conversation).

## What it returns

The trashed/restored message or thread with its new `labelIds` (trashed mail carries `TRASH`).

## What changes in Gmail

`trash` hides the mail from every list except the trash and starts Gmail's ~30-day countdown to permanent deletion. `untrash` cancels that. Note: `untrash` does not re-add `INBOX` — follow with [modify_message](./modify-message.md) `archived: false` if the mail should reappear in the inbox.

## Example request

> Move all messages from that recruiting spam sender to the trash.

## Errors and limitations

Reversible only for ~30 days — after that Gmail deletes trashed mail on its own. Trashing an already-trashed message is harmless. Permanent deletion is possible only through [raw_request](./raw-request.md) and a broader OAuth scope — avoid it. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Change message labels / state](./modify-message.md) — archiving (hide without the deletion countdown).
- [Search and list messages](./list-messages.md) — find trashed mail with `include_spam_trash: true` and `in:trash`.

## Technical details

- **Impact:** destructive operation
- **Group:** Messages
- **Description source:** `manage_trash` registration in `src/tools/messages.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
