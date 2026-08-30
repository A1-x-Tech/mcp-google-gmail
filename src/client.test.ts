import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildLabelChanges,
  buildMimeMessage,
  decodeEncodedWords,
  decodeMessage,
  GoogleGmailClient,
} from "./client.js";
import type { WireMessage } from "./client.js";
import { CredentialsError, MISSING_CREDENTIALS_MESSAGE } from "./config.js";
import type { GoogleGmailConfig } from "./types.js";

const BASE = "https://gmail.googleapis.com";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

type Call = { url: string; method: string; auth: unknown; body: string | undefined };

/** A client on a static access token — no token-endpoint traffic expected. */
function staticConfig(extra: Partial<GoogleGmailConfig> = {}): GoogleGmailConfig {
  return { accessToken: "STATIC", apiBase: BASE, maxRetries: 0, retryBaseMs: 0, ...extra };
}

/** A client on the refresh flow. */
function refreshConfig(extra: Partial<GoogleGmailConfig> = {}): GoogleGmailConfig {
  return {
    clientId: "cid",
    clientSecret: "csec",
    refreshToken: "rtok",
    apiBase: BASE,
    maxRetries: 0,
    retryBaseMs: 0,
    ...extra,
  };
}

/** Installs a recording fetch stub; the handler decides each response. */
function mockFetch(handler: (url: string, init: RequestInit, n: number) => Response | Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Call[] = [];
  globalThis.fetch = (async (url: unknown, init: unknown) => {
    const i = (init ?? {}) as RequestInit & { headers?: Record<string, string> };
    calls.push({
      url: String(url),
      method: String(i.method),
      auth: i.headers?.Authorization,
      body: typeof i.body === "string" ? i.body : undefined,
    });
    return handler(String(url), i, calls.length);
  }) as typeof fetch;
  return {
    calls,
    restore() {
      globalThis.fetch = original;
    },
  };
}

const okJson = (data: unknown) => new Response(JSON.stringify(data), { status: 200 });

/** Default handler: token endpoint mints TOK-1, everything else returns { ok: true }. */
function defaultHandler(url: string): Response {
  if (url === TOKEN_URL) return okJson({ access_token: "TOK-1", expires_in: 3600 });
  return okJson({ ok: true });
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");

// ---- Auth ----

/**
 * The degraded-start contract: a server without credentials still runs, so the
 * client must fail the call itself — with the exact actionable message, before
 * any fetch. Zero fetch calls proves the error skips the retry/backoff loop
 * and the forced 401 re-mint alike (maxRetries is deliberately non-zero here).
 */
test("no credentials at all: CredentialsError with the exact text, fetch never called", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    const client = new GoogleGmailClient({ apiBase: BASE, maxRetries: 3, retryBaseMs: 0 });
    await assert.rejects(
      () => client.getProfile(),
      (err: unknown) => {
        assert.ok(err instanceof CredentialsError, "must be a CredentialsError");
        assert.equal(err.message, MISSING_CREDENTIALS_MESSAGE);
        // The historical startup error, verbatim — the message is the product.
        assert.ok(
          err.message.startsWith(
            "Google OAuth credentials are required: set GOOGLE_GMAIL_CLIENT_ID + " +
              "GOOGLE_GMAIL_CLIENT_SECRET + GOOGLE_GMAIL_REFRESH_TOKEN (recommended), " +
              "or GOOGLE_GMAIL_ACCESS_TOKEN with a short-lived access token.",
          ),
          "the message must open with the historical startup error, verbatim",
        );
        assert.match(err.message, /restart the server/, "the fix must mention the restart");
        return true;
      },
    );
    assert.equal(mock.calls.length, 0, "must not fetch at all — no retries, no token mint, no replay");
  } finally {
    mock.restore();
  }
});

test("static access token: Bearer header, no token-endpoint traffic", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    await new GoogleGmailClient(staticConfig()).getProfile();
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].url, `${BASE}/gmail/v1/users/me/profile`);
    assert.equal(mock.calls[0].method, "GET");
    assert.equal(mock.calls[0].auth, "Bearer STATIC");
  } finally {
    mock.restore();
  }
});

test("refresh flow: mints a token first, then caches it across requests", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    const client = new GoogleGmailClient(refreshConfig());
    await client.getProfile();
    await client.getLabel("INBOX");

    const tokenCalls = mock.calls.filter((c) => c.url === TOKEN_URL);
    assert.equal(tokenCalls.length, 1, "the second request must reuse the cached token");
    assert.equal(tokenCalls[0].method, "POST");
    const params = new URLSearchParams(tokenCalls[0].body);
    assert.equal(params.get("grant_type"), "refresh_token");
    assert.equal(params.get("client_id"), "cid");
    assert.equal(params.get("client_secret"), "csec");
    assert.equal(params.get("refresh_token"), "rtok");

    const apiCalls = mock.calls.filter((c) => c.url.startsWith(`${BASE}/`));
    assert.equal(apiCalls.length, 2);
    for (const call of apiCalls) assert.equal(call.auth, "Bearer TOK-1");
  } finally {
    mock.restore();
  }
});

