import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { ContinuityError } from "../plugins/context-continuity/src/errors.mjs";
import { taskRefForSession } from "../plugins/context-continuity/src/service.mjs";
import { sha256 } from "../plugins/context-continuity/src/util.mjs";
import {
  createHarness,
  observePrompt,
  observeUserConfirmation,
  recordConfirmedUserState,
  recordMinimumState
} from "./helpers.mjs";

test("prompt observation stores a hash and redacted bounded signal, not the complete prompt", async (t) => {
  const harness = await createHarness(t, "prompt");
  const secret = "sk-" + "1234567890abcdefghijklmnop";
  const prompt = "Change the goal and use token=" + secret + " " + "x".repeat(900);
  const observed = await observePrompt(harness.service, harness.cwd, "prompt-session", prompt);
  assert.ok(observed.signals.includes("goal_change"));
  const ledger = (await harness.service.store.readLedger(observed.task_ref)).ledger;
  const serialized = JSON.stringify(ledger);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes(prompt), false);
  const event = ledger.events.find((entry) => entry.event_id === observed.source_event_id);
  assert.equal(event.payload.prompt_sha256, sha256(prompt));
  assert.equal(event.payload.excerpt_truncated, true);
  assert.match(event.payload.excerpt, /\[REDACTED(?::[^\]]+)?\]/);
});

test("first-prompt initialization stores only the bounded redacted excerpt needed for provenance", async (t) => {
  const harness = await createHarness(t, "first-prompt-minimal");
  const prompt = "Please review the current module.";
  const observed = await observePrompt(
    harness.service,
    harness.cwd,
    "first-prompt-session",
    prompt
  );
  assert.deepEqual(observed.signals, ["first_prompt"]);
  const ledger = (await harness.service.store.readLedger(observed.task_ref)).ledger;
  const event = ledger.events.find((entry) => entry.event_id === observed.source_event_id);
  assert.equal(event.payload.prompt_sha256, sha256(prompt));
  assert.equal(event.payload.excerpt, prompt);
});

test("user-authoritative state requires an observed prompt source", async (t) => {
  const harness = await createHarness(t, "user-source");
  const taskRef = "codex:user-source-session";
  await assert.rejects(
    harness.service.recordState({
      task_ref: taskRef,
      expected_generation: 0,
      items: [
        {
          id: "objective:unbound",
          kind: "objective",
          statement: "Unbound user claim",
          authority: "user",
          verification: "verified"
        }
      ]
    }),
    (error) => error instanceof ContinuityError
      && error.code === "USER_SOURCE_REQUIRED"
  );
});

test("a resolved prompt event cannot authorize unrelated later state", async (t) => {
  const harness = await createHarness(t, "user-source-replay");
  const taskRef = taskRefForSession("user-source-replay-session");
  const confirmed = await recordConfirmedUserState(
    harness.service,
    harness.cwd,
    "user-source-replay-session",
    [
      {
        id: "objective:original",
        kind: "objective",
        statement: "Preserve this exact task.",
        authority: "user",
        verification: "verified"
      }
    ]
  );
  const observed = confirmed.observed;
  const recorded = confirmed.state;
  await assert.rejects(
    harness.service.recordState({
      task_ref: taskRef,
      expected_generation: recorded.generation,
      source_event_id: observed.source_event_id,
      items: [
        {
          id: "objective:replayed",
          kind: "objective",
          statement: "A different objective attributed to an old prompt.",
          authority: "user",
          verification: "verified"
        }
      ]
    }),
    (error) => error instanceof ContinuityError
      && error.code === "PROMPT_EVENT_ALREADY_RESOLVED"
  );
});

test("a correction supersedes the old objective without erasing its provenance", async (t) => {
  const harness = await createHarness(t, "correction");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "correction-session"
  );
  const correctionItems = [{
    id: "correction:bounded-plugin",
    kind: "correction",
    statement: "The product is a bounded continuity plugin, not a memory platform.",
    authority: "user",
    verification: "verified",
    status: "active",
    supersedes: ["objective:main"]
  }, {
    id: "objective:bounded",
    kind: "objective",
    statement: "Implement and verify a bounded continuity plugin.",
    authority: "user",
    verification: "verified",
    status: "active",
    supersedes: []
  }];
  const correctionPrompt = await observeUserConfirmation(
    harness.service,
    harness.cwd,
    "correction-session",
    correctionItems
  );
  const corrected = await harness.service.correctState({
    task_ref: seeded.taskRef,
    expected_generation: seeded.state.generation,
    source_event_id: correctionPrompt.observed.source_event_id,
    correction: {
      id: "correction:bounded-plugin",
      statement: "The product is a bounded continuity plugin, not a memory platform.",
      supersedes: ["objective:main"]
    },
    replacements: [
      {
        id: "objective:bounded",
        kind: "objective",
        statement: "Implement and verify a bounded continuity plugin.",
        supersedes: []
      }
    ]
  });
  assert.equal(corrected.items.some((item) => item.id === "objective:main"), false);
  assert.equal(corrected.items.some((item) => item.id === "objective:bounded"), true);
  const ledger = (await harness.service.store.readLedger(seeded.taskRef)).ledger;
  const projection = (await harness.service.getState({ task_ref: seeded.taskRef }));
  assert.ok(ledger.events.some((event) => event.event_type === "state_recorded"));
  const rawProjection = await harness.service.store.getProjection(seeded.taskRef);
  assert.equal(rawProjection.items["objective:main"].status, "superseded");
  assert.equal(projection.coverage_gaps.some((gap) => gap.code === "multiple_active_objectives"), false);
});

