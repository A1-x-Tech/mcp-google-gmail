# Gmail: Update a draft — MCP tool

**Gmail MCP tool:** Replaces a draft's entire message with new content — the Gmail API has no partial draft edit.

Technical name: `update_draft`

## What task it solves

> I want to change what a draft says.

Rewrites a stored draft — new recipients, subject or body — while keeping the same draft id.

## When to use it

After the user reviewed a draft and asked for changes. Read it with [get_draft](./get-draft.md) first: this call **replaces the whole message**, so every field to keep must be passed again — omitted fields are dropped, not preserved.

## What to provide

- `draft_id` — **required**.
- The complete new state, same fields as [create_draft](./create-draft.md): `to`, `cc`, `bcc`, `subject`, `body_text`/`body_html`, and `thread_id`/`in_reply_to` for reply drafts.

## What it returns

The updated draft (same `draft_id`; the underlying message id changes).

## What changes in Gmail

The draft's previous content is overwritten in the mailbox. The old version is not kept anywhere.

## Example request

> In my draft to the supplier, change the requested delivery date to 15 September and add Maria to CC — keep the rest as is.

## Errors and limitations

Because omitted fields are dropped, "add Maria to CC" requires re-sending everything else too — fetch, merge, then update. A 404 means the draft was sent or deleted meanwhile. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Read a draft](./get-draft.md) — the current content to merge with.
- [Send a draft](./send-draft.md) — after the update is approved.

## Technical details

- **Impact:** destructive operation
- **Group:** Drafts
- **Description source:** `update_draft` registration in `src/tools/drafts.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
