import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ContinuityService,
  taskRefForSession
} from "../plugins/context-continuity/src/service.mjs";
import { estimateTokens } from "../plugins/context-continuity/src/util.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(await fs.readFile(path.join(here, "cases.json"), "utf8"));

const WEIGHTS = new Map([
  ["objective", 3],
  ["hard_constraint", 3],
  ["authorization", 3],
  ["correction", 2],
  ["work_object", 2],
  ["completion", 2],
  ["dispute", 2],
  ["open_question", 2],
  ["next_action", 2],
  ["decision", 1]
]);

function item(input) {
  return {
    authority: "user",
    verification: "verified",
    status: input.status || "active",
    scope: "task",
    supersedes: input.supersedes || [],
    ...input
  };
}

function currentItems(testCase) {
  const output = [];
  if (testCase.correction) {
    output.push(item({
      id: "correction:current",
      kind: "correction",
      statement: testCase.correction,
      supersedes: ["objective:prior"]
    }));
  }
  output.push(item({
    id: "objective:current",
    kind: "objective",
    statement: testCase.goal,
    supersedes: testCase.initial_goal ? ["objective:prior"] : []
  }));
  for (const [index, statement] of (testCase.constraints || []).entries()) {
    output.push(item({
      id: "constraint:current:" + index,
      kind: "hard_constraint",
      statement,
      supersedes: testCase.prior_constraints?.[index]
        ? ["constraint:prior:" + index]
        : []
    }));
  }
  if (testCase.authorization) {
    output.push(item({
      id: "authorization:current",
      kind: "authorization",
      statement: testCase.authorization
    }));
  }
  if (testCase.decision) {
    output.push(item({
      id: "decision:current",
      kind: "decision",
      statement: testCase.decision
    }));
  }
  if (testCase.dispute) {
    output.push(item({
      id: "dispute:current",
      kind: "dispute",
      statement: testCase.dispute,
      status: "disputed"
    }));
  }
  if (testCase.open_question) {
    output.push(item({
      id: "open-question:current",
      kind: "open_question",
      statement: testCase.open_question
    }));
  }
  output.push(item({
    id: "work-object:current",
    kind: "work_object",
    statement: testCase.work_object,
    supersedes: testCase.prior_work_object ? ["work-object:prior"] : []
  }));
  if (testCase.completion) {
    output.push(item({
      id: "completion:current",
      kind: "completion",
      statement: testCase.completion
    }));
  }
  output.push(item({
    id: "next-action:current",
    kind: "next_action",
    statement: testCase.next_action
  }));
  return output;
}

function priorItems(testCase) {
  const output = [];
  if (testCase.initial_goal) {
    output.push(item({
      id: "objective:prior",
      kind: "objective",
      statement: testCase.initial_goal
    }));
  }
  for (const [index, statement] of (testCase.prior_constraints || []).entries()) {
    output.push(item({
      id: "constraint:prior:" + index,
      kind: "hard_constraint",
      statement
    }));
  }
  if (testCase.prior_work_object) {
    output.push(item({
      id: "work-object:prior",
      kind: "work_object",
      statement: testCase.prior_work_object
    }));
  }
  return output;
}

async function observeAndRecord(service, sessionId, cwd, prompt, items) {
  if (items.length === 0) {
    return service.getState({ task_ref: taskRefForSession(sessionId) });
  }
  const original = await service.observePrompt({
    session_id: sessionId,
    turn_id: "eval-source-" + Date.now(),
    cwd,
    hook_event_name: "UserPromptSubmit",
    prompt
  });
  let result = null;
  for (const [index, entry] of items.entries()) {
    const state = await service.getState({ task_ref: original.task_ref });
    const resolutionIds = index === 0 ? [original.source_event_id] : [];
    const prepared = await service.prepareStateConfirmation({
      task_ref: original.task_ref,
      expected_generation: state.generation,
      resolve_prompt_event_ids: resolutionIds,
      items: [entry]
    });
    const confirmation = await service.observePrompt({
      session_id: sessionId,
      turn_id: "eval-confirm-" + Date.now() + "-" + index,
      cwd,
      hook_event_name: "UserPromptSubmit",
      prompt: prepared.confirmation_prompt
    });
    result = await service.recordState({
      task_ref: original.task_ref,
      expected_generation: state.generation,
      source_event_id: confirmation.source_event_id,
      resolve_prompt_event_ids: resolutionIds,
      items: [entry]
    });
  }
  return result;
}

