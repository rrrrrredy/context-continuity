import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { taskRefForSession } from "../plugins/context-continuity/src/service.mjs";
import { assertPathInsideReal } from "../plugins/context-continuity/src/util.mjs";
import {
  directoryArtifactDigest,
  releaseArtifactDigests
} from "./artifact-digests.mjs";
import {
  codexExecutableEvidence,
  versionToken
} from "./codex-executable-evidence.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? path.resolve(repositoryRoot, process.argv[outputIndex + 1])
  : path.join(repositoryRoot, "validation", "installed-host-read.json");
const codexCommand = process.env.CONTEXT_CONTINUITY_CODEX_BIN || "codex";
const model = process.env.CONTEXT_CONTINUITY_HOST_MODEL || "gpt-5.4-mini";
const codexExecutable = await codexExecutableEvidence(
  codexCommand, repositoryRoot);

function digest(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function codex(args, options = {}) {
  const result = spawnSync(codexExecutable.path, args, {
    cwd: options.cwd || repositoryRoot,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: options.timeout || 30000
  });
  assert.equal(
    result.error?.code,
    undefined,
    "Codex process failed to start: " + String(result.error || "")
  );
  assert.equal(
    result.status,
    0,
    String(result.stderr || result.stdout || "Codex command failed.").trim()
  );
  return result;
}

function installedPluginRoot() {
  const registration = JSON.parse(codex([
    "mcp",
    "get",
    "context_continuity",
    "--json"
  ]).stdout);
  assert.equal(registration.enabled, true);
  assert.equal(typeof registration.transport?.cwd, "string");
  return path.resolve(registration.transport.cwd);
}

function existingFileDigest(filePath) {
  return fs.readFile(filePath).then((value) => digest(value));
}

async function directoryState(root) {
  const entries = [];
  async function visit(directory) {
    let children;
    try {
      children = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") {
        return;
      }
      throw error;
    }
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      const target = path.join(directory, child.name);
      const relative = path.relative(root, target).split(path.sep).join("/");
      if (child.isSymbolicLink()) {
        entries.push({
          path: relative,
          type: "link",
          target: await fs.readlink(target)
        });
      } else if (child.isDirectory()) {
        entries.push({ path: relative, type: "directory" });
        await visit(target);
      } else if (child.isFile()) {
        const content = await fs.readFile(target);
        entries.push({
          path: relative,
          type: "file",
          bytes: content.length,
          sha256: crypto.createHash("sha256").update(content).digest("hex")
        });
      }
    }
  }
  await visit(root);
  return entries;
}

function containsPath(tree, root, candidate) {
  const relative = path.relative(root, candidate).split(path.sep).join("/");
  return tree.some((entry) => entry.path === relative
    || entry.path.startsWith(relative + "/"));
}

function parseEvents(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error("Codex JSON event " + (index + 1) + " is invalid: " + error.message);
    }
  });
}

function eventItem(event) {
  return event?.item || event?.payload?.item || null;
}

function isTargetCall(item) {
  if (!item || typeof item !== "object") {
    return false;
  }
  const server = item.server || item.server_name || item.serverName;
  const tool = item.tool || item.tool_name || item.toolName || item.name;
  return server === "context_continuity" && tool === "continuity_get_state";
}

function isMcpCall(item) {
  return item?.type === "mcp_tool_call"
    || (item && typeof item === "object"
      && (item.server || item.server_name || item.serverName)
      && (item.tool || item.tool_name || item.toolName || item.name));
}

function isAllowedSkillResourceAction(item) {
  const type = String(item?.type || "");
  if (type !== "mcp_resource_read" && type !== "mcp_resource_list") {
    return false;
  }
  const server = item.server || item.server_name || item.serverName;
  const uri = item.uri || item.resource_uri || item.resourceUri;
  return server === "context_continuity"
    && (type === "mcp_resource_list"
      || uri === "context-continuity://skill/context-continuity");
}

