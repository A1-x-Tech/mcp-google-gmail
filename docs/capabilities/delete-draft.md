# Gmail: Delete a draft — MCP tool

**Gmail MCP tool:** Permanently deletes a draft — drafts skip the trash, so there is no undo.

Technical name: `delete_draft`

## What task it solves

> I want to discard a draft we no longer need.

Removes an unsent draft from the mailbox for good.

## When to use it

When the user explicitly discards a draft, or when cleaning up a draft this session created and no longer needs. Confirm with [get_draft](./get-draft.md) first if there is any doubt about which draft it is.

## What to provide

- `draft_id` — **required**. The draft to delete.

## What it returns

Empty on success (reported as `{"deleted":true}`).

## What changes in Gmail

The draft is gone **permanently** — unlike messages, drafts do not go to the trash and cannot be restored by [manage_trash](./manage-trash.md).

## Example request

> Discard the draft to the old supplier — we're not sending that one.

## Errors and limitations

Irreversible; there is no recovery path. A 404 means the draft was already sent or deleted. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [List drafts](./list-drafts.md) — find the right draft id.
- [Read a draft](./get-draft.md) — verify before deleting.

## Technical details

- **Impact:** destructive operation
- **Group:** Drafts
- **Description source:** `delete_draft` registration in `src/tools/drafts.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
