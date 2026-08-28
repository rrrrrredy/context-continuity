import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveDataRoot } from "../plugins/context-continuity/src/util.mjs";

test("explicit continuity data directory has highest priority", () => {
  const result = resolveDataRoot({
    CONTEXT_CONTINUITY_DATA_DIR: "D:\\explicit",
    CODEX_HOME: "D:\\codex-home",
    PLUGIN_DATA: "D:\\plugin-data"
  });
  assert.equal(result.path, path.resolve("D:\\explicit"));
  assert.equal(result.source, "CONTEXT_CONTINUITY_DATA_DIR");
  assert.equal(result.durable, true);
});

test("Codex home gives Hook and MCP a stable shared directory", () => {
  const result = resolveDataRoot({
    CODEX_HOME: "D:\\codex-home",
    PLUGIN_DATA: "D:\\plugin-data"
  });
  assert.equal(result.path, path.join(path.resolve("D:\\codex-home"),
    "plugin-data", "context-continuity", "v1"));
  assert.equal(result.source, "CODEX_HOME");
  assert.equal(result.durable, true);
});

test("plugin-provided directory remains a compatible fallback", () => {
  const result = resolveDataRoot({ PLUGIN_DATA: "D:\\plugin-data" });
  assert.equal(result.path, path.resolve("D:\\plugin-data"));
  assert.equal(result.source, "PLUGIN_DATA");
  assert.equal(result.durable, true);
});

test("installed cache path safely recovers the Codex home when env is sanitized", () => {
  const fakeCodexHome = path.join(path.parse(process.cwd()).root, "codex-home");
  const entryPoint = path.join(
    fakeCodexHome,
    "plugins",
    "cache",
    "market",
    "context-continuity",
    "src",
    "mcp-server.mjs"
  );
  const result = resolveDataRoot({}, entryPoint);
  assert.equal(result.path, path.join(
    fakeCodexHome,
    "plugin-data",
    "context-continuity",
    "v1"
  ));
  assert.equal(result.source, "installed_cache");
  assert.equal(result.durable, true);
});

test("missing persistent directory is visibly volatile", () => {
  const result = resolveDataRoot(
    {},
    path.join(path.parse(process.cwd()).root, "source", "server.mjs")
  );
  assert.equal(result.source, "volatile_fallback");
  assert.equal(result.durable, false);
});
