import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { ContinuityError } from "../plugins/context-continuity/src/errors.mjs";
import { assertPathInsideReal } from "../plugins/context-continuity/src/util.mjs";
import {
  createHarness,
  observePrompt,
  recordMinimumState
} from "./helpers.mjs";

test("ledger hash-chain corruption fails closed for continuity state", async (t) => {
  const harness = await createHarness(t, "integrity");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "integrity-session"
  );
  const filePath = harness.service.store.ledgerPath(seeded.taskRef);
  const ledger = JSON.parse(await fs.readFile(filePath, "utf8"));
  const workspaceEvent = ledger.events.find((event) =>
    event.event_type === "workspace_observed");
  workspaceEvent.payload.workspace.digest = "0".repeat(64);
  await fs.writeFile(filePath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
  await assert.rejects(
    harness.service.getState({ task_ref: seeded.taskRef }),
    (error) => error instanceof ContinuityError
      && error.code === "LEDGER_HASH_MISMATCH"
  );
});

test("concurrent writes use expected_generation instead of last-write-wins", async (t) => {
  const harness = await createHarness(t, "concurrency");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "concurrency-session"
  );
  const observed = await observePrompt(
    harness.service,
    harness.cwd,
    "concurrency-session",
    "Proceed with two possible decisions."
  );
  const write = (id, statement) => harness.service.recordState({
    task_ref: seeded.taskRef,
    expected_generation: seeded.state.generation,
    source_event_id: observed.source_event_id,
    items: [
      {
        id,
        kind: "decision",
        statement,
        source_ref: "agent:decision",
        authority: "agent_inference",
        verification: "unverified",
        confidence: 0.6,
        status: "unverified"
      }
    ]
  });
  const results = await Promise.allSettled([
    write("decision:a", "Use implementation A."),
    write("decision:b", "Use implementation B.")
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.code, "GENERATION_CONFLICT");
});

test("lock acquisition validates the stable directory before leaf creation", async (t) => {
  const harness = await createHarness(t, "lock-containment-race");
  const taskRef = "session:lock-containment-race";
  const releaseOwner = await harness.service.store.acquireLock(taskRef);
  const lockPath = harness.service.store.lockPath(taskRef);
  const originalRealpath = fs.realpath;
  const originalOpen = fs.open;
  const sentinel = Object.assign(
    new Error("Stop after the pre-open containment check."),
    { code: "TEST_STOP_AFTER_CONTAINMENT" }
  );
  let leafRealpathCalls = 0;

  fs.realpath = async (target) => {
    if (path.resolve(target) === path.resolve(lockPath)) {
      leafRealpathCalls += 1;
    }
    return originalRealpath(target);
  };
  fs.open = async (target, ...args) => {
    if (path.resolve(target) === path.resolve(lockPath)) {
      throw sentinel;
    }
    return originalOpen(target, ...args);
  };
  try {
    await assert.rejects(
      harness.service.store.acquireLock(taskRef),
      (error) => error === sentinel
    );
  } finally {
    fs.realpath = originalRealpath;
    fs.open = originalOpen;
    await releaseOwner();
  }

  assert.equal(
    leafRealpathCalls,
    0,
    "The transient lock leaf must not be realpath-resolved before open(wx)."
  );
});

test("realpath validation restarts when the nearest leaf disappears", async (t) => {
  const harness = await createHarness(t, "realpath-retry");
  const ephemeralPath = path.join(harness.root, "ephemeral.lock");
  await fs.writeFile(ephemeralPath, "temporary", "utf8");

  const originalRealpath = fs.realpath;
  let removedDuringValidation = false;
  fs.realpath = async (target) => {
    if (!removedDuringValidation
        && path.resolve(target) === path.resolve(ephemeralPath)) {
      removedDuringValidation = true;
      await fs.rm(ephemeralPath, { force: true });
      const error = new Error("Simulated lstat/realpath removal race.");
      error.code = "ENOENT";
      throw error;
    }
    return originalRealpath(target);
  };
  try {
    await assertPathInsideReal(harness.root, ephemeralPath);
  } finally {
    fs.realpath = originalRealpath;
  }

  assert.equal(removedDuringValidation, true);
});

test("Windows EPERM is retried only after a leaf disappears", {
  skip: process.platform !== "win32"
}, async (t) => {
  const harness = await createHarness(t, "realpath-eperm");
  const transientPath = path.join(harness.root, "transient.lock");
  await fs.writeFile(transientPath, "temporary", "utf8");

  const originalRealpath = fs.realpath;
  let transientTriggered = false;
  fs.realpath = async (target) => {
    if (!transientTriggered
        && path.resolve(target) === path.resolve(transientPath)) {
      transientTriggered = true;
      await fs.rm(transientPath, { force: true });
      const error = new Error("Simulated Windows delete race.");
      error.code = "EPERM";
      throw error;
    }
    return originalRealpath(target);
  };
  try {
    await assertPathInsideReal(harness.root, transientPath);
  } finally {
    fs.realpath = originalRealpath;
  }
  assert.equal(transientTriggered, true);

  const persistentPath = path.join(harness.root, "persistent.lock");
  await fs.writeFile(persistentPath, "still present", "utf8");
  const persistentError = new Error("Simulated persistent permission failure.");
  persistentError.code = "EPERM";
  fs.realpath = async (target) => {
    if (path.resolve(target) === path.resolve(persistentPath)) {
      throw persistentError;
    }
    return originalRealpath(target);
  };
  try {
    await assert.rejects(
      assertPathInsideReal(harness.root, persistentPath),
      (error) => error === persistentError
    );
  } finally {
    fs.realpath = originalRealpath;
  }
});