test("a 401 forces one re-mint and replays the request", async () => {
  let minted = 0;
  let apiHits = 0;
  const mock = mockFetch((url) => {
    if (url === TOKEN_URL) {
      minted++;
      return okJson({ access_token: `TOK-${minted}`, expires_in: 3600 });
    }
    apiHits++;
    if (apiHits === 1) return new Response('{"error":{"message":"expired"}}', { status: 401 });
    return okJson({ ok: true });
  });
  try {
    const result = await new GoogleGmailClient(refreshConfig()).getProfile();
    assert.deepEqual(result, { ok: true });
    assert.equal(minted, 2, "the 401 must force a second mint");
    const lastApi = mock.calls.filter((c) => c.url.startsWith(`${BASE}/`)).at(-1);
    assert.equal(lastApi?.auth, "Bearer TOK-2");
  } finally {
    mock.restore();
  }
});

test("a persistent 401 throws instead of looping", async () => {
  let apiHits = 0;
  const mock = mockFetch((url) => {
    if (url === TOKEN_URL) return okJson({ access_token: "TOK", expires_in: 3600 });
    apiHits++;
    return new Response('{"error":{"message":"nope","status":"UNAUTHENTICATED"}}', { status: 401 });
  });
  try {
    await assert.rejects(
      () => new GoogleGmailClient(refreshConfig()).getProfile(),
      /HTTP 401: \[UNAUTHENTICATED\] nope/,
    );
    assert.equal(apiHits, 2, "exactly one replay after the forced re-mint");
  } finally {
    mock.restore();
  }
});

test("a failed token exchange surfaces the OAuth error", async () => {
  const mock = mockFetch((url) => {
    if (url === TOKEN_URL) {
      return new Response('{"error":"invalid_grant","error_description":"Token has been revoked."}', {
        status: 400,
      });
    }
    return okJson({ ok: true });
  });
  try {
    await assert.rejects(
      () => new GoogleGmailClient(refreshConfig()).getProfile(),
      /HTTP 400: invalid_grant: Token has been revoked\./,
    );
  } finally {
    mock.restore();
  }
});

// ---- Retry / timeout / SSRF behavior ----

test("request() retries a 429 for reads and writes alike", async () => {
  for (const run of [
    () => new GoogleGmailClient(staticConfig({ maxRetries: 3 })).getProfile(),
    () => new GoogleGmailClient(staticConfig({ maxRetries: 3 })).trashMessage("m1"),
  ]) {
    let n = 0;
    const mock = mockFetch(() => {
      n++;
      if (n === 1) return new Response("slow down", { status: 429 });
      return okJson({ ok: true });
    });
    try {
      assert.deepEqual(await run(), { ok: true });
      assert.equal(n, 2);
    } finally {
      mock.restore();
    }
  }
});

test("request() retries a 5xx only for GET — a write is never replayed", async () => {
  let n = 0;
  const mock = mockFetch(() => {
    n++;
    if (n === 1) return new Response("unavailable", { status: 503 });
    return okJson({ ok: true });
  });
  try {
    const result = await new GoogleGmailClient(staticConfig({ maxRetries: 3 })).getProfile();
    assert.deepEqual(result, { ok: true });
    assert.equal(n, 2, "the read is retried");
  } finally {
    mock.restore();
  }

  n = 0;
  const mock2 = mockFetch(() => {
    n++;
    return new Response("unavailable", { status: 503 });
  });
  try {
    await assert.rejects(
      () =>
        new GoogleGmailClient(staticConfig({ maxRetries: 3 })).sendMessage({
          to: ["a@b.c"],
          subject: "hi",
          bodyText: "x",
        }),
      /HTTP 503/,
    );
    assert.equal(n, 1, "a 503 on a send must not be replayed — the email may already be out");
  } finally {
    mock2.restore();
  }
});

test("request() retries a network error only for GET", async () => {
  let n = 0;
  const mock = mockFetch(() => {
    n++;
    if (n === 1) throw new Error("ECONNRESET");
    return okJson({ ok: true });
  });
  try {
    const result = await new GoogleGmailClient(staticConfig({ maxRetries: 2 })).getProfile();
    assert.deepEqual(result, { ok: true });
    assert.equal(n, 2);
  } finally {
    mock.restore();
  }

  n = 0;
  const mock2 = mockFetch(() => {
    n++;
    throw new Error("ECONNRESET");
  });
  try {
    await assert.rejects(
      () =>
        new GoogleGmailClient(staticConfig({ maxRetries: 2 })).sendMessage({
          to: ["a@b.c"],
          subject: "hi",
          bodyText: "x",
        }),
      /ECONNRESET/,
    );
    assert.equal(n, 1, "a network error on a send must not be replayed");
  } finally {
    mock2.restore();
  }
});

