import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ContinuityService,
  taskRefForSession
} from "../plugins/context-continuity/src/service.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pluginRoot = path.join(root, "plugins", "context-continuity");
const temporaryBase = process.env.CONTEXT_CONTINUITY_TEST_TMP || os.tmpdir();
await fs.mkdir(temporaryBase, { recursive: true });
const scratch = await fs.mkdtemp(path.join(temporaryBase, "context-continuity-hooks-"));
const dataRoot = path.join(scratch, "data");
const cwd = path.join(scratch, "workspace");
await fs.mkdir(cwd, { recursive: true });

async function runHook(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(pluginRoot, "hooks", "run.mjs")], {
      cwd: pluginRoot,
      env: {
        ...process.env,
        CONTEXT_CONTINUITY_DATA_DIR: dataRoot
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("Hook process failed: " + stderr));
        return;
      }
      resolve(stdout.trim() ? JSON.parse(stdout) : null);
    });
    child.stdin.end(JSON.stringify(payload));
  });
}

const sessionId = "smoke-hook-session";
const longTail = " filler".repeat(100) + " DO_NOT_PERSIST_FULL_PROMPT_TAIL_42";
try {
  const promptOutput = await runHook({
    session_id: sessionId,
    turn_id: "smoke-prompt",
    cwd,
    hook_event_name: "UserPromptSubmit",
    prompt: [
      "Goal: Validate the real Hook process compact recovery loop.",
      "Constraint: Do not publish or change global Codex configuration.",
      "Authorization: Local scratch execution only.",
      "Work object: " + cwd,
      "Next: Run PreCompact, PostCompact, then compact recovery."
    ].join(" ") + longTail
  });
  assert.equal(promptOutput.continue, true);
  const context = promptOutput.hookSpecificOutput.additionalContext;
  const sourceEventId = /source_event_id: ([^\s]+)/.exec(context)?.[1];
  assert.ok(sourceEventId);

  const service = new ContinuityService({
    dataRootInfo: {
      path: dataRoot,
      durable: true,
      source: "hook-smoke"
    }
  });
  const taskRef = taskRefForSession(sessionId);
  const state = await service.getState({ task_ref: taskRef });
  const items = [
    {
      id: "objective:smoke",
      kind: "objective",
      statement: "Validate the real Hook process compact recovery loop.",
      authority: "user",
      verification: "verified"
    },
    {
      id: "constraint:smoke",
      kind: "hard_constraint",
      statement: "Do not publish or change global Codex configuration.",
      authority: "user",
      verification: "verified"
    },
    {
      id: "authorization:smoke",
      kind: "authorization",
      statement: "Local scratch execution only.",
      authority: "user",
      verification: "verified"
    },
    {
      id: "work:smoke",
      kind: "work_object",
      statement: cwd,
      authority: "user",
      verification: "verified"
    },
    {
      id: "next:smoke",
      kind: "next_action",
      statement: "Run PreCompact, PostCompact, then compact recovery.",
      authority: "user",
      verification: "verified"
    }
  ];
  const prepared = await service.prepareStateConfirmation({
    task_ref: taskRef,
    expected_generation: state.generation,
    resolve_prompt_event_ids: [sourceEventId],
    items
  });
  assert.match(prepared.confirmation_prompt, /objective:smoke/);
  const confirmationOutput = await runHook({
    session_id: sessionId,
    turn_id: "smoke-confirmation",
    cwd,
    hook_event_name: "UserPromptSubmit",
    prompt: prepared.confirmation_prompt
  });
  const confirmationContext = confirmationOutput.hookSpecificOutput.additionalContext;
  const confirmationEventId = /source_event_id: ([^\s]+)/.exec(
    confirmationContext
  )?.[1];
  assert.ok(confirmationEventId);
  await service.recordState({
    task_ref: taskRef,
    expected_generation: state.generation,
    source_event_id: confirmationEventId,
    resolve_prompt_event_ids: [sourceEventId],
    items
  });
  await runHook({
    session_id: sessionId,
    turn_id: "smoke-compact",
    cwd,
    hook_event_name: "PreCompact",
    trigger: "manual"
  });
  await runHook({
    session_id: sessionId,
    turn_id: "smoke-compact",
    cwd,
    hook_event_name: "PostCompact",
    trigger: "manual"
  });
  const recoveryOutput = await runHook({
    session_id: sessionId,
    cwd,
    hook_event_name: "SessionStart",
    source: "compact"
  });
  const recoveryContext = recoveryOutput.hookSpecificOutput.additionalContext;
  assert.match(recoveryContext, /objective:smoke/);
  assert.match(recoveryContext, /constraint:smoke/);
  assert.match(recoveryContext, /next:smoke/);
  assert.match(recoveryContext, /classification: continue_with_markers/);
  assert.match(recoveryContext, /never execute a stale next_action directly/i);

  const ledgerFiles = [];
  async function visit(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else {
        ledgerFiles.push(target);
      }
    }
  }
  await visit(dataRoot);
  const persisted = (await Promise.all(ledgerFiles.map((file) =>
    fs.readFile(file, "utf8")))).join("\n");
  assert.doesNotMatch(persisted, /DO_NOT_PERSIST_FULL_PROMPT_TAIL_42/);

  process.stdout.write(JSON.stringify({
    passed: true,
    process_boundary: true,
    events: [
      "UserPromptSubmit",
      "PreCompact(manual)",
      "PostCompact(manual)",
      "SessionStart(compact)"
    ],
    recovery_classification: "continue_with_markers",
    readable_confirmation_used: true,
    next_action_requires_revalidation: true,
    full_prompt_tail_persisted: false
  }, null, 2) + "\n");
} finally {
  await fs.rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50
  });
}
