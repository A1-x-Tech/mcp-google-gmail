# Gmail: List drafts — MCP tool

**Gmail MCP tool:** Lists the mailbox's drafts with their ids.

Technical name: `list_drafts`

## What task it solves

> I want to see what drafts exist.

Enumerates unsent drafts so one can be picked for reading, editing, sending or deleting.

## When to use it

Before working with an existing draft whose id is unknown, or to check whether a [send_draft](./send-draft.md) with an unclear outcome actually went out (a sent draft disappears from this list).

## What to provide

- `query` — **optional**. Gmail query syntax over the drafts, e.g. `subject:invoice`.
- `page_size` — **optional**. 1..500 (API default 100).
- `page_token` — **optional**. `nextPageToken` from the previous page.

## What it returns

`drafts[]` with the draft `id` and the underlying `message` (`id`, `threadId`) — no subjects or content; read one with [get_draft](./get-draft.md).

## What changes in Gmail

Nothing — a pure read.

## Example request

> Do I have any unsent drafts about the invoice? Show me what's in them.

## Errors and limitations

The listing is ids-only by API design — expect one get_draft per draft you need to display. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Read a draft](./get-draft.md) — content of one draft.
- [Create a draft](./create-draft.md) — add a new one.

## Technical details

- **Impact:** read-only
- **Group:** Drafts
- **Description source:** `list_drafts` registration in `src/tools/drafts.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
