# Gmail: Search and list messages — MCP tool

**Gmail MCP tool:** Searches the mailbox with Gmail query syntax and returns one triage-ready summary per message.

Technical name: `list_messages`

## What task it solves

> I want to find the messages that match a search.

Finds messages by any combination of Gmail search operators and labels, so the follow-up work (reading, replying, labelling) starts from the right set.

## When to use it

Use it whenever the starting point is "which emails…": unread mail, everything from a sender, invoices with attachments from last week. If the unit of work is a whole conversation, prefer [list_threads](./list-threads.md).

## What to provide

- `query` — **optional**. Gmail query syntax, the same operators as the Gmail search box: `from:amy@example.com is:unread newer_than:7d has:attachment subject:invoice`.
- `label_ids` — **optional**. Only messages carrying ALL of these label ids (see [list_labels](./list-labels.md)).
- `page_size` — **optional**. 1..100, default 25 (each summary costs one metadata read).
- `page_token` — **optional**. `nextPageToken` from the previous page.
- `include_spam_trash` — **optional**. Also search SPAM and TRASH (default false).
- `include_metadata` — **optional**. `false` returns bare ids only — the cheapest form.

## What it returns

`messages[]` with `id`, `threadId`, `labelIds`, `snippet`, `from`, `to`, `subject`, `date` and `internalDate`, plus `nextPageToken` and `resultSizeEstimate` (an estimate, not an exact count).

## What changes in Gmail

Nothing. This is a pure read; it does not even mark anything as read.

## Example request

> Find unread emails from the last three days that have attachments, and show who sent them.

## Errors and limitations

The API's search is the only filter; there is no server-side sort. `resultSizeEstimate` can be off — paginate to the end when an exact count matters. Each summary is one extra metadata read against the per-user quota (~250 units/s; a metadata get costs 5); the reads are throttled to a few in parallel so a full page of 100 does not burst the quota. A message deleted (by another client) between the search and its metadata read is skipped, so a page can contain slightly fewer summaries than `page_size`. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Read a message](./get-message.md) — full decoded body of one hit.
- [Search and list threads](./list-threads.md) — the same search at conversation granularity.
- [List labels](./list-labels.md) — the label-id vocabulary for `label_ids`.

## Technical details

- **Impact:** read-only
- **Group:** Messages
- **Description source:** `list_messages` registration in `src/tools/messages.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
