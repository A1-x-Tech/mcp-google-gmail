import { test } from "node:test";
import assert from "node:assert/strict";
import { registerMessageTools } from "./messages.js";
import { registerThreadTools } from "./threads.js";
import { registerDraftTools } from "./drafts.js";
import { registerLabelTools } from "./labels.js";
import { registerProfileTools } from "./profile.js";
import { registerRawTool } from "./raw.js";
import { DESTRUCTIVE, READ_ONLY, UPDATE, WRITE } from "./util.js";

interface Annotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

/** Registers every tool against a fake server, capturing each tool's annotations. */
function collectAnnotations(): Record<string, Annotations | undefined> {
  const annotations: Record<string, Annotations | undefined> = {};
  const server = {
    registerTool: (name: string, cfg: { annotations?: Annotations }) => {
      annotations[name] = cfg.annotations;
    },
  };
  // Registration reads the client only inside handlers, so a stub is fine here.
  registerMessageTools(server as never, {} as never);
  registerThreadTools(server as never, {} as never);
  registerDraftTools(server as never, {} as never);
  registerLabelTools(server as never, {} as never);
  registerProfileTools(server as never, {} as never);
  registerRawTool(server as never, {} as never);
  return annotations;
}

const ANN = collectAnnotations();

/**
 * Gmail mixes reads with irreversible writes, so instead of one blanket
 * invariant the expected hints are pinned per tool. Changing a tool's
 * annotation must be a conscious decision that updates this map. Sending
 * (send_message/send_draft) is pinned DESTRUCTIVE on purpose: an email cannot
 * be unsent, so clients must gate it like a deletion, not like a create.
 */
const EXPECTED: Record<string, Annotations> = {
  list_messages: READ_ONLY,
  get_message: READ_ONLY,
  send_message: DESTRUCTIVE,
  modify_message: UPDATE,
  manage_trash: UPDATE,
  list_threads: READ_ONLY,
  get_thread: READ_ONLY,
  modify_thread: UPDATE,
  create_draft: WRITE,
  list_drafts: READ_ONLY,
  get_draft: READ_ONLY,
  update_draft: UPDATE,
  send_draft: DESTRUCTIVE,
  delete_draft: DESTRUCTIVE,
  list_labels: READ_ONLY,
  manage_labels: DESTRUCTIVE,
  get_profile: READ_ONLY,
  raw_request: DESTRUCTIVE,
};

test("registers all eighteen tools with annotations", () => {
  assert.deepEqual(Object.keys(ANN).sort(), Object.keys(EXPECTED).sort());
  for (const [name, a] of Object.entries(ANN)) {
    assert.ok(a, `${name} is missing annotations`);
  }
});

test("every tool carries exactly its pinned hints (all four set)", () => {
  for (const [name, expected] of Object.entries(EXPECTED)) {
    assert.deepEqual(ANN[name], expected, `${name} annotations drifted`);
  }
});

test("sending and permanent deletion are never presented as safe", () => {
  for (const name of ["send_message", "send_draft", "delete_draft", "manage_labels", "raw_request"]) {
    assert.equal(ANN[name]?.destructiveHint, true, `${name} must carry destructiveHint`);
    assert.equal(ANN[name]?.idempotentHint, false, `${name} must not claim idempotency`);
  }
});

test("all reads stay read-only", () => {
  for (const name of [
    "list_messages",
    "get_message",
    "list_threads",
    "get_thread",
    "list_drafts",
    "get_draft",
    "list_labels",
    "get_profile",
  ]) {
    assert.equal(ANN[name]?.readOnlyHint, true, `${name} must be read-only`);
  }
});
