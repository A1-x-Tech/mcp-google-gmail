import { randomBytes } from "node:crypto";
import type { GoogleGmailConfig, LabelListVisibility, MessageListVisibility } from "./types.js";
import { GoogleGmailError } from "./types.js";
import { CredentialsError } from "./config.js";

/** The Gmail API uses all five verbs (labels.patch is PATCH, drafts.update is PUT). */
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Google's OAuth2 token endpoint — refresh tokens are exchanged here. */
const TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Every call targets the authenticated mailbox; the API calls it `me`. */
const USER_PATH = "gmail/v1/users/me";

/**
 * Max parallel metadata GETs while hydrating a list page. A full page of 100
 * fired at once would burst ~500 quota units instantly (a metadata get costs 5
 * against ~250 units/s/user); a small pool keeps the burst under the limit
 * without serializing the page.
 */
const HYDRATE_CONCURRENCY = 8;

// ---------------------------------------------------------------------------
// Normalized parameter shapes (tools speak these; the wire never leaks out)
// ---------------------------------------------------------------------------

/** Normalized inputs for building an outgoing RFC 2822 message (send or draft). */
export interface EmailParams {
  /** Recipients ("Name <a@b.c>" or bare addresses). Optional for drafts. */
  to?: string[];
  cc?: string[];
  bcc?: string[];
  subject?: string;
  /** Plain-text body. */
  bodyText?: string;
  /** HTML body; combined with bodyText into multipart/alternative when both are set. */
  bodyHtml?: string;
  /** Reply into this Gmail thread (pairs with inReplyTo for RFC-correct threading). */
  threadId?: string;
  /** RFC Message-ID of the message being replied to (from get_message headers.messageId). */
  inReplyTo?: string;
  /** Explicit References chain; defaults to inReplyTo when omitted. */
  references?: string;
}

/** Normalized inputs for list_messages / list_threads / list_drafts. */
export interface ListParams {
  /** Gmail query syntax, e.g. "from:x is:unread newer_than:7d". */
  query?: string;
  labelIds?: string[];
  pageSize?: number;
  pageToken?: string;
  includeSpamTrash?: boolean;
}

/** How much decoded body to return. */
export interface DecodeOptions {
  /** Include the decoded HTML body even when a text body exists (default: only when there is no text part). */
  includeHtml?: boolean;
  /** Truncate each decoded body at this many characters (default 50000). */
  maxBodyChars?: number;
}

/** Normalized label-state changes; mapped to Gmail system labels by the client. */
export interface LabelChanges {
  /** true = mark read (removes UNREAD), false = mark unread. */
  read?: boolean;
  /** true = star (adds STARRED), false = unstar. */
  starred?: boolean;
  /** true = archive (removes INBOX), false = move back to inbox. */
  archived?: boolean;
  addLabelIds?: string[];
  removeLabelIds?: string[];
}

// ---------------------------------------------------------------------------
// MIME building (outgoing mail) — pure functions, exported for tests
// ---------------------------------------------------------------------------

/** Rejects header values that would smuggle extra headers into the message. */
function assertHeaderSafe(field: string, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`"${field}" must not contain line breaks.`);
  }
}

