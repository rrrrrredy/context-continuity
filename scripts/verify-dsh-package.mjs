import assert from "node:assert/strict";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { releaseArtifactDigests } from "./artifact-digests.mjs";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outputIndex = process.argv.indexOf("--output");
const outputPath = outputIndex >= 0
  ? path.resolve(repositoryRoot, process.argv[outputIndex + 1])
  : path.join(repositoryRoot, "validation", "dsh-package.json");
const temporaryBase = process.env.CONTEXT_CONTINUITY_TEST_TMP || os.tmpdir();

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env || process.env,
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
          path.basename(executable) + " failed with code " + code + ": "
            + stderr.trim()
        ));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function runNpm(args, options = {}) {
  if (process.env.npm_execpath) {
    return run(process.execPath, [process.env.npm_execpath, ...args], options);
  }
  if (process.platform === "win32") {
    const npmCli = path.join(
      path.dirname(process.execPath),
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    );
    try {
      await fs.access(npmCli);
    } catch {
      throw new Error(
        "Direct verification could not locate npm-cli.js beside node.exe. "
          + "Run npm run verify:dsh:package instead."
      );
    }
    return run(process.execPath, [npmCli, ...args], options);
  }
  return run("npm", args, options);
}

await fs.mkdir(temporaryBase, { recursive: true });
const scratch = await fs.mkdtemp(path.join(
  temporaryBase,
  "context-continuity-dsh-package-"
));
let receipt;

try {
  const packDirectory = path.join(scratch, "pack");
  const consumer = path.join(scratch, "consumer");
  await fs.mkdir(packDirectory, { recursive: true });
  await fs.mkdir(consumer, { recursive: true });

  const packResult = await runNpm([
    "pack",
    "--json",
    "--pack-destination",
    packDirectory
  ], { cwd: repositoryRoot });
  const packed = JSON.parse(packResult.stdout);
  assert.equal(packed.length, 1, "npm pack must produce exactly one tarball.");
  const metadata = packed[0];
  const tarballPath = path.join(packDirectory, metadata.filename);
  const tarball = await fs.readFile(tarballPath);
  const packedPaths = new Set(metadata.files.map((entry) => entry.path));
  const requiredPaths = [
    "package.json",
    "LICENSE",
    "README.md",
    "README.zh-CN.md",
    "adapters/deepseek-harness/index.js",
    "adapters/deepseek-harness/cordis.patch.yml",
    "plugins/context-continuity/.codex-plugin/plugin.json",
    "plugins/context-continuity/src/service.mjs"
  ];
  for (const required of requiredPaths) {
    assert.ok(packedPaths.has(required), "Tarball is missing " + required);
  }

  await fs.writeFile(path.join(consumer, "package.json"), JSON.stringify({
    name: "context-continuity-dsh-package-check",
    version: "0.0.0",
    private: true
  }, null, 2) + "\n");
  await runNpm([
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    tarballPath
  ], { cwd: consumer });

  const installedRoot = path.join(
    consumer,
    "node_modules",
    "context-continuity"
  );
  const installedManifest = JSON.parse(await fs.readFile(
    path.join(installedRoot, "package.json"),
    "utf8"
  ));
  const installedPatch = await fs.readFile(
    path.join(installedRoot, "adapters", "deepseek-harness", "cordis.patch.yml"),
    "utf8"
  );
  const installedModule = await import(
    pathToFileURL(path.join(
      installedRoot,
      "adapters",
      "deepseek-harness",
      "index.js"
    )).href + "?package-check=" + Date.now()
  );

  assert.equal(installedManifest.name, "context-continuity");
  assert.equal(installedManifest.private, true);
  assert.equal(
    installedManifest.dsh?.bundle?.patch,
    "./adapters/deepseek-harness/cordis.patch.yml"
  );
  assert.deepEqual(installedManifest.dependencies || {}, {});
  assert.deepEqual(installedManifest.peerDependencies, {
    "@deepseek-ai/dsh-llm": "0.1.1-rc.2",
    "@deepseek-ai/dsh-tools": "0.1.1-rc.2"
  });
  assert.match(installedPatch, /id: context-continuity/);
  assert.match(installedPatch, /name: context-continuity/);
  assert.equal(installedModule.name, "context-continuity");
  assert.deepEqual(installedModule.inject, ["agents", "systemPrompt", "tools"]);
  assert.equal(typeof installedModule.apply, "function");

  const sourcePluginRoot = path.join(
    repositoryRoot,
    "plugins",
    "context-continuity"
  );
  const artifacts = await releaseArtifactDigests(repositoryRoot, sourcePluginRoot);
  receipt = {
    schema_version: "1.0",
    run_kind: "dsh_isolated_package_install",
    verified: true,
    verified_at: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    node_version: process.version,
    package_version: installedManifest.version,
    dsh_compatibility: "0.1.1-rc.2",
    source_tree_sha256: artifacts.source_tree_sha256,
    source_plugin_package_sha256: artifacts.plugin_package_sha256,
    npm_tarball_sha256: sha256(tarball),
    npm_tarball_integrity: metadata.integrity,
    npm_tarball_file_count: metadata.files.length,
    npm_tarball_unpacked_bytes: metadata.unpackedSize,
    required_files_verified: requiredPaths.length,
    bundle_patch_verified: true,
    installed_module_imported: true,
    host_runtime_dependencies_are_peers: true,
    install_scripts_executed: false,
    persistent_dsh_profile_changed: false,
    global_install_changed: false,
    prompt_or_assistant_content_in_receipt: false
  };
} finally {
  await fs.rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 100
  });
}

assert.ok(receipt, "DSH package verification did not produce a receipt.");
await assert.rejects(fs.access(scratch), (error) => error.code === "ENOENT");
receipt.scratch_removed = true;
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, JSON.stringify(receipt, null, 2) + "\n");
process.stdout.write(JSON.stringify(receipt, null, 2) + "\n");
