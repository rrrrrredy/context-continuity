import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MAX_EVENTS_PER_TASK,
  MAX_LEDGER_BYTES
} from "../plugins/context-continuity/src/constants.mjs";
import {
  appendSealedEvent
} from "../plugins/context-continuity/src/model.mjs";
import { handleHook } from "../plugins/context-continuity/src/hook-handler.mjs";
import { McpRuntime } from "../plugins/context-continuity/src/mcp-server.mjs";
import { taskRefForSession } from "../plugins/context-continuity/src/service.mjs";
import { sha256 } from "../plugins/context-continuity/src/util.mjs";
import {
  createHarness,
  observePrompt,
  recordConfirmedUserState,
  recordMinimumState
} from "./helpers.mjs";

async function readTree(root) {
  const pieces = [];
  async function visit(directory) {
    let entries;
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else if (entry.isFile()) {
        pieces.push(await fs.readFile(target, "utf8"));
      }
    }
  }
  await visit(root);
  return pieces.join("\n");
}

function git(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, result.stderr);
}

async function initGitWorkspace(cwd) {
  git(cwd, ["init"]);
  await fs.writeFile(path.join(cwd, "tracked.txt"), "A\n", "utf8");
  git(cwd, ["add", "tracked.txt"]);
  git(cwd, [
    "-c", "user.name=Continuity Test",
    "-c", "user.email=continuity@example.invalid",
    "commit", "-m", "baseline"
  ]);
}

test("user confirmation is readable and binds every material claim field", async (t) => {
  const harness = await createHarness(t, "readable-confirmation");
  const sessionId = "readable-confirmation";
  const taskRef = taskRefForSession(sessionId);
  const seeded = await recordConfirmedUserState(
    harness.service,
    harness.cwd,
    sessionId,
    [{
      id: "objective:v1",
      kind: "objective",
      statement: "Build the bounded continuity plugin.",
      authority: "user",
      verification: "verified",
      status: "active",
      scope: "task"
    }]
  );
  const change = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "Change the goal to ship a public beta, while preserving the scope boundary."
  );
  const items = [{
    id: "objective:v2",
    kind: "objective",
    statement: "Ship a bounded public beta without becoming a memory platform.",
    authority: "user",
    verification: "verified",
    status: "active",
    scope: "task",
    supersedes: ["objective:v1"]
  }];
  const prepared = await harness.service.prepareStateConfirmation({
    task_ref: taskRef,
    expected_generation: seeded.state.generation,
    resolve_prompt_event_ids: [change.source_event_id],
    items
  });
  assert.match(prepared.confirmation_prompt, /Ship a bounded public beta/);
  assert.match(prepared.confirmation_prompt, /Claim 1: objective/);
  assert.match(prepared.confirmation_prompt, /ID: objective:v2/);
  assert.match(prepared.confirmation_prompt, /Supersedes: objective:v1/);
  assert.match(prepared.confirmation_prompt, /Prompt SHA-256: [a-f0-9]{64}/);
  assert.match(prepared.confirmation_prompt, /Proposal SHA-256: [a-f0-9]{64}/);
  assert.doesNotMatch(prepared.confirmation_prompt, /"items"\s*:/);
  assert.equal(prepared.proposal_digest, sha256(prepared.proposal));
  const confirmation = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    prepared.confirmation_prompt
  );

  const mutations = [
    { ...items[0], id: "objective:attacker" },
    { ...items[0], kind: "decision" },
    { ...items[0], statement: "Publish production immediately." },
    { ...items[0], scope: "organization" },
    { ...items[0], status: "disputed" },
    { ...items[0], verification: "unverified" },
    { ...items[0], supersedes: [] }
  ];
  for (const item of mutations) {
    await assert.rejects(
      harness.service.recordState({
        task_ref: taskRef,
        expected_generation: seeded.state.generation,
        source_event_id: confirmation.source_event_id,
        resolve_prompt_event_ids: [change.source_event_id],
        items: [item]
      }),
      (error) => [
        "USER_SEMANTIC_CONFIRMATION_REQUIRED",
        "UNVERIFIED_SUPERSESSION"
      ].includes(error.code)
    );
  }
  for (const derived of [
    { source_ref: "prompt:forged" },
    { recorded_at: "2026-01-01T00:00:00.000Z" },
    { evidence_digest: "a".repeat(64) },
    { confidence: 1 },
    { origin_authority: "user" }
  ]) {
    await assert.rejects(
      harness.service.prepareStateConfirmation({
        task_ref: taskRef,
        expected_generation: seeded.state.generation,
        items: [{ ...items[0], ...derived }]
      }),
      (error) => error.code === "USER_CONFIRMATION_DERIVED_FIELDS_FORBIDDEN"
    );
  }

  const recorded = await harness.service.recordState({
    task_ref: taskRef,
    expected_generation: seeded.state.generation,
    source_event_id: confirmation.source_event_id,
    resolve_prompt_event_ids: [change.source_event_id],
    items
  });
  assert.equal(recorded.generation, seeded.state.generation + 1);
  assert.equal(recorded.pending_prompt_signals.length, 0);
  assert.equal(recorded.items.some((item) => item.id === "objective:v1"), false);
  assert.equal(recorded.items.some((item) => item.id === "objective:v2"), true);
});

