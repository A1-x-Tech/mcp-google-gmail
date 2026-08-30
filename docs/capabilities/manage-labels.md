# Gmail: Create, rename or delete a label — MCP tool

**Gmail MCP tool:** Manages the mailbox's user labels — creating, renaming, changing visibility or deleting them.

Technical name: `manage_labels`

## What task it solves

> I want to change the set of labels my mail is organized with.

Creates new filing categories, renames or hides existing ones, and removes labels that are no longer needed.

## When to use it

When the organization scheme itself changes. To put mail *into* labels use [modify_message](./modify-message.md)/[modify_thread](./modify-thread.md), not this tool.

## What to provide

- `action` — **required**. `create`, `update` or `delete`.
- `name` — required for `create` (nest with `/`, e.g. `Clients/Acme` — the parent must already exist); optional for `update` (rename).
- `label_id` — required for `update`/`delete`. A **user** label id from [list_labels](./list-labels.md).
- `label_list_visibility` — **optional**. Sidebar visibility: `show` | `show_if_unread` | `hide`.
- `message_list_visibility` — **optional**. Whether its messages show in the list: `show` | `hide`.

`update` changes only the provided fields.

## What it returns

The created/updated label (`id`, `name`, visibility), or empty (`{"deleted":true}`) after a delete.

## What changes in Gmail

`create` adds a label; `update` renames/re-hides it everywhere at once; `delete` removes the label from EVERY message it was applied to — the messages survive, but the label and its associations are gone **irreversibly**.

## Example request

> Create a label "Clients/Acme" and hide it from the sidebar unless it has unread mail.

## Errors and limitations

System labels (INBOX, STARRED, ...) cannot be created, renamed or deleted. Creating a nested label whose parent does not exist fails — create the parent first. Deleting is not undoable; re-creating a label with the same name does not restore its message associations. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [List labels](./list-labels.md) — current labels and their ids.
- [Change message labels / state](./modify-message.md) — apply/remove labels on mail.

## Technical details

- **Impact:** destructive operation
- **Group:** Labels
- **Description source:** `manage_labels` registration in `src/tools/labels.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
