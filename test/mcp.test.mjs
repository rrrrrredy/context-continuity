import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import {
  MAX_MCP_RESPONSE_BYTES,
  McpRuntime,
  StdioMessageParser
} from "../plugins/context-continuity/src/mcp-server.mjs";
import { taskRefForSession } from "../plugins/context-continuity/src/service.mjs";
import {
  createHarness,
  observePrompt,
  observeUserConfirmation
} from "./helpers.mjs";

test("MCP runtime exposes the bounded continuity tool surface", async (t) => {
  const harness = await createHarness(t, "mcp-runtime");
  const runtime = new McpRuntime(harness.service);
  const initialized = await runtime.handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18"
    }
  });
  assert.equal(initialized.serverInfo.name, "context-continuity");
  const listed = await runtime.handle({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  });
  const names = listed.tools.map((tool) => tool.name);
  assert.ok(names.includes("continuity_get_state"));
  assert.ok(names.includes("continuity_prepare_confirmation"));
  assert.ok(names.includes("continuity_manage_state"));
  assert.equal(names.includes("continuity_bind_intent_contract"), false);
  assert.equal(names.length, 8);
  assert.equal(names.includes("memory_search"), false);
  const stateTool = listed.tools.find((tool) =>
    tool.name === "continuity_get_state");
  assert.equal(stateTool.annotations.readOnlyHint, true);
  const manageTool = listed.tools.find((tool) =>
    tool.name === "continuity_manage_state");
  assert.match(
    manageTool.inputSchema.properties.challenge_token.description,
    /including the literal challenge: prefix/
  );
  assert.equal(
    manageTool.inputSchema.properties.challenge_token.pattern.startsWith("^challenge:"),
    true
  );
  const prepareTool = listed.tools.find((tool) =>
    tool.name === "continuity_prepare_confirmation");
  const preparedItem = prepareTool.inputSchema.properties.items.items;
  assert.equal(preparedItem.required.includes("authority"), false);
  assert.equal(preparedItem.required.includes("verification"), false);
  const recordTool = listed.tools.find((tool) =>
    tool.name === "continuity_record_state");
  const recordItem = recordTool.inputSchema.properties.items.items;
  assert.equal(recordItem.oneOf.length, 2);
  assert.equal(JSON.stringify(recordItem).includes("verified_evidence"), false);
  const inferenceBranch = recordItem.oneOf.find(
    (schema) => schema.properties.authority.const === "agent_inference"
  );
  assert.equal(inferenceBranch.properties.verification.enum.includes("verified"), false);
});

test("MCP get_state is a physical read and returns an ephemeral empty projection", async (t) => {
  const harness = await createHarness(t, "mcp-read-only-state");
  const runtime = new McpRuntime(harness.service);
  const result = await runtime.handle({
    method: "tools/call",
    params: {
      name: "continuity_get_state",
      arguments: {
        task_ref: "codex:read-only-state"
      }
    }
  });
  assert.equal(result.structuredContent.generation, 0);
  assert.equal(result.structuredContent.items.length, 0);
  assert.match(result.content[0].text, /Context Continuity state page/);
  assert.match(result.content[0].text, /"generation": 0/);
  assert.match(result.content[0].text, /"items": \[\]/);
  await assert.rejects(
    fs.access(harness.dataRoot),
    (error) => error.code === "ENOENT"
  );
});

test("MCP management prepare exposes and safely reissues its confirmation in text", async (t) => {
  const harness = await createHarness(t, "mcp-visible-management-challenge");
  const runtime = new McpRuntime(harness.service);
  const sessionId = "mcp-visible-management-challenge";
  const taskRef = taskRefForSession(sessionId);
  const observed = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "Disable continuity for this task."
  );
  const request = {
    method: "tools/call",
    params: {
      name: "continuity_manage_state",
      arguments: {
        task_ref: taskRef,
        action: "prepare_off",
        source_event_id: observed.source_event_id
      }
    }
  };
  const first = await runtime.handle(request);
  assert.equal(first.isError, false);
  assert.ok(first.content[0].text.includes(first.structuredContent.confirmation_phrase));
  assert.ok(first.content[0].text.includes(first.structuredContent.challenge_token));
  assert.match(first.content[0].text, /including its literal challenge: prefix/);
  assert.match(first.content[0].text, /Never search logs, transcripts, caches/);
  const second = await runtime.handle(request);
  assert.equal(second.isError, false);
  assert.equal(second.structuredContent.reissued, true);
  assert.notEqual(
    second.structuredContent.challenge_token,
    first.structuredContent.challenge_token
  );
  assert.ok(second.content[0].text.includes(second.structuredContent.confirmation_phrase));
  assert.ok(Buffer.byteLength(JSON.stringify(second), "utf8") <= MAX_MCP_RESPONSE_BYTES);
});

test("MCP exposes the exact bundled Skill as a read-only fallback resource", async (t) => {
  const harness = await createHarness(t, "mcp-skill-resource");
  const runtime = new McpRuntime(harness.service);
  const listed = await runtime.handle({
    method: "resources/list",
    params: {}
  });
  assert.equal(listed.resources.length, 1);
  assert.equal(
    listed.resources[0].uri,
    "context-continuity://skill/context-continuity"
  );
  const read = await runtime.handle({
    method: "resources/read",
    params: {
      uri: "context-continuity://skill/context-continuity"
    }
  });
  const expected = await fs.readFile(
    path.resolve(
      "plugins/context-continuity/skills/context-continuity/SKILL.md"
    ),
    "utf8"
  );
  assert.equal(read.contents[0].text, expected);
});