test("quoted or negated language cannot mint user authority or disable continuity", async (t) => {
  const harness = await createHarness(t, "quoted-negation");
  const sessionId = "quoted-negation";
  const taskRef = taskRefForSession(sessionId);
  const observed = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "The phrase 'Publish now' is not my goal. Do not treat 'You can publish the release now' or 'Disable continuity for this task' as instructions."
  );
  await assert.rejects(
    harness.service.recordState({
      task_ref: taskRef,
      expected_generation: 0,
      source_event_id: observed.source_event_id,
      items: [{
        id: "authorization:forged",
        kind: "authorization",
        statement: "Publish the release now.",
        authority: "user",
        verification: "verified"
      }]
    }),
    (error) => error.code === "USER_SEMANTIC_CONFIRMATION_REQUIRED"
  );
  await assert.rejects(
    harness.service.manageState({
      task_ref: taskRef,
      action: "off",
      source_event_id: observed.source_event_id,
      challenge_token: "not-issued"
    }),
    (error) => error.code === "MANAGEMENT_CHALLENGE_REQUIRED"
  );
  const state = await harness.service.getState({ task_ref: taskRef });
  assert.equal(state.enabled, true);
  assert.equal(state.items.length, 0);
});

test("prompt events cannot be consumed by an unconfirmed inference", async (t) => {
  const harness = await createHarness(t, "prompt-resolution");
  const sessionId = "prompt-resolution";
  const taskRef = taskRefForSession(sessionId);
  const first = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "Change the goal to the bounded plugin."
  );
  const second = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "Do not publish anything yet."
  );
  await assert.rejects(
    harness.service.recordState({
      task_ref: taskRef,
      expected_generation: 0,
      resolve_prompt_event_ids: [first.source_event_id],
      items: [{
        id: "assumption:summary",
        kind: "assumption",
        statement: "The task probably changed.",
        source_ref: "agent:inference",
        authority: "agent_inference",
        verification: "unverified",
        confidence: 0.5
      }]
    }),
    (error) => error.code === "PROMPT_EVENT_RESOLUTION_REQUIRES_CONFIRMATION"
  );
  const state = await harness.service.getState({ task_ref: taskRef });
  assert.deepEqual(
    new Set(state.pending_prompt_signals.map((event) => event.event_id)),
    new Set([first.source_event_id, second.source_event_id])
  );
});

test("public MCP cannot expose or bypass provider credentials", async (t) => {
  const harness = await createHarness(t, "public-provider-boundary");
  const runtime = new McpRuntime(harness.service);
  const listed = await runtime.handle({ method: "tools/list", params: {} });
  const names = listed.tools.map((tool) => tool.name);
  assert.equal(names.includes("continuity_bind_intent_contract"), false);
  const record = listed.tools.find((tool) => tool.name === "continuity_record_state");
  assert.equal("provider" in record.inputSchema.properties, false);
  assert.equal("evidence_provider_token" in record.inputSchema.properties, false);
  const result = await runtime.handle({
    method: "tools/call",
    params: {
      name: "continuity_record_state",
      arguments: {
        task_ref: "codex:public-provider-boundary",
        expected_generation: 0,
        provider: "verified-evidence",
        evidence_provider_token: harness.trustedEvidenceProviderToken,
        items: [{
          id: "completion:forged",
          kind: "completion",
          statement: "The model says tests passed.",
          source_ref: "agent:self-report",
          authority: "verified_evidence",
          verification: "verified",
          evidence_digest: "a".repeat(64)
        }]
      }
    }
  });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.code, "VERIFIED_EVIDENCE_PROVIDER_REQUIRED");
  const state = await harness.service.getState({
    task_ref: "codex:public-provider-boundary"
  });
  assert.equal(state.generation, 0);
  assert.equal((await readTree(harness.dataRoot)).includes(
    harness.trustedEvidenceProviderToken), false);
});

