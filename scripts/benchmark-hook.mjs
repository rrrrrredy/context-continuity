import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hook = path.join(
  root,
  "plugins",
  "context-continuity",
  "hooks",
  "run.mjs"
);
const requestedRuns = Number.parseInt(
  process.argv.find((value) => value.startsWith("--runs="))?.split("=")[1]
    || "30",
  10
);
if (!Number.isInteger(requestedRuns) || requestedRuns < 5 || requestedRuns > 200) {
  throw new Error("--runs must be an integer from 5 through 200.");
}

function percentile(sorted, quantile) {
  return sorted[Math.ceil(sorted.length * quantile) - 1];
}

async function invoke(payload, environment) {
  const started = performance.now();
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [hook], {
      cwd: root,
      env: environment,
      stdio: ["pipe", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error("Hook exited " + code + ": " + stderr.trim()));
      }
    });
    child.stdin.end(JSON.stringify(payload));
  });
  return performance.now() - started;
}

const temporaryRoot = await fs.mkdtemp(
  path.join(os.tmpdir(), "context-continuity-hook-benchmark-")
);
const measurements = [];
try {
  const environment = {
    ...process.env,
    CONTEXT_CONTINUITY_DATA_DIR: temporaryRoot
  };
  for (let index = 0; index < requestedRuns; index += 1) {
    measurements.push(await invoke({
      hook_event_name: "UserPromptSubmit",
      session_id: "benchmark-session",
      turn_id: "benchmark-turn-" + index,
      cwd: root,
      prompt: "Review the current module."
    }, environment));
  }
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}

const sorted = [...measurements].sort((left, right) => left - right);
process.stdout.write(JSON.stringify({
  benchmark: "source_user_prompt_submit_process_cold_start",
  runs: sorted.length,
  platform: process.platform,
  node: process.version,
  p50_ms: Number(percentile(sorted, 0.50).toFixed(2)),
  p95_ms: Number(percentile(sorted, 0.95).toFixed(2)),
  minimum_ms: Number(sorted[0].toFixed(2)),
  maximum_ms: Number(sorted.at(-1).toFixed(2)),
  calls_extra_model: false,
  temporary_state_removed: true,
  claim_limit: "A local source-process benchmark is not installed-client or cross-platform performance evidence."
}, null, 2) + "\n");
