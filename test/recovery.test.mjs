import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { renderRecoveryContext } from "../plugins/context-continuity/src/recovery.mjs";
import {
  createHarness,
  observePrompt,
  recordConfirmedUserState,
  recordMinimumState
} from "./helpers.mjs";

async function snapshotAndComplete(service, taskRef, cwd, turnId = "compact-turn") {
  const snapshot = await service.createSnapshot({
    task_ref: taskRef,
    cwd,
    trigger: "manual",
    turn_id: turnId
  });
  await service.markCompaction({
    task_ref: taskRef,
    trigger: "manual",
    turn_id: turnId
  });
  return snapshot;
}

test("compact recovery selects the verified sidecar and marks the action cursor for revalidation", async (t) => {
  const harness = await createHarness(t, "recover-equivalent");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "recover-equivalent-session"
  );
  await snapshotAndComplete(harness.service, seeded.taskRef, harness.cwd);
  const recovery = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "compact"
  });
  assert.equal(recovery.report.classification, "continue_with_markers");
  assert.equal(recovery.report.selected_generation, seeded.state.generation);
  assert.match(recovery.rendered.text, /objective:main/);
  assert.match(recovery.rendered.text, /authorization:local-only/);
});

test("resume without a compaction snapshot preserves state but revalidates the action cursor", async (t) => {
  const harness = await createHarness(t, "resume-workspace");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "resume-workspace-session"
  );
  await harness.service.sessionEnd({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    reason: "other"
  });
  const recovered = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "resume"
  });
  assert.equal(recovered.report.snapshot_id, null);
  assert.equal(recovered.report.classification, "continue_with_markers");
  assert.equal(
    recovered.report.findings.some((entry) =>
      entry.code === "pre_transition_snapshot_unavailable"),
    false
  );
});

test("compact recovery marks a missing or mismatched PostCompact confirmation", async (t) => {
  const harness = await createHarness(t, "recover-missing-post");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "recover-missing-post-session"
  );
  await harness.service.createSnapshot({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    trigger: "manual",
    turn_id: "compact-without-post"
  });
  const recovery = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "compact"
  });
  assert.equal(recovery.report.classification, "continue_with_markers");
  assert.ok(recovery.report.findings.some((finding) =>
    finding.code === "post_compact_confirmation_missing"));
});

test("an unresolved correction after the snapshot produces ask-before-high-risk", async (t) => {
  const harness = await createHarness(t, "recover-correction");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "recover-correction-session"
  );
  await snapshotAndComplete(harness.service, seeded.taskRef, harness.cwd);
  const observed = await observePrompt(
    harness.service,
    harness.cwd,
    "recover-correction-session",
    "Correction: do not implement the memory platform; change the goal to the continuity plugin."
  );
  assert.ok(observed.signals.includes("correction"));
  const recovery = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "compact"
  });
  assert.equal(recovery.report.classification, "ask_before_high_risk");
  assert.ok(recovery.report.findings.some((finding) =>
    finding.code === "unresolved_prompt_signal"));
  assert.match(recovery.rendered.text, /Correction:/);
  assert.match(recovery.rendered.text, /ask the user one concise question/i);
});

test("newer ledger state supersedes a pre-compaction snapshot", async (t) => {
  const harness = await createHarness(t, "recover-newer");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "recover-newer-session"
  );
  await snapshotAndComplete(harness.service, seeded.taskRef, harness.cwd);
  const confirmed = await recordConfirmedUserState(
    harness.service,
    harness.cwd,
    "recover-newer-session",
    [
      {
        id: "next:validate-package",
        kind: "next_action",
        statement: "Run the verified package validation.",
        authority: "user",
        verification: "verified",
        status: "active",
        supersedes: ["next:test"]
      }
    ]
  );
  const updated = confirmed.state;
  const recovery = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "compact"
  });
  assert.equal(recovery.report.classification, "repaired");
  assert.equal(recovery.report.selected_generation, updated.generation);
  assert.match(recovery.rendered.text, /next:validate-package/);
  assert.doesNotMatch(recovery.rendered.text, /next:test/);
});

test("workspace change never inherits prior completion as current without a warning", async (t) => {
  const harness = await createHarness(t, "workspace-change");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "workspace-change-session"
  );
  await snapshotAndComplete(harness.service, seeded.taskRef, harness.cwd);
  const other = path.join(harness.root, "other-workspace");
  await fs.mkdir(other);
  const recovery = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: other,
    source: "resume"
  });
  assert.equal(recovery.report.classification, "ask_before_high_risk");
  assert.ok(recovery.report.findings.some((finding) =>
    finding.code === "workspace_changed"));
});

test("recovery rendering respects the token ceiling by omitting low-priority items", async (t) => {
  const harness = await createHarness(t, "token-budget");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "token-budget-session"
  );
  const observed = await observePrompt(
    harness.service,
    harness.cwd,
    "token-budget-session",
    "Consider many optional decisions while keeping the same goal."
  );
  const items = Array.from({ length: 18 }, (_, index) => ({
    id: "decision:" + index,
    kind: "decision",
    statement: "Optional exploration decision " + index + " " + "detail ".repeat(80),
    source_ref: "agent:decision:" + index,
    authority: "agent_inference",
    verification: "unverified",
    confidence: 0.5,
    status: "unverified"
  }));
  const state = await harness.service.recordState({
    task_ref: seeded.taskRef,
    expected_generation: seeded.state.generation,
    source_event_id: observed.source_event_id,
    items
  });
  await snapshotAndComplete(harness.service, seeded.taskRef, harness.cwd);
  const recovery = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "compact",
    token_budget: 300
  });
  assert.ok(recovery.rendered.omitted_items > 0);
  assert.ok(recovery.rendered.estimated_tokens <= 340);
  assert.match(recovery.rendered.text, /authorization:local-only/);
  assert.match(recovery.rendered.text, /FETCH REQUIRED/);
  assert.equal(recovery.report.classification, "ask_before_high_risk");
  assert.ok(recovery.rendered.critical_items_omitted > 0);
  assert.equal(state.generation, seeded.state.generation + 1);
});