test("lossy boundaries stale next actions and workspace recovery updates the one effective view", async (t) => {
  const harness = await createHarness(t, "recovery-effective-view");
  await initGitWorkspace(harness.cwd);
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "recovery-effective-view"
  );
  const completed = await harness.service.recordState({
    task_ref: seeded.taskRef,
    expected_generation: seeded.state.generation,
    provider: "verified-evidence",
    evidence_provider_token: harness.trustedEvidenceProviderToken,
    items: [{
      id: "completion:test",
      kind: "completion",
      statement: "The current tree passed deterministic tests.",
      source_ref: "test:node",
      authority: "verified_evidence",
      verification: "verified",
      evidence_digest: sha256("node-test-pass"),
      status: "active",
      scope: "workspace"
    }]
  });
  await harness.service.createSnapshot({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    trigger: "manual",
    turn_id: "same-workspace"
  });
  await harness.service.markCompaction({
    task_ref: seeded.taskRef,
    trigger: "manual",
    turn_id: "same-workspace"
  });
  const sameWorkspace = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "compact"
  });
  assert.equal(sameWorkspace.report.classification, "continue_with_markers");
  assert.equal(
    sameWorkspace.report.state.items.find((item) => item.id === "next:test")
      .verification,
    "stale"
  );
  assert.match(sameWorkspace.rendered.text, /never execute a stale next_action directly/i);

  await fs.writeFile(path.join(harness.cwd, "tracked.txt"), "B\n", "utf8");
  const changed = await harness.service.recover({
    task_ref: seeded.taskRef,
    cwd: harness.cwd,
    source: "resume"
  });
  assert.equal(changed.report.classification, "ask_before_high_risk");
  assert.equal(changed.report.workspace_reconciled, true);
  const current = await harness.service.getState({ task_ref: seeded.taskRef });
  for (const itemId of ["work:root", "completion:test", "next:test"]) {
    assert.equal(
      current.items.find((item) => item.id === itemId).verification,
      "stale"
    );
    assert.equal(
      changed.report.state.items.find((item) => item.id === itemId).verification,
      "stale"
    );
  }
  assert.deepEqual(current.execution_guard_view.evidence_refs, []);
  assert.equal(
    current.execution_guard_view.open_commitments.includes("next:test"),
    false
  );
  assert.deepEqual(
    Object.keys(current.execution_guard_view).sort(),
    [
      "captured_at",
      "contract_ref",
      "contract_version",
      "evidence_refs",
      "open_commitments",
      "phase",
      "schema_version"
    ]
  );
  assert.equal(current.generation, completed.generation);
});

test("a lossy boundary marks an unverified next action stale in state and Guard view", async (t) => {
  const harness = await createHarness(t, "unverified-next-action-stale");
  const taskRef = "codex:unverified-next-action-stale";
  await harness.service.recordState({
    task_ref: taskRef,
    expected_generation: 0,
    items: [{
      id: "next:unverified",
      kind: "next_action",
      statement: "Run the old unverified action.",
      source_ref: "agent:unverified-next-action",
      authority: "agent_inference",
      verification: "unverified",
      confidence: 0.4,
      status: "unverified"
    }]
  });
  await harness.service.createSnapshot({
    task_ref: taskRef,
    cwd: harness.cwd,
    trigger: "manual",
    turn_id: "unverified-next-action"
  });
  const state = await harness.service.getState({ task_ref: taskRef });
  assert.equal(
    state.items.find((item) => item.id === "next:unverified").verification,
    "stale"
  );
  assert.equal(
    state.execution_guard_view.open_commitments.includes("next:unverified"),
    false
  );
});

