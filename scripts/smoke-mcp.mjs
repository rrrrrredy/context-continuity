import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pluginRoot = path.join(root, "plugins", "context-continuity");
const temporaryBase = process.env.CONTEXT_CONTINUITY_TEST_TMP || os.tmpdir();
await fs.mkdir(temporaryBase, { recursive: true });
const scratch = await fs.mkdtemp(path.join(temporaryBase, "context-continuity-mcp-"));
const dataRoot = path.join(scratch, "data");

try {
  const child = spawn(process.execPath, [path.join(pluginRoot, "src", "mcp-server.mjs")], {
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
  const completed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error("MCP process failed: " + stderr));
        return;
      }
      resolve();
    });
  });
  const messages = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "smoke", version: "1.0" }
      }
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
      params: {}
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/list",
      params: {}
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: {
        uri: "context-continuity://skill/context-continuity"
      }
    },
    {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "continuity_get_state",
        arguments: {
          task_ref: "codex:mcp-smoke"
        }
      }
    }
  ];
  child.stdin.end(messages.map((message) => JSON.stringify(message)).join("\n") + "\n");
  await completed;
  const responses = stdout.trim().split(/\r?\n/).map((line) => JSON.parse(line));
  assert.equal(responses.length, 5);
  const byId = new Map(responses.map((response) => [response.id, response]));
  assert.equal(byId.get(1).result.serverInfo.name, "context-continuity");
  const tools = byId.get(2).result.tools;
  assert.equal(tools.length, 8);
  assert.ok(tools.some((tool) => tool.name === "continuity_get_state"));
  assert.ok(tools.some((tool) => tool.name === "continuity_prepare_confirmation"));
  assert.equal(
    tools.some((tool) => tool.name === "continuity_bind_intent_contract"),
    false
  );
  const recordTool = tools.find((tool) => tool.name === "continuity_record_state");
  assert.equal("provider" in recordTool.inputSchema.properties, false);
  assert.equal("evidence_provider_token" in recordTool.inputSchema.properties, false);
  assert.equal(
    byId.get(5).result.structuredContent.task_ref,
    "codex:mcp-smoke"
  );
  assert.equal(byId.get(3).result.resources.length, 1);
  assert.match(
    byId.get(4).result.contents[0].text,
    /^---\r?\nname: context-continuity/m
  );
  process.stdout.write(JSON.stringify({
    passed: true,
    framing: "ndjson",
    tool_count: tools.length,
    state_round_trip: true,
    skill_resource_round_trip: true
  }, null, 2) + "\n");
} finally {
  await fs.rm(scratch, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50
  });
}
