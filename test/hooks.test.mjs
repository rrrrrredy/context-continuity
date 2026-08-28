import assert from "node:assert/strict";
import test from "node:test";
import { handleHook } from "../plugins/context-continuity/src/hook-handler.mjs";
import { taskRefForSession } from "../plugins/context-continuity/src/service.mjs";
import {
  createHarness,
  recordMinimumState
} from "./helpers.mjs";
import { estimateTokens } from "../plugins/context-continuity/src/util.mjs";

function hookPayload(event, cwd, overrides = {}) {
  return {
    session_id: "hook-session",
    transcript_path: null,
    cwd,
    hook_event_name: event,
    model: "test-model",
    ...overrides
  };
}

test("UserPromptSubmit always exposes a trusted task and source reference", async (t) => {
  const harness = await createHarness(t, "hook-prompt");
  const signaled = await handleHook(
    hookPayload("UserPromptSubmit", harness.cwd, {
      turn_id: "turn-1",
      prompt: "Change the goal and do not publish."
    }),
    {},
    harness.service
  );
  assert.equal(
    signaled.hookSpecificOutput.hookEventName,
    "UserPromptSubmit"
  );
  assert.match(signaled.hookSpecificOutput.additionalContext, /source_event_id/);
  const ordinary = await handleHook(
    hookPayload("UserPromptSubmit", harness.cwd, {
      turn_id: "turn-2",
      prompt: "Continue."
    }),
    {},
    harness.service
  );
  assert.equal(ordinary.hookSpecificOutput.hookEventName, "UserPromptSubmit");
  assert.match(ordinary.hookSpecificOutput.additionalContext, /signals: none/);
  const ledger = (await harness.service.store.readLedger(
    taskRefForSession("hook-session")
  )).ledger;
  assert.equal(
    ledger.events.filter((event) => event.event_type === "workspace_observed").length,
    1
  );
});

test("PreCompact, PostCompact, and SessionStart compact form one recovery loop", async (t) => {
  const harness = await createHarness(t, "hook-loop");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "hook-session"
  );
  const pre = await handleHook(
    hookPayload("PreCompact", harness.cwd, {
      turn_id: "turn-compact",
      trigger: "manual"
    }),
    {},
    harness.service
  );
  assert.equal(pre, null);
  const post = await handleHook(
    hookPayload("PostCompact", harness.cwd, {
      turn_id: "turn-compact",
      trigger: "manual"
    }),
    {},
    harness.service
  );
  assert.equal(post, null);
  const start = await handleHook(
    hookPayload("SessionStart", harness.cwd, {
      source: "compact"
    }),
    {},
    harness.service
  );
  assert.equal(start.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(start.hookSpecificOutput.additionalContext, /classification: continue_with_markers/);
  const state = await harness.service.getState({ task_ref: seeded.taskRef });
  assert.equal(state.latest_compaction.snapshot_matched, true);
  assert.equal(state.latest_restore.classification, "continue_with_markers");
});

test("subagent results remain candidates and do not overwrite parent state", async (t) => {
  const harness = await createHarness(t, "hook-subagent");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "hook-session"
  );
  const beforeGeneration = seeded.state.generation;
  const start = await handleHook(
    hookPayload("SubagentStart", harness.cwd, {
      turn_id: "turn-agent",
      agent_id: "agent-1",
      agent_type: "worker"
    }),
    {},
    harness.service
  );
  assert.match(start.hookSpecificOutput.additionalContext, /does not grant new authorization/);
  const stop = await handleHook(
    hookPayload("SubagentStop", harness.cwd, {
      turn_id: "turn-agent",
      agent_id: "agent-1",
      agent_type: "worker",
      stop_hook_active: false,
      last_assistant_message: "I changed the goal and completed everything."
    }),
    {},
    harness.service
  );
  assert.equal(stop.continue, true);
  const state = await harness.service.getState({ task_ref: seeded.taskRef });
  assert.equal(state.generation, beforeGeneration);
  assert.equal(state.items.find((item) => item.kind === "objective").id, "objective:main");
});

test("SubagentStart context is priority ordered and token bounded", async (t) => {
  const harness = await createHarness(t, "hook-subagent-budget");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "hook-session"
  );
  await harness.service.recordState({
    task_ref: seeded.taskRef,
    expected_generation: seeded.state.generation,
    provider: "standalone",
    items: Array.from({ length: 12 }, (_, index) => ({
      id: "evidence:large-" + index,
      kind: "evidence",
      statement: "Verified low-priority detail " + index + " " + "x".repeat(1200),
      source_ref: "test:evidence:" + index,
      authority: "agent_inference",
      verification: "unverified",
      confidence: 0.5,
      status: "unverified",
      scope: "task",
      supersedes: []
    }))
  });
  const start = await handleHook(
    hookPayload("SubagentStart", harness.cwd, {
      turn_id: "turn-agent-budget",
      agent_id: "agent-budget",
      agent_type: "worker"
    }),
    {},
    harness.service
  );
  const context = start.hookSpecificOutput.additionalContext;
  assert.ok(estimateTokens(context) <= 800);
  assert.match(context, /kind="objective".+provenance="user\/verified"/);
  assert.match(context, /omitted_items:/);
});

test("SessionStart clear invalidates active state without deleting history", async (t) => {
  const harness = await createHarness(t, "hook-clear");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "hook-session"
  );
  const result = await handleHook(
    hookPayload("SessionStart", harness.cwd, {
      source: "clear"
    }),
    {},
    harness.service
  );
  assert.equal(result, null);
  const state = await harness.service.getState({ task_ref: seeded.taskRef });
  assert.equal(state.lifecycle_status, "cleared");
  assert.equal(state.items.length, 0);
  const ledger = (await harness.service.store.readLedger(seeded.taskRef)).ledger;
  assert.ok(ledger.events.some((event) => event.event_type === "task_cleared"));
});
