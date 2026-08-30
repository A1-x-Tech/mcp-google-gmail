import { test } from "node:test";
import assert from "node:assert/strict";
import { registerMessageTools } from "./messages.js";

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
    listMessages: make("listMessages"),
    getMessage: make("getMessage"),
    sendMessage: make("sendMessage"),
    modifyMessage: make("modifyMessage"),
    trashMessage: make("trashMessage"),
    untrashMessage: make("untrashMessage"),
    trashThread: make("trashThread"),
    untrashThread: make("untrashThread"),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerMessageTools(server as never, client as never);
  return { calls, tools };
}

test("registers the five message tools", () => {
  const { tools } = harness();
  assert.deepEqual(
    Object.keys(tools).sort(),
    ["get_message", "list_messages", "manage_trash", "modify_message", "send_message"],
  );
});

test("list_messages maps snake_case args and defaults page_size to 25", async () => {
  const { calls, tools } = harness();
  await tools.list_messages({
    query: "is:unread",
    label_ids: ["INBOX"],
    page_token: "pt",
    include_spam_trash: true,
    include_metadata: false,
  });
  assert.deepEqual(calls[0], {
    method: "listMessages",
    params: [
      {
        query: "is:unread",
        labelIds: ["INBOX"],
        pageSize: 25,
        pageToken: "pt",
        includeSpamTrash: true,
        hydrate: false,
      },
    ],
  });
});

test("get_message forwards the decode options", async () => {
  const { calls, tools } = harness();
  await tools.get_message({ message_id: "m1", include_html: true, max_body_chars: 5000, metadata_only: true });
  assert.deepEqual(calls[0], {
    method: "getMessage",
    params: ["m1", { includeHtml: true, maxBodyChars: 5000, metadataOnly: true }],
  });
});

test("send_message maps the email fields including reply headers", async () => {
  const { calls, tools } = harness();
  await tools.send_message({
    to: ["a@b.c"],
    cc: ["c@b.c"],
    subject: "Re: Hi",
    body_text: "t",
    body_html: "<p>t</p>",
    thread_id: "t1",
    in_reply_to: "<orig@x>",
    references: "<a@x> <orig@x>",
  });
  assert.deepEqual(calls[0], {
    method: "sendMessage",
    params: [
      {
        to: ["a@b.c"],
        cc: ["c@b.c"],
        bcc: undefined,
        subject: "Re: Hi",
        bodyText: "t",
        bodyHtml: "<p>t</p>",
        threadId: "t1",
        inReplyTo: "<orig@x>",
        references: "<a@x> <orig@x>",
      },
    ],
  });
});

test("send_message with neither subject nor body fails without calling the client", async () => {
  const { calls, tools } = harness();
  const res = await tools.send_message({ to: ["a@b.c"] });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /at least a subject or a body/);
  assert.equal(calls.length, 0, "validation failures must not reach the API");
});

test("send_message without any recipient fails without calling the client", async () => {
  const { calls, tools } = harness();
  for (const args of [{ subject: "s" }, { to: [], cc: [], bcc: [], subject: "s" }]) {
    const res = await tools.send_message(args);
    assert.equal(res.isError, true);
    assert.match(res.content[0].text, /at least one recipient in to, cc or bcc/);
  }
  assert.equal(calls.length, 0, "validation failures must not reach the API");
});

test("send_message allows a bcc-only send (to is optional)", async () => {
  const { calls, tools } = harness();
  const res = await tools.send_message({ bcc: ["hidden@b.c"], subject: "s", body_text: "t" });
  assert.notEqual(res.isError, true);
  assert.equal(calls[0].method, "sendMessage");
  assert.deepEqual((calls[0].params[0] as Record<string, unknown>).bcc, ["hidden@b.c"]);
  assert.equal((calls[0].params[0] as Record<string, unknown>).to, undefined);
});

test("modify_message forwards the normalized state flags", async () => {
  const { calls, tools } = harness();
  await tools.modify_message({
    message_id: "m1",
    read: true,
    starred: false,
    archived: true,
    add_label_ids: ["Label_1"],
    remove_label_ids: ["Label_2"],
  });
  assert.deepEqual(calls[0], {
    method: "modifyMessage",
    params: [
      "m1",
      { read: true, starred: false, archived: true, addLabelIds: ["Label_1"], removeLabelIds: ["Label_2"] },
    ],
  });
});

test("manage_trash routes every action/target pair to the right client method", async () => {
  const { calls, tools } = harness();
  await tools.manage_trash({ action: "trash", id: "m1" });
  await tools.manage_trash({ action: "untrash", id: "m1", target: "message" });
  await tools.manage_trash({ action: "trash", id: "t1", target: "thread" });
  await tools.manage_trash({ action: "untrash", id: "t1", target: "thread" });
  assert.deepEqual(
    calls.map((c) => ({ method: c.method, id: c.params[0] })),
    [
      { method: "trashMessage", id: "m1" },
      { method: "untrashMessage", id: "m1" },
      { method: "trashThread", id: "t1" },
      { method: "untrashThread", id: "t1" },
    ],
  );
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "sendMessage" });
  const res = await tools.send_message({ to: ["a@b.c"], subject: "s" });
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});
