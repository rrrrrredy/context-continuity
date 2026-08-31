import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const testRoot = path.join(repositoryRoot, "test");
const files = (await fs.readdir(testRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join(testRoot, entry.name))
  .sort((left, right) => left.localeCompare(right, "en"));

if (files.length === 0) {
  throw new Error("No core test files were found.");
}

const child = spawn(process.execPath, [
  "--test",
  "--test-concurrency=1",
  ...files
], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
  windowsHide: true
});

child.on("error", (error) => {
  throw error;
});
child.on("close", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
