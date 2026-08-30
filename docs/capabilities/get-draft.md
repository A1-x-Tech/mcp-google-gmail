# Gmail: Read a draft — MCP tool

**Gmail MCP tool:** Fetches one draft with its message decoded into readable headers and body.

Technical name: `get_draft`

## What task it solves

> I want to see exactly what a draft says.

Shows the draft as it would be sent: recipients, subject, decoded body, attachment metadata.

## When to use it

Always before [send_draft](./send-draft.md) (show the user what will go out) and before [update_draft](./update-draft.md) (updates replace the whole draft, so the current content must be known).

## What to provide

- `draft_id` — **required**. From [list_drafts](./list-drafts.md) or [create_draft](./create-draft.md).
- `include_html` — **optional**. Decoded HTML body even when a text body exists (default false).
- `max_body_chars` — **optional**. Body truncation limit (default 50000).

## What it returns

The draft `id` and its `message`, decoded like get_message: `headers` (to, cc, subject, ...), `text`/`html` with truncation flags, `attachments[]` metadata, `threadId` for reply drafts.

## What changes in Gmail

Nothing — a pure read.

## Example request

> Show me the current text of my draft to the supplier before we send it.

## Errors and limitations

A 404 means the draft was already sent or deleted — its id is consumed on send. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Update a draft](./update-draft.md) — replace the content after reviewing it.
- [Send a draft](./send-draft.md) — send it as shown.
- [Delete a draft](./delete-draft.md) — discard it.

## Technical details

- **Impact:** read-only
- **Group:** Drafts
- **Description source:** `get_draft` registration in `src/tools/drafts.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