/** RFC 2047 encoded-word for non-ASCII header text (Subject); ASCII passes through. */
function encodeHeaderText(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Wraps a base64 string at 76 chars per RFC 2045. */
function wrap76(b64: string): string {
  return b64.replace(/(.{76})/g, "$1\r\n").replace(/\r\n$/, "");
}

/** Ensures an RFC Message-ID is wrapped in angle brackets. */
function angleWrap(id: string): string {
  const trimmed = id.trim();
  return trimmed.startsWith("<") ? trimmed : `<${trimmed}>`;
}

function bodyPart(mimeType: "text/plain" | "text/html", content: string): string {
  return [
    `Content-Type: ${mimeType}; charset="UTF-8"`,
    "Content-Transfer-Encoding: base64",
    "",
    wrap76(Buffer.from(content, "utf8").toString("base64")),
  ].join("\r\n");
}

/**
 * Builds the RFC 2822 message the Gmail API expects in `raw`. Bodies are sent
 * base64-encoded (immune to line-length and 8-bit issues); text + HTML become
 * multipart/alternative. Throws on header injection (CR/LF in addresses or the
 * subject) — that is a caller error, not something to sanitize silently.
 */
export function buildMimeMessage(p: EmailParams): string {
  for (const [field, list] of [["to", p.to], ["cc", p.cc], ["bcc", p.bcc]] as const) {
    for (const addr of list ?? []) assertHeaderSafe(field, addr);
  }
  if (p.subject !== undefined) assertHeaderSafe("subject", p.subject);
  if (p.inReplyTo !== undefined) assertHeaderSafe("in_reply_to", p.inReplyTo);
  if (p.references !== undefined) assertHeaderSafe("references", p.references);

  const headers: string[] = [];
  if (p.to?.length) headers.push(`To: ${p.to.join(", ")}`);
  if (p.cc?.length) headers.push(`Cc: ${p.cc.join(", ")}`);
  if (p.bcc?.length) headers.push(`Bcc: ${p.bcc.join(", ")}`);
  if (p.subject !== undefined) headers.push(`Subject: ${encodeHeaderText(p.subject)}`);
  if (p.inReplyTo) headers.push(`In-Reply-To: ${angleWrap(p.inReplyTo)}`);
  if (p.references || p.inReplyTo) {
    headers.push(`References: ${p.references ?? angleWrap(p.inReplyTo as string)}`);
  }
  headers.push("MIME-Version: 1.0");

  const text = p.bodyText;
  const html = p.bodyHtml;
  if (text !== undefined && html !== undefined) {
    const boundary = `=_mcp_${randomBytes(12).toString("hex")}`;
    return [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      bodyPart("text/plain", text),
      `--${boundary}`,
      bodyPart("text/html", html),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }
  if (html !== undefined) return [...headers, bodyPart("text/html", html)].join("\r\n");
  return [...headers, bodyPart("text/plain", text ?? "")].join("\r\n");
}

// ---------------------------------------------------------------------------
// MIME decoding (incoming mail) — pure functions, exported for tests
// ---------------------------------------------------------------------------

/** A Gmail API MessagePart (the fields this server reads). */
interface WirePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: { name?: string; value?: string }[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: WirePart[];
}

/** A Gmail API Message (the fields this server reads). */
export interface WireMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: WirePart;
}

export interface DecodedAttachment {
  filename: string;
  mimeType?: string;
  sizeBytes?: number;
  /** Pass to raw_request (users/me/messages/<id>/attachments/<attachmentId>) to download. */
  attachmentId?: string;
  partId?: string;
}

export interface DecodedMessage {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  /** Server-side receive time as an ISO timestamp. */
  internalDate?: string;
  sizeEstimate?: number;
  headers: Record<string, string>;
  text?: string;
  textTruncated?: boolean;
  html?: string;
  htmlTruncated?: boolean;
  attachments?: DecodedAttachment[];
}

const DEFAULT_MAX_BODY_CHARS = 50_000;

/** TextDecoder with an unknown-charset fallback to UTF-8. */
function decodeBytes(bytes: Uint8Array, charset?: string): string {
  if (charset) {
    try {
      return new TextDecoder(charset.toLowerCase()).decode(bytes);
    } catch {
      // unknown label — fall through to utf-8
    }
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** RFC 2047 Q-encoding to bytes: `_` is space, `=XX` a hex byte. */
function qDecodeBytes(data: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const ch = data[i];
    if (ch === "_") {
      out.push(0x20);
    } else if (ch === "=" && i + 2 < data.length + 1 && /^[0-9a-fA-F]{2}$/.test(data.slice(i + 1, i + 3))) {
      out.push(parseInt(data.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      out.push(data.charCodeAt(i));
    }
  }
  return Uint8Array.from(out);
}

/** Decodes RFC 2047 encoded-words (=?charset?B|Q?...?=) inside a header value. */
export function decodeEncodedWords(value: string): string {
  return value.replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=/g, (match, charset: string, enc: string, data: string) => {
    try {
      const bytes = enc.toLowerCase() === "b" ? new Uint8Array(Buffer.from(data, "base64")) : qDecodeBytes(data);
      return decodeBytes(bytes, charset);
    } catch {
      return match;
    }
  });
}

/** charset from a part's Content-Type header, e.g. text/plain; charset="koi8-r". */
function charsetOf(part: WirePart): string | undefined {
  const contentType = part.headers?.find((h) => h.name?.toLowerCase() === "content-type")?.value;
  return contentType?.match(/charset="?([\w.-]+)"?/i)?.[1];
}

/** Decodes a base64url body with the part's declared charset. */
function decodePartBody(part: WirePart): string {
  const bytes = new Uint8Array(Buffer.from(part.body?.data ?? "", "base64url"));
  return decodeBytes(bytes, charsetOf(part));
}

/** The message headers worth surfacing, normalized to camelCase keys. */
const HEADER_KEYS: Record<string, string> = {
  from: "from",
  to: "to",
  cc: "cc",
  bcc: "bcc",
  "reply-to": "replyTo",
  subject: "subject",
  date: "date",
  "message-id": "messageId",
  "in-reply-to": "inReplyTo",
  references: "references",
};

/**
 * Decodes a wire Message into what a model actually needs: RFC-2047-decoded
 * address/subject headers, the text and (on request) HTML bodies decoded from
 * base64url with their declared charsets, and attachment *metadata* — never
 * attachment content, which can be fetched via raw_request when truly needed.
 * Bodies are truncated at maxBodyChars with an explicit truncation flag, so a
 * newsletter cannot silently flood the model's context.
 */
export function decodeMessage(msg: WireMessage, opts: DecodeOptions = {}): DecodedMessage {
  const maxChars = opts.maxBodyChars ?? DEFAULT_MAX_BODY_CHARS;
  const texts: string[] = [];
  const htmls: string[] = [];
  const attachments: DecodedAttachment[] = [];

  const walk = (part: WirePart | undefined): void => {
    if (!part) return;
    if (part.parts?.length) {
      for (const child of part.parts) walk(child);
      return;
    }
    const isAttachment = Boolean(part.filename) || Boolean(part.body?.attachmentId);
    if (isAttachment) {
      attachments.push(
        compact({
          filename: part.filename || "(unnamed)",
          mimeType: part.mimeType,
          sizeBytes: part.body?.size,
          attachmentId: part.body?.attachmentId,
          partId: part.partId,
        }) as unknown as DecodedAttachment,
      );
      return;
    }
    if (!part.body?.data) return;
    const mime = (part.mimeType ?? "").toLowerCase();
    if (mime.startsWith("text/plain")) texts.push(decodePartBody(part));
    else if (mime.startsWith("text/html")) htmls.push(decodePartBody(part));
  };
  walk(msg.payload);

  const headers: Record<string, string> = {};
  for (const h of msg.payload?.headers ?? []) {
    const key = HEADER_KEYS[(h.name ?? "").toLowerCase()];
    if (key && h.value !== undefined && !(key in headers)) {
      headers[key] = decodeEncodedWords(h.value);
    }
  }

  const text = texts.length ? texts.join("\n") : undefined;
  const htmlWanted = opts.includeHtml || text === undefined;
  const html = htmlWanted && htmls.length ? htmls.join("\n") : undefined;
  const internalMs = Number(msg.internalDate);

  return compact({
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds,
    snippet: msg.snippet,
    historyId: msg.historyId,
    internalDate: Number.isFinite(internalMs) && internalMs > 0 ? new Date(internalMs).toISOString() : undefined,
    sizeEstimate: msg.sizeEstimate,
    headers,
    text: text !== undefined ? text.slice(0, maxChars) : undefined,
    textTruncated: text !== undefined && text.length > maxChars ? true : undefined,
    html: html !== undefined ? html.slice(0, maxChars) : undefined,
    htmlTruncated: html !== undefined && html.length > maxChars ? true : undefined,
    attachments: attachments.length ? attachments : undefined,
  }) as DecodedMessage;
}

/**
 * Maps the normalized read/starred/archived flags plus explicit label ids to
 * the API's addLabelIds/removeLabelIds. Pure wire mapping — throws when no
 * change was requested, because an empty modify call is always a caller bug.
 */
export function buildLabelChanges(p: LabelChanges): { addLabelIds?: string[]; removeLabelIds?: string[] } {
  const add = [...(p.addLabelIds ?? [])];
  const remove = [...(p.removeLabelIds ?? [])];
  if (p.read === true) remove.push("UNREAD");
  if (p.read === false) add.push("UNREAD");
  if (p.starred === true) add.push("STARRED");
  if (p.starred === false) remove.push("STARRED");
  if (p.archived === true) remove.push("INBOX");
  if (p.archived === false) add.push("INBOX");
  if (add.length === 0 && remove.length === 0) {
    throw new Error(
      "At least one change is required: read, starred, archived, add_label_ids or remove_label_ids.",
    );
  }
  return compact({
    addLabelIds: add.length ? add : undefined,
    removeLabelIds: remove.length ? remove : undefined,
  });
}

/** Maps normalized label visibility to the API's wire enum. */
function mapLabelListVisibility(v: LabelListVisibility): string {
  return { show: "labelShow", show_if_unread: "labelShowIfUnread", hide: "labelHide" }[v];
}

// ---------------------------------------------------------------------------
// The client
// ---------------------------------------------------------------------------

export class GoogleGmailClient {
  private readonly base: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;
  /** Cached access token from the refresh flow, with its expiry. */
  private cachedToken?: { value: string; expiresAt: number };
  /** In-flight refresh, deduping concurrent token requests. */
  private refreshInFlight?: Promise<string>;

  constructor(private readonly config: GoogleGmailConfig) {
    this.base = config.apiBase.endsWith("/") ? config.apiBase : config.apiBase + "/";
    this.timeoutMs = config.timeoutMs ?? 60_000;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 500;
  }

  private canRefresh(): boolean {
    return Boolean(this.config.refreshToken && this.config.clientId && this.config.clientSecret);
  }

  /**
   * Returns a valid Bearer token. With the refresh triple configured, mints an
   * access token from the refresh token and caches it until shortly before it
   * expires (concurrent callers share one in-flight refresh); otherwise the
   * static GOOGLE_GMAIL_ACCESS_TOKEN is used as-is. With neither configured,
   * throws {@link CredentialsError} BEFORE any fetch — a missing setup must
   * never enter the retry/backoff loop or trigger the 401 re-mint, because no
   * amount of retrying mints credentials.
   */
  private async accessToken(forceRefresh = false): Promise<string> {
    if (!this.canRefresh()) {
      if (!this.config.accessToken) throw new CredentialsError();
      return this.config.accessToken;
    }
    if (!forceRefresh && this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.value;
    }
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refreshAccessToken().finally(() => {
        this.refreshInFlight = undefined;
      });
    }
    return this.refreshInFlight;
  }

  /** Exchanges the refresh token for a fresh access token at Google's token endpoint. */
  private async refreshAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      client_id: this.config.clientId as string,
      client_secret: this.config.clientSecret as string,
      refresh_token: this.config.refreshToken as string,
      grant_type: "refresh_token",
    }).toString();

    const { res, text } = await this.fetchWithTimeout(
      TOKEN_URL,
      { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body },
      "oauth2 token refresh",
    );

    let data: unknown;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    if (!res.ok) throw new GoogleGmailError(res.status, data);

    const token = (data as { access_token?: unknown }).access_token;
    if (typeof token !== "string" || !token) {
      throw new Error("OAuth2 token endpoint returned no access_token.");
    }
    const expiresIn = Number((data as { expires_in?: unknown }).expires_in);
    const ttl = Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
    // Refresh 60s ahead of the real expiry so requests never race a dying token.
    this.cachedToken = { value: token, expiresAt: Date.now() + Math.max(ttl - 60, 30) * 1000 };
    return token;
  }

  /** Backoff before a retry: honors Retry-After when present, else exponential (capped at 30s). */
  private backoffMs(attempt: number, res?: Response): number {
    const retryAfter = res ? Number(res.headers.get("Retry-After")) : NaN;
    if (Number.isFinite(retryAfter) && retryAfter > 0) return Math.min(retryAfter, 30) * 1000;
    return Math.min(this.retryBaseMs * 2 ** attempt, 30_000);
  }

  /**
   * fetch with an AbortController timeout. Reads the response body inside the
   * guarded zone so the timeout also covers a slow or drip-feeding body, not
   * just the initial headers, and returns the text alongside the response.
   */
  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    label: string,
  ): Promise<{ res: Response; text: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      return { res, text };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error(`Request to "${label}" timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Low-level request to a Gmail API path (e.g. "gmail/v1/users/me/profile").
   * Auth is a Bearer token (refreshed transparently; a 401 forces one re-mint +
   * retry). 429 is always retried with backoff; 5xx and network errors/timeouts
   * are retried only for GET — replaying a send/trash/delete after an ambiguous
   * failure could execute it twice (a duplicate email cannot be unsent). Any
   * other non-2xx throws a {@link GoogleGmailError}.
   */
  async request<T = unknown>(
    method: HttpMethod,
    path: string,
    body?: Record<string, unknown>,
    query?: Record<string, string | number | boolean | string[] | undefined>,
  ): Promise<T> {
    // Guard method !== "GET" keeps undici from crashing on a GET-with-body.
    const hasBody = body !== undefined && method !== "GET";

    // Resolve the path against the API base, then reject anything that escaped
    // to a foreign origin (an absolute "https://evil/x" or a "\\evil/x" slipped
    // through raw_request) so the Bearer token can never leak to another host.
    const url = new URL(path.replace(/^\//, ""), this.base);
    if (url.origin !== new URL(this.base).origin) {
      throw new Error(`raw_request path must be a relative API path (resolved to foreign origin ${url.origin})`);
    }
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) url.searchParams.append(key, item);
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const target = url.toString();

    // Writes must not be replayed on ambiguous failures (see the retry gate below).
    const idempotent = method === "GET";
    let refreshedOn401 = false;

    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (hasBody) headers["Content-Type"] = "application/json";

      let res: Response;
      let text: string;
      try {
        ({ res, text } = await this.fetchWithTimeout(
          target,
          { method, headers, body: hasBody ? JSON.stringify(body) : undefined },
          path,
        ));
      } catch (err) {
        // Network error or timeout: the request may or may not have reached the
        // API, so only reads are retried; writes rethrow immediately.
        if (idempotent && attempt < this.maxRetries) {
          await delay(this.backoffMs(attempt));
          continue;
        }
        throw err;
      }

      // An expired/revoked access token: re-mint once and replay. The request
      // never executed, so this is safe for writes too.
      if (res.status === 401 && this.canRefresh() && !refreshedOn401) {
        refreshedOn401 = true;
        await this.accessToken(true);
        continue;
      }

      // 429 means the request was rejected before executing — safe to retry for
      // any method. 5xx is ambiguous (the send may have committed), so it is
      // gated to idempotent requests.
      const transient = res.status === 429 || (idempotent && res.status >= 500 && res.status < 600);
      if (transient && attempt < this.maxRetries) {
        await delay(this.backoffMs(attempt, res));
        continue;
      }

      let data: unknown = undefined;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }

      if (!res.ok) throw new GoogleGmailError(res.status, data);
      return data as T;
    }
  }

  // ---- Profile ----

  /** The authenticated mailbox: emailAddress, messagesTotal, threadsTotal, historyId. */
  async getProfile(): Promise<unknown> {
    return this.request("GET", `${USER_PATH}/profile`);
  }

  /** Verifies the OAuth credentials by minting a fresh access token (refresh flow only). */
  async authCheck(): Promise<unknown> {
    if (!this.canRefresh()) {
      throw new Error(
        "authCheck needs the refresh flow (GOOGLE_GMAIL_CLIENT_ID / _CLIENT_SECRET / _REFRESH_TOKEN); with a static GOOGLE_GMAIL_ACCESS_TOKEN fetch the profile instead.",
      );
    }
    await this.accessToken(true);
    return { ok: true, auth: "refresh_token" };
  }

  // ---- Messages ----

  /**
   * Lists message ids matching the Gmail query, then (unless hydrate is off)
   * fetches format=metadata for each id so the model sees from/subject/date/
   * snippet instead of bare ids. Hydration costs one extra GET per message —
   * the page size is capped by the tool schema accordingly — and runs at most
   * {@link HYDRATE_CONCURRENCY} reads in parallel. A message deleted between
   * the list and its get (a 404 racing another client) is skipped rather than
   * failing the whole page.
   */
  async listMessages(p: ListParams & { hydrate?: boolean }): Promise<unknown> {
    const data = await this.request<{
      messages?: { id: string; threadId?: string }[];
      nextPageToken?: string;
      resultSizeEstimate?: number;
    }>("GET", `${USER_PATH}/messages`, undefined, compact({
      q: p.query,
      labelIds: p.labelIds,
      maxResults: p.pageSize,
      pageToken: p.pageToken,
      includeSpamTrash: p.includeSpamTrash,
    }));
    if (p.hydrate === false || !data.messages?.length) return data;
    const messages = await this.hydrateSummaries(data.messages.map((m) => m.id));
    return compact({
      messages,
      nextPageToken: data.nextPageToken,
      resultSizeEstimate: data.resultSizeEstimate,
    });
  }

  /**
   * Fetches a metadata summary per id with a small worker pool (at most
   * {@link HYDRATE_CONCURRENCY} GETs in flight) so a 100-id page never bursts
   * the per-user quota. List order is preserved. A 404 means the message was
   * deleted between the list and this get — the entry is dropped, a partial
   * page being strictly more useful than a failed one; any other error still
   * throws, because it would apply to every remaining read too.
   */
  private async hydrateSummaries(ids: string[]): Promise<unknown[]> {
    const slots: (unknown | undefined)[] = new Array(ids.length);
    let next = 0;
    const worker = async (): Promise<void> => {
      for (let i = next++; i < ids.length; i = next++) {
        try {
          slots[i] = await this.messageSummary(ids[i]);
        } catch (err) {
          if (err instanceof GoogleGmailError && err.status === 404) continue;
          throw err;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(HYDRATE_CONCURRENCY, ids.length) }, worker));
    return slots.filter((s) => s !== undefined);
  }

  /** One metadata-only GET: enough to triage a message without its body. */
  private async messageSummary(id: string): Promise<unknown> {
    const wire = await this.request<WireMessage>(
      "GET",
      `${USER_PATH}/messages/${encodeURIComponent(id)}`,
      undefined,
      { format: "metadata", metadataHeaders: ["From", "To", "Subject", "Date"] },
    );
    const decoded = decodeMessage(wire);
    return compact({
      id: decoded.id,
      threadId: decoded.threadId,
      labelIds: decoded.labelIds,
      snippet: decoded.snippet,
      internalDate: decoded.internalDate,
      from: decoded.headers.from,
      to: decoded.headers.to,
      subject: decoded.headers.subject,
      date: decoded.headers.date,
    });
  }

  /** One message, decoded: headers, text/html bodies, attachment metadata. */
  async getMessage(id: string, opts: DecodeOptions & { metadataOnly?: boolean } = {}): Promise<unknown> {
    const wire = await this.request<WireMessage>(
      "GET",
      `${USER_PATH}/messages/${encodeURIComponent(id)}`,
      undefined,
      { format: opts.metadataOnly ? "metadata" : "full" },
    );
    return decodeMessage(wire, opts);
  }

  /**
   * Sends an email (new, or a reply when threadId is set). Any recipient field
   * satisfies the send — Gmail accepts cc-only and bcc-only messages, so `to`
   * alone is not required. The MIME message is built here and never retried
   * after an ambiguous failure — a duplicate email cannot be unsent.
   */
  async sendMessage(p: EmailParams): Promise<unknown> {
    if (!p.to?.length && !p.cc?.length && !p.bcc?.length) {
      throw new Error('At least one recipient is required across "to", "cc" and "bcc" to send.');
    }
    const raw = Buffer.from(buildMimeMessage(p), "utf8").toString("base64url");
    return this.request("POST", `${USER_PATH}/messages/send`, compact({ raw, threadId: p.threadId }));
  }

  /** Applies normalized label changes (read/star/archive/custom labels) to a message. */
  async modifyMessage(id: string, changes: LabelChanges): Promise<unknown> {
    return this.request(
      "POST",
      `${USER_PATH}/messages/${encodeURIComponent(id)}/modify`,
      buildLabelChanges(changes),
    );
  }

  /** Moves a message to the trash (reversible for ~30 days). */
  async trashMessage(id: string): Promise<unknown> {
    return this.request("POST", `${USER_PATH}/messages/${encodeURIComponent(id)}/trash`, {});
  }

  /** Restores a message from the trash. */
  async untrashMessage(id: string): Promise<unknown> {
    return this.request("POST", `${USER_PATH}/messages/${encodeURIComponent(id)}/untrash`, {});
  }

  // ---- Threads ----

  /** Lists threads matching the Gmail query (the API includes snippets here). */
  async listThreads(p: ListParams): Promise<unknown> {
    return this.request("GET", `${USER_PATH}/threads`, undefined, compact({
      q: p.query,
      labelIds: p.labelIds,
      maxResults: p.pageSize,
      pageToken: p.pageToken,
      includeSpamTrash: p.includeSpamTrash,
    }));
  }

  /** A whole conversation: every message decoded like getMessage. */
  async getThread(id: string, opts: DecodeOptions = {}): Promise<unknown> {
    const wire = await this.request<{ id?: string; historyId?: string; messages?: WireMessage[] }>(
      "GET",
      `${USER_PATH}/threads/${encodeURIComponent(id)}`,
      undefined,
      { format: "full" },
    );
    return compact({
      id: wire.id,
      historyId: wire.historyId,
      messages: wire.messages?.map((m) => decodeMessage(m, opts)),
    });
  }

  /** Applies normalized label changes to every message in a thread. */
  async modifyThread(id: string, changes: LabelChanges): Promise<unknown> {
    return this.request(
      "POST",
      `${USER_PATH}/threads/${encodeURIComponent(id)}/modify`,
      buildLabelChanges(changes),
    );
  }

  /** Moves a whole thread to the trash (reversible for ~30 days). */
  async trashThread(id: string): Promise<unknown> {
    return this.request("POST", `${USER_PATH}/threads/${encodeURIComponent(id)}/trash`, {});
  }

  /** Restores a thread from the trash. */
  async untrashThread(id: string): Promise<unknown> {
    return this.request("POST", `${USER_PATH}/threads/${encodeURIComponent(id)}/untrash`, {});
  }

  // ---- Drafts ----

  /** Creates a draft (optionally a reply draft when threadId is set). */
  async createDraft(p: EmailParams): Promise<unknown> {
    const raw = Buffer.from(buildMimeMessage(p), "utf8").toString("base64url");
    return this.request("POST", `${USER_PATH}/drafts`, {
      message: compact({ raw, threadId: p.threadId }),
    });
  }

  /** Lists drafts; q filters with the same Gmail query syntax. */
  async listDrafts(p: { query?: string; pageSize?: number; pageToken?: string } = {}): Promise<unknown> {
    return this.request("GET", `${USER_PATH}/drafts`, undefined, compact({
      q: p.query,
      maxResults: p.pageSize,
      pageToken: p.pageToken,
    }));
  }

  /** One draft with its message decoded. */
  async getDraft(id: string, opts: DecodeOptions = {}): Promise<unknown> {
    const wire = await this.request<{ id?: string; message?: WireMessage }>(
      "GET",
      `${USER_PATH}/drafts/${encodeURIComponent(id)}`,
      undefined,
      { format: "full" },
    );
    return compact({
      id: wire.id,
      message: wire.message ? decodeMessage(wire.message, opts) : undefined,
    });
  }

  /** Replaces the draft's message entirely (the API has no partial draft update). */
  async updateDraft(id: string, p: EmailParams): Promise<unknown> {
    const raw = Buffer.from(buildMimeMessage(p), "utf8").toString("base64url");
    return this.request("PUT", `${USER_PATH}/drafts/${encodeURIComponent(id)}`, {
      message: compact({ raw, threadId: p.threadId }),
    });
  }

  /** Sends an existing draft as-is; the draft is consumed by the send. */
  async sendDraft(id: string): Promise<unknown> {
    return this.request("POST", `${USER_PATH}/drafts/send`, { id });
  }

  /** Permanently deletes a draft — drafts skip the trash entirely. */
  async deleteDraft(id: string): Promise<unknown> {
    return this.request("DELETE", `${USER_PATH}/drafts/${encodeURIComponent(id)}`);
  }

  // ---- Labels ----

  /** All labels (system + user). labels.list carries no counts — use getLabel for those. */
  async listLabels(): Promise<unknown> {
    return this.request("GET", `${USER_PATH}/labels`);
  }

  /** One label with its message/thread counts. */
  async getLabel(id: string): Promise<unknown> {
    return this.request("GET", `${USER_PATH}/labels/${encodeURIComponent(id)}`);
  }

  /** Creates a user label (nested names use "/", e.g. "Clients/Acme"). */
  async createLabel(p: {
    name: string;
    labelListVisibility?: LabelListVisibility;
    messageListVisibility?: MessageListVisibility;
  }): Promise<unknown> {
    return this.request("POST", `${USER_PATH}/labels`, compact({
      name: p.name,
      labelListVisibility: p.labelListVisibility ? mapLabelListVisibility(p.labelListVisibility) : undefined,
      messageListVisibility: p.messageListVisibility,
    }));
  }

  /** Patches only the provided label fields (rename and/or visibility). */
  async updateLabel(
    id: string,
    p: {
      name?: string;
      labelListVisibility?: LabelListVisibility;
      messageListVisibility?: MessageListVisibility;
    },
  ): Promise<unknown> {
    const body = compact({
      name: p.name,
      labelListVisibility: p.labelListVisibility ? mapLabelListVisibility(p.labelListVisibility) : undefined,
      messageListVisibility: p.messageListVisibility,
    });
    if (Object.keys(body).length === 0) {
      throw new Error("At least one of name, label_list_visibility or message_list_visibility is required.");
    }
    return this.request("PATCH", `${USER_PATH}/labels/${encodeURIComponent(id)}`, body);
  }

  /** Deletes a user label; it is removed from every message it was applied to. */
  async deleteLabel(id: string): Promise<unknown> {
    return this.request("DELETE", `${USER_PATH}/labels/${encodeURIComponent(id)}`);
  }
}

/** Drops keys whose value is `undefined` so they are not sent to the API. */
function compact<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
