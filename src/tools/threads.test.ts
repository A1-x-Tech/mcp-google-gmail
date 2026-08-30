import { test } from "node:test";
import assert from "node:assert/strict";
import { registerThreadTools } from "./threads.js";

type Args = Record<string, unknown>;
type Handler = (args: Args) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function harness(opts: { throwOn?: string } = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const make =
    (method: string) =>
    async (...params: unknown[]) => {
      calls.push({ method, params });
      if (opts.throwOn === method) throw new Error("boom");
      return { ok: true };
    };
  const client = {
    listThreads: make("listThreads"),
    getThread: make("getThread"),
    modifyThread: make("modifyThread"),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerThreadTools(server as never, client as never);
  return { calls, tools };
}

test("registers the three thread tools", () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(tools).sort(), ["get_thread", "list_threads", "modify_thread"]);
});

test("list_threads maps the snake_case args", async () => {
  const { calls, tools } = harness();
  await tools.list_threads({
    query: "subject:x",
    label_ids: ["INBOX"],
    page_size: 50,
    page_token: "pt",
    include_spam_trash: true,
  });
  assert.deepEqual(calls[0], {
    method: "listThreads",
    params: [
      { query: "subject:x", labelIds: ["INBOX"], pageSize: 50, pageToken: "pt", includeSpamTrash: true },
    ],
  });
});

test("get_thread forwards the decode options", async () => {
  const { calls, tools } = harness();
  await tools.get_thread({ thread_id: "t1", include_html: true, max_body_chars: 1000 });
  assert.deepEqual(calls[0], {
    method: "getThread",
    params: ["t1", { includeHtml: true, maxBodyChars: 1000 }],
  });
});

test("modify_thread forwards the normalized state flags", async () => {
  const { calls, tools } = harness();
  await tools.modify_thread({ thread_id: "t1", read: true, add_label_ids: ["Label_1"] });
  assert.deepEqual(calls[0], {
    method: "modifyThread",
    params: [
      "t1",
      { read: true, starred: undefined, archived: undefined, addLabelIds: ["Label_1"], removeLabelIds: undefined },
    ],
  });
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "getThread" });
  const res = await tools.get_thread({ thread_id: "t1" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});
