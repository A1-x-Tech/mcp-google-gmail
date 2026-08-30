import { test } from "node:test";
import assert from "node:assert/strict";
import { registerLabelTools } from "./labels.js";

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
    listLabels: make("listLabels"),
    getLabel: make("getLabel"),
    createLabel: make("createLabel"),
    updateLabel: make("updateLabel"),
    deleteLabel: make("deleteLabel"),
  };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerLabelTools(server as never, client as never);
  return { calls, tools };
}

test("registers the two label tools", () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(tools).sort(), ["list_labels", "manage_labels"]);
});

test("list_labels lists all labels, or fetches one with counts when label_id is set", async () => {
  const { calls, tools } = harness();
  await tools.list_labels({});
  assert.deepEqual(calls[0], { method: "listLabels", params: [] });

  await tools.list_labels({ label_id: "Label_1" });
  assert.deepEqual(calls[1], { method: "getLabel", params: ["Label_1"] });
});

test("each manage_labels action routes to the matching client method", async () => {
  const { calls, tools } = harness();
  await tools.manage_labels({
    action: "create",
    name: "Clients/Acme",
    label_list_visibility: "show_if_unread",
    message_list_visibility: "hide",
  });
  assert.deepEqual(calls[0], {
    method: "createLabel",
    params: [{ name: "Clients/Acme", labelListVisibility: "show_if_unread", messageListVisibility: "hide" }],
  });

  await tools.manage_labels({ action: "update", label_id: "Label_1", name: "Renamed" });
  assert.equal(calls[1].method, "updateLabel");
  assert.equal(calls[1].params[0], "Label_1");
  assert.deepEqual(calls[1].params[1], {
    name: "Renamed",
    labelListVisibility: undefined,
    messageListVisibility: undefined,
  });

  await tools.manage_labels({ action: "delete", label_id: "Label_1" });
  assert.deepEqual(calls[2], { method: "deleteLabel", params: ["Label_1"] });
});

test("missing per-action params fail without calling the client", async () => {
  const { calls, tools } = harness();

  const create = await tools.manage_labels({ action: "create" });
  assert.equal(create.isError, true);
  assert.match(create.content[0].text, /requires name/);

  const update = await tools.manage_labels({ action: "update", name: "x" });
  assert.equal(update.isError, true);
  assert.match(update.content[0].text, /requires label_id/);

  const del = await tools.manage_labels({ action: "delete" });
  assert.equal(del.isError, true);
  assert.match(del.content[0].text, /requires label_id/);

  assert.equal(calls.length, 0, "validation failures must not reach the API");
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "listLabels" });
  const res = await tools.list_labels({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});
