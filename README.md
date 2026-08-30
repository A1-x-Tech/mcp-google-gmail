# <img src="./assets/a1-logo.svg" alt="A1" width="40"> Gmail MCP

**English** | [Русский](./README.ru.md)

[![npm](https://img.shields.io/npm/v/mcp-google-gmail)](https://www.npmjs.com/package/mcp-google-gmail)
[![CI](https://github.com/A1-x-Tech/mcp-google-gmail/actions/workflows/ci.yml/badge.svg)](https://github.com/A1-x-Tech/mcp-google-gmail/actions/workflows/ci.yml)
[![Glama](https://glama.ai/mcp/servers/A1-x-Tech/mcp-google-gmail/badges/score.svg)](https://glama.ai/mcp/servers/A1-x-Tech/mcp-google-gmail)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

**A1 Gmail MCP** lets an AI app work with your Gmail mailbox in plain language. Search and read mail, prepare replies as drafts, send them when you are ready, keep labels tidy and use the trash instead of permanent deletion.

It uses the Gmail API with your Google account. It distinguishes a draft you can still edit from a sent email that cannot be recalled, and makes the limits of the Gmail API explicit instead of implying that every mail task is reversible.

- **18 tools.** Search and read messages and threads, send email directly or through drafts, manage the draft lifecycle, labels and the trash.
- **Send deliberately.** The draft → review → send path is first-class; sending is marked destructive, and the server never re-sends after an ambiguous failure — an email cannot be unsent.
- **The trash is the safety net.** Removing mail goes through the reversible trash (about 30 days); there is deliberately no permanent message delete tool.
- **Bounded reading.** Decoded bodies are truncated at an explicit limit and attachments come back as metadata, so a long newsletter cannot silently flood the conversation.
- **Minimal Google scope.** It uses `gmail.modify` only — no permanent deletion and no access to Gmail settings.

Start with a read-only question:

> Show my unread emails from the last week and tell me which ones need a reply.

[Connect the server](#quick-start) · [Explore use cases](#what-you-can-ask-it-to-do) · [Open technical documentation](#technical-documentation)

---

## See it work in a minute

> **You:** What is unread in my inbox from this week about the Acme contract?
>
> **Assistant:** Searches with Gmail query syntax and shows senders, subjects, dates and snippets. Nothing changes.
>
> **You:** Draft a reply to the latest one: we send the signed copy on Friday.
>
> **Assistant:** Creates a draft in the same thread and shows it for review. Nothing is sent.
>
> **You:** Send it.
>
> **Assistant:** Sends the draft. Sending is a separate, explicitly destructive step, so your AI app can ask for confirmation first.

## Contents

- [Quick start](#quick-start)
- [What you can ask it to do](#what-you-can-ask-it-to-do)
- [How mail changes](#how-mail-changes)
- [What can change](#what-can-change)
- [Getting access](#getting-access)
- [Configuration](#configuration)
- [Data, limits and background work](#data-limits-and-background-work)
- [Technical documentation](#technical-documentation)
- [Support](#support)

## Quick start

You need Node.js 20+, a Google account and OAuth credentials from a Google Cloud project with the Gmail API enabled.

1. [Prepare Google OAuth access](#getting-access).
2. Add the server to your AI app.
3. Ask the read-only question above.

<details open>
<summary><strong>Codex</strong></summary>

<br>

**In the app:** open **Settings → Plugins → MCP servers**, select **Add server**, then add `npx -y mcp-google-gmail@latest` with `GOOGLE_GMAIL_CLIENT_ID`, `GOOGLE_GMAIL_CLIENT_SECRET` and `GOOGLE_GMAIL_REFRESH_TOKEN`.

**From the command line:**

```bash
codex mcp add google-gmail \
  --env GOOGLE_GMAIL_CLIENT_ID=your_client_id \
  --env GOOGLE_GMAIL_CLIENT_SECRET=your_client_secret \
  --env GOOGLE_GMAIL_REFRESH_TOKEN=your_refresh_token \
  -- npx -y mcp-google-gmail@latest
```

```bash
codex mcp list
```

[Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)

</details>

<details>
<summary><strong>Claude Code</strong></summary>

<br>

```bash
claude mcp add \
  --env GOOGLE_GMAIL_CLIENT_ID=your_client_id \
  --env GOOGLE_GMAIL_CLIENT_SECRET=your_client_secret \
  --env GOOGLE_GMAIL_REFRESH_TOKEN=your_refresh_token \
  --transport stdio --scope user google-gmail \
  -- npx -y mcp-google-gmail@latest
```

```bash
claude mcp list
```

[Claude Code MCP documentation](https://code.claude.com/docs/en/mcp)

</details>

<details>
<summary><strong>Claude Desktop</strong></summary>

<br>

Open **Settings → Developer → Edit Config** and add:

```json
{
  "mcpServers": {
    "google-gmail": {
      "command": "npx",
      "args": ["-y", "mcp-google-gmail@latest"],
      "env": {
        "GOOGLE_GMAIL_CLIENT_ID": "your_client_id",
        "GOOGLE_GMAIL_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_GMAIL_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

If **Edit Config** is unavailable, edit `~/Library/Application Support/Claude/claude_desktop_config.json` on macOS or `%APPDATA%\Claude\claude_desktop_config.json` on Windows.

[Claude Desktop MCP documentation](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)

</details>

<details>
<summary><strong>Cursor</strong></summary>

<br>

Add this to `~/.cursor/mcp.json` on macOS/Linux or `%USERPROFILE%\.cursor\mcp.json` on Windows:

```json
{
  "mcpServers": {
    "google-gmail": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-google-gmail@latest"],
      "env": {
        "GOOGLE_GMAIL_CLIENT_ID": "your_client_id",
        "GOOGLE_GMAIL_CLIENT_SECRET": "your_client_secret",
        "GOOGLE_GMAIL_REFRESH_TOKEN": "your_refresh_token"
      }
    }
  }
}
```

[Cursor MCP documentation](https://cursor.com/docs/mcp)

</details>

<details>
<summary><strong>VS Code</strong></summary>

<br>

Run **MCP: Open User Configuration** and add:

```json
{
  "servers": {
    "google-gmail": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-google-gmail@latest"],
      "env": {
        "GOOGLE_GMAIL_CLIENT_ID": "${input:gmail_client_id}",
        "GOOGLE_GMAIL_CLIENT_SECRET": "${input:gmail_client_secret}",
        "GOOGLE_GMAIL_REFRESH_TOKEN": "${input:gmail_refresh_token}"
      }
    }
  },
  "inputs": [
    { "type": "promptString", "id": "gmail_client_id", "description": "Google OAuth client ID" },
    { "type": "promptString", "id": "gmail_client_secret", "description": "Google OAuth client secret", "password": true },
    { "type": "promptString", "id": "gmail_refresh_token", "description": "Google OAuth refresh token", "password": true }
  ]
}
```

Check it with **MCP: List Servers**.

[VS Code MCP documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers)

</details>

## What you can ask it to do

### Triage the inbox

- Show unread messages from the last seven days and group them by sender.
- Find the conversation with Acme about the contract and summarize it, oldest to newest.
- Which messages have attachments waiting for me? Show subjects and file names.

### Write and send email

- Draft a reply in this thread saying the signed copy goes out on Friday.
- Show me the draft, tighten the wording, then send it.
- Send a short status email to the team, with the manager in CC.

### Keep the mailbox organized

- Create a label `Receipts/2026` and apply it to the matching messages.
- Mark this week's newsletters as read and archive them.
- Move that thread to the trash — and restore it if I change my mind.

## How mail changes

1. The safe path to sending is a **draft**: `create_draft` prepares the email, `get_draft` shows it for review, `send_draft` sends it. `send_message` skips the draft and sends immediately.
2. A sent email is externally irreversible. After a timeout or a `5xx` error the server does not re-send; search `in:sent` before trying again, because a replayed send would be a double-sent email.
3. Removing a message or thread means trashing it. `manage_trash` is reversible for about 30 days; there is deliberately no permanent-delete tool.
4. Drafts are the exception: `update_draft` replaces the whole draft (the API has no partial edit) and `delete_draft` is permanent, because drafts skip the trash.

Every call works on one mailbox — the account that granted the token. Decoded bodies are truncated at a configurable limit with explicit flags, and attachments come back as metadata only; attachment content is fetched through `raw_request` deliberately.

## What can change

| Operation | What happens | Confirmation boundary |
|---|---|---|
| Search and read messages, threads, drafts, labels, the profile | Reads mailbox data | No change |
| Create or update a draft | Prepares or replaces an unsent email | Changes the mailbox |
| Change read, starred or archived state, apply or strip labels | Changes how mail is organized | Changes the mailbox |
| Create or rename a label | Changes the label vocabulary | Changes the mailbox |
| Trash or untrash a message or thread | Moves mail to or from the trash; reversible for ~30 days | Destructive |
| Send an email or a draft | Delivers mail to real recipients; cannot be unsent | Destructive |
| Delete a draft or a label | Removes it permanently, skipping the trash | Destructive |
| Raw API request | Can call API methods without a dedicated tool | Potentially destructive |

The AI client controls confirmation prompts. The server marks reads, writes and destructive tools so the client can distinguish an inspection from a live change.

## Getting access

Gmail requires OAuth 2.0; an API key is not enough.

1. Create or select a Google Cloud project and enable the **Gmail API**.
2. Configure the OAuth consent screen and create a **Desktop app** OAuth client.
3. Authorize the Google account whose mailbox you want to connect — every call works on that one mailbox. The [OAuth 2.0 Playground](https://developers.google.com/oauthplayground) can obtain the refresh token when **Use your own OAuth credentials** is enabled.
4. Request the scope:

   ```text
   https://www.googleapis.com/auth/gmail.modify
   ```

   It covers search, reading, sending, drafts, labels and the trash — but not permanent deletion and not Gmail settings. Permanent deletion through `raw_request` additionally requires the full `https://mail.google.com/` scope.

Testing-mode OAuth refresh tokens can expire after seven days. Publish the OAuth app, or use an Internal app in a Workspace domain, when you need long-lived access. Treat the client secret and refresh token as passwords.

## Configuration

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_GMAIL_CLIENT_ID` | Yes* | OAuth client ID. |
| `GOOGLE_GMAIL_CLIENT_SECRET` | Yes* | OAuth client secret. |
| `GOOGLE_GMAIL_REFRESH_TOKEN` | Yes* | OAuth refresh token. |
| `GOOGLE_GMAIL_ACCESS_TOKEN` | Yes* | Short-lived alternative to the OAuth trio (about 1 hour). |
| `GOOGLE_GMAIL_API_BASE` | No | Gmail API base URL override. |
| `GOOGLE_GMAIL_TIMEOUT_MS` | No | Per-request timeout; default `60000` ms. |
| `GOOGLE_GMAIL_MAX_RETRIES` | No | Temporary-error retries; default `3`. |

\* Provide either the OAuth trio or an access token.

## Data, limits and background work

- **Requests go to Gmail.** The local server refreshes Google OAuth tokens and calls the Gmail API. Its anonymous telemetry contains an installation ID, package version, AI client and platform versions, and tool names — never OAuth tokens, mail content, tool arguments or prompts. Set `ASKADS_TELEMETRY=0` to opt out.
- **Google meters quota units.** Gmail allows roughly 250 quota units per second per user; a send costs 100 units, a typical read 5. Consumer accounts can send about 500 emails a day, Workspace accounts about 2,000. On `429`, the server uses backoff; reads also retry after network and `5xx` errors, while sends and other writes are never replayed after an uncertain failure.
- **There is no background polling.** The server runs only when called. If your AI app supports scheduled tasks, it can check the inbox periodically; `raw_request` can also reach `history.list` for incremental sync.

## Technical documentation

- [MCP capability catalog](./docs/capabilities/index.md) — task-oriented pages for every tool.
- [All tools and inputs](./docs/TOOLS.md)
- [Development documentation](./docs/DEVELOPMENT.md)
- [Publishing documentation](./docs/PUBLISHING.md)
- [Gmail API reference](https://developers.google.com/gmail/api)

## Support

Found a bug or need a scenario? [Create an issue](https://github.com/A1-x-Tech/mcp-google-gmail/issues) or write in [Telegram](https://t.me/a1_mcp).

<br>

<p align="center">
  <img src="https://github.com/ztemerbekov/a1-yandex-kit-skills/raw/main/assets/images/mona-hifive-yandex-kit-warm.gif" alt="Две Моны дают пять" width="256">
</p>

<p align="center">
  You made it to the end!
</p>
