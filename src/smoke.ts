import { ConfigError, CredentialsError, loadConfig } from "./config.js";
import { GoogleGmailClient } from "./client.js";

/**
 * Live smoke check against the real Gmail API.
 *
 * Default: READ-ONLY — fetches the profile (email address + counts), which
 * exercises the whole credential path without touching any mail.
 *
 * Opt-in write scenario (GOOGLE_GMAIL_SMOKE_WRITE=1): exercises the write path
 * on a DISPOSABLE resource only — creates a clearly-labelled draft addressed
 * to the mailbox itself, reads it back, and deletes it in a finally block so
 * the cleanup runs after success AND after a failure. Nothing is ever sent.
 */
async function main(): Promise<void> {
  const client = new GoogleGmailClient(loadConfig());

  const profile = (await client.getProfile()) as { emailAddress?: string; messagesTotal?: number };
  console.log(JSON.stringify({ profile }, null, 2));

  if (process.env.GOOGLE_GMAIL_SMOKE_WRITE !== "1") return;
  if (!profile.emailAddress) throw new Error("profile carries no emailAddress — cannot run the write scenario");

  const draft = (await client.createDraft({
    to: [profile.emailAddress],
    subject: `mcp-google-gmail smoke ${new Date().toISOString()} (safe to delete)`,
    bodyText: "Disposable draft created by the mcp-google-gmail live smoke check. It is deleted automatically.",
  })) as { id?: string };
  if (!draft.id) throw new Error("draft create returned no id");
  console.log(JSON.stringify({ draftCreated: draft.id }, null, 2));

  try {
    const fetched = (await client.getDraft(draft.id)) as { message?: { headers?: { subject?: string } } };
    console.log(JSON.stringify({ draftSubject: fetched.message?.headers?.subject }, null, 2));
  } finally {
    // Cleanup runs on success and on failure alike — no smoke litter in the mailbox.
    await client.deleteDraft(draft.id);
    console.log(JSON.stringify({ draftDeleted: draft.id }, null, 2));
  }
}

main().catch((err) => {
  // Missing or malformed credentials are a user error, not a bug: no stack.
  const userError = err instanceof ConfigError || err instanceof CredentialsError;
  console.error("smoke failed:", userError ? err.message : err);
  process.exit(1);
});
