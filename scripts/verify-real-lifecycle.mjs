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
import { sha256 } from "../plugins/context-continuity/src/util.mjs";
import {
  directoryArtifactDigest,
  releaseArtifactDigests
} from "./artifact-digests.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pluginRootIndex = process.argv.indexOf("--plugin-root");
const pluginRoot = pluginRootIndex >= 0
  ? path.resolve(process.argv[pluginRootIndex + 1])
  : path.join(repositoryRoot, "plugins", "context-continuity");
const installedCacheMarker = path.sep + "plugins" + path.sep + "cache" + path.sep;
const pluginRuntime = pluginRoot.toLocaleLowerCase("en-US")
  .includes(installedCacheMarker.toLocaleLowerCase("en-US"))
  ? "installed_cache"
  : "source_checkout";
const sourcePluginRoot = path.join(
  repositoryRoot,
  "plugins",
  "context-continuity"
);
const sourceArtifacts = await releaseArtifactDigests(
  repositoryRoot,
  sourcePluginRoot
);
const testedArtifacts = await directoryArtifactDigest(pluginRoot);
assert.equal(
  testedArtifacts.plugin_package_sha256,
  sourceArtifacts.plugin_package_sha256,
  "The lifecycle plugin package is not byte-identical to the release candidate."
);
const modeIndex = process.argv.indexOf("--mode");
const outputIndex = process.argv.indexOf("--output");
const mode = modeIndex >= 0 ? process.argv[modeIndex + 1] : "manual";
const outputPath = outputIndex >= 0
  ? path.resolve(repositoryRoot, process.argv[outputIndex + 1])
  : null;
assert.ok(["manual", "auto"].includes(mode), "Mode must be manual or auto.");

const temporaryBase = process.env.CONTEXT_CONTINUITY_TEST_TMP || os.tmpdir();
await fs.mkdir(temporaryBase, { recursive: true });
const scratch = await fs.mkdtemp(path.join(
  temporaryBase,
  "context-continuity-real-" + mode + "-"
));
const cwd = path.join(scratch, "workspace");
const dataRoot = path.join(scratch, "plugin-data");
await fs.mkdir(cwd, { recursive: true });

const pluginHooks = JSON.parse(await fs.readFile(
  path.join(pluginRoot, "hooks", "hooks.json"),
  "utf8"
));
const rootToken = "$" + "{PLUGIN_ROOT}";
for (const definitions of Object.values(pluginHooks.hooks)) {
  for (const definition of definitions) {
    for (const hook of definition.hooks) {
      hook.command = hook.command.replaceAll(
        rootToken,
        pluginRoot.replaceAll("\\", "/")
      );
      hook.commandWindows = hook.commandWindows.replaceAll(
        rootToken,
        pluginRoot.replaceAll("\\", "/")
      );
    }
  }
}

class JsonLineRpc {
  constructor(child) {
    this.child = child;
    this.nextId = 1;
    this.pending = new Map();
    this.notifications = [];
    this.waiters = [];
    this.buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      this.buffer += chunk;
      let newline = this.buffer.indexOf("\n");
      while (newline >= 0) {
        const line = this.buffer.slice(0, newline).trim();
        this.buffer = this.buffer.slice(newline + 1);
        if (line) {
          this.accept(JSON.parse(line));
        }
        newline = this.buffer.indexOf("\n");
      }
    });
  }

  accept(message) {
    if (Object.hasOwn(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(Object.assign(
          new Error(message.error.message || "App Server request failed."),
          { rpc_error: message.error }
        ));
      } else {
        pending.resolve(message.result);
      }
      return;
    }
    if (message.method && Object.hasOwn(message, "id")) {
      this.child.stdin.write(JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32000,
          message: "Lifecycle validation does not approve server-initiated actions."
        }
      }) + "\n");
      return;
    }
    if (message.method) {
      this.notifications.push(message);
      const remaining = [];
      for (const waiter of this.waiters) {
        if (waiter.predicate(message)) {
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        } else {
          remaining.push(waiter);
        }
      }
      this.waiters = remaining;
    }
  }

  request(method, params, timeoutMs = 120000) {
    const id = this.nextId;
    this.nextId += 1;
    this.child.stdin.write(JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params
    }) + "\n");
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Timed out waiting for " + method));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  notify(method, params = undefined) {
    const message = { jsonrpc: "2.0", method };
    if (params !== undefined) {
      message.params = params;
    }
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  waitFor(predicate, timeoutMs = 120000) {
    const existing = this.notifications.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        predicate,
        resolve,
        reject,
        timer: null
      };
      waiter.timer = setTimeout(() => {
        this.waiters = this.waiters.filter((candidate) => candidate !== waiter);
        reject(new Error("Timed out waiting for App Server notification."));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }
}

