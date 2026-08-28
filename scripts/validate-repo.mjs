import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MAX_ACTIVE_ITEMS,
  MAX_HANDOFF_BYTES,
  MAX_LEDGER_BYTES,
  MAX_PROMPT_EXCERPT_CHARS,
  MAX_SNAPSHOT_BYTES,
  MAX_STATE_ITEMS_PER_WRITE,
  MAX_TOKEN_BUDGET,
  SNAPSHOT_RETENTION
} from "../plugins/context-continuity/src/constants.mjs";
import { releaseArtifactDigests } from "./artifact-digests.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pluginPrefix = "plugins/context-continuity";
const pluginPath = (relative) => pluginPrefix + "/" + relative;
const required = [
  "README.md",
  "README.zh-CN.md",
  "AGENTS.md",
  ".gitattributes",
  ".agents/plugins/marketplace.json",
  pluginPath(".codex-plugin/plugin.json"),
  pluginPath(".mcp.json"),
  pluginPath("hooks/hooks.json"),
  pluginPath("hooks/run.mjs"),
  pluginPath("skills/context-continuity/SKILL.md"),
  pluginPath("src/mcp-server.mjs"),
  pluginPath("LICENSE"),
  "LICENSE",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
  "SUPPORT.md",
  "CHANGELOG.md",
  ".github/CODEOWNERS",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ".github/ISSUE_TEMPLATE/feature_request.yml",
  ".github/ISSUE_TEMPLATE/config.yml",
  ".github/workflows/ci.yml",
  "spec/task-state-item.schema.json",
  "spec/ledger.schema.json",
  "spec/snapshot.schema.json",
  "spec/handoff-capsule.schema.json",
  "spec/execution-guard-view.schema.json",
  "spec/evaluation-result.schema.json",
  "evals/cases.json",
  "validation/README.md",
  "validation/real-manual.json",
  "validation/real-auto.json",
  "validation/installed-package.json",
  "validation/installed-host-read.json",
  "validation/real-installed-manual.json",
  "validation/real-installed-auto.json",
  "docs/product-contract.md",
  "docs/integration-contracts.md",
  "docs/prd.md",
  "docs/usage.md",
  "docs/privacy.md",
  "docs/evaluation.md",
  "docs/architecture.md",
  "docs/open-source.md",
  "docs/implementation-status.md",
  "docs/release-readiness.md",
  "docs/release-notes-v0.1.0.md",
  "docs/user-pilot-2026-08-29.md",
  "docs/platform/codex-capability-2026-08-28.md",
  "scripts/benchmark-hook.mjs",
  "scripts/artifact-digests.mjs",
  "scripts/verify-installed-host-read.mjs"
];

for (const relative of required) {
  const information = await fs.stat(path.join(root, relative));
  assert.ok(information.isFile(), "Required file is not a file: " + relative);
}

const jsonFiles = [
  ".agents/plugins/marketplace.json",
  pluginPath(".codex-plugin/plugin.json"),
  pluginPath(".mcp.json"),
  pluginPath("hooks/hooks.json"),
  "package.json",
  "spec/task-state-item.schema.json",
  "spec/ledger.schema.json",
  "spec/snapshot.schema.json",
  "spec/handoff-capsule.schema.json",
  "spec/execution-guard-view.schema.json",
  "spec/evaluation-result.schema.json",
  "evals/cases.json",
  "validation/real-manual.json",
  "validation/real-auto.json",
  "validation/installed-package.json",
  "validation/installed-host-read.json",
  "validation/real-installed-manual.json",
  "validation/real-installed-auto.json"
];
const parsed = new Map();
for (const relative of jsonFiles) {
  const value = JSON.parse(await fs.readFile(path.join(root, relative), "utf8"));
  parsed.set(relative, value);
}

const sourcePluginRoot = path.join(root, pluginPrefix);
const artifactDigests = await releaseArtifactDigests(root, sourcePluginRoot);

