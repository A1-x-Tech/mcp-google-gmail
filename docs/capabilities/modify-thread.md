# Gmail: Change thread labels / state — MCP tool

**Gmail MCP tool:** Applies read/star/archive/label changes to every message of a conversation in one call.

Technical name: `modify_thread`

## What task it solves

> I want to re-file a whole conversation at once.

The same normalized flags as modify_message — read, starred, archived, add/remove labels — applied to every message in the thread, without looping.

## When to use it

Conversation-level housekeeping: mark a whole thread read after summarizing it, archive a finished discussion, put a project label on the entire exchange.

## What to provide

- `thread_id` — **required**.
- `read`, `starred`, `archived` — **optional** booleans (same meaning as in [modify_message](./modify-message.md)).
- `add_label_ids` / `remove_label_ids` — **optional**. Label ids from [list_labels](./list-labels.md), applied to every message.

At least one change is required.

## What it returns

The thread's `id` and its messages' new label state.

## What changes in Gmail

Every message in the conversation gains/loses the same labels in the real mailbox. Reversible by the opposite call; nothing is deleted.

## Example request

> Archive the whole conversation about the March invoice and label it "Accounting".

## Errors and limitations

An empty change set is rejected before reaching the API. New messages arriving later in the thread do not inherit the change automatically. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Change message labels / state](./modify-message.md) — the per-message version.
- [Trash or restore mail](./manage-trash.md) — trash the thread via `target=thread` there.

## Technical details

- **Impact:** destructive operation
- **Group:** Threads
- **Description source:** `modify_thread` registration in `src/tools/threads.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