test("request() does not retry a 400 and gives up after maxRetries on 429", async () => {
  let n = 0;
  const mock = mockFetch(() => {
    n++;
    return new Response('{"error":{"message":"bad","status":"INVALID_ARGUMENT"}}', { status: 400 });
  });
  try {
    await assert.rejects(
      () => new GoogleGmailClient(staticConfig({ maxRetries: 3 })).getProfile(),
      /HTTP 400: \[INVALID_ARGUMENT\] bad/,
    );
    assert.equal(n, 1);
  } finally {
    mock.restore();
  }

  n = 0;
  const mock2 = mockFetch(() => {
    n++;
    return new Response("slow down", { status: 429 });
  });
  try {
    await assert.rejects(
      () => new GoogleGmailClient(staticConfig({ maxRetries: 2 })).getProfile(),
      /HTTP 429/,
    );
    assert.equal(n, 3); // initial + 2 retries
  } finally {
    mock2.restore();
  }
});

test("request() aborts and reports a timeout when the request hangs", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: unknown, init: unknown) =>
    new Promise((_resolve, reject) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      signal.addEventListener("abort", () =>
        reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
      );
    })) as typeof fetch;
  try {
    const client = new GoogleGmailClient(staticConfig({ timeoutMs: 10, maxRetries: 0 }));
    await client.getProfile().then(
      () => assert.fail("must reject"),
      (err) => assert.match(String(err), /timed out after 10ms/),
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("request() rejects an absolute path (SSRF) and never fetches a foreign origin", async () => {
  for (const evil of ["https://evil.example/steal", "http://evil.example/x", "\\\\evil.example/x"]) {
    const mock = mockFetch(() => okJson({}));
    try {
      await assert.rejects(
        () => new GoogleGmailClient(staticConfig()).request("GET", evil),
        /foreign origin/,
      );
      assert.equal(mock.calls.length, 0, `must not fetch for ${JSON.stringify(evil)}`);
    } finally {
      mock.restore();
    }
  }
});

test("request() still accepts a relative API path with a query string", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    const result = await new GoogleGmailClient(staticConfig()).request(
      "GET",
      "gmail/v1/users/me/history?startHistoryId=123",
    );
    assert.deepEqual(result, { ok: true });
    assert.equal(mock.calls[0].url, `${BASE}/gmail/v1/users/me/history?startHistoryId=123`);
  } finally {
    mock.restore();
  }
});

// ---- MIME building ----

test("buildMimeMessage builds a plain-text message with base64 body", () => {
  const mime = buildMimeMessage({
    to: ["Alice <alice@example.com>", "bob@example.com"],
    cc: ["carol@example.com"],
    subject: "Hello",
    bodyText: "Hi there",
  });
  assert.match(mime, /^To: Alice <alice@example\.com>, bob@example\.com\r\n/);
  assert.match(mime, /Cc: carol@example\.com\r\n/);
  assert.match(mime, /Subject: Hello\r\n/);
  assert.match(mime, /MIME-Version: 1\.0\r\n/);
  assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"\r\n/);
  assert.match(mime, /Content-Transfer-Encoding: base64\r\n/);
  const b64 = mime.split("\r\n\r\n")[1];
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), "Hi there");
});

test("buildMimeMessage combines text + html into multipart/alternative", () => {
  const mime = buildMimeMessage({
    to: ["a@b.c"],
    subject: "Both",
    bodyText: "plain",
    bodyHtml: "<b>rich</b>",
  });
  const boundary = mime.match(/multipart\/alternative; boundary="([^"]+)"/)?.[1];
  assert.ok(boundary, "must declare a boundary");
  const parts = mime.split(`--${boundary}`);
  assert.equal(parts.length, 4, "preamble, two parts, closing");
  assert.match(parts[1], /text\/plain/);
  assert.equal(Buffer.from(parts[1].split("\r\n\r\n")[1], "base64").toString("utf8"), "plain");
  assert.match(parts[2], /text\/html/);
  assert.equal(Buffer.from(parts[2].split("\r\n\r\n")[1], "base64").toString("utf8"), "<b>rich</b>");
  assert.match(parts[3], /^--/, "must end with the closing boundary");
});