function assertReceiptArtifactBinding(receipt, relative) {
  assert.match(receipt.source_tree_sha256 || "", /^[a-f0-9]{64}$/,
    relative + " is missing source_tree_sha256.");
  assert.match(receipt.source_plugin_package_sha256 || "", /^[a-f0-9]{64}$/,
    relative + " is missing source_plugin_package_sha256.");
  assert.match(receipt.plugin_package_sha256 || "", /^[a-f0-9]{64}$/,
    relative + " is missing plugin_package_sha256.");
  assert.equal(receipt.source_tree_sha256, artifactDigests.source_tree_sha256,
    relative + " does not bind the current release source tree.");
  assert.equal(
    receipt.source_plugin_package_sha256,
    artifactDigests.plugin_package_sha256,
    relative + " does not bind the current source plugin package."
  );
  assert.equal(receipt.plugin_package_sha256, artifactDigests.plugin_package_sha256,
    relative + " was not produced from a byte-identical plugin package.");
}

const marketplace = parsed.get(".agents/plugins/marketplace.json");
const manifest = parsed.get(pluginPath(".codex-plugin/plugin.json"));
const packageJson = parsed.get("package.json");
assert.equal(manifest.name, packageJson.name);
assert.equal(manifest.version, packageJson.version);
assert.equal(manifest.skills, "./skills/");
assert.equal(manifest.mcpServers, "./.mcp.json");
assert.equal(Object.hasOwn(manifest, "marketplace"), false);
assert.equal(packageJson.license, "Apache-2.0");
assert.equal(packageJson.private, true);
assert.equal(packageJson.repository.url,
  "git+https://github.com/rrrrrredy/context-continuity.git");
const rootLicense = await fs.readFile(path.join(root, "LICENSE"), "utf8");
const packagedLicense = await fs.readFile(
  path.join(root, pluginPath("LICENSE")),
  "utf8"
);
assert.equal(packagedLicense, rootLicense);
assert.equal(marketplace.name, "context-continuity");
assert.equal(marketplace.interface.displayName, "Context Continuity");
const marketplaceEntry = marketplace.plugins.find((entry) =>
  entry.name === "context-continuity");
assert.ok(marketplaceEntry);
assert.equal(marketplaceEntry.source.source, "local");
assert.equal(marketplaceEntry.source.path, "./plugins/context-continuity");
assert.equal(marketplaceEntry.policy.installation, "AVAILABLE");
assert.equal(marketplaceEntry.policy.authentication, "ON_INSTALL");
assert.equal(marketplaceEntry.category, "Productivity");

const mcp = parsed.get(pluginPath(".mcp.json"));
const server = mcp.mcpServers?.context_continuity;
assert.ok(server);
assert.deepEqual(server.args, ["src/mcp-server.mjs"]);
assert.equal(server.cwd, ".");
assert.equal(Object.hasOwn(server, "env"), false);

const hooks = parsed.get(pluginPath("hooks/hooks.json")).hooks;
const expectedHooks = [
  "SessionStart",
  "UserPromptSubmit",
  "PreCompact",
  "PostCompact",
  "SubagentStart",
  "SubagentStop",
  "SessionEnd"
];
assert.deepEqual(Object.keys(hooks).sort(), expectedHooks.sort());
for (const definitions of Object.values(hooks)) {
  for (const definition of definitions) {
    for (const hook of definition.hooks) {
      assert.equal(hook.type, "command");
      assert.match(hook.command, /\$\{PLUGIN_ROOT\}\/hooks\/run\.mjs/);
      assert.ok(hook.timeout <= 10);
      if (hook.additionalContextLimit !== undefined) {
        assert.ok(hook.additionalContextLimit <= 1800);
      }
    }
  }
}

