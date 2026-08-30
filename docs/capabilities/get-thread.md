# Gmail: Read a whole conversation — MCP tool

**Gmail MCP tool:** Fetches a thread with every message decoded — the complete back-and-forth in one call.

Technical name: `get_thread`

## What task it solves

> I want to read a conversation from start to finish.

Returns every message of a thread decoded like get_message (headers, text bodies, attachment metadata), oldest first, so the model can summarize or answer with full context.

## When to use it

Before summarizing or replying to a conversation. To reply, take the **last** message's `threadId`, `headers.messageId` and subject and hand them to [send_message](./send-message.md) (`thread_id`, `in_reply_to`, subject with `Re: `).

## What to provide

- `thread_id` — **required**. From [list_threads](./list-threads.md) or a message's `threadId`.
- `include_html` — **optional**. Decoded HTML bodies even when text exists (default false).
- `max_body_chars` — **optional**. Truncation limit **per message** (default 50000).

## What it returns

`id`, `historyId` and `messages[]`, each with decoded headers, `text`/`html`, truncation flags and `attachments[]` metadata.

## What changes in Gmail

Nothing — reading a thread does not mark it read.

## Example request

> Read my conversation with the landlord and summarize what we agreed about the repairs.

## Errors and limitations

Long threads can be large — lower `max_body_chars` when only the gist matters. Quoted history inside each message is part of its body; the newest content is usually at the top of the last message. Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Search and list threads](./list-threads.md) — find the thread id first.
- [Send an email](./send-message.md) — reply using the last message's identifiers.
- [Change thread labels / state](./modify-thread.md) — mark the conversation read afterwards.

## Technical details

- **Impact:** read-only
- **Group:** Threads
- **Description source:** `get_thread` registration in `src/tools/threads.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
