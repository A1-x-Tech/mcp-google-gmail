# Gmail: Change message labels / state — MCP tool

**Gmail MCP tool:** Marks a message read/unread, stars it, archives it or applies/strips labels.

Technical name: `modify_message`

## What task it solves

> I want to change how a message is filed.

Read/unread, star, archive and labelling are all Gmail label operations; this tool exposes them as plain flags and maps them to `UNREAD`/`STARRED`/`INBOX` internally.

## When to use it

After triage: mark handled mail read, star follow-ups, archive noise, file messages under user labels. For a whole conversation at once use [modify_thread](./modify-thread.md); for the trash use [manage_trash](./manage-trash.md).

## What to provide

- `message_id` — **required**.
- `read` — **optional**. `true` = mark read, `false` = mark unread.
- `starred` — **optional**. `true` = star, `false` = unstar.
- `archived` — **optional**. `true` = remove from inbox, `false` = move back.
- `add_label_ids` / `remove_label_ids` — **optional**. Any label ids from [list_labels](./list-labels.md).

At least one change is required.

## What it returns

The message's new `id`, `threadId` and `labelIds`.

## What changes in Gmail

The message's labels change in the real mailbox — it moves between inbox/archive, gains or loses stars and labels. Every change here is reversible by the opposite call; nothing is deleted.

## Example request

> Mark all of yesterday's newsletters as read and archive them.

## Errors and limitations

An empty change set is rejected before reaching the API. System labels can be added/removed on messages but not everything is writable (e.g. SENT is managed by Gmail). Applying the same change twice is harmless. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Change thread labels / state](./modify-thread.md) — the same flags for a whole conversation.
- [Trash or restore mail](./manage-trash.md) — moving to/from the trash lives there.
- [List labels](./list-labels.md) — the label-id vocabulary.

## Technical details

- **Impact:** destructive operation
- **Group:** Messages
- **Description source:** `modify_message` registration in `src/tools/messages.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
