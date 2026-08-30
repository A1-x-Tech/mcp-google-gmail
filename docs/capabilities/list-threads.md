# Gmail: Search and list threads — MCP tool

**Gmail MCP tool:** Searches the mailbox at conversation granularity and returns thread ids with snippets.

Technical name: `list_threads`

## What task it solves

> I want to find the conversations that match a search.

The same Gmail query syntax as message search, but each hit is a whole back-and-forth — the natural unit for triage and replying.

## When to use it

When the follow-up concerns conversations: "what discussions am I behind on", "find the thread with the contractor". For individual emails (attachments, single notifications) use [list_messages](./list-messages.md).

## What to provide

- `query` — **optional**. Gmail query syntax (`from:`, `subject:`, `is:unread`, `newer_than:7d`, ...).
- `label_ids` — **optional**. Only threads carrying ALL of these label ids.
- `page_size` — **optional**. 1..500 (API default 100).
- `page_token` — **optional**. `nextPageToken` from the previous page.
- `include_spam_trash` — **optional**. Also search SPAM and TRASH (default false).

## What it returns

`threads[]` with `id`, `snippet` (of the latest message) and `historyId`, plus `nextPageToken` and `resultSizeEstimate`.

## What changes in Gmail

Nothing — a pure read.

## Example request

> Which conversations from this week are still unread? Give me a one-line summary of each.

## Errors and limitations

Snippets cover only the newest message — read the conversation with [get_thread](./get-thread.md) before summarizing it. No server-side ordering beyond Gmail's default (newest first). Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Read a whole conversation](./get-thread.md) — the full content of one hit.
- [Search and list messages](./list-messages.md) — the same search per message.

## Technical details

- **Impact:** read-only
- **Group:** Threads
- **Description source:** `list_threads` registration in `src/tools/threads.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
