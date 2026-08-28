import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../plugins/context-continuity/src/cli.mjs";
import { createHarness } from "./helpers.mjs";

test("CLI reset and delete require a separate exact task_ref confirmation", async (t) => {
  const harness = await createHarness(t, "cli-confirm");
  const taskRef = "codex:cli-confirm";
  await harness.service.store.getProjection(taskRef);

  await assert.rejects(
    runCli(["reset", taskRef, "--data-dir", harness.dataRoot]),
    (error) => error.code === "TASK_CONFIRMATION_REQUIRED"
  );
  const reset = await runCli([
    "reset",
    taskRef,
    taskRef,
    "--data-dir",
    harness.dataRoot
  ]);
  assert.equal(reset.archived, true);
  assert.equal(reset.task_ref, taskRef);

  await assert.rejects(
    runCli(["delete", taskRef, "--data-dir", harness.dataRoot]),
    (error) => error.code === "TASK_CONFIRMATION_REQUIRED"
  );
  const deleted = await runCli([
    "delete",
    taskRef,
    taskRef,
    "--data-dir",
    harness.dataRoot
  ]);
  assert.equal(deleted.deleted, true);
});
