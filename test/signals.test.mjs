import assert from "node:assert/strict";
import test from "node:test";
import { detectPromptSignals } from "../plugins/context-continuity/src/signals.mjs";

const existingProjection = {
  generation: 1,
  pending_prompt_signals: {}
};

test("an explicit no-change continuity statement does not invent an authorization update", () => {
  const signals = detectPromptSignals(
    "Continue the same validation without changing goal or authorization.",
    existingProjection
  );
  assert.deepEqual(signals, []);
});

test("actual authorization grants, revocations, and limits remain material signals", () => {
  assert.ok(detectPromptSignals(
    "Authorization is revoked.",
    existingProjection
  ).includes("authorization"));
  assert.ok(detectPromptSignals(
    "You have permission to publish.",
    existingProjection
  ).includes("authorization"));
  assert.ok(detectPromptSignals(
    "Do not install this plugin.",
    existingProjection
  ).includes("authorization"));
});