const cases = parsed.get("evals/cases.json").cases;
assert.equal(cases.length, 30);
assert.equal(new Set(cases.map((testCase) => testCase.id)).size, 30);
const categoryCounts = Object.fromEntries(
  [...new Set(cases.map((testCase) => testCase.category))]
    .map((category) => [
      category,
      cases.filter((testCase) => testCase.category === category).length
    ])
);
for (const category of [
  "automatic_compaction",
  "repeated_compaction",
  "user_goal_change",
  "user_correction",
  "unresolved_disagreement",
  "long_pause_resume",
  "cross_agent_handoff",
  "erroneous_summary",
  "superseded_information",
  "raw_conversation_unavailable"
]) {
  assert.equal(categoryCounts[category], 2, "Expected two cases for " + category);
}
assert.equal(categoryCounts.compound, 10);
for (const testCase of cases) {
  assert.ok(testCase.goal);
  assert.ok(testCase.work_object);
  assert.ok(testCase.next_action);
  assert.ok(["manual", "auto"].includes(testCase.transition.trigger));
  assert.ok(testCase.transition.repeats >= 1);
}

for (const [relative, mode] of [
  ["validation/real-manual.json", "manual"],
  ["validation/real-auto.json", "auto"]
]) {
  const receipt = parsed.get(relative);
  assertReceiptArtifactBinding(receipt, relative);
  assert.equal(receipt.run_kind, "real_codex_lifecycle");
  assert.equal(receipt.mode, mode);
  assert.equal(receipt.verified, true);
  assert.equal(receipt.final_restore_classification, "continue_with_markers");
  assert.equal(receipt.final_recovery_safe_to_continue, true);
  assert.equal(receipt.objective_preserved, true);
  assert.equal(receipt.next_action_preserved, true);
  assert.equal(receipt.next_action_requires_revalidation, true);
  assert.equal(receipt.readable_state_confirmation_used, true);
  assert.equal(receipt.prompt_or_assistant_content_in_receipt, false);
  assert.equal(receipt.persistent_install_or_trust_change, false);
  assert.equal(receipt.unrelated_hook_ran, false);
}

for (const [relative, mode, minimumCompactions] of [
  ["validation/real-installed-manual.json", "manual", 1],
  ["validation/real-installed-auto.json", "auto", 2]
]) {
  const receipt = parsed.get(relative);
  assertReceiptArtifactBinding(receipt, relative);
  assert.equal(receipt.run_kind, "real_codex_lifecycle");
  assert.equal(receipt.mode, mode);
  assert.equal(receipt.verified, true);
  assert.equal(receipt.plugin_runtime, "installed_cache");
  assert.equal(receipt.final_restore_classification, "continue_with_markers");
  assert.equal(receipt.final_recovery_safe_to_continue, true);
  assert.equal(receipt.objective_preserved, true);
  assert.equal(receipt.next_action_preserved, true);
  assert.equal(receipt.next_action_requires_revalidation, true);
  assert.equal(receipt.readable_state_confirmation_used, true);
  assert.equal(receipt.prompt_or_assistant_content_in_receipt, false);
  assert.equal(receipt.persistent_install_or_trust_change, false);
  const completed = receipt.context_compaction_items.filter((entry) =>
    entry.notification === "item/completed");
  assert.ok(completed.length >= minimumCompactions);
}

const installedPackage = parsed.get("validation/installed-package.json");
assertReceiptArtifactBinding(installedPackage, "validation/installed-package.json");
assert.equal(installedPackage.run_kind, "installed_package_e2e");
assert.equal(installedPackage.verified, true);
assert.equal(installedPackage.mcp_namespace, "context_continuity");
assert.equal(installedPackage.mcp_tool_count, 8);
assert.equal(installedPackage.mcp_resource_count, 1);
assert.equal(installedPackage.readable_state_confirmation_used, true);
assert.equal(installedPackage.physical_read_created_task_state, false);
assert.equal(installedPackage.cross_process_state_recovered, true);
assert.equal(installedPackage.raw_secret_marker_persisted_before_delete, false);
assert.equal(installedPackage.two_stage_task_delete_succeeded, true);
assert.equal(installedPackage.task_bytes_remain_after_delete, false);
assert.equal(installedPackage.installed_license_equals_source, true);
assert.equal(installedPackage.prompt_or_assistant_content_in_receipt, false);
assert.equal(installedPackage.persistent_hook_trust_change, false);

