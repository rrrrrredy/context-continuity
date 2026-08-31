import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseArtifactDigests } from "./artifact-digests.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? path.resolve(repositoryRoot, process.argv[outputIndex + 1])
  : path.join(repositoryRoot, "validation", "dsh-real-lifecycle.json");
const testPath = path.join(
  repositoryRoot,
  "adapters",
  "deepseek-harness",
  "test",
  "adapter.test.mjs"
);
const testName =
  "published DSH host APIs carry confirmed state through a validated compaction";

function runTest(observationPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--test",
      "--test-concurrency=1",
      "--test-name-pattern",
      "^" + testName + "$",
      testPath
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        CONTEXT_CONTINUITY_DSH_OBSERVATION_PATH: observationPath
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(
          "DSH lifecycle test failed with code " + code + ": " + stderr.trim()
        ));
        return;
      }
      resolve(stdout);
    });
  });
}

const observationRoot = await fs.mkdtemp(path.join(
  os.tmpdir(),
  "context-continuity-dsh-observation-"
));
const observationPath = path.join(observationRoot, "observation.json");
let stdout;
let observation;
try {
  stdout = await runTest(observationPath);
  assert.match(stdout, /# pass 1/);
  assert.match(stdout, /# fail 0/);
  observation = JSON.parse(await fs.readFile(
    observationPath,
    "utf8"
  ));
} finally {
  await fs.rm(observationRoot, { recursive: true, force: true, maxRetries: 5 });
}
assert.equal(observation.schema_version, "1.0");
assert.equal(observation.native_tool_count, 8);
for (const field of [
  "native_tool_confirmation_completed",
  "validated_session_compaction_events_completed",
  "pre_step_recovery_injected",
  "stale_next_action_removed_from_guard_view",
  "trusted_inbox_source_bound_without_model_argument",
  "summary_content_ignored_as_truth"
]) {
  assert.equal(
    observation[field],
    true,
    "DSH lifecycle observation failed: " + field
  );
}

async function packageVersion(name) {
  const manifest = JSON.parse(await fs.readFile(
    path.join(repositoryRoot, "node_modules", ...name.split("/"), "package.json"),
    "utf8"
  ));
  return manifest.version;
}

const packageJson = JSON.parse(await fs.readFile(
  path.join(repositoryRoot, "package.json"),
  "utf8"
));
const sourcePluginRoot = path.join(
  repositoryRoot,
  "plugins",
  "context-continuity"
);
const artifacts = await releaseArtifactDigests(repositoryRoot, sourcePluginRoot);
const receipt = {
  schema_version: "1.0",
  run_kind: "dsh_published_host_api_lifecycle",
  verified: true,
  verified_at: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  node_version: process.version,
  package_version: packageJson.version,
  source_tree_sha256: artifacts.source_tree_sha256,
  source_plugin_package_sha256: artifacts.plugin_package_sha256,
  host_packages: {
    cordis: await packageVersion("@deepseek-ai/cordis"),
    agent: await packageVersion("@deepseek-ai/dsh-agent"),
    llm: await packageVersion("@deepseek-ai/dsh-llm"),
    session: await packageVersion("@deepseek-ai/dsh-session"),
    system_prompt: await packageVersion("@deepseek-ai/dsh-system-prompt"),
    tools: await packageVersion("@deepseek-ai/dsh-tools")
  },
  native_tool_confirmation_completed: observation.native_tool_confirmation_completed,
  validated_session_compaction_events_completed:
    observation.validated_session_compaction_events_completed,
  pre_step_recovery_injected: observation.pre_step_recovery_injected,
  stale_next_action_removed_from_guard_view:
    observation.stale_next_action_removed_from_guard_view,
  trusted_inbox_source_bound_without_model_argument:
    observation.trusted_inbox_source_bound_without_model_argument,
  platform_summary_ignored_as_truth: observation.summary_content_ignored_as_truth,
  automatic_compaction_engine_triggered: false,
  dsh_cli_profile_install_exercised: false,
  persistent_dsh_profile_changed: false,
  prompt_or_assistant_content_in_receipt: false
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n");
process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