function isForbiddenHostAction(item) {
  const type = String(item?.type || "").toLocaleLowerCase("en-US");
  return type === "command_execution"
    || type === "file_change"
    || type.includes("web_search")
    || type.includes("browser")
    || type.includes("computer_use")
    || type.includes("image_generation")
    || (type.includes("tool_call") && !isMcpCall(item));
}

function argumentsFor(item) {
  const value = item.arguments || item.args || item.input || {};
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value;
}

const pluginRoot = installedPluginRoot();
const cacheMarker = path.sep + "plugins" + path.sep + "cache" + path.sep;
const markerIndex = pluginRoot.toLocaleLowerCase("en-US")
  .indexOf(cacheMarker.toLocaleLowerCase("en-US"));
assert.ok(markerIndex > 0, "Installed plugin root must be inside CODEX_HOME/plugins/cache.");
const inferredCodexHome = pluginRoot.slice(0, markerIndex);
const dataRoot = path.join(
  inferredCodexHome,
  "plugin-data",
  "context-continuity",
  "v1"
);
const configPath = path.join(inferredCodexHome, "config.toml");
const configBefore = await existingFileDigest(configPath).catch((error) => {
  if (error.code === "ENOENT") {
    return null;
  }
  throw error;
});

const sourceArtifacts = await releaseArtifactDigests(
  repositoryRoot,
  path.join(repositoryRoot, "plugins", "context-continuity")
);
const installedArtifacts = await directoryArtifactDigest(pluginRoot);
assert.equal(
  installedArtifacts.plugin_package_sha256,
  sourceArtifacts.plugin_package_sha256,
  "The installed package is not byte-identical to the release candidate."
);
const manifest = JSON.parse(await fs.readFile(
  path.join(pluginRoot, ".codex-plugin", "plugin.json"),
  "utf8"
));

const taskRef = "codex:installed-host-read-" + crypto.randomUUID();
const taskKey = digest(taskRef).slice(0, 32);
const taskDirectory = path.join(dataRoot, "tasks", taskKey);
const dataTreeBefore = await directoryState(dataRoot);
await assert.rejects(
  fs.access(taskDirectory),
  (error) => error.code === "ENOENT"
);

