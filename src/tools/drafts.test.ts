import { test } from "node:test";
import assert from "node:assert/strict";
import { registerDraftTools } from "./drafts.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function harness(opts: { throwOn?: string; returnValue?: unknown } = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const make =
    (method: string) =>
    async (...params: unknown[]) => {
      calls.push({ method, params });
      if (opts.throwOn === method) throw new Error("boom");
      return "returnValue" in opts ? opts.returnValue : { ok: true };
    };
  const client = {
    createDraft: make("createDraft"),
    listDrafts: make("listDrafts"),
    getDraft: make("getDraft"),
    updateDraft: make("updateDraft"),
    sendDraft: make("sendDraft"),
    deleteDraft: make("deleteDraft"),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerDraftTools(server as never, client as never);
  return { calls, tools };
}

test("registers the six draft tools", () => {
  const { tools } = harness();
  assert.deepEqual(
    Object.keys(tools).sort(),
    ["create_draft", "delete_draft", "get_draft", "list_drafts", "send_draft", "update_draft"],
  );
});

test("create_draft maps the email fields including reply headers", async () => {
  const { calls, tools } = harness();
  await tools.create_draft({
    to: ["a@b.c"],
    subject: "Re: Hi",
    body_text: "t",
    thread_id: "t1",
    in_reply_to: "<orig@x>",
  });
  assert.deepEqual(calls[0], {
    method: "createDraft",
    params: [
      {
        to: ["a@b.c"],
        cc: undefined,
        bcc: undefined,
        subject: "Re: Hi",
        bodyText: "t",
        bodyHtml: undefined,
        threadId: "t1",
        inReplyTo: "<orig@x>",
        references: undefined,
      },
    ],
  });
});

test("list_drafts and get_draft route with their options", async () => {
  const { calls, tools } = harness();
  await tools.list_drafts({ query: "subject:x", page_size: 10, page_token: "pt" });
  assert.deepEqual(calls[0], {
    method: "listDrafts",
    params: [{ query: "subject:x", pageSize: 10, pageToken: "pt" }],
  });

  await tools.get_draft({ draft_id: "d1", include_html: true, max_body_chars: 2000 });
  assert.deepEqual(calls[1], {
    method: "getDraft",
    params: ["d1", { includeHtml: true, maxBodyChars: 2000 }],
  });
});

test("update_draft passes the draft id separately from the new content", async () => {
  const { calls, tools } = harness();
  await tools.update_draft({ draft_id: "d1", to: ["a@b.c"], subject: "v2", body_text: "new" });
  assert.equal(calls[0].method, "updateDraft");
  assert.equal(calls[0].params[0], "d1");
  assert.deepEqual(calls[0].params[1], {
    to: ["a@b.c"],
    cc: undefined,
    bcc: undefined,
    subject: "v2",
    bodyText: "new",
    bodyHtml: undefined,
    threadId: undefined,
    inReplyTo: undefined,
    references: undefined,
  });
});

test("send_draft and delete_draft route by draft id", async () => {
  const { calls, tools } = harness();
  await tools.send_draft({ draft_id: "d1" });
  assert.deepEqual(calls[0], { method: "sendDraft", params: ["d1"] });

  await tools.delete_draft({ draft_id: "d1" });
  assert.deepEqual(calls[1], { method: "deleteDraft", params: ["d1"] });
});

test("delete_draft reports success even when the API returns an empty body", async () => {
  const { tools } = harness({ returnValue: undefined });
  const res = await tools.delete_draft({ draft_id: "d1" });
  assert.equal(res.isError, undefined);
  assert.match(res.content[0].text, /deleted/);
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "sendDraft" });
  const res = await tools.send_draft({ draft_id: "d1" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});
