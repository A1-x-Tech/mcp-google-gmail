# Gmail: Get the mailbox profile — MCP tool

**Gmail MCP tool:** Returns the authenticated mailbox's address and message counts — the cheapest credential check.

Technical name: `get_profile`

## What task it solves

> I want to know whose mailbox is connected and that access works.

One tiny read that proves the OAuth setup end-to-end and tells the model the user's own email address.

## When to use it

At the start of a session to verify credentials, before send-to-self tests, and whenever the user's own address is needed to recognize their messages inside threads.

## What to provide

Nothing — the tool takes no parameters (the API always targets the mailbox that granted the token).

## What it returns

`emailAddress`, `messagesTotal`, `threadsTotal` and `historyId` (a cursor usable with the history API via raw_request).

## What changes in Gmail

Nothing — a pure read.

## Example request

> Which Gmail account is connected here?

## Errors and limitations

A CredentialsError here means the server was started without the environment variables; an HTTP 401/invalid_grant means the refresh token died (typically an OAuth consent screen still in Testing, where refresh tokens expire after 7 days). Access also depends on token permissions, quotas, and upstream API limits.

## Related MCP tools

- [Search and list messages](./list-messages.md) — the natural next read.
- [Raw Gmail API call](./raw-request.md) — pair `historyId` with `history.list` for incremental sync.

## Technical details

- **Impact:** read-only
- **Group:** Profile
- **Description source:** `get_profile` registration in `src/tools/profile.ts`
- [Full technical reference](../TOOLS.md)
- [All MCP capabilities](./index.md)