test("buildMimeMessage encodes a non-ASCII subject as an RFC 2047 word", () => {
  const mime = buildMimeMessage({ to: ["a@b.c"], subject: "Привет", bodyText: "x" });
  const encoded = mime.match(/Subject: (.+)\r\n/)?.[1];
  assert.ok(encoded?.startsWith("=?UTF-8?B?"), "must be an encoded word");
  const b64 = encoded!.slice("=?UTF-8?B?".length, -2);
  assert.equal(Buffer.from(b64, "base64").toString("utf8"), "Привет");
});

test("buildMimeMessage sets reply headers and wraps a bare Message-ID", () => {
  const mime = buildMimeMessage({
    to: ["a@b.c"],
    subject: "Re: Hello",
    bodyText: "reply",
    inReplyTo: "abc123@mail.example.com",
  });
  assert.match(mime, /In-Reply-To: <abc123@mail\.example\.com>\r\n/);
  assert.match(mime, /References: <abc123@mail\.example\.com>\r\n/);

  const explicit = buildMimeMessage({
    to: ["a@b.c"],
    bodyText: "x",
    inReplyTo: "<b@x>",
    references: "<a@x> <b@x>",
  });
  assert.match(explicit, /In-Reply-To: <b@x>\r\n/);
  assert.match(explicit, /References: <a@x> <b@x>\r\n/);
});

test("buildMimeMessage rejects header injection in addresses and subject", () => {
  assert.throws(
    () => buildMimeMessage({ to: ["a@b.c\r\nBcc: evil@x.y"], bodyText: "x" }),
    /"to" must not contain line breaks/,
  );
  assert.throws(
    () => buildMimeMessage({ to: ["a@b.c"], subject: "hi\nX-Evil: 1", bodyText: "x" }),
    /"subject" must not contain line breaks/,
  );
});

test("buildMimeMessage with no body still emits an empty text part", () => {
  const mime = buildMimeMessage({ to: ["a@b.c"], subject: "s" });
  assert.match(mime, /Content-Type: text\/plain; charset="UTF-8"\r\n/);
});

// ---- Message decoding ----

function wireMessageFixture(): WireMessage {
  return {
    id: "m1",
    threadId: "t1",
    labelIds: ["INBOX", "UNREAD"],
    snippet: "Hi there",
    historyId: "999",
    internalDate: "1756400000000",
    sizeEstimate: 4321,
    payload: {
      mimeType: "multipart/mixed",
      headers: [
        { name: "From", value: "=?UTF-8?B?0JDQvdC90LA=?= <anna@example.com>" },
        { name: "To", value: "me@example.com" },
        { name: "Subject", value: "=?UTF-8?Q?Caf=C3=A9_report?=" },
        { name: "Date", value: "Fri, 29 Aug 2026 10:00:00 +0000" },
        { name: "Message-ID", value: "<orig-123@mail.example.com>" },
        { name: "In-Reply-To", value: "<prev-1@mail.example.com>" },
      ],
      parts: [
        {
          partId: "0",
          mimeType: "multipart/alternative",
          parts: [
            {
              partId: "0.0",
              mimeType: "text/plain",
              headers: [{ name: "Content-Type", value: 'text/plain; charset="UTF-8"' }],
              body: { data: b64url("Hello plain"), size: 11 },
            },
            {
              partId: "0.1",
              mimeType: "text/html",
              headers: [{ name: "Content-Type", value: 'text/html; charset="UTF-8"' }],
              body: { data: b64url("<p>Hello html</p>"), size: 17 },
            },
          ],
        },
        {
          partId: "1",
          mimeType: "application/pdf",
          filename: "report.pdf",
          body: { attachmentId: "att-1", size: 12345 },
        },
      ],
    },
  };
}

test("decodeMessage decodes headers, text body and attachment metadata", () => {
  const decoded = decodeMessage(wireMessageFixture());
  assert.equal(decoded.id, "m1");
  assert.equal(decoded.threadId, "t1");
  assert.deepEqual(decoded.labelIds, ["INBOX", "UNREAD"]);
  assert.equal(decoded.internalDate, new Date(1756400000000).toISOString());
  // RFC 2047 words decoded in both B and Q encodings.
  assert.equal(decoded.headers.from, "Анна <anna@example.com>");
  assert.equal(decoded.headers.subject, "Café report");
  assert.equal(decoded.headers.messageId, "<orig-123@mail.example.com>");
  assert.equal(decoded.headers.inReplyTo, "<prev-1@mail.example.com>");
  assert.equal(decoded.text, "Hello plain");
  assert.equal(decoded.html, undefined, "html is omitted when a text part exists");
  assert.deepEqual(decoded.attachments, [
    { filename: "report.pdf", mimeType: "application/pdf", sizeBytes: 12345, attachmentId: "att-1", partId: "1" },
  ]);
});