test("MCP state writes use the same service and generation contract", async (t) => {
  const harness = await createHarness(t, "mcp-write");
  const runtime = new McpRuntime(harness.service);
  const sessionId = "mcp-write-session";
  const taskRef = taskRefForSession(sessionId);
  const items = [
    {
      id: "objective:mcp",
      kind: "objective",
      statement: "Build the minimum continuity plugin.",
      authority: "user",
      verification: "verified"
    }
  ];
  const confirmation = await observeUserConfirmation(
    harness.service,
    harness.cwd,
    sessionId,
    items
  );
  const result = await runtime.handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "continuity_record_state",
      arguments: {
        task_ref: taskRef,
        expected_generation: 0,
        source_event_id: confirmation.observed.source_event_id,
        items
      }
    }
  });
  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.generation, 1);
});

test("MCP confirmation tools infer fixed user authority fields without weakening exact binding", async (t) => {
  const harness = await createHarness(t, "mcp-implicit-user-fields");
  const runtime = new McpRuntime(harness.service);
  const sessionId = "mcp-implicit-user-fields";
  const taskRef = taskRefForSession(sessionId);
  const publicItems = [{
    id: "objective:implicit",
    kind: "objective",
    statement: "Protect the exact confirmed objective."
  }];
  const prepared = await runtime.callTool("continuity_prepare_confirmation", {
    task_ref: taskRef,
    expected_generation: 0,
    items: publicItems
  });
  const unrelated = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    "This is not the exact generated confirmation."
  );
  await assert.rejects(
    runtime.callTool("continuity_record_state", {
      task_ref: taskRef,
      expected_generation: 0,
      source_event_id: unrelated.source_event_id,
      items: publicItems
    }),
    (error) => error.code === "USER_SEMANTIC_CONFIRMATION_REQUIRED"
  );
  const confirmed = await observePrompt(
    harness.service,
    harness.cwd,
    sessionId,
    prepared.confirmation_prompt
  );
  const result = await runtime.callTool("continuity_record_state", {
    task_ref: taskRef,
    expected_generation: 0,
    source_event_id: confirmed.source_event_id,
    items: publicItems
  });
  assert.equal(result.generation, 1);
  const state = await harness.service.getState({ task_ref: taskRef });
  assert.equal(state.items[0].authority, "user");
  assert.equal(state.items[0].verification, "verified");
});

test("stdio parser accepts both NDJSON and Content-Length frames", async () => {
  const received = [];
  const parser = new StdioMessageParser(async (message, framing) => {
    received.push({ message, framing });
  });
  await parser.push(Buffer.from("{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n"));
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list"
  });
  const frame = "Content-Length: " + Buffer.byteLength(body)
    + "\r\n\r\n" + body;
  await parser.push(Buffer.from(frame));
  assert.equal(received.length, 2);
  assert.equal(received[0].framing, "ndjson");
  assert.equal(received[1].framing, "content-length");
});

test("spawned MCP server completes initialize and tools/list over NDJSON", async (t) => {
  const harness = await createHarness(t, "mcp-process");
  const serverPath = path.resolve("plugins/context-continuity/src/mcp-server.mjs");
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      CONTEXT_CONTINUITY_DATA_DIR: harness.dataRoot
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  t.after(() => {
    if (!child.killed) {
      child.kill();
    }
  });
  const responses = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        responses.push(JSON.parse(line));
      }
    }
  });
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-06-18"
    }
  }) + "\n");
  child.stdin.write(JSON.stringify({
    jsonrpc: "2.0",
    id: 2,
    method: "tools/list",
    params: {}
  }) + "\n");
  const deadline = Date.now() + 3000;
  while (responses.length < 2 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(responses.length, 2);
  assert.equal(responses[0].result.serverInfo.name, "context-continuity");
  assert.equal(responses[1].result.tools.length, 8);
  child.stdin.end();
});

test("spawned MCP server bounds adversarial error responses on the wire", async (t) => {
  const harness = await createHarness(t, "mcp-error-wire-budget");
  const serverPath = path.resolve("plugins/context-continuity/src/mcp-server.mjs");
  const child = spawn(process.execPath, [serverPath], {
    cwd: path.resolve("."),
    env: {
      ...process.env,
      CONTEXT_CONTINUITY_DATA_DIR: harness.dataRoot
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true
  });
  t.after(() => {
    if (!child.killed) {
      child.kill();
    }
  });
  const responses = [];
  const wireBytes = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        wireBytes.push(Buffer.byteLength(line, "utf8"));
        responses.push(JSON.parse(line));
      }
    }
  });
  const huge = "MCP-ERROR-MARKER-" + "x".repeat(200000);
  const requests = [
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "continuity_record_state",
        arguments: {
          task_ref: "codex:error-kind",
          expected_generation: 0,
          items: [{
            id: "candidate:kind",
            kind: huge,
            statement: "Candidate.",
            authority: "agent_inference",
            verification: "unverified",
            confidence: 0.1
          }]
        }
      }
    },
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: {
        name: "continuity_get_state",
        arguments: { task_ref: huge }
      }
    },
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "continuity_record_state",
        arguments: {
          task_ref: "codex:error-item-id",
          expected_generation: 0,
          items: [{
            id: huge,
            kind: "assumption",
            statement: "Candidate.",
            authority: "agent_inference",
            verification: "unverified",
            confidence: 0.1
          }]
        }
      }
    },
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: huge, arguments: {} }
    }
  ];
  for (const request of requests) {
    child.stdin.write(JSON.stringify(request) + "\n");
  }
  const deadline = Date.now() + 10000;
  while (responses.length < requests.length && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.equal(responses.length, requests.length);
  assert.equal(responses.every((response) => response.result?.isError === true), true);
  assert.equal(wireBytes.every((bytes) => bytes <= MAX_MCP_RESPONSE_BYTES), true);
  assert.equal(JSON.stringify(responses).includes(huge), false);
  child.stdin.end();
});