function sameSemanticItem(left, right) {
  return left.kind === right.kind && left.statement === right.statement;
}

function scoreArm(expected, recovered, contextTokens = 0) {
  let preservedWeight = 0;
  let totalWeight = 0;
  for (const expectedItem of expected) {
    const weight = WEIGHTS.get(expectedItem.kind) || 1;
    totalWeight += weight;
    if (recovered.some((candidate) => sameSemanticItem(candidate, expectedItem))) {
      preservedWeight += weight;
    }
  }
  const falseItems = recovered.filter((candidate) =>
    !expected.some((expectedItem) => sameSemanticItem(candidate, expectedItem)));
  const expectedNext = expected.find((candidate) => candidate.kind === "next_action");
  const recoveredNext = [...recovered].reverse()
    .find((candidate) => candidate.kind === "next_action");
  const criticalKinds = new Set([
    "objective",
    "hard_constraint",
    "authorization",
    "work_object"
  ]);
  const criticalMissing = expected
    .filter((candidate) => criticalKinds.has(candidate.kind))
    .some((expectedItem) =>
      !recovered.some((candidate) => sameSemanticItem(candidate, expectedItem)));
  const criticalFalse = falseItems.some((candidate) =>
    criticalKinds.has(candidate.kind));
  return {
    weighted_invariant_retention: totalWeight === 0
      ? 1
      : preservedWeight / totalWeight,
    next_action_equivalent: Boolean(expectedNext
      && recoveredNext
      && sameSemanticItem(expectedNext, recoveredNext)),
    major_goal_or_constraint_shift: criticalMissing || criticalFalse,
    false_recovery_count: falseItems.length,
    recovered_item_count: recovered.length,
    injected_context_tokens: contextTokens
  };
}

function aggregate(results, armName) {
  const rows = results.map((result) => result.arms[armName]);
  const average = (field) =>
    rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
  const sortedTokens = rows
    .map((row) => row.injected_context_tokens)
    .sort((left, right) => left - right);
  const percentile = (fraction) =>
    sortedTokens[Math.min(
      sortedTokens.length - 1,
      Math.ceil(sortedTokens.length * fraction) - 1
    )];
  return {
    cases: rows.length,
    weighted_invariant_retention: average("weighted_invariant_retention"),
    next_action_equivalence_rate: rows
      .filter((row) => row.next_action_equivalent).length / rows.length,
    major_shift_rate: rows
      .filter((row) => row.major_goal_or_constraint_shift).length / rows.length,
    false_recovery_count: rows
      .reduce((sum, row) => sum + row.false_recovery_count, 0),
    injected_context_tokens_p50: percentile(0.5),
    injected_context_tokens_p95: percentile(0.95)
  };
}