function turnCompletedFor(threadId, turnId) {
  return (message) => message.method === "turn/completed"
    && message.params?.threadId === threadId
    && (!turnId || message.params?.turn?.id === turnId);
}

function compactionItems(notifications) {
  return notifications
    .filter((message) =>
      ["item/started", "item/completed"].includes(message.method)
      && message.params?.item?.type === "contextCompaction")
    .map((message) => ({
      notification: message.method,
      thread_id: message.params.threadId,
      turn_id: message.params.turnId,
      item_id: message.params.item.id,
      item_type: message.params.item.type
    }));
}

function hookRuns(notifications) {
  return notifications
    .filter((message) => message.method === "hook/completed")
    .map((message) => ({
      event_name: message.params?.run?.eventName,
      status: message.params?.run?.status,
      source: message.params?.run?.source,
      scope: message.params?.run?.scope,
      duration_ms: message.params?.run?.durationMs
    }));
}

async function waitForTurn(rpc, threadId, response) {
  const turnId = response?.turn?.id || null;
  await rpc.waitFor(turnCompletedFor(threadId, turnId), 180000);
  return turnId;
}

const startedAt = new Date().toISOString();
const codexCommand = process.env.CONTEXT_CONTINUITY_CODEX_BIN || "codex";
const appArgs = [
  "app-server",
  "--stdio",
  "-c",
  "features.hooks=true"
];
if (mode === "auto") {
  appArgs.push(
    "-c",
    "model_context_window=8192",
    "-c",
    "model_auto_compact_token_limit=1200",
    "-c",
    "model_auto_compact_token_limit_scope=\"body_after_prefix\""
  );
}
const child = spawn(codexCommand, appArgs, {
  cwd,
  env: {
    ...process.env,
    CONTEXT_CONTINUITY_DATA_DIR: dataRoot
  },
  stdio: ["pipe", "pipe", "pipe"]
});
let stderr = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const closed = new Promise((resolve) => child.on("close", resolve));
const rpc = new JsonLineRpc(child);
let receipt;

