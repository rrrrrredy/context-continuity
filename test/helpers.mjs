import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ContinuityService,
  taskRefForSession
} from "../plugins/context-continuity/src/service.mjs";
import { sha256 } from "../plugins/context-continuity/src/util.mjs";

export async function createHarness(testContext, name = "case") {
  const trustedProviderToken = "context-continuity-test-provider-token-0001";
  const trustedEvidenceProviderToken =
    "context-continuity-test-evidence-token-0001";
  const preferred = process.env.CONTEXT_CONTINUITY_TEST_TMP || os.tmpdir();
  await fs.mkdir(preferred, { recursive: true });
  const root = await fs.mkdtemp(path.join(preferred, "context-continuity-" + name + "-"));
  const dataRoot = path.join(root, "data");
  const cwd = path.join(root, "workspace");
  await fs.mkdir(cwd, { recursive: true });
  testContext.after(async () => {
    await fs.rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50
    });
  });
  const service = new ContinuityService({
    dataRootInfo: {
      path: dataRoot,
      durable: true,
      source: "test"
    },
    trustedProviderToken,
    trustedEvidenceProviderToken
  });
  return {
    root,
    dataRoot,
    cwd,
    service,
    trustedProviderToken,
    trustedEvidenceProviderToken
  };
}

export async function observePrompt(service, cwd, sessionId, prompt) {
  return service.observePrompt({
    session_id: sessionId,
    turn_id: "turn-" + Date.now(),
    cwd,
    hook_event_name: "UserPromptSubmit",
    prompt
  });
}

export async function observeUserConfirmation(
  service,
  cwd,
  sessionId,
  items,
  resolvePromptEventIds = []
) {
  const taskRef = taskRefForSession(sessionId);
  const current = await service.getState({ task_ref: taskRef });
  const prepared = await service.prepareStateConfirmation({
    task_ref: taskRef,
    expected_generation: current.generation,
    resolve_prompt_event_ids: resolvePromptEventIds,
    items
  });
  const observed = await observePrompt(
    service,
    cwd,
    sessionId,
    prepared.confirmation_prompt
  );
  return {
    taskRef,
    current,
    prepared,
    observed,
    resolve_prompt_event_ids: resolvePromptEventIds
  };
}

export async function recordConfirmedUserState(
  service,
  cwd,
  sessionId,
  items,
  resolvePromptEventIds = []
) {
  const confirmation = await observeUserConfirmation(
    service,
    cwd,
    sessionId,
    items,
    resolvePromptEventIds
  );
  const state = await service.recordState({
    task_ref: confirmation.taskRef,
    expected_generation: confirmation.current.generation,
    provider: "standalone",
    source_event_id: confirmation.observed.source_event_id,
    resolve_prompt_event_ids: resolvePromptEventIds,
    items
  });
  return {
    ...confirmation,
    state
  };
}

export async function recordMinimumState(service, cwd, sessionId, options = {}) {
  const taskRef = taskRefForSession(sessionId);
  const objective = options.objective
    || "Implement and verify the local Context Continuity plugin.";
  const constraint = "Do not install, publish, or delete unrelated files.";
  const authorization = "Local repository edits and tests are authorized; publishing is not authorized.";
  const nextAction = options.nextAction
    || "Implement the state core, then run deterministic tests.";
  const evidenceDigest = sha256("workspace:" + cwd);
  const beforeEvidence = await service.getState({ task_ref: taskRef });
  await service.recordState({
    task_ref: taskRef,
    expected_generation: beforeEvidence.generation,
    provider: "verified-evidence",
    evidence_provider_token:
      "context-continuity-test-evidence-token-0001",
    items: [
      {
        id: "work:root",
        kind: "work_object",
        statement: cwd,
        source_ref: "file:" + cwd,
        authority: "verified_evidence",
        verification: "verified",
        evidence_digest: evidenceDigest,
        status: "active",
        scope: "workspace"
      }
    ]
  });
  const userItems = [
      {
        id: "objective:main",
        kind: "objective",
        statement: objective,
        authority: "user",
        verification: "verified",
        status: "active",
        scope: "task"
      },
      {
        id: "constraint:no-publish",
        kind: "hard_constraint",
        statement: constraint,
        authority: "user",
        verification: "verified",
        status: "active",
        scope: "task"
      },
      {
        id: "authorization:local-only",
        kind: "authorization",
        statement: authorization,
        authority: "user",
        verification: "verified",
        status: "active",
        scope: "task"
      },
      {
        id: "next:test",
        kind: "next_action",
        statement: nextAction,
        authority: "user",
        verification: "verified",
        status: "active",
        scope: "task"
      }
    ];
  const confirmed = await recordConfirmedUserState(
    service,
    cwd,
    sessionId,
    userItems
  );
  return {
    taskRef,
    observed: confirmed.observed,
    prepared: confirmed.prepared,
    state: confirmed.state,
    evidenceDigest
  };
}