const installedHost = parsed.get("validation/installed-host-read.json");
assertReceiptArtifactBinding(installedHost, "validation/installed-host-read.json");
assert.equal(installedHost.run_kind, "real_codex_installed_read");
assert.equal(installedHost.verified, true);
assert.equal(installedHost.ephemeral_thread, true);
assert.equal(installedHost.sandbox, "read-only");
assert.equal(installedHost.mcp_server, "context_continuity");
assert.equal(installedHost.mcp_tool, "continuity_get_state");
assert.equal(installedHost.mcp_call_completed, true);
assert.equal(installedHost.mcp_call_count, 1);
assert.match(installedHost.observed_thread_id_sha256 || "", /^[a-f0-9]{64}$/);
assert.equal(installedHost.observed_mcp_action_count, 1);
assert.ok(Number.isInteger(installedHost.observed_skill_resource_action_count));
assert.ok(installedHost.observed_skill_resource_action_count >= 0);
assert.equal(installedHost.unauthorized_action_count, 0);
assert.equal(installedHost.data_root_source, "installed_cache");
assert.equal(installedHost.physical_read_created_task_state, false);
assert.equal(installedHost.plugin_data_tree_unchanged, true);
assert.match(installedHost.plugin_data_tree_sha256 || "", /^[a-f0-9]{64}$/);
assert.ok(Number.isInteger(installedHost.plugin_data_tree_entry_count));
assert.ok(installedHost.plugin_data_tree_entry_count >= 0);
assert.equal(installedHost.persistent_hook_trust_change, false);
assert.equal(installedHost.codex_configuration_unchanged, true);
assert.equal(installedHost.prompt_or_assistant_content_in_receipt, false);

const runtimeFiles = [
  pluginPath("src/constants.mjs"),
  pluginPath("src/model.mjs"),
  pluginPath("src/recovery.mjs"),
  pluginPath("src/service.mjs"),
  pluginPath("src/hook-handler.mjs"),
  pluginPath("src/store.mjs"),
  pluginPath("hooks/run.mjs")
];
const runtimeText = (await Promise.all(runtimeFiles.map((relative) =>
  fs.readFile(path.join(root, relative), "utf8")))).join("\n");
assert.doesNotMatch(runtimeText, /transcript_path/);
assert.doesNotMatch(runtimeText, /hidden.reasoning|chain.of.thought/i);
assert.equal(MAX_PROMPT_EXCERPT_CHARS, 512);
assert.equal(MAX_TOKEN_BUDGET, 1500);
assert.equal(SNAPSHOT_RETENTION, 3);
assert.equal(MAX_STATE_ITEMS_PER_WRITE, 64);
assert.equal(MAX_ACTIVE_ITEMS, 128);
assert.equal(MAX_HANDOFF_BYTES, 256 * 1024);
assert.equal(MAX_SNAPSHOT_BYTES, 512 * 1024);
assert.equal(MAX_LEDGER_BYTES, 8 * 1024 * 1024);

process.stdout.write(JSON.stringify({
  valid: true,
  plugin: manifest.name + "@" + manifest.version,
  required_files: required.length,
  parsed_json_files: jsonFiles.length,
  verified_lifecycle_receipts: [
    "manual",
    "auto",
    "installed-package",
    "installed-host-read",
    "installed-manual",
    "installed-auto"
  ],
  hook_events: expectedHooks,
  evaluation_cases: cases.length,
  category_counts: categoryCounts,
  privacy_limits: {
    prompt_excerpt_chars: MAX_PROMPT_EXCERPT_CHARS,
    maximum_recovery_tokens: MAX_TOKEN_BUDGET,
    snapshot_retention: SNAPSHOT_RETENTION,
    maximum_items_per_write: MAX_STATE_ITEMS_PER_WRITE,
    maximum_active_items: MAX_ACTIVE_ITEMS,
    maximum_handoff_bytes: MAX_HANDOFF_BYTES,
    maximum_snapshot_bytes: MAX_SNAPSHOT_BYTES,
    maximum_ledger_bytes: MAX_LEDGER_BYTES
  },
  artifact_digests: artifactDigests
}, null, 2) + "\n");