async function runCase(testCase, root) {
  const caseRoot = path.join(root, testCase.id);
  const dataRoot = path.join(caseRoot, "data");
  const cwd = path.join(caseRoot, "workspace");
  await fs.mkdir(cwd, { recursive: true });
  const service = new ContinuityService({
    dataRootInfo: {
      path: dataRoot,
      durable: true,
      source: "protocol-eval"
    }
  });
  const sessionId = "protocol-" + testCase.id;
  const taskRef = taskRefForSession(sessionId);
  const prior = priorItems(testCase);
  if (prior.length > 0) {
    await observeAndRecord(
      service,
      sessionId,
      cwd,
      "Initial task state before the user's later update.",
      prior
    );
  }
  const expected = currentItems(testCase);
  await observeAndRecord(
    service,
    sessionId,
    cwd,
    [
      "Current goal: " + testCase.goal,
      testCase.correction ? "Correction: " + testCase.correction : "",
      "Next: " + testCase.next_action
    ].filter(Boolean).join("\n"),
    expected
  );

  let pluginItems;
  let pluginTokens = 0;
  if (testCase.transition.kind === "handoff") {
    for (let index = 1; index < testCase.transition.repeats; index += 1) {
      await service.createSnapshot({
        task_ref: taskRef,
        cwd,
        trigger: testCase.transition.trigger,
        turn_id: testCase.id + "-pre-handoff-" + index
      });
      await service.markCompaction({
        task_ref: taskRef,
        trigger: testCase.transition.trigger,
        turn_id: testCase.id + "-pre-handoff-" + index
      });
      await service.recover({ task_ref: taskRef, cwd, source: "compact" });
    }
    const handoff = await service.subagentContext({
      task_ref: taskRef,
      scope: "eval-child",
      agent_id: "child-" + testCase.id,
      agent_type: "reviewer",
      source_ref: "eval:" + testCase.id
    });
    pluginItems = handoff.capsule.items;
    pluginTokens = estimateTokens(handoff.context);
    const targetRef = taskRef + ":target";
    const imported = await service.importHandoff({
      task_ref: targetRef,
      expected_generation: 0,
      capsule: handoff.capsule
    });
    assert.equal(imported.active_state_changed, false);
    assert.equal(imported.imported_as, "candidate_only");
  } else {
    let recovery;
    for (let index = 0; index < testCase.transition.repeats; index += 1) {
      await service.createSnapshot({
        task_ref: taskRef,
        cwd,
        trigger: testCase.transition.trigger,
        turn_id: testCase.id + "-" + index
      });
      if (testCase.transition.kind === "compaction") {
        await service.markCompaction({
          task_ref: taskRef,
          trigger: testCase.transition.trigger,
          turn_id: testCase.id + "-" + index
        });
      }
      recovery = await service.recover({
        task_ref: taskRef,
        cwd,
        source: testCase.transition.kind === "compaction"
          ? "compact"
          : "resume"
      });
    }
    pluginItems = recovery.report.state.items;
    pluginTokens = recovery.rendered.estimated_tokens;
  }

  const oracleItems = testCase.transition.kind === "handoff"
    ? expected.filter((candidate) => candidate.kind !== "authorization")
    : expected;
  const nativeItems = oracleItems
    .filter((candidate) => !testCase.native_loss_kinds.includes(candidate.kind))
    .concat((testCase.native_invented || []).map((candidate, index) => ({
      id: "native:false:" + index,
      authority: "agent_inference",
      verification: "unverified",
      status: "unverified",
      ...candidate
    })));
  return {
    id: testCase.id,
    category: testCase.category,
    transition: testCase.transition,
    oracle_item_count: oracleItems.length,
    parent_authority_excluded_from_handoff: testCase.transition.kind === "handoff"
      && expected.some((candidate) => candidate.kind === "authorization"),
    arms: {
      full_context: scoreArm(oracleItems, oracleItems, 0),
      host_native: scoreArm(oracleItems, nativeItems, 0),
      continuity_plugin: scoreArm(oracleItems, pluginItems, pluginTokens)
    }
  };
}

assert.equal(fixture.schema_version, "1.0");
assert.equal(fixture.cases.length, 30);
const temporaryBase = process.env.CONTEXT_CONTINUITY_TEST_TMP || os.tmpdir();
await fs.mkdir(temporaryBase, { recursive: true });
const root = await fs.mkdtemp(path.join(temporaryBase, "context-continuity-eval-"));
const startedAt = new Date().toISOString();
try {
  const caseResults = [];
  for (const testCase of fixture.cases) {
    caseResults.push(await runCase(testCase, root));
  }
  const result = {
    schema_version: "1.0",
    run_kind: "protocol_fixture",
    started_at: startedAt,
    environment: {
      node: process.version,
      platform: process.platform,
      case_fixture: "evals/cases.json",
      case_count: fixture.cases.length
    },
    case_results: caseResults,
    aggregate: {
      full_context: aggregate(caseResults, "full_context"),
      host_native: aggregate(caseResults, "host_native"),
      continuity_plugin: aggregate(caseResults, "continuity_plugin")
    },
    protocol_assertions: {
      plugin_retains_all_frozen_invariants: true,
      plugin_restores_no_false_fixture_items: true,
      all_next_actions_equivalent: true
    },
    claim_limit: fixture.claim_limit
  };
  assert.equal(result.aggregate.continuity_plugin.weighted_invariant_retention, 1);
  assert.equal(result.aggregate.continuity_plugin.next_action_equivalence_rate, 1);
  assert.equal(result.aggregate.continuity_plugin.false_recovery_count, 0);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
} finally {
  await fs.rm(root, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50
  });
}
