import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DESTRUCTIVE,
  fail,
  messageIdSchema,
  ok,
  READ_ONLY,
  recipientSchema,
  UPDATE,
  WRITE,
} from "./util.js";

test("recipientSchema accepts addresses and rejects header injection", () => {
  const r = recipientSchema(); // factory → fresh schema
  assert.equal(r.safeParse("user@example.com").success, true);
  assert.equal(r.safeParse("Name Surname <user@example.com>").success, true);
  assert.equal(r.safeParse("a@b.c\r\nBcc: evil@x.y").success, false);
  assert.equal(r.safeParse("").success, false);
});

test("schema factories return independent schemas (no $ref dedup)", () => {
  assert.notEqual(messageIdSchema(), messageIdSchema());
  assert.notEqual(recipientSchema(), recipientSchema());
});

test("ok emits compact JSON; fail flags isError", () => {
  assert.equal((ok({ a: 1 }).content[0] as { text: string }).text, '{"a":1}');
  const f = fail(new Error("boom"));
  assert.equal(f.isError, true);
  assert.match((f.content[0] as { text: string }).text, /boom/);
});

test("fail appends the underlying cause when present", () => {
  const err = new Error("timeout", { cause: new Error("ECONNRESET") });
  const f = fail(err);
  assert.match((f.content[0] as { text: string }).text, /timeout \(ECONNRESET\)/);
});

test("the four annotation presets set all four hints explicitly", () => {
  assert.deepEqual(READ_ONLY, {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(WRITE, {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  });
  assert.deepEqual(UPDATE, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: true,
  });
  assert.deepEqual(DESTRUCTIVE, {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: true,
  });
});