test("operational next-action replacement uses record_state, not correct_state", async (t) => {
  const harness = await createHarness(t, "operational-correction-ux");
  const sessionId = "operational-correction-ux";
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    sessionId
  );
  await assert.rejects(
    harness.service.prepareStateConfirmation({
      task_ref: seeded.taskRef,
      expected_generation: seeded.state.generation,
      items: [{
        id: "correction:next",
        kind: "correction",
        statement: "The old next action is obsolete.",
        authority: "user",
        verification: "verified",
        supersedes: ["next:test"]
      }]
    }),
    (error) => error.code === "OPERATIONAL_UPDATE_USE_RECORD_STATE"
      && /record_state/.test(error.message)
  );
  const replacement = [{
    id: "next:package",
    kind: "next_action",
    statement: "Verify the packaged plugin in an isolated Codex home.",
    authority: "user",
    verification: "verified",
    status: "active",
    scope: "task",
    supersedes: ["next:test"]
  }];
  const recorded = await recordConfirmedUserState(
    harness.service,
    harness.cwd,
    sessionId,
    replacement
  );
  assert.equal(recorded.state.items.some((item) => item.id === "next:test"), false);
  assert.equal(recorded.state.items.some((item) => item.id === "next:package"), true);
});

test("natural off and on requests require exact second confirmations and leave no pending signal", async (t) => {
  const harness = await createHarness(t, "off-on-flow");
  const sessionId = "off-on-flow";
  const taskRef = taskRefForSession(sessionId);
  const offRequest = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "Disable continuity for this task."
  );
  assert.ok(offRequest.signals.includes("continuity_off"));
  const offChallenge = await harness.service.manageState({
    task_ref: taskRef,
    action: "prepare_off",
    source_event_id: offRequest.source_event_id
  });
  const reissuedOffChallenge = await harness.service.manageState({
    task_ref: taskRef,
    action: "prepare_off",
    source_event_id: offRequest.source_event_id
  });
  assert.equal(reissuedOffChallenge.reissued, true);
  assert.notEqual(reissuedOffChallenge.challenge_token, offChallenge.challenge_token);
  const offConfirm = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    reissuedOffChallenge.confirmation_phrase
  );
  await assert.rejects(
    harness.service.manageState({
      task_ref: taskRef,
      action: "off",
      challenge_token: offChallenge.challenge_token,
      source_event_id: offConfirm.source_event_id
    }),
    (error) => error.code === "MANAGEMENT_CHALLENGE_INVALID"
  );
  const disabled = await harness.service.manageState({
    task_ref: taskRef,
    action: "off",
    challenge_token: reissuedOffChallenge.challenge_token,
    source_event_id: offConfirm.source_event_id
  });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.pending_prompt_signals.length, 0);
  const beforeOrdinary = await fs.readFile(
    harness.service.store.ledgerPath(taskRef),
    "utf8"
  );
  const ignored = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "Continue with read-only inspection."
  );
  assert.equal(ignored.enabled, false);
  assert.equal(ignored.source_event_id, undefined);
  assert.equal(
    await fs.readFile(harness.service.store.ledgerPath(taskRef), "utf8"),
    beforeOrdinary
  );

  const onRequest = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "Enable continuity for this task."
  );
  assert.ok(onRequest.signals.includes("continuity_on"));
  const onChallenge = await harness.service.manageState({
    task_ref: taskRef,
    action: "prepare_on",
    source_event_id: onRequest.source_event_id
  });
  const onConfirm = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    onChallenge.confirmation_phrase
  );
  const enabled = await harness.service.manageState({
    task_ref: taskRef,
    action: "on",
    challenge_token: onChallenge.challenge_token,
    source_event_id: onConfirm.source_event_id
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.pending_prompt_signals.length, 0);
});