try {
  await rpc.request("initialize", {
    clientInfo: {
      name: "context-continuity-lifecycle-validator",
      version: "0.1.0"
    },
    capabilities: {
      experimentalApi: true
    }
  });
  rpc.notify("initialized");

  const hookListing = await rpc.request("hooks/list", { cwds: [cwd] });
  const preexistingHookEntries = hookListing.data.flatMap((entry) => entry.hooks);
  const unexpected = preexistingHookEntries.filter((entry) =>
    entry.enabled && !entry.isManaged && entry.source !== "plugin");
  assert.deepEqual(
    unexpected.map((entry) => ({
      source_path: entry.sourcePath,
      event_name: entry.eventName,
      trust_status: entry.trustStatus
    })),
    [],
    "Unrelated unmanaged Hooks would run under the thread trust bypass."
  );

  const threadResponse = await rpc.request("thread/start", {
    cwd,
    ephemeral: true,
    model: "gpt-5.4-mini",
    plugin_runtime: pluginRuntime,
    approvalPolicy: "never",
    sandbox: "read-only",
    config: {
      bypass_hook_trust: true,
      features: {
        plugins: false
      },
      hooks: pluginHooks.hooks
    },
    baseInstructions: "This is a lifecycle validation. Do not use tools. Keep every answer under five words."
  });
  const threadId = threadResponse.thread.id;
  const initialPrompt = [
    "Goal: Validate Context Continuity across a real Codex compaction.",
    "Constraint: Do not install, publish, or change global Codex configuration.",
    "Authorization: A read-only scratch App Server run is authorized.",
    "Work object: " + cwd + ".",
    "Next: Compact, restore, and verify the same next action.",
    "Reply exactly READY."
  ].join(" ");
  const firstTurn = await rpc.request("turn/start", {
    threadId,
    input: [{ type: "text", text: initialPrompt }],
    effort: "low",
    sandboxPolicy: {
      type: "readOnly",
      networkAccess: false
    }
  });
  await waitForTurn(rpc, threadId, firstTurn);

  const service = new ContinuityService({
    dataRootInfo: {
      path: dataRoot,
      durable: true,
      source: "real-app-server-validation"
    }
  });
  const taskRef = taskRefForSession(threadId);
  const observedState = await service.getState({
    task_ref: taskRef,
    create_if_missing: false
  });
  const sourceEventId = observedState.pending_prompt_signals[0]?.event_id;
  assert.ok(sourceEventId, "The real UserPromptSubmit Hook did not persist a source event.");
  const items = [
    {
      id: "objective:real-lifecycle",
      kind: "objective",
      statement: "Validate Context Continuity across a real Codex compaction.",
      authority: "user",
      verification: "verified"
    },
    {
      id: "constraint:real-lifecycle",
      kind: "hard_constraint",
      statement: "Do not install, publish, or change global Codex configuration.",
      authority: "user",
      verification: "verified"
    },
    {
      id: "authorization:real-lifecycle",
      kind: "authorization",
      statement: "A read-only scratch App Server run is authorized.",
      authority: "user",
      verification: "verified"
    },
    {
      id: "work:real-lifecycle",
      kind: "work_object",
      statement: cwd,
      authority: "user",
      verification: "verified"
    },
    {
      id: "next:real-lifecycle",
      kind: "next_action",
      statement: "Compact, restore, and verify the same next action.",
      authority: "user",
      verification: "verified"
    }
  ];
  const prepared = await service.prepareStateConfirmation({
    task_ref: taskRef,
    expected_generation: observedState.generation,
    resolve_prompt_event_ids: [sourceEventId],
    items
  });
  assert.match(prepared.confirmation_prompt, /objective:real-lifecycle/);
  const confirmationTurn = await rpc.request("turn/start", {
    threadId,
    input: [{ type: "text", text: prepared.confirmation_prompt }],
    effort: "low",
    sandboxPolicy: {
      type: "readOnly",
      networkAccess: false
    }
  });
  await waitForTurn(rpc, threadId, confirmationTurn);
  const confirmationLedger = (await service.store.readLedger(
    taskRef,
    false
  )).ledger;
  const confirmationEvent = [...confirmationLedger.events].reverse().find((event) =>
    event.event_type === "prompt_signal_observed"
      && event.payload?.prompt_length === prepared.confirmation_prompt.length
      && event.payload?.prompt_sha256 === sha256(prepared.confirmation_prompt));
  assert.ok(confirmationEvent, "The exact readable state confirmation was not observed.");
  await service.recordState({
    task_ref: taskRef,
    expected_generation: observedState.generation,
    source_event_id: confirmationEvent.event_id,
    resolve_prompt_event_ids: [sourceEventId],
    items
  });

  if (mode === "manual") {
    await rpc.request("thread/compact/start", { threadId }, 180000);
    const completedCompaction = await rpc.waitFor((message) =>
      message.method === "item/completed"
      && message.params?.threadId === threadId
      && message.params?.item?.type === "contextCompaction",
    180000);
    await rpc.waitFor(
      turnCompletedFor(threadId, completedCompaction.params?.turnId),
      180000
    );
  } else {
    const filler = "bounded continuity filler ".repeat(500);
    const autoTurn = await rpc.request("turn/start", {
      threadId,
      input: [{
        type: "text",
        text: "Continue this validation. "
          + filler
          + " Reply exactly AUTO."
      }],
      effort: "low",
      sandboxPolicy: {
        type: "readOnly",
        networkAccess: false
      }
    });
    await waitForTurn(rpc, threadId, autoTurn);
  }

  const compactionsBeforeRestore = compactionItems(rpc.notifications);
  if (compactionsBeforeRestore.length > 0) {
    const finalTurn = await rpc.request("turn/start", {
      threadId,
      input: [{
        type: "text",
        text: "Continue from the recorded next safe action. Reply exactly CONTINUITY_OK."
      }],
      effort: "low",
      sandboxPolicy: {
        type: "readOnly",
        networkAccess: false
      }
    });
    await waitForTurn(rpc, threadId, finalTurn);
  }

  const finalState = await service.getState({
    task_ref: taskRef,
    create_if_missing: false
  });
  const ledger = JSON.parse(await fs.readFile(
    service.store.ledgerPath(taskRef),
    "utf8"
  ));
  const lifecycleEvents = ledger.events
    .filter((event) => [
      "snapshot_created",
      "compaction_completed",
      "restore_checked"
    ].includes(event.event_type))
    .map((event) => ({
      sequence: event.sequence,
      event_type: event.event_type,
      source_ref: event.source_ref,
      trigger: event.payload?.trigger || null,
      classification: event.payload?.classification || null
    }));
  const compactItems = compactionItems(rpc.notifications);
  const publicCompactItems = compactItems.map((entry) => ({
    notification: entry.notification,
    thread_id_sha256: sha256(entry.thread_id),
    turn_id_sha256: sha256(entry.turn_id),
    item_id_sha256: sha256(entry.item_id),
    item_type: entry.item_type
  }));
  const completedItem = compactItems.some((entry) =>
    entry.notification === "item/completed");
  const expectedTrigger = mode === "manual" ? "manual" : "auto";
  const ledgerLoop = ["snapshot_created", "compaction_completed", "restore_checked"]
    .every((eventType) =>
      lifecycleEvents.some((entry) => entry.event_type === eventType));
  const triggerMatched = lifecycleEvents
    .filter((entry) => entry.event_type !== "restore_checked")
    .every((entry) => entry.trigger === expectedTrigger);
  const objectivePresent = finalState.items.some((entry) =>
    entry.id === "objective:real-lifecycle");
  const nextActionPresent = finalState.items.some((entry) =>
    entry.id === "next:real-lifecycle");
  const nextActionRequiresRevalidation = finalState.items.some((entry) =>
    entry.id === "next:real-lifecycle" && entry.verification === "stale");
  const completedHookRuns = hookRuns(rpc.notifications);
  const unrelatedHookRan = completedHookRuns.some((entry) =>
    !["sessionFlags", "system", "mdm", "cloudRequirements", "cloudManagedConfig"]
      .includes(entry.source));
  const recoverySafe = ["equivalent", "repaired", "continue_with_markers"]
    .includes(finalState.latest_restore?.classification);
  const verified = completedItem
    && ledgerLoop
    && triggerMatched
    && objectivePresent
    && nextActionPresent
    && nextActionRequiresRevalidation
    && !unrelatedHookRan
    && recoverySafe;

  receipt = {
    schema_version: "1.0",
    run_kind: "real_codex_lifecycle",
    mode,
    verified,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    codex_version: "codex-cli 0.150.0-alpha.8",
    plugin_runtime: pluginRuntime,
    app_server_method: mode === "manual"
      ? "thread/compact/start"
      : "model_auto_compact_token_limit",
    model: "gpt-5.4-mini",
    source_tree_sha256: sourceArtifacts.source_tree_sha256,
    source_plugin_package_sha256: sourceArtifacts.plugin_package_sha256,
    plugin_package_sha256: testedArtifacts.plugin_package_sha256,
    source_tree_file_count: sourceArtifacts.source_tree_file_count,
    plugin_package_file_count: testedArtifacts.plugin_package_file_count,
    scratch_hook_config_sha256: sha256(pluginHooks),
    input_sha256: sha256(initialPrompt),
    confirmation_prompt_sha256: sha256(prepared.confirmation_prompt),
    readable_state_confirmation_used: true,
    preexisting_hook_listing: preexistingHookEntries.map((entry) => ({
      event_name: entry.eventName,
      source: entry.source,
      is_managed: entry.isManaged,
      trust_status: entry.trustStatus,
      enabled: entry.enabled
    })),
    session_hook_events_injected: Object.keys(pluginHooks.hooks),
    hook_runs: completedHookRuns,
    unrelated_hook_ran: unrelatedHookRan,
    context_compaction_items: publicCompactItems,
    ledger_lifecycle_events: lifecycleEvents,
    final_projection_digest: finalState.projection_digest,
    final_generation: finalState.generation,
    final_restore_classification: finalState.latest_restore?.classification || null,
    final_recovery_safe_to_continue: recoverySafe,
    objective_preserved: objectivePresent,
    next_action_preserved: nextActionPresent,
    next_action_requires_revalidation: nextActionRequiresRevalidation,
    prompt_or_assistant_content_in_receipt: false,
    persistent_install_or_trust_change: false,
    failure_reason: verified
      ? null
      : mode === "auto" && compactItems.length === 0
        ? "Automatic compaction did not trigger in the bounded run."
        : "The real compaction or matching Hook ledger loop was incomplete."
  };
} catch (error) {
  receipt = {
    schema_version: "1.0",
    run_kind: "real_codex_lifecycle",
    mode,
    verified: false,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    codex_version: "codex-cli 0.150.0-alpha.8",
    prompt_or_assistant_content_in_receipt: false,
    persistent_install_or_trust_change: false,
    failure_reason: error.code
      ? error.code + ": " + error.message
      : error.message,
    app_server_stderr_tail: stderr
      .split(/\r?\n/)
      .filter(Boolean)
      .slice(-5)
  };
} finally {
  child.stdin.end();
  child.kill();
  await Promise.race([
    closed,
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
  await fs.rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

const serialized = JSON.stringify(receipt, null, 2) + "\n";
if (outputPath) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, serialized, "utf8");
}
process.stdout.write(serialized);
if (!receipt.verified) {
  process.exitCode = 2;
}