test("snapshot retention keeps exactly the three most recent snapshots", async (t) => {
  const harness = await createHarness(t, "retention");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "retention-session"
  );
  for (let index = 0; index < 4; index += 1) {
    await harness.service.createSnapshot({
      task_ref: seeded.taskRef,
      cwd: harness.cwd,
      trigger: "manual",
      turn_id: "turn-" + index
    });
  }
  const names = await fs.readdir(
    harness.service.store.snapshotDirectory(seeded.taskRef)
  );
  assert.equal(names.filter((name) => name.endsWith(".json")).length, 3);
  const latest = await harness.service.store.transact(
    seeded.taskRef,
    (transaction) => transaction.latestSnapshot()
  );
  assert.match(latest.turn_id, /^turn:[a-f0-9]{24}$/);
});

test("snapshot recovery follows the verified ledger reference, not a newer orphan file", async (t) => {
  const harness = await createHarness(t, "snapshot-reference");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "snapshot-reference-session"
  );
  const created = await harness.service.createSnapshot({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    trigger: "manual",
    turn_id: "committed"
  });
  const directory = harness.service.store.snapshotDirectory(seeded.taskRef);
  await fs.writeFile(
    path.join(directory, "zzzz-orphan.json"),
    JSON.stringify({
      ...created.snapshot,
      turn_id: "orphan"
    }, null, 2) + "\n",
    "utf8"
  );
  const referenced = await harness.service.store.transact(
    seeded.taskRef,
    (transaction) => transaction.latestSnapshot()
  );
  assert.match(referenced.turn_id, /^turn:[a-f0-9]{24}$/);
});

test("one state update cannot bypass the minimal-state item budget", async (t) => {
  const harness = await createHarness(t, "item-batch-limit");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "item-batch-limit-session"
  );
  await assert.rejects(
    harness.service.recordState({
      task_ref: seeded.taskRef,
      expected_generation: seeded.state.generation,
      provider: "standalone",
      items: Array.from({ length: 65 }, (_, index) => ({
        id: "assumption:" + index,
        kind: "assumption",
        statement: "Candidate " + index,
        source_ref: "test:batch",
        authority: "agent_inference",
        verification: "unverified",
        confidence: 0.5,
        status: "unverified"
      }))
    }),
    (error) => error.code === "STATE_ITEM_BATCH_LIMIT"
  );
});

test("reset and delete require a two-stage challenge plus a second exact user prompt", async (t) => {
  const harness = await createHarness(t, "destructive");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "destructive-session"
  );
  await harness.service.createSnapshot({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    trigger: "manual",
    turn_id: "before-reset"
  });
  await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "resume"
  });
  const beforeReset = await harness.service.getState({ task_ref: seeded.taskRef });
  assert.ok(beforeReset.latest_snapshot);
  assert.ok(beforeReset.latest_restore);
  await assert.rejects(
    harness.service.manageState({
      task_ref: seeded.taskRef,
      action: "reset",
    }),
    (error) => error.code === "MANAGEMENT_CHALLENGE_REQUIRED"
  );
  const resetRequest = await observePrompt(
    harness.service,
    harness.cwd,
    "destructive-session",
    "Reset continuity state."
  );
  const resetChallenge = await harness.service.manageState({
    task_ref: seeded.taskRef,
    action: "prepare_reset",
    source_event_id: resetRequest.source_event_id
  });
  const resetConfirmation = await observePrompt(
    harness.service,
    harness.cwd,
    "destructive-session",
    resetChallenge.confirmation_phrase
  );
  const reset = await harness.service.manageState({
    task_ref: seeded.taskRef,
    action: "reset",
    challenge_token: resetChallenge.challenge_token,
    source_event_id: resetConfirmation.source_event_id
  });
  assert.equal(reset.items.length, 0);
  assert.ok(reset.generation > seeded.state.generation);
  assert.equal(reset.latest_snapshot, null);
  assert.equal(reset.latest_compaction, null);
  assert.equal(reset.latest_restore, null);
  await assert.rejects(
    harness.service.manageState({
      task_ref: seeded.taskRef,
      action: "delete"
    }),
    (error) => error.code === "MANAGEMENT_CHALLENGE_REQUIRED"
  );
  const deleteRequest = await observePrompt(
    harness.service,
    harness.cwd,
    "destructive-session",
    "Delete continuity state."
  );
  const deleteChallenge = await harness.service.manageState({
    task_ref: seeded.taskRef,
    action: "prepare_delete",
    source_event_id: deleteRequest.source_event_id
  });
  const deleteConfirmation = await observePrompt(
    harness.service,
    harness.cwd,
    "destructive-session",
    deleteChallenge.confirmation_phrase
  );
  const deleted = await harness.service.manageState({
    task_ref: seeded.taskRef,
    action: "delete",
    challenge_token: deleteChallenge.challenge_token,
    source_event_id: deleteConfirmation.source_event_id
  });
  assert.equal(deleted.deleted, true);
  await assert.rejects(
    fs.stat(harness.service.store.taskDirectory(seeded.taskRef)),
    (error) => error.code === "ENOENT"
  );
});
