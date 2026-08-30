# Gmail MCP capabilities

This catalog contains 18 public pages—one for every registered MCP tool in `mcp-google-gmail`. Each page starts with the user's task, explains the result, and states whether the call changes real data.

Use this catalog to choose a ready-made capability. Full parameter schemas and API response details remain in the [technical reference](../TOOLS.md).

## Messages

- [Search and list messages](./list-messages.md) — Gmail query syntax search with triage-ready summaries. **Impact:** read-only.
- [Read a message](./get-message.md) — one email fully decoded: headers, text/HTML bodies, attachment metadata. **Impact:** read-only.
- [Send an email](./send-message.md) — sends immediately and irreversibly; supports threaded replies. **Impact:** destructive operation.
- [Change message labels / state](./modify-message.md) — read/unread, star, archive, apply/strip labels. **Impact:** destructive operation.
- [Trash or restore mail](./manage-trash.md) — reversible trash for messages and threads (~30 days). **Impact:** destructive operation.

## Threads

- [Search and list threads](./list-threads.md) — the same search at conversation granularity. **Impact:** read-only.
- [Read a whole conversation](./get-thread.md) — every message of a thread decoded, oldest first. **Impact:** read-only.
- [Change thread labels / state](./modify-thread.md) — the modify_message flags for a whole conversation. **Impact:** destructive operation.

## Drafts

- [Create a draft](./create-draft.md) — prepare an email without sending; supports reply drafts. **Impact:** changes data.
- [List drafts](./list-drafts.md) — the unsent drafts and their ids. **Impact:** read-only.
- [Read a draft](./get-draft.md) — the draft's content, decoded, for pre-send review. **Impact:** read-only.
- [Update a draft](./update-draft.md) — replaces the whole draft message (no partial edit in the API). **Impact:** destructive operation.
- [Send a draft](./send-draft.md) — sends the stored draft as-is, irreversibly. **Impact:** destructive operation.
- [Delete a draft](./delete-draft.md) — permanent; drafts skip the trash. **Impact:** destructive operation.

## Labels

- [List labels](./list-labels.md) — the label-id vocabulary; per-label counts on request. **Impact:** read-only.
- [Create, rename or delete a label](./manage-labels.md) — manage user labels; deletion is irreversible. **Impact:** destructive operation.

## Profile

- [Get the mailbox profile](./get-profile.md) — the connected address and counts; the cheapest credential check. **Impact:** read-only.

## Additional API methods

- [Raw Gmail API call](./raw-request.md) — escape hatch to any Gmail API v1 path (attachments, history, settings). **Impact:** destructive operation.

## For maintainers and publishers

- [MCP capability documentation contract](../CAPABILITY-DOCUMENTATION.md)
- [Technical tool reference](../TOOLS.md)
- [GitHub repository](https://github.com/A1-x-Tech/mcp-google-gmail)