test("decodeMessage returns html on request, or when there is no text part", () => {
  const withHtml = decodeMessage(wireMessageFixture(), { includeHtml: true });
  assert.equal(withHtml.text, "Hello plain");
  assert.equal(withHtml.html, "<p>Hello html</p>");

  const htmlOnly: WireMessage = {
    id: "m2",
    payload: {
      mimeType: "text/html",
      headers: [{ name: "Content-Type", value: "text/html; charset=UTF-8" }],
      body: { data: b64url("<i>only html</i>") },
    },
  };
  const decoded = decodeMessage(htmlOnly);
  assert.equal(decoded.text, undefined);
  assert.equal(decoded.html, "<i>only html</i>", "html appears when it is the only body");
});

test("decodeMessage honors the part charset and falls back to utf-8 on junk labels", () => {
  const koi8Bytes = Buffer.from([0xf0, 0xf2, 0xe9, 0xf7, 0xe5, 0xf4]); // "ПРИВЕТ" in koi8-r
  const msg: WireMessage = {
    id: "m3",
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "Content-Type", value: 'text/plain; charset="koi8-r"' }],
      body: { data: koi8Bytes.toString("base64url") },
    },
  };
  assert.equal(decodeMessage(msg).text, "ПРИВЕТ");

  const junkCharset: WireMessage = {
    id: "m4",
    payload: {
      mimeType: "text/plain",
      headers: [{ name: "Content-Type", value: 'text/plain; charset="x-nonsense"' }],
      body: { data: b64url("plain utf8") },
    },
  };
  assert.equal(decodeMessage(junkCharset).text, "plain utf8");
});

test("decodeMessage truncates bodies at maxBodyChars and flags it", () => {
  const long = "a".repeat(500);
  const msg: WireMessage = {
    id: "m5",
    payload: { mimeType: "text/plain", body: { data: b64url(long) } },
  };
  const decoded = decodeMessage(msg, { maxBodyChars: 100 });
  assert.equal(decoded.text?.length, 100);
  assert.equal(decoded.textTruncated, true);

  const untruncated = decodeMessage(msg);
  assert.equal(untruncated.text?.length, 500);
  assert.equal(untruncated.textTruncated, undefined);
});

test("decodeEncodedWords leaves plain values and broken words untouched", () => {
  assert.equal(decodeEncodedWords("plain subject"), "plain subject");
  assert.equal(decodeEncodedWords("=?UTF-8?Q?a_b?="), "a b");
  const broken = "=?bogus-charset?B?////?=";
  assert.equal(typeof decodeEncodedWords(broken), "string", "never throws on junk");
});

// ---- Label-change mapping ----

test("buildLabelChanges maps the normalized flags to system labels", () => {
  assert.deepEqual(buildLabelChanges({ read: true }), { removeLabelIds: ["UNREAD"] });
  assert.deepEqual(buildLabelChanges({ read: false }), { addLabelIds: ["UNREAD"] });
  assert.deepEqual(buildLabelChanges({ starred: true }), { addLabelIds: ["STARRED"] });
  assert.deepEqual(buildLabelChanges({ starred: false }), { removeLabelIds: ["STARRED"] });
  assert.deepEqual(buildLabelChanges({ archived: true }), { removeLabelIds: ["INBOX"] });
  assert.deepEqual(buildLabelChanges({ archived: false }), { addLabelIds: ["INBOX"] });
  assert.deepEqual(
    buildLabelChanges({ read: true, starred: true, addLabelIds: ["Label_1"], removeLabelIds: ["Label_2"] }),
    { addLabelIds: ["Label_1", "STARRED"], removeLabelIds: ["Label_2", "UNREAD"] },
  );
});

test("buildLabelChanges rejects an empty change set", () => {
  assert.throws(() => buildLabelChanges({}), /At least one change is required/);
});

// ---- Endpoint mapping ----