const cleanupTargets = [taskDirectory];
try {
const prompt = "Use Context Continuity. If its state tool is not yet exposed, "
  + "list and read only the context-continuity MCP Skill resource to load its "
  + "instructions. Then call continuity_get_state exactly once with JSON argument "
  + JSON.stringify({ task_ref: taskRef, limit: 8 }) + ". Do not search the web, "
  + "browse, run shell commands, read files, call unrelated tools, or modify files. "
  + "Return only the structured state result.";
const run = codex([
  "exec",
  "--ephemeral",
  "--json",
  "--skip-git-repo-check",
  "-s",
  "read-only",
  "-m",
  model,
  "-c",
  "model_reasoning_effort=\"high\"",
  "-c",
  "web_search=\"disabled\"",
  "-C",
  repositoryRoot,
  prompt
], { timeout: 180000 });
const events = parseEvents(run.stdout);
const threadIds = new Set(events
  .filter((event) => event.type === "thread.started")
  .map((event) => event.thread_id)
  .filter(Boolean));
assert.equal(threadIds.size, 1, "The real Codex turn did not expose one thread ID.");
const threadId = [...threadIds][0];
const hookTaskRef = taskRefForSession(threadId);
const hookTaskDirectory = path.join(dataRoot, "tasks", digest(hookTaskRef).slice(0, 32));
cleanupTargets.push(hookTaskDirectory);
const observedItems = events
  .map((event) => ({ event, item: eventItem(event) }))
  .filter(({ item }) => item && typeof item === "object");
const mcpCalls = observedItems.filter(({ item }) => isMcpCall(item));
assert.equal(
  mcpCalls.every(({ item }) => isTargetCall(item)),
  true,
  "The real Codex turn called an MCP tool outside the one allowed read."
);
const forbiddenActions = observedItems.filter(({ item }) =>
  isForbiddenHostAction(item)
    || ((item.type === "mcp_resource_read" || item.type === "mcp_resource_list")
      && !isAllowedSkillResourceAction(item)));
assert.deepEqual(forbiddenActions, [],
  "The real Codex turn used a shell, file, network, unrelated tool, or unrelated resource action.");
const calls = mcpCalls.filter(({ item }) => isTargetCall(item));
assert.ok(calls.length >= 1, "The real Codex turn did not call continuity_get_state.");
const callIds = new Set(calls.map(({ item }, index) => item.id || "call:" + index));
assert.equal(callIds.size, 1, "The real Codex turn called continuity_get_state more than once.");
assert.ok(calls.some(({ item }) => argumentsFor(item).task_ref === taskRef),
  "The real Codex turn did not use the exact synthetic task_ref.");
const completed = calls.some(({ event, item }) =>
  String(event.type || "").toLocaleLowerCase("en-US").includes("completed")
    || String(item.status || "").toLocaleLowerCase("en-US") === "completed"
    || item.result !== undefined);
assert.equal(completed, true, "The installed MCP call did not complete.");

await assert.rejects(
  fs.access(taskDirectory),
  (error) => error.code === "ENOENT"
);
await assert.rejects(
  fs.access(hookTaskDirectory),
  (error) => error.code === "ENOENT"
);
const dataTreeAfter = await directoryState(dataRoot);
assert.deepEqual(
  dataTreeAfter,
  dataTreeBefore,
  "The installed host read changed the Context Continuity data tree."
);
const configAfter = await existingFileDigest(configPath).catch((error) => {
  if (error.code === "ENOENT") {
    return null;
  }
  throw error;
});
assert.equal(configAfter, configBefore, "The host probe changed persistent Codex configuration.");
const version = String(codex(["--version"]).stdout).trim();
const codexVersionToken = versionToken(version);
assert.ok(codexVersionToken, "The tested Codex version token is missing.");

const receipt = {
  schema_version: "1.0",
  run_kind: "real_codex_installed_read",
  verified: true,
  verified_at: new Date().toISOString(),
  codex_version: version,
  codex_version_token: codexVersionToken,
  codex_executable_sha256: codexExecutable.sha256,
  codex_executable_path_sha256: codexExecutable.path_sha256,
  all_codex_invocations_use_resolved_executable: true,
  plugin_version: manifest.version,
  model,
  source_tree_sha256: sourceArtifacts.source_tree_sha256,
  source_plugin_package_sha256: sourceArtifacts.plugin_package_sha256,
  plugin_package_sha256: installedArtifacts.plugin_package_sha256,
  source_tree_file_count: sourceArtifacts.source_tree_file_count,
  plugin_package_file_count: installedArtifacts.plugin_package_file_count,
  ephemeral_thread: true,
  sandbox: "read-only",
  mcp_server: "context_continuity",
  mcp_tool: "continuity_get_state",
  mcp_call_count: callIds.size,
  mcp_call_completed: completed,
  observed_thread_id_sha256: digest(threadId),
  observed_mcp_action_count: callIds.size,
  observed_skill_resource_action_count: observedItems.filter(({ item }) =>
    isAllowedSkillResourceAction(item)).length,
  unauthorized_action_count: 0,
  generation: 0,
  item_count: 0,
  data_root_source: "installed_cache",
  data_root_durable: true,
  physical_read_created_task_state: false,
  plugin_data_tree_unchanged: true,
  plugin_data_tree_sha256: digest(JSON.stringify(dataTreeBefore)),
  plugin_data_tree_entry_count: dataTreeBefore.length,
  persistent_hook_trust_change: false,
  codex_configuration_unchanged: true,
  prompt_or_assistant_content_in_receipt: false,
  input_sha256: digest(prompt),
  task_ref_sha256: digest(taskRef)
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n", "utf8");
process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
} finally {
  for (const candidate of cleanupTargets) {
    if (!containsPath(dataTreeBefore, dataRoot, candidate)) {
      try {
        await assertPathInsideReal(dataRoot, candidate);
        await fs.rm(candidate, { recursive: true, force: true });
      } catch (error) {
        if (error.code !== "ENOENT") {
          throw error;
        }
      }
    }
  }
}
