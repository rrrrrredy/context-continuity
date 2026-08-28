import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  directoryArtifactDigest,
  releaseArtifactDigests
} from "./artifact-digests.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pluginRootIndex = process.argv.indexOf("--plugin-root");
const outputIndex = process.argv.indexOf("--output");

function discoverInstalledPluginRoot() {
  const codexCommand = process.env.CONTEXT_CONTINUITY_CODEX_BIN || "codex";
  const result = spawnSync(
    codexCommand,
    ["mcp", "get", "context_continuity", "--json"],
    {
      encoding: "utf8",
      windowsHide: true
    }
  );
  assert.equal(
    result.status,
    0,
    "Context Continuity must be installed, or pass --plugin-root explicitly. "
      + String(result.stderr || "").trim()
  );
  const registration = JSON.parse(result.stdout);
  assert.ok(
    registration.enabled === true
      && typeof registration.transport?.cwd === "string",
    "The installed context_continuity MCP registration has no enabled cwd."
  );
  return path.resolve(registration.transport.cwd);
}

const pluginRoot = pluginRootIndex >= 0 && process.argv[pluginRootIndex + 1]
  ? path.resolve(process.argv[pluginRootIndex + 1])
  : discoverInstalledPluginRoot();
const outputPath = outputIndex >= 0
  ? path.resolve(repositoryRoot, process.argv[outputIndex + 1])
  : path.join(repositoryRoot, "validation", "installed-package.json");
const marker = path.sep + "plugins" + path.sep + "cache" + path.sep;
const markerIndex = pluginRoot.toLocaleLowerCase("en-US")
  .indexOf(marker.toLocaleLowerCase("en-US"));
assert.ok(markerIndex > 0, "Installed plugin root must be inside CODEX_HOME/plugins/cache.");
const inferredCodexHome = pluginRoot.slice(0, markerIndex);
const dataRoot = path.join(
  inferredCodexHome,
  "plugin-data",
  "context-continuity",
  "v1"
);
const serverPath = path.join(pluginRoot, "src", "mcp-server.mjs");
const hookPath = path.join(pluginRoot, "hooks", "run.mjs");
const skillPath = path.join(
  pluginRoot,
  "skills",
  "context-continuity",
  "SKILL.md"
);
const sourceSkillPath = path.join(
  repositoryRoot,
  "plugins",
  "context-continuity",
  "skills",
  "context-continuity",
  "SKILL.md"
);
const installedLicensePath = path.join(pluginRoot, "LICENSE");
const sourceLicensePath = path.join(repositoryRoot, "LICENSE");
const sourcePluginRoot = path.join(
  repositoryRoot,
  "plugins",
  "context-continuity"
);
const sourceArtifacts = await releaseArtifactDigests(
  repositoryRoot,
  sourcePluginRoot
);
const installedArtifacts = await directoryArtifactDigest(pluginRoot);
assert.equal(
  installedArtifacts.plugin_package_sha256,
  sourceArtifacts.plugin_package_sha256,
  "The installed cache package is not byte-identical to the release candidate."
);
const manifest = JSON.parse(await fs.readFile(
  path.join(pluginRoot, ".codex-plugin", "plugin.json"),
  "utf8"
));
const temporaryBase = process.env.CONTEXT_CONTINUITY_TEST_TMP || os.tmpdir();
await fs.mkdir(temporaryBase, { recursive: true });
const scratch = await fs.mkdtemp(path.join(
  temporaryBase,
  "context-continuity-installed-"
));
const workspace = path.join(scratch, "workspace");
await fs.mkdir(workspace, { recursive: true });

function sanitizedEnvironment() {
  const environment = { ...process.env };
  for (const key of [
    "CODEX_HOME",
    "PLUGIN_DATA",
    "CLAUDE_PLUGIN_DATA",
    "CONTEXT_CONTINUITY_DATA_DIR"
  ]) {
    delete environment[key];
  }
  return environment;
}

function runProcess(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
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
        reject(new Error(
          "Installed process failed with code " + code + ": " + stderr
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin.end(options.stdin || "");
  });
}

async function callMcp(messages) {
  const result = await runProcess(process.execPath, [serverPath], {
    cwd: pluginRoot,
    env: sanitizedEnvironment(),
    stdin: messages.map((message) => JSON.stringify(message)).join("\n") + "\n"
  });
  const responses = result.stdout.trim().split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return new Map(responses.map((response) => [response.id, response]));
}