test("listMessages builds the search query and hydrates summaries", async () => {
  const mock = mockFetch((url) => {
    if (url.includes("/messages?"))
      return okJson({ messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "npt", resultSizeEstimate: 2 });
    return okJson({
      id: "m1",
      threadId: "t1",
      labelIds: ["INBOX"],
      snippet: "snip",
      internalDate: "1756400000000",
      payload: { headers: [{ name: "From", value: "x@y.z" }, { name: "Subject", value: "S" }] },
    });
  });
  try {
    const result = (await new GoogleGmailClient(staticConfig()).listMessages({
      query: "is:unread from:x@y.z",
      labelIds: ["INBOX", "IMPORTANT"],
      pageSize: 2,
      pageToken: "prev",
      includeSpamTrash: true,
    })) as { messages: { id: string; from?: string; subject?: string }[]; nextPageToken?: string };

    const listUrl = new URL(mock.calls[0].url);
    assert.equal(listUrl.pathname, "/gmail/v1/users/me/messages");
    assert.equal(listUrl.searchParams.get("q"), "is:unread from:x@y.z");
    assert.deepEqual(listUrl.searchParams.getAll("labelIds"), ["INBOX", "IMPORTANT"]);
    assert.equal(listUrl.searchParams.get("maxResults"), "2");
    assert.equal(listUrl.searchParams.get("pageToken"), "prev");
    assert.equal(listUrl.searchParams.get("includeSpamTrash"), "true");

    // One metadata GET per id, with the header whitelist.
    assert.equal(mock.calls.length, 3);
    const metaUrl = new URL(mock.calls[1].url);
    assert.equal(metaUrl.pathname, "/gmail/v1/users/me/messages/m1");
    assert.equal(metaUrl.searchParams.get("format"), "metadata");
    assert.deepEqual(metaUrl.searchParams.getAll("metadataHeaders"), ["From", "To", "Subject", "Date"]);

    assert.equal(result.messages[0].from, "x@y.z");
    assert.equal(result.messages[0].subject, "S");
    assert.equal(result.nextPageToken, "npt");
  } finally {
    mock.restore();
  }
});

test("listMessages hydration skips a message deleted between list and get (404)", async () => {
  const mock = mockFetch((url) => {
    if (url.includes("/messages?"))
      return okJson({ messages: [{ id: "m1" }, { id: "gone" }, { id: "m3" }], nextPageToken: "npt" });
    if (url.includes("/messages/gone"))
      return new Response('{"error":{"code":404,"message":"Requested entity was not found."}}', { status: 404 });
    const id = url.includes("/messages/m1") ? "m1" : "m3";
    return okJson({ id, threadId: `t-${id}`, payload: { headers: [{ name: "Subject", value: id }] } });
  });
  try {
    const result = (await new GoogleGmailClient(staticConfig()).listMessages({ pageSize: 3 })) as {
      messages: { id: string }[];
      nextPageToken?: string;
    };
    // Partial page, list order preserved — the racing deletion must not fail the search.
    assert.deepEqual(result.messages.map((m) => m.id), ["m1", "m3"]);
    assert.equal(result.nextPageToken, "npt");
    assert.equal(mock.calls.length, 4, "list + one metadata read per id, 404 included");
  } finally {
    mock.restore();
  }
});

test("listMessages hydration still fails on a non-404 error", async () => {
  const mock = mockFetch((url) => {
    if (url.includes("/messages?")) return okJson({ messages: [{ id: "m1" }, { id: "m2" }] });
    if (url.includes("/messages/m2"))
      return new Response('{"error":{"code":403,"message":"quota exceeded"}}', { status: 403 });
    return okJson({ id: "m1" });
  });
  try {
    await assert.rejects(() => new GoogleGmailClient(staticConfig()).listMessages({ pageSize: 2 }), /HTTP 403/);
  } finally {
    mock.restore();
  }
});

test("listMessages hydration caps parallel metadata reads", async () => {
  const pageSize = 40;
  let inFlight = 0;
  let peak = 0;
  const mock = mockFetch(async (url) => {
    if (url.includes("/messages?"))
      return okJson({ messages: Array.from({ length: pageSize }, (_, i) => ({ id: `m${i}` })) });
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    inFlight--;
    return okJson({ id: "x" });
  });
  try {
    const result = (await new GoogleGmailClient(staticConfig()).listMessages({ pageSize })) as {
      messages: unknown[];
    };
    assert.equal(result.messages.length, pageSize, "every id is still hydrated");
    assert.equal(mock.calls.length, 1 + pageSize);
    assert.ok(peak > 1, "hydration must not be fully serialized");
    assert.ok(peak <= 8, `a full page must not burst in parallel (peak was ${peak})`);
  } finally {
    mock.restore();
  }
});

test("listMessages with hydrate=false returns bare ids from one request", async () => {
  const mock = mockFetch(() => okJson({ messages: [{ id: "m1", threadId: "t1" }] }));
  try {
    const result = await new GoogleGmailClient(staticConfig()).listMessages({ hydrate: false });
    assert.equal(mock.calls.length, 1, "no per-message hydration reads");
    assert.deepEqual(result, { messages: [{ id: "m1", threadId: "t1" }] });
  } finally {
    mock.restore();
  }
});

test("getMessage fetches format=full (or metadata) and decodes", async () => {
  const mock = mockFetch(() => okJson(wireMessageFixture()));
  try {
    const client = new GoogleGmailClient(staticConfig());
    const decoded = (await client.getMessage("m 1")) as { text?: string };
    const url = new URL(mock.calls[0].url);
    assert.equal(url.pathname, "/gmail/v1/users/me/messages/m%201");
    assert.equal(url.searchParams.get("format"), "full");
    assert.equal(decoded.text, "Hello plain");

    await client.getMessage("m1", { metadataOnly: true });
    assert.equal(new URL(mock.calls[1].url).searchParams.get("format"), "metadata");
  } finally {
    mock.restore();
  }
});

