import { test } from "node:test";
import assert from "node:assert/strict";
import { registerProfileTools } from "./profile.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: { text: string }[]; isError?: boolean }>;

function harness(opts: { throwOn?: string } = {}) {
  const calls: { method: string; params: unknown[] }[] = [];
  const make =
    (method: string) =>
    async (...params: unknown[]) => {
      calls.push({ method, params });
      if (opts.throwOn === method) throw new Error("boom");
      return { emailAddress: "me@example.com" };
    };
  const client = { getProfile: make("getProfile") };
  const tools: Record<string, Handler> = {};
  const server = {
    registerTool: (name: string, _cfg: unknown, handler: Handler) => {
      tools[name] = handler;
    },
  };
  registerProfileTools(server as never, client as never);
  return { calls, tools };
}

test("registers get_profile", () => {
  const { tools } = harness();
  assert.deepEqual(Object.keys(tools), ["get_profile"]);
});

test("get_profile routes to the client and returns the profile", async () => {
  const { calls, tools } = harness();
  const res = await tools.get_profile({});
  assert.deepEqual(calls, [{ method: "getProfile", params: [] }]);
  assert.match(res.content[0].text, /me@example\.com/);
});

test("a client error is returned as an isError result, not thrown", async () => {
  const { tools } = harness({ throwOn: "getProfile" });
  const res = await tools.get_profile({});
  assert.equal(res.isError, true);
  assert.match(res.content[0].text, /boom/);
});
