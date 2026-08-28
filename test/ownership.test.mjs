import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { ContinuityError } from "../plugins/context-continuity/src/errors.mjs";
import { externalContractDigest } from "../plugins/context-continuity/src/model.mjs";
import { sha256 } from "../plugins/context-continuity/src/util.mjs";
import {
  createHarness,
  observePrompt,
  recordMinimumState
} from "./helpers.mjs";

test("an external intent contract owns intent while operational evidence remains writable", async (t) => {
  const harness = await createHarness(t, "ownership");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "ownership-session"
  );
  const externalItems = [
    {
      id: "intent:external-objective",
      kind: "objective",
      statement: "Implement the Codex continuity version.",
      source_ref: "intent-loop:event-9",
      authority: "user",
      verification: "verified",
      status: "active",
      recorded_at: "2026-08-28T00:00:00.000Z",
      supersedes: []
    },
    {
      id: "intent:external-constraint",
      kind: "hard_constraint",
      statement: "Do not publish the plugin.",
      source_ref: "intent-loop:event-10",
      authority: "user",
      verification: "verified",
      status: "active",
      recorded_at: "2026-08-28T00:00:00.000Z",
      supersedes: []
    }
  ];
  const bound = await harness.service.bindExternalContract({
    task_ref: seeded.taskRef,
    expected_generation: seeded.state.generation,
    contract_ref: "intent-loop:contract-4",
    contract_version: 4,
    snapshot_sha256: sha256("external-contract-bytes"),
    items_digest: externalContractDigest(externalItems),
    provider_token: harness.trustedProviderToken,
    items: externalItems
  });
  assert.equal(bound.contract.source, "user-intent-plugin");
  assert.equal(bound.contract.contract_version, 4);
  const newPrompt = await observePrompt(
    harness.service,
    harness.cwd,
    "ownership-session",
    "Change the objective again. Continuity silently rewrites the external intent."
  );
  await assert.rejects(
    harness.service.recordState({
      task_ref: seeded.taskRef,
      expected_generation: bound.generation,
      source_event_id: newPrompt.source_event_id,
      provider: "standalone",
        items: [
          {
            id: "objective:forbidden-standalone",
            kind: "objective",
          statement: "Continuity silently rewrites the external intent.",
          authority: "user",
          verification: "verified"
        }
      ]
    }),
    (error) => error instanceof ContinuityError
      && error.code === "EXTERNAL_INTENT_PROVIDER_OWNS_STATE"
  );
  const evidenceDigest = sha256("tests-passed");
  const operational = await harness.service.recordState({
    task_ref: seeded.taskRef,
    expected_generation: bound.generation,
    provider: "verified-evidence",
    evidence_provider_token: harness.trustedEvidenceProviderToken,
    items: [
      {
        id: "completion:tests",
        kind: "completion",
        statement: "The deterministic tests passed.",
        source_ref: "test:node",
        authority: "verified_evidence",
        verification: "verified",
        evidence_digest: evidenceDigest
      }
    ]
  });
  assert.equal(operational.contract.contract_version, 4);
  assert.equal(operational.items.some((item) => item.id === "completion:tests"), true);
});