test("sendMessage posts base64url raw MIME with the threadId", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    await new GoogleGmailClient(staticConfig()).sendMessage({
      to: ["a@b.c"],
      subject: "Re: Hello",
      bodyText: "reply body",
      threadId: "t-9",
      inReplyTo: "<orig@x>",
    });
    assert.equal(mock.calls[0].url, `${BASE}/gmail/v1/users/me/messages/send`);
    assert.equal(mock.calls[0].method, "POST");
    const body = JSON.parse(mock.calls[0].body!) as { raw: string; threadId: string };
    assert.equal(body.threadId, "t-9");
    const mime = Buffer.from(body.raw, "base64url").toString("utf8");
    assert.match(mime, /To: a@b\.c\r\n/);
    assert.match(mime, /Subject: Re: Hello\r\n/);
    assert.match(mime, /In-Reply-To: <orig@x>\r\n/);
  } finally {
    mock.restore();
  }
});

test("sendMessage requires at least one recipient across to/cc/bcc, before any fetch", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    for (const params of [
      { subject: "x", bodyText: "y" },
      { to: [], cc: [], bcc: [], subject: "x", bodyText: "y" },
    ]) {
      await assert.rejects(
        () => new GoogleGmailClient(staticConfig()).sendMessage(params),
        /At least one recipient is required across "to", "cc" and "bcc"/,
      );
    }
    assert.equal(mock.calls.length, 0);
  } finally {
    mock.restore();
  }
});

test("sendMessage accepts a bcc-only send — Gmail does not require To", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    await new GoogleGmailClient(staticConfig()).sendMessage({
      bcc: ["hidden@b.c"],
      subject: "Announcement",
      bodyText: "hi all",
    });
    assert.equal(mock.calls[0].url, `${BASE}/gmail/v1/users/me/messages/send`);
    const body = JSON.parse(mock.calls[0].body!) as { raw: string };
    const mime = Buffer.from(body.raw, "base64url").toString("utf8");
    assert.match(mime, /Bcc: hidden@b\.c\r\n/);
    assert.doesNotMatch(mime, /^To:/m);
  } finally {
    mock.restore();
  }
});

test("modifyMessage / modifyThread post mapped label changes", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    const client = new GoogleGmailClient(staticConfig());
    await client.modifyMessage("m1", { read: true, starred: true });
    assert.equal(mock.calls[0].url, `${BASE}/gmail/v1/users/me/messages/m1/modify`);
    assert.deepEqual(JSON.parse(mock.calls[0].body!), {
      addLabelIds: ["STARRED"],
      removeLabelIds: ["UNREAD"],
    });

    await client.modifyThread("t1", { archived: true });
    assert.equal(mock.calls[1].url, `${BASE}/gmail/v1/users/me/threads/t1/modify`);
    assert.deepEqual(JSON.parse(mock.calls[1].body!), { removeLabelIds: ["INBOX"] });

    await assert.rejects(() => client.modifyMessage("m1", {}), /At least one change/);
    assert.equal(mock.calls.length, 2, "an empty change set never reaches the API");
  } finally {
    mock.restore();
  }
});

test("trash/untrash hit the message and thread endpoints", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    const client = new GoogleGmailClient(staticConfig());
    await client.trashMessage("m1");
    await client.untrashMessage("m1");
    await client.trashThread("t1");
    await client.untrashThread("t1");
    assert.deepEqual(
      mock.calls.map((c) => c.url.slice(`${BASE}/gmail/v1/users/me/`.length)),
      ["messages/m1/trash", "messages/m1/untrash", "threads/t1/trash", "threads/t1/untrash"],
    );
    for (const call of mock.calls) assert.equal(call.method, "POST");
  } finally {
    mock.restore();
  }
});

test("listThreads and getThread map the query and decode every message", async () => {
  const mock = mockFetch((url) => {
    if (url.includes("/threads?") && !url.includes("/threads/"))
      return okJson({ threads: [{ id: "t1", snippet: "s" }] });
    return okJson({ id: "t1", historyId: "5", messages: [wireMessageFixture()] });
  });
  try {
    const client = new GoogleGmailClient(staticConfig());
    await client.listThreads({ query: "subject:x", pageSize: 5 });
    const listUrl = new URL(mock.calls[0].url);
    assert.equal(listUrl.pathname, "/gmail/v1/users/me/threads");
    assert.equal(listUrl.searchParams.get("q"), "subject:x");
    assert.equal(listUrl.searchParams.get("maxResults"), "5");

    const thread = (await client.getThread("t1")) as { messages: { text?: string }[] };
    const getUrl = new URL(mock.calls[1].url);
    assert.equal(getUrl.pathname, "/gmail/v1/users/me/threads/t1");
    assert.equal(getUrl.searchParams.get("format"), "full");
    assert.equal(thread.messages[0].text, "Hello plain");
  } finally {
    mock.restore();
  }
});