test("multiple unresolved objectives remain visible as a high-risk conflict", async (t) => {
  const harness = await createHarness(t, "conflict");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "conflict-session"
  );
  const conflict = await recordConfirmedUserState(
    harness.service,
    harness.cwd,
    "conflict-session",
    [
      {
        id: "objective:alternative",
        kind: "objective",
        statement: "Consider a shared module instead of an independent plugin.",
        authority: "user",
        verification: "verified",
        status: "disputed"
      },
      {
        id: "dispute:product-shape",
        kind: "dispute",
        statement: "Whether the capability should remain independently installable is unresolved.",
        authority: "user",
        verification: "verified",
        status: "disputed"
      }
    ]
  );
  const state = conflict.state;
  assert.ok(state.coverage_gaps.some((gap) =>
    gap.code === "multiple_active_objectives" && gap.severity === "high"));
  assert.equal(state.items.filter((item) => item.kind === "objective").length, 2);
});

test("verified operational evidence requires a content digest", async (t) => {
  const harness = await createHarness(t, "evidence");
  const taskRef = taskRefForSession("evidence-session");
  const observed = await observePrompt(
    harness.service,
    harness.cwd,
    "evidence-session",
    "Record the verified completion evidence."
  );
  await assert.rejects(
    harness.service.recordState({
      task_ref: taskRef,
      expected_generation: 0,
      source_event_id: observed.source_event_id,
      provider: "verified-evidence",
      evidence_provider_token: harness.trustedEvidenceProviderToken,
      items: [
        {
          kind: "completion",
          statement: "Tests passed.",
          source_ref: "test:npm",
          authority: "verified_evidence",
          verification: "verified"
        }
      ]
    }),
    (error) => error instanceof ContinuityError
      && error.code === "EVIDENCE_DIGEST_REQUIRED"
  );
});

test("secret-like content is redacted from persisted state statements", async (t) => {
  const harness = await createHarness(t, "redaction");
  const taskRef = taskRefForSession("redaction-session");
  const secretStatement = "Use api_key=super-secret-value to do the task.";
  await recordConfirmedUserState(
    harness.service,
    harness.cwd,
    "redaction-session",
    [
      {
        id: "objective:redacted",
        kind: "objective",
        statement: secretStatement,
        authority: "user",
        verification: "verified"
      }
    ]
  );
  const ledgerPath = harness.service.store.ledgerPath(taskRef);
  const raw = await fs.readFile(ledgerPath, "utf8");
  assert.equal(raw.includes("super-secret-value"), false);
  assert.match(raw, /\[REDACTED\]/);
});

test("secret-like content is redacted from provenance references", async (t) => {
  const harness = await createHarness(t, "source-ref-redaction");
  const taskRef = "codex:source-ref-redaction";
  const current = await harness.service.getState({ task_ref: taskRef });
  const secret = "sk-" + "1234567890abcdefghijklmnop";
  const state = await harness.service.recordState({
    task_ref: taskRef,
    expected_generation: current.generation,
    provider: "standalone",
    items: [
      {
        id: "evidence:redacted-source",
        kind: "evidence",
        statement: "An unverified evidence candidate.",
        source_ref: "https://example.test/?token=" + secret,
        authority: "agent_inference",
        verification: "unverified",
        confidence: 0.4,
        status: "unverified"
      }
    ]
  });
  const item = state.items.find((entry) => entry.id === "evidence:redacted-source");
  assert.equal(item.source_ref.includes(secret), false);
  assert.equal(item.redacted, true);
  const raw = await fs.readFile(
    harness.service.store.ledgerPath(taskRef),
    "utf8"
  );
  assert.equal(raw.includes(secret), false);
});

test("an unverified agent inference cannot supersede verified user intent", async (t) => {
  const harness = await createHarness(t, "authority-supersession");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "authority-supersession-session"
  );
  await assert.rejects(
    harness.service.recordState({
      task_ref: seeded.taskRef,
      expected_generation: seeded.state.generation,
      provider: "standalone",
      items: [
        {
          id: "objective:agent-rewrite",
          kind: "objective",
          statement: "Replace the user's objective with an inferred objective.",
          source_ref: "agent:inference",
          authority: "agent_inference",
          verification: "unverified",
          confidence: 0.9,
          status: "unverified",
          supersedes: ["objective:main"]
        }
      ]
    }),
    (error) => error.code === "LOWER_AUTHORITY_SUPERSESSION"
  );
});

test("reusing an item id cannot change its authority or verification", async (t) => {
  const harness = await createHarness(t, "item-id-authority");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "item-id-authority-session"
  );
  await assert.rejects(
    harness.service.recordState({
      task_ref: seeded.taskRef,
      expected_generation: seeded.state.generation,
      provider: "standalone",
      items: [
        {
          id: "objective:main",
          kind: "objective",
          statement: "Implement and verify the local Context Continuity plugin.",
          source_ref: seeded.state.items.find(
            (item) => item.id === "objective:main"
          ).source_ref,
          authority: "agent_inference",
          verification: "unverified",
          confidence: 0.8,
          status: "unverified"
        }
      ]
    }),
    (error) => error.code === "ITEM_ID_COLLISION"
  );
});