test("external intent binding is monotonic and same-version content addressed", async (t) => {
  const harness = await createHarness(t, "external-contract-monotonic");
  const taskRef = "codex:external-contract-monotonic";
  const initial = await harness.service.getState({ task_ref: taskRef });
  const snapshotHash = sha256("intent-contract-v3");
  const emptyDigest = externalContractDigest([]);
  const bound = await harness.service.bindExternalContract({
    task_ref: taskRef,
    expected_generation: initial.generation,
    contract_ref: "intent:task-monotonic",
    contract_version: 3,
    snapshot_sha256: snapshotHash,
    items_digest: emptyDigest,
    provider_token: harness.trustedProviderToken,
    items: []
  });

  const idempotent = await harness.service.bindExternalContract({
    task_ref: taskRef,
    expected_generation: bound.generation,
    contract_ref: "intent:task-monotonic",
    contract_version: 3,
    snapshot_sha256: snapshotHash,
    items_digest: emptyDigest,
    provider_token: harness.trustedProviderToken,
    items: []
  });
  assert.equal(idempotent.idempotent, true);
  assert.equal(idempotent.generation, bound.generation);

  await assert.rejects(
    harness.service.bindExternalContract({
      task_ref: taskRef,
      expected_generation: bound.generation,
      contract_ref: "intent:task-monotonic",
      contract_version: 2,
      snapshot_sha256: sha256("intent-contract-v2"),
      items_digest: emptyDigest,
      provider_token: harness.trustedProviderToken,
      items: []
    }),
    (error) => error.code === "CONTRACT_VERSION_ROLLBACK"
  );
  await assert.rejects(
    harness.service.bindExternalContract({
      task_ref: taskRef,
      expected_generation: bound.generation,
      contract_ref: "intent:task-monotonic",
      contract_version: 3,
      snapshot_sha256: sha256("different-v3-content"),
      items_digest: emptyDigest,
      provider_token: harness.trustedProviderToken,
      items: []
    }),
    (error) => error.code === "CONTRACT_VERSION_COLLISION"
  );
  await assert.rejects(
    harness.service.bindExternalContract({
      task_ref: taskRef,
      expected_generation: bound.generation,
      contract_ref: "intent:different-task",
      contract_version: 4,
      snapshot_sha256: sha256("intent-contract-v4"),
      items_digest: emptyDigest,
      provider_token: harness.trustedProviderToken,
      items: []
    }),
    (error) => error.code === "CONTRACT_REF_CHANGE_REQUIRES_RESET"
  );
});

test("handoff import remains candidate-only and cannot change active generation", async (t) => {
  const source = await createHarness(t, "handoff-source");
  const target = await createHarness(t, "handoff-target");
  const seededSource = await recordMinimumState(
    source.service,
    source.cwd,
    "source-session"
  );
  const seededTarget = await recordMinimumState(
    target.service,
    target.cwd,
    "target-session"
  );
  const capsule = await source.service.exportHandoff({
    task_ref: seededSource.taskRef,
    scope: "adapter-test"
  });
  const imported = await target.service.importHandoff({
    task_ref: seededTarget.taskRef,
    expected_generation: seededTarget.state.generation,
    capsule
  });
  assert.equal(imported.imported_as, "candidate_only");
  assert.equal(imported.active_state_changed, false);
  assert.equal(imported.generation, seededTarget.state.generation);
  const state = await target.service.getState({ task_ref: seededTarget.taskRef });
  assert.equal(state.generation, seededTarget.state.generation);
  assert.equal(state.items.some((item) => item.id === "objective:main"), true);
});

test("handoff import whitelists and redacts candidate fields before persistence", async (t) => {
  const source = await createHarness(t, "handoff-redact-source");
  const target = await createHarness(t, "handoff-redact-target");
  const seededSource = await recordMinimumState(
    source.service,
    source.cwd,
    "handoff-redact-source-session"
  );
  const seededTarget = await recordMinimumState(
    target.service,
    target.cwd,
    "handoff-redact-target-session"
  );
  const capsule = await source.service.exportHandoff({
    task_ref: seededSource.taskRef,
    scope: "redaction-test"
  });
  const secret = "sk-" + "1234567890abcdefghijklmnop";
  capsule.items[0].statement = "Candidate token=" + secret;
  capsule.items[0].source_ref = "agent:token=" + secret;
  capsule.items[0].unexpected = "must not persist";
  capsule.capsule_digest = sha256({
    ...capsule,
    capsule_digest: undefined
  });
  await target.service.importHandoff({
    task_ref: seededTarget.taskRef,
    expected_generation: seededTarget.state.generation,
    capsule
  });
  const raw = await fs.readFile(
    target.service.store.ledgerPath(seededTarget.taskRef),
    "utf8"
  );
  assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes("unexpected"), false);
  assert.match(raw, /candidate_only/);
});

test("execution guard view is derived from the one effective projection", async (t) => {
  const harness = await createHarness(t, "guard-view");
  const seeded = await recordMinimumState(
    harness.service,
    harness.cwd,
    "guard-session"
  );
  assert.equal(
    seeded.state.execution_guard_view.contract_ref,
    seeded.state.contract.contract_ref
  );
  assert.equal(
    seeded.state.execution_guard_view.contract_version,
    seeded.state.contract.contract_version
  );
  assert.ok(
    seeded.state.execution_guard_view.open_commitments.includes("next:test")
  );
});