async function runHook(payload) {
  const result = await runProcess(process.execPath, [hookPath], {
    cwd: pluginRoot,
    env: sanitizedEnvironment(),
    stdin: JSON.stringify(payload)
  });
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

async function filesBelow(directory) {
  const files = [];
  async function visit(current) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(target);
      } else {
        files.push(target);
      }
    }
  }
  await visit(directory);
  return files;
}

function digest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

const sessionId = "installed-e2e-" + crypto.randomUUID();
const taskRef = "codex:" + digest(sessionId).slice(0, 32);
const taskKey = digest(taskRef).slice(0, 32);
const taskDirectory = path.join(dataRoot, "tasks", taskKey);
const secretMarker = "e2e-secret-" + crypto.randomBytes(18).toString("hex");

try {
  const initial = await callMcp([
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "installed-package-check", version: "1" }
      }
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "continuity_get_state",
        arguments: { task_ref: taskRef }
      }
    }
  ]);
  assert.equal(initial.get(1).result.serverInfo.name, "context-continuity");
  assert.equal(initial.get(2).result.structuredContent.generation, 0);
  await assert.rejects(
    fs.access(taskDirectory),
    (error) => error.code === "ENOENT"
  );

  const promptOutput = await runHook({
    session_id: sessionId,
    turn_id: "installed-e2e-prompt",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    prompt: "Goal: Verify the installed continuity package. "
      + "Constraint: Do not publish during the installed-package check. "
      + "Next: Restart the MCP process and verify the same state. "
      + "password=" + secretMarker
  });
  const context = promptOutput.hookSpecificOutput.additionalContext;
  const sourceEventId = /source_event_id: ([^\s]+)/.exec(context)?.[1];
  assert.ok(sourceEventId);

  const items = [
    {
      id: "objective:installed-e2e",
      kind: "objective",
      statement: "Verify the installed continuity package.",
      authority: "user",
      verification: "verified"
    },
    {
      id: "constraint:installed-e2e",
      kind: "hard_constraint",
      statement: "Do not publish during the installed-package check.",
      authority: "user",
      verification: "verified"
    },
    {
      id: "next:installed-e2e",
      kind: "next_action",
      statement: "Restart the MCP process and verify the same state.",
      authority: "user",
      verification: "verified"
    }
  ];
  const prepared = await callMcp([
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "continuity_prepare_confirmation",
        arguments: {
          task_ref: taskRef,
          expected_generation: 0,
          resolve_prompt_event_ids: [sourceEventId],
          items
        }
      }
    }
  ]);
  const confirmation = prepared.get(3).result.structuredContent;
  assert.match(confirmation.confirmation_prompt, /objective:installed-e2e/);
  assert.match(confirmation.confirmation_prompt, /Do not publish/);
  const confirmationOutput = await runHook({
    session_id: sessionId,
    turn_id: "installed-e2e-state-confirmation",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    prompt: confirmation.confirmation_prompt
  });
  const confirmationEventId = /source_event_id: ([^\s]+)/.exec(
    confirmationOutput.hookSpecificOutput.additionalContext
  )?.[1];
  assert.ok(confirmationEventId);

  const write = await callMcp([
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: {
        name: "continuity_record_state",
        arguments: {
          task_ref: taskRef,
          expected_generation: 0,
          source_event_id: confirmationEventId,
          resolve_prompt_event_ids: [sourceEventId],
          items
        }
      }
    }
  ]);
  assert.equal(write.get(4).result.structuredContent.generation, 1);

  const restarted = await callMcp([
    {
      jsonrpc: "2.0",
      id: 5,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "installed-package-restart", version: "1" }
      }
    },
    {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/list",
      params: {}
    },
    {
      jsonrpc: "2.0",
      id: 7,
      method: "resources/list",
      params: {}
    },
    {
      jsonrpc: "2.0",
      id: 8,
      method: "resources/read",
      params: {
        uri: "context-continuity://skill/context-continuity"
      }
    },
    {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: {
        name: "continuity_get_state",
        arguments: { task_ref: taskRef }
      }
    }
  ]);
  const restored = restarted.get(9).result.structuredContent;
  assert.equal(restored.generation, 1);
  assert.equal(restored.items.length, 3);
  assert.equal(restored.storage.source, "installed_cache");
  assert.equal(restarted.get(6).result.tools.length, 8);
  assert.equal(restarted.get(7).result.resources.length, 1);
  const resourceText = restarted.get(8).result.contents[0].text;
  const installedSkill = await fs.readFile(skillPath, "utf8");
  const sourceSkill = await fs.readFile(sourceSkillPath, "utf8");
  assert.equal(resourceText, installedSkill);
  assert.equal(installedSkill, sourceSkill);
  const installedLicense = await fs.readFile(installedLicensePath, "utf8");
  const sourceLicense = await fs.readFile(sourceLicensePath, "utf8");
  assert.equal(installedLicense, sourceLicense);

  const persistedFiles = await filesBelow(taskDirectory);
  const persistedText = (await Promise.all(
    persistedFiles.map((file) => fs.readFile(file, "utf8"))
  )).join("\n");
  assert.equal(persistedText.includes(secretMarker), false);

  const deleteRequestOutput = await runHook({
    session_id: sessionId,
    turn_id: "installed-e2e-delete-request",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    prompt: "Delete continuity state for this task."
  });
  const deleteRequestEventId = /source_event_id: ([^\s]+)/.exec(
    deleteRequestOutput.hookSpecificOutput.additionalContext
  )?.[1];
  assert.ok(deleteRequestEventId);
  const preparedDelete = await callMcp([
    {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: {
        name: "continuity_manage_state",
        arguments: {
          task_ref: taskRef,
          action: "prepare_delete",
          source_event_id: deleteRequestEventId
        }
      }
    }
  ]);
  const challenge = preparedDelete.get(10).result.structuredContent;
  assert.equal(challenge.action, "delete");
  assert.ok(challenge.challenge_token);
  assert.ok(challenge.confirmation_phrase);

  const deleteConfirmationOutput = await runHook({
    session_id: sessionId,
    turn_id: "installed-e2e-delete-confirmation",
    cwd: workspace,
    hook_event_name: "UserPromptSubmit",
    prompt: challenge.confirmation_phrase
  });
  const deleteConfirmationEventId = /source_event_id: ([^\s]+)/.exec(
    deleteConfirmationOutput.hookSpecificOutput.additionalContext
  )?.[1];
  assert.ok(deleteConfirmationEventId);
  const deleted = await callMcp([
    {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "continuity_manage_state",
        arguments: {
          task_ref: taskRef,
          action: "delete",
          challenge_token: challenge.challenge_token,
          source_event_id: deleteConfirmationEventId
        }
      }
    }
  ]);
  assert.equal(deleted.get(11).result.structuredContent.deleted, true);
  await assert.rejects(
    fs.access(taskDirectory),
    (error) => error.code === "ENOENT"
  );
  const remainingFiles = await filesBelow(dataRoot);
  const remainingText = (await Promise.all(
    remainingFiles.map((file) => fs.readFile(file, "utf8"))
  )).join("\n");
  assert.equal(remainingText.includes(taskRef), false);
  assert.equal(remainingText.includes(secretMarker), false);
  assert.equal(remainingText.includes(digest(secretMarker).slice(0, 12)), false);

  const versionOutput = spawnSync("codex", ["--version"], {
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(versionOutput.status, 0);
  const receipt = {
    schema_version: "1.0",
    run_kind: "installed_package_e2e",
    verified: true,
    verified_at: new Date().toISOString(),
    codex_version: String(versionOutput.stdout).trim(),
    plugin_version: manifest.version,
    source_tree_sha256: sourceArtifacts.source_tree_sha256,
    source_plugin_package_sha256: sourceArtifacts.plugin_package_sha256,
    plugin_package_sha256: installedArtifacts.plugin_package_sha256,
    source_tree_file_count: sourceArtifacts.source_tree_file_count,
    plugin_package_file_count: installedArtifacts.plugin_package_file_count,
    installed_cache_layout: true,
    mcp_namespace: "context_continuity",
    mcp_tool_count: 8,
    mcp_resource_count: 1,
    skill_resource_equals_installed_file: true,
    installed_skill_equals_source_file: true,
    installed_license_equals_source: true,
    physical_read_created_task_state: false,
    user_prompt_hook_observed: true,
    readable_state_confirmation_used: true,
    cross_process_state_recovered: true,
    restored_item_count: 3,
    data_root_source: "installed_cache",
    raw_secret_marker_persisted_before_delete: false,
    two_stage_task_delete_succeeded: true,
    task_bytes_remain_after_delete: false,
    prompt_or_assistant_content_in_receipt: false,
    persistent_hook_trust_change: false,
    task_ref_sha256: digest(taskRef)
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
  process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
} finally {
  await fs.rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50
  });
}