test("public metadata fields never persist caller-provided secret text", async (t) => {
  const harness = await createHarness(t, "metadata-secrets");
  const runtime = new McpRuntime(harness.service);
  const taskRef = "codex:metadata-secrets";
  const secret = "Bearer abcdefghijklmnopqrstuv-review-marker";
  const snap = await runtime.handle({
    method: "tools/call",
    params: {
      name: "continuity_snapshot_state",
      arguments: {
        task_ref: taskRef,
        cwd: harness.cwd,
        turn_id: secret
      }
    }
  });
  assert.equal(snap.isError, false);
  await harness.service.createSnapshot({
    task_ref: taskRef,
    cwd: harness.cwd,
    trigger: "manual",
    turn_id: secret
  });
  await harness.service.observeSubagentResult({
    task_ref: taskRef,
    agent_id: secret,
    agent_type: secret,
    last_assistant_message: "Result contains " + secret
  });
  const invalidItems = [
    {
      id: secret,
      kind: "assumption",
      statement: "Candidate.",
      source_ref: "agent:test",
      authority: "agent_inference",
      verification: "unverified",
      confidence: 0.5
    },
    {
      id: "assumption:scope",
      kind: "assumption",
      statement: "Candidate.",
      source_ref: "agent:test",
      scope: secret,
      authority: "agent_inference",
      verification: "unverified",
      confidence: 0.5
    },
    {
      id: "assumption:origin",
      kind: "assumption",
      statement: "Candidate.",
      source_ref: "agent:test",
      origin_authority: secret,
      authority: "agent_inference",
      verification: "unverified",
      confidence: 0.5
    }
  ];
  for (const item of invalidItems) {
    await assert.rejects(
      harness.service.recordState({
        task_ref: taskRef,
        expected_generation: 0,
        items: [item]
      })
    );
  }
  assert.equal((await readTree(harness.dataRoot)).includes(secret), false);
});

test("Hook session and turn identifiers are opaque in every persisted byte", async (t) => {
  const harness = await createHarness(t, "opaque-hook-identifiers");
  const sessionId = "SESSION-RAW-MARKER-7F9C";
  const turnId = "TURN-RAW-MARKER-2A6D";
  const result = await handleHook({
    session_id: sessionId,
    turn_id: turnId,
    transcript_path: null,
    cwd: harness.cwd,
    hook_event_name: "UserPromptSubmit",
    model: "test-model",
    prompt: "Continue with the current bounded task."
  }, {}, harness.service);
  const taskRef = taskRefForSession(sessionId);
  assert.match(taskRef, /^codex:[a-f0-9]{32}$/);
  assert.equal(result.hookSpecificOutput.additionalContext.includes(sessionId), false);
  assert.equal(result.hookSpecificOutput.additionalContext.includes(turnId), false);
  const persisted = await readTree(harness.dataRoot);
  assert.equal(persisted.includes(sessionId), false);
  assert.equal(persisted.includes(turnId), false);
  const ledger = (await harness.service.store.readLedger(taskRef, false)).ledger;
  const promptEvent = ledger.events.find((event) =>
    event.event_type === "prompt_signal_observed");
  assert.match(promptEvent.source_ref, /^codex:user_prompt:turn:[a-f0-9]{24}$/);
});

test("Windows junctions cannot redirect task deletion outside the data root", {
  skip: process.platform !== "win32"
}, async (t) => {
  const harness = await createHarness(t, "junction-task-delete");
  const taskRef = "codex:junction-task-delete";
  const victimTasks = path.join(harness.root, "junction-victim-tasks");
  const victimTask = path.join(
    victimTasks,
    path.basename(harness.service.store.taskDirectory(taskRef))
  );
  const marker = path.join(victimTask, "must-survive.txt");
  const tasksLink = path.join(harness.dataRoot, "tasks");
  await fs.mkdir(victimTask, { recursive: true });
  await fs.writeFile(marker, "outside-data-root", "utf8");
  await fs.mkdir(harness.dataRoot, { recursive: true });
  await fs.symlink(victimTasks, tasksLink, "junction");
  try {
    await assert.rejects(
      harness.service.store.deleteTask(taskRef),
      (error) => error.code === "REALPATH_ESCAPE"
    );
    assert.equal(await fs.readFile(marker, "utf8"), "outside-data-root");
  } finally {
    await fs.unlink(tasksLink).catch(() => {});
  }
});