test("draft CRUD maps to the drafts endpoints with raw MIME", async () => {
  const mock = mockFetch((url, init) => {
    if (url.endsWith("/drafts") && init.method === "POST") return okJson({ id: "d1" });
    if (url.includes("/drafts/d1") && init.method === "GET")
      return okJson({ id: "d1", message: wireMessageFixture() });
    return okJson({ ok: true });
  });
  try {
    const client = new GoogleGmailClient(staticConfig());

    const created = (await client.createDraft({ to: ["a@b.c"], subject: "Draft", bodyText: "d" })) as {
      id: string;
    };
    assert.equal(created.id, "d1");
    assert.equal(mock.calls[0].url, `${BASE}/gmail/v1/users/me/drafts`);
    const createBody = JSON.parse(mock.calls[0].body!) as { message: { raw: string } };
    assert.match(Buffer.from(createBody.message.raw, "base64url").toString("utf8"), /Subject: Draft\r\n/);

    const fetched = (await client.getDraft("d1")) as { message: { text?: string } };
    assert.equal(new URL(mock.calls[1].url).searchParams.get("format"), "full");
    assert.equal(fetched.message.text, "Hello plain");

    await client.updateDraft("d1", { to: ["a@b.c"], subject: "Draft v2", bodyText: "e", threadId: "t1" });
    assert.equal(mock.calls[2].method, "PUT");
    assert.equal(mock.calls[2].url, `${BASE}/gmail/v1/users/me/drafts/d1`);
    const updateBody = JSON.parse(mock.calls[2].body!) as { message: { raw: string; threadId: string } };
    assert.equal(updateBody.message.threadId, "t1");
    assert.match(Buffer.from(updateBody.message.raw, "base64url").toString("utf8"), /Subject: Draft v2\r\n/);

    await client.sendDraft("d1");
    assert.equal(mock.calls[3].method, "POST");
    assert.equal(mock.calls[3].url, `${BASE}/gmail/v1/users/me/drafts/send`);
    assert.deepEqual(JSON.parse(mock.calls[3].body!), { id: "d1" });

    await client.deleteDraft("d1");
    assert.equal(mock.calls[4].method, "DELETE");
    assert.equal(mock.calls[4].url, `${BASE}/gmail/v1/users/me/drafts/d1`);

    await client.listDrafts({ query: "subject:x", pageSize: 3, pageToken: "pt" });
    const listUrl = new URL(mock.calls[5].url);
    assert.equal(listUrl.pathname, "/gmail/v1/users/me/drafts");
    assert.equal(listUrl.searchParams.get("q"), "subject:x");
    assert.equal(listUrl.searchParams.get("maxResults"), "3");
    assert.equal(listUrl.searchParams.get("pageToken"), "pt");
  } finally {
    mock.restore();
  }
});

test("label methods map to the labels endpoints with visibility mapping", async () => {
  const mock = mockFetch(defaultHandler);
  try {
    const client = new GoogleGmailClient(staticConfig());
    await client.listLabels();
    assert.equal(mock.calls[0].url, `${BASE}/gmail/v1/users/me/labels`);

    await client.getLabel("Label_1");
    assert.equal(mock.calls[1].url, `${BASE}/gmail/v1/users/me/labels/Label_1`);

    await client.createLabel({
      name: "Clients/Acme",
      labelListVisibility: "show_if_unread",
      messageListVisibility: "hide",
    });
    assert.equal(mock.calls[2].method, "POST");
    assert.deepEqual(JSON.parse(mock.calls[2].body!), {
      name: "Clients/Acme",
      labelListVisibility: "labelShowIfUnread",
      messageListVisibility: "hide",
    });

    await client.updateLabel("Label_1", { name: "Renamed", labelListVisibility: "hide" });
    assert.equal(mock.calls[3].method, "PATCH");
    assert.equal(mock.calls[3].url, `${BASE}/gmail/v1/users/me/labels/Label_1`);
    assert.deepEqual(JSON.parse(mock.calls[3].body!), { name: "Renamed", labelListVisibility: "labelHide" });

    await assert.rejects(() => client.updateLabel("Label_1", {}), /At least one of/);

    await client.deleteLabel("Label_1");
    assert.equal(mock.calls[4].method, "DELETE");
    assert.equal(mock.calls[4].url, `${BASE}/gmail/v1/users/me/labels/Label_1`);
  } finally {
    mock.restore();
  }
});
