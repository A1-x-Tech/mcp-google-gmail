# Gmail: List labels — MCP tool

**Gmail MCP tool:** Lists every label in the mailbox, or fetches one label with its message counts.

Technical name: `list_labels`

## What task it solves

> I want to know what labels exist and what their ids are.

Labels are Gmail's folders, stars and read-state all at once; their ids are the vocabulary every filtering and filing tool speaks.

## When to use it

Before any `label_ids`/`add_label_ids` usage, when the user names a label ("file it under Accounting") and its id is unknown, or with `label_id` to get unread/total counts for one label.

## What to provide

- `label_id` — **optional**. Fetch this one label including `messagesTotal`, `messagesUnread`, `threadsTotal`, `threadsUnread` (the plain list carries no counts).

## What it returns

Without `label_id`: `labels[]` with `id`, `name` and `type` — system labels (`INBOX`, `SENT`, `DRAFT`, `SPAM`, `TRASH`, `UNREAD`, `STARRED`, `IMPORTANT`, `CATEGORY_*`) and user labels (`Label_...`). With `label_id`: that label with its counts.

## What changes in Gmail

Nothing — a pure read.

## Example request

> How many unread messages are in my "Clients/Acme" label?

## Errors and limitations

Counts require the per-label fetch — one call per label. User label ids are opaque (`Label_123`), never the display name; always resolve names through this tool. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Create, rename or delete a label](./manage-labels.md) — change the label set itself.
- [Change message labels / state](./modify-message.md) — apply labels to mail.

## Technical details

- **Impact:** read-only
- **Group:** Labels
- **Description source:** `list_labels` registration in `src/tools/labels.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