test("Windows junctions cannot redirect archive deletion outside the data root", {
  skip: process.platform !== "win32"
}, async (t) => {
  const harness = await createHarness(t, "junction-archive-delete");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "junction-archive-delete"
  );
  const ledgerPath = harness.service.store.ledgerPath(seeded.taskRef);
  const ledgerBefore = await fs.readFile(ledgerPath, "utf8");
  const victimArchive = path.join(harness.root, "junction-victim-archive");
  const marker = path.join(victimArchive, "must-survive.txt");
  const archiveLink = path.join(harness.dataRoot, "archive");
  await fs.mkdir(victimArchive, { recursive: true });
  await fs.writeFile(marker, "outside-data-root", "utf8");
  await fs.symlink(victimArchive, archiveLink, "junction");
  try {
    await assert.rejects(
      harness.service.store.deleteTask(seeded.taskRef),
      (error) => error.code === "REALPATH_ESCAPE"
    );
    assert.equal(await fs.readFile(ledgerPath, "utf8"), ledgerBefore);
    assert.equal(await fs.readFile(marker, "utf8"), "outside-data-root");
  } finally {
    await fs.unlink(archiveLink).catch(() => {});
  }
});

test("Windows junctions cannot redirect snapshots outside the data root", {
  skip: process.platform !== "win32"
}, async (t) => {
  const harness = await createHarness(t, "junction-snapshot-write");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "junction-snapshot-write"
  );
  const ledgerPath = harness.service.store.ledgerPath(seeded.taskRef);
  const ledgerBefore = await fs.readFile(ledgerPath, "utf8");
  const victimSnapshots = path.join(harness.root, "junction-victim-snapshots");
  const marker = path.join(victimSnapshots, "must-survive.txt");
  const snapshotsLink = harness.service.store.snapshotDirectory(seeded.taskRef);
  await fs.mkdir(victimSnapshots, { recursive: true });
  await fs.writeFile(marker, "outside-data-root", "utf8");
  await fs.symlink(victimSnapshots, snapshotsLink, "junction");
  try {
    await assert.rejects(
      harness.service.createSnapshot({
        task_ref: seeded.taskRef,
        cwd: harness.cwd,
        trigger: "manual",
        turn_id: "junction-snapshot"
      }),
      (error) => error.code === "REALPATH_ESCAPE"
    );
    assert.equal(await fs.readFile(ledgerPath, "utf8"), ledgerBefore);
    assert.equal(await fs.readFile(marker, "utf8"), "outside-data-root");
  } finally {
    await fs.unlink(snapshotsLink).catch(() => {});
  }
});

test("delete removes both active state and exact archived copies", async (t) => {
  const harness = await createHarness(t, "delete-archives");
  const sessionId = "delete-archives";
  const taskRef = taskRefForSession(sessionId);
  const archivedMarker = "ARCHIVED-CONTINUITY-MARKER-7B3A";
  await recordConfirmedUserState(
    harness.service,
    harness.cwd,
    sessionId,
    [{
      id: "objective:archive",
      kind: "objective",
      statement: archivedMarker,
      authority: "user",
      verification: "verified"
    }]
  );
  const archived = await harness.service.manageStateDirect({
    task_ref: taskRef,
    action: "reset",
    confirm_task_ref: taskRef
  });
  assert.equal(archived.archived, true);
  await recordConfirmedUserState(
    harness.service,
    harness.cwd,
    sessionId,
    [{
      id: "objective:new",
      kind: "objective",
      statement: "Replacement active state.",
      authority: "user",
      verification: "verified"
    }]
  );
  const deleted = await harness.service.manageStateDirect({
    task_ref: taskRef,
    action: "delete",
    confirm_task_ref: taskRef
  });
  assert.equal(deleted.deleted, true);
  assert.ok(deleted.archived_copies_deleted >= 1);
  assert.equal((await readTree(harness.dataRoot)).includes(archivedMarker), false);
});

test("failed snapshots at the event cap create no orphan and prune no referenced state", async (t) => {
  const harness = await createHarness(t, "snapshot-event-cap");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "snapshot-event-cap"
  );
  const loaded = await harness.service.store.readLedger(seeded.taskRef, false);
  while (loaded.ledger.events.length < MAX_EVENTS_PER_TASK) {
    appendSealedEvent(loaded.ledger, "session_ended", {
      reason: "event-cap-fixture"
    }, {
      sourceRef: "test:event-cap"
    });
  }
  await fs.writeFile(
    harness.service.store.ledgerPath(seeded.taskRef),
    JSON.stringify(loaded.ledger, null, 2) + "\n",
    "utf8"
  );
  const before = await fs.readFile(
    harness.service.store.ledgerPath(seeded.taskRef),
    "utf8"
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await assert.rejects(
      harness.service.createSnapshot({
        task_ref: seeded.taskRef,
        cwd: harness.cwd,
        trigger: "manual",
        turn_id: "event-cap-" + attempt
      }),
      (error) => error.code === "EVENT_LIMIT_REACHED"
    );
  }
  assert.equal(
    await fs.readFile(harness.service.store.ledgerPath(seeded.taskRef), "utf8"),
    before
  );
  await assert.rejects(
    fs.access(harness.service.store.snapshotDirectory(seeded.taskRef)),
    (error) => error.code === "ENOENT"
  );
});

test("ledger reads reject unsupported fields and re-sealed unknown event types", async (t) => {
  const harness = await createHarness(t, "strict-ledger-schema");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "strict-ledger-schema"
  );
  const filePath = harness.service.store.ledgerPath(seeded.taskRef);
  const original = JSON.parse(await fs.readFile(filePath, "utf8"));

  const rootWithExtraField = structuredClone(original);
  rootWithExtraField.untrusted_extension = true;
  await fs.writeFile(filePath, JSON.stringify(rootWithExtraField), "utf8");
  await assert.rejects(
    harness.service.store.readLedger(seeded.taskRef, false),
    (error) => error.code === "INVALID_LEDGER_FIELDS"
  );

  const unknownEvent = structuredClone(original);
  unknownEvent.events[0].event_type = "extension_event_not_in_protocol";
  const eventForHash = structuredClone(unknownEvent.events[0]);
  delete eventForHash.event_hash;
  unknownEvent.events[0].event_hash = sha256(eventForHash);
  if (unknownEvent.events.length > 1) {
    unknownEvent.events[1].previous_hash = unknownEvent.events[0].event_hash;
    const nextForHash = structuredClone(unknownEvent.events[1]);
    delete nextForHash.event_hash;
    unknownEvent.events[1].event_hash = sha256(nextForHash);
  }
  await fs.writeFile(filePath, JSON.stringify(unknownEvent), "utf8");
  await assert.rejects(
    harness.service.store.readLedger(seeded.taskRef, false),
    (error) => error.code === "UNKNOWN_LEDGER_EVENT"
  );
});

test("oversized ledgers are rejected before JSON parsing", async (t) => {
  const harness = await createHarness(t, "oversized-ledger-read");
  const taskRef = "codex:oversized-ledger-read";
  const filePath = harness.service.store.ledgerPath(taskRef);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, Buffer.alloc(MAX_LEDGER_BYTES + 1, 0x20));
  await assert.rejects(
    harness.service.store.readLedger(taskRef, false),
    (error) => error.code === "LEDGER_SIZE_LIMIT"
  );
});

test("maximum MCP state and handoff responses remain below the hard wire budget", async (t) => {
  const harness = await createHarness(t, "mcp-response-budget");
  const taskRef = "codex:mcp-response-budget";
  for (let batch = 0; batch < 2; batch += 1) {
    await harness.service.recordState({
      task_ref: taskRef,
      expected_generation: batch,
      items: Array.from({ length: 64 }, (_, index) => {
        const number = batch * 64 + index;
        return {
          id: "assumption:" + number,
          kind: "assumption",
          statement: "Bounded candidate " + number + " " + "x".repeat(1700),
          source_ref: "agent:response-budget:" + number,
          authority: "agent_inference",
          verification: "unverified",
          confidence: 0.2,
          status: "unverified"
        };
      })
    });
  }
  const runtime = new McpRuntime(harness.service);
  for (const request of [
    {
      name: "continuity_get_state",
      arguments: { task_ref: taskRef, limit: 8 }
    },
    {
      name: "continuity_export_handoff",
      arguments: { task_ref: taskRef, scope: "bounded", max_bytes: 16 * 1024 }
    }
  ]) {
    const result = await runtime.handle({
      method: "tools/call",
      params: request
    });
    assert.equal(result.isError, false);
    assert.ok(Buffer.byteLength(JSON.stringify(result), "utf8") <= 24 * 1024);
  }
});
