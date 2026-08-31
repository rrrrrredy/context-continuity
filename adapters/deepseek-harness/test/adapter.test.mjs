import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import AgentRegistry, { agentEvents } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { Session, SessionId } from "@deepseek-ai/dsh-session";
import SystemPrompt from "@deepseek-ai/dsh-system-prompt";
import ToolRuntime from "@deepseek-ai/dsh-tools";
import {
  DshContinuityAdapter,
  apply,
  inject,
  resolveDshDataRoot
} from "../index.js";
import {
  taskRefForHostSession,
  taskRefForSession
} from "../../../plugins/context-continuity/src/service.mjs";

function logger() {
  return {
    warnings: [],
    warn(message) {
      this.warnings.push(String(message));
    }
  };
}

function agent(id = "session-one", cwd = "/workspace") {
  return {
    id,
    session: {
      id,
      header: { cwd }
    }
  };
}

function context() {
  return { logger: logger() };
}

test("host task references are opaque and namespace separated", () => {
  const codex = taskRefForSession("same-session");
  const dsh = taskRefForHostSession("dsh", "same-session");
  assert.match(codex, /^codex:[a-f0-9]{32}$/);
  assert.match(dsh, /^dsh:[a-f0-9]{32}$/);
  assert.notEqual(codex, dsh);
  assert.throws(
    () => taskRefForHostSession("DSH", "session"),
    /host_name must be a lowercase namespace/
  );
});

test("DSH data stays under its own home unless an explicit override exists", () => {
  assert.deepEqual(
    resolveDshDataRoot({ DSH_HOME: "/dsh-home" }, "/home/user"),
    {
      path: path.resolve("/dsh-home", "plugin-data", "context-continuity", "v1"),
      durable: true,
      source: "DSH_HOME"
    }
  );
  const explicit = resolveDshDataRoot({
    DSH_HOME: "/ignored",
    CONTEXT_CONTINUITY_DATA_DIR: "/continuity"
  }, "/home/user");
  assert.equal(
    explicit.path,
    path.resolve("/continuity")
  );
  assert.equal(explicit.source, "CONTEXT_CONTINUITY_DATA_DIR");
});

test("native DSH tools bind the live session and reject model-supplied task refs", async () => {
  const ctx = context();
  const adapter = new DshContinuityAdapter(ctx, {});
  adapter.runtime = {
    async callTool(name, args) {
      return { name, args };
    }
  };
  const definitions = adapter.toolDefinitions();
  assert.equal(definitions.length, 8);
  const state = definitions.find((definition) =>
    definition.name === "continuity_get_state");
  assert.ok(state);
  assert.equal(Object.hasOwn(state.parameters.properties, "task_ref"), false);
  for (const name of [
    "continuity_record_state",
    "continuity_correct_state",
    "continuity_manage_state"
  ]) {
    const definition = definitions.find((entry) => entry.name === name);
    assert.equal(Object.hasOwn(definition.parameters.properties, "source_event_id"), false);
  }
  const current = agent("tool-session", "/tool-workspace");
  const result = await state.execute({}, {
    agent: current,
    signal: new AbortController().signal
  });
  assert.equal(
    result.args.task_ref,
    taskRefForHostSession("dsh", "tool-session")
  );
  await assert.rejects(
    state.execute({ task_ref: "dsh:forged" }, {
      agent: current,
      signal: new AbortController().signal
    }),
    /not a declared property/
  );
  const snapshot = definitions.find((definition) =>
    definition.name === "continuity_snapshot_state");
  const snapResult = await snapshot.execute({}, {
    agent: current,
    signal: new AbortController().signal
  });
  assert.equal(snapResult.args.cwd, "/tool-workspace");
});

test("inbox observation is ordered before the true compaction recovery loop", async () => {
  const calls = [];
  const service = {
    async observePrompt(args) {
      calls.push(["prompt", args]);
      return { source_event_id: "prompt:1" };
    },
    async createSnapshot(args) {
      calls.push(["snapshot", args]);
      return { snapshot: { snapshot_id: "snapshot:1" } };
    },
    async markCompaction(args) {
      calls.push(["mark", args]);
      return { snapshot_matched: true };
    },
    async recover(args) {
      calls.push(["recover", args]);
      return { rendered: { text: "[Context Continuity recovery]\nobjective kept" } };
    }
  };
  const ctx = context();
  const adapter = new DshContinuityAdapter(ctx, service);
  const current = agent("compact-session", "/project");

  adapter.onInboxInserted({
    agent: current,
    message: {
      source: { kind: "user" },
      content: [{ type: "text", text: "Keep the release constraint." }]
    }
  });
  adapter.onSessionEvent(current.session, {
    type: "compaction/start",
    data: { compactionId: "compact-1", turn: 4 }
  });
  adapter.onSessionEvent(current.session, {
    type: "compaction/end",
    data: { compactionId: "compact-1", turn: 4 }
  });

  const decision = await adapter.onPreStep({
    agent: current,
    signal: new AbortController().signal
  }, async () => ({
    kind: "enter",
    messages: [{
      source: { kind: "user" },
      content: [{ type: "text", text: "Continue." }]
    }]
  }));

  assert.deepEqual(calls.map(([kind]) => kind), [
    "prompt",
    "snapshot",
    "mark",
    "recover"
  ]);
  assert.equal(calls[1][1].trigger, "auto");
  assert.equal(calls[2][1].turn_id, "compact-1");
  assert.equal(decision.kind, "enter");
  assert.equal(decision.startsRequestSeries, true);
  assert.equal(decision.messages.length, 2);
  assert.equal(decision.messages[0].source.plugin, "context-continuity");
  assert.equal(decision.messages[1].content[0].text, "Continue.");
});

test("a failed DSH compaction keeps the pre-snapshot but injects no false restore", async () => {
  const calls = [];
  const ctx = context();
  const adapter = new DshContinuityAdapter(ctx, {
    async createSnapshot(args) {
      calls.push(args);
      return { snapshot: { snapshot_id: "snapshot:failed" } };
    }
  });
  const current = agent("failed-session", "/project");
  adapter.onSessionEvent(current.session, {
    type: "compaction/start",
    data: { compactionId: "compact-failed", turn: null }
  });
  adapter.onSessionEvent(current.session, {
    type: "compaction/end",
    data: {
      compactionId: "compact-failed",
      turn: null,
      error: "aborted"
    }
  });
  await adapter.queue.drain();
  const original = {
    kind: "enter",
    messages: [{
      source: { kind: "user" },
      content: [{ type: "text", text: "Retry." }]
    }]
  };
  const decision = await adapter.onPreStep({
    agent: current,
    signal: new AbortController().signal
  }, async () => original);
  assert.deepEqual(decision, original);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].trigger, "manual");
  assert.equal(ctx.logger.warnings.length, 1);
});

test("resume recovery is admitted before the first resumed request", async () => {
  const current = agent("resume-session", "/project");
  const adapter = new DshContinuityAdapter(context(), {
    async recover(args) {
      assert.equal(args.source, "resume");
      return { rendered: { text: "resume state" } };
    }
  });
  adapter.onSessionStart({ agent: current, source: "resume" });
  const decision = await adapter.onPreStep({
    agent: current,
    signal: new AbortController().signal
  }, async () => ({
    kind: "enter",
    messages: [{
      source: { kind: "user" },
      content: [{ type: "text", text: "Where were we?" }]
    }]
  }));
  assert.equal(decision.messages[0].content[0].text, "resume state");
  assert.equal(decision.messages[1].content[0].text, "Where were we?");
});

test("published DSH host APIs carry confirmed state through a validated compaction", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "context-continuity-dsh-host-"));
  const workspace = path.join(root, "workspace");
  const dataRoot = path.join(root, "data");
  await fs.mkdir(workspace, { recursive: true });
  const previousDataRoot = process.env.CONTEXT_CONTINUITY_DATA_DIR;
  process.env.CONTEXT_CONTINUITY_DATA_DIR = dataRoot;

  const ctx = new Context();
  t.after(async () => {
    await ctx.fiber.dispose();
    if (previousDataRoot === undefined) {
      delete process.env.CONTEXT_CONTINUITY_DATA_DIR;
    } else {
      process.env.CONTEXT_CONTINUITY_DATA_DIR = previousDataRoot;
    }
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5 });
  });

  await ctx.plugin(SystemPrompt);
  await ctx.plugin(ToolRuntime);
  await ctx.plugin(AgentRegistry);
  const loadedPlugin = Object.assign(
    (pluginContext) => apply(pluginContext),
    { inject }
  );
  await ctx.plugin(loadedPlugin);

  const assembly = await ctx.systemPrompt.assemble();
  const continuityTools = assembly.tools.filter(({ name }) =>
    name.startsWith("continuity_"));
  assert.equal(continuityTools.length, 8);
  assert.ok(assembly.sections.some(({ name }) =>
    name === "context-continuity:policy"));

  const sessionId = SessionId("dsh-host-contract");
  const session = Session.create(sessionId, [], {
    version: 0,
    id: sessionId,
    createdAt: Date.now(),
    cwd: workspace
  });
  const agent = {
    id: sessionId,
    session,
    options: { provider: "fixture", model: "fixture" }
  };
  const signal = new AbortController().signal;
  let callNumber = 0;
  const call = async (toolName, args) => {
    const result = await ctx.tools.execute({
      callId: "context-continuity-" + (++callNumber),
      name: toolName,
      arguments: args,
      agent,
      signal
    });
    assert.equal(result.isError, false, JSON.stringify(result.content));
    return result.value;
  };
  const userMessage = (text) => createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "user" }
  });

  agentEvents(ctx, agent).emit("agent/inbox/inserted", {
    message: userMessage("Protect the release objective and macOS constraint.")
  });
  const before = await call("continuity_get_state", {});
  assert.equal(before.storage.source, "CONTEXT_CONTINUITY_DATA_DIR");
  assert.equal(before.pending_prompt_signals.length, 1);
  const requestEventId = before.pending_prompt_signals[0].event_id;

  const items = [
    {
      id: "objective:release",
      kind: "objective",
      statement: "Publish the Codex and DeepSeek Harness continuity plugin.",
      authority: "user",
      verification: "verified",
      status: "active",
      scope: "release"
    },
    {
      id: "constraint:macos",
      kind: "hard_constraint",
      statement: "Keep the same plugin behavior available on macOS.",
      authority: "user",
      verification: "verified",
      status: "active",
      scope: "release"
    },
    {
      id: "action:verify",
      kind: "next_action",
      statement: "Run the cross-platform package and lifecycle checks.",
      authority: "user",
      verification: "verified",
      status: "active",
      scope: "release"
    }
  ];
  const prepared = await call("continuity_prepare_confirmation", {
    expected_generation: before.generation,
    resolve_prompt_event_ids: [requestEventId],
    items
  });
  agentEvents(ctx, agent).emit("agent/inbox/inserted", {
    message: userMessage(prepared.confirmation_prompt)
  });
  agentEvents(ctx, agent).emit("agent/inbox/inserted", {
    message: userMessage("Thanks. Continue.")
  });
  await call("continuity_get_state", {});
  const recordArguments = {
    expected_generation: before.generation,
    resolve_prompt_event_ids: [requestEventId],
    items
  };
  const recorded = await call("continuity_record_state", recordArguments);
  assert.ok(recorded.changed_item_ids.includes("objective:release"));

  const compactionId = "context-continuity-compaction";
  const start = session.append("compaction/start", {
    compactionId,
    turn: null
  });
  ctx.emit("session/event", session, start);
  const summary = session.append("compaction/summary", {
    compactionId,
    summary: [{
      type: "text",
      text: "Platform summary intentionally omits the objective."
    }],
    shadowedRange: { start: 0, end: 0 },
    shadowedSeqs: [0],
    shadowedTokenCount: 1,
    provider: "fixture",
    model: "fixture"
  });
  ctx.emit("session/event", session, summary);
  const end = session.append("compaction/end", {
    compactionId,
    turn: null
  });
  ctx.emit("session/event", session, end);

  const currentMessage = userMessage("Continue from the correct release position.");
  const decision = await agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    {
      messages: [currentMessage],
      turn: 1,
      step: 1,
      signal
    },
    async () => ({ kind: "enter", messages: [currentMessage] })
  );
  assert.equal(decision.kind, "enter");
  assert.equal(decision.messages[0].source.kind, "plugin");
  const recoveryText = decision.messages[0].content
    .filter(({ type }) => type === "text")
    .map(({ text }) => text)
    .join("\n");
  assert.match(recoveryText, /Publish the Codex and DeepSeek Harness continuity plugin/);
  assert.match(recoveryText, /Keep the same plugin behavior available on macOS/);

  const after = await call("continuity_get_state", {});
  const nextAction = after.items.find(({ id }) => id === "action:verify");
  assert.equal(nextAction.verification, "stale");
  assert.equal(after.execution_guard_view.open_commitments.includes("action:verify"), false);

  const observationPath = process.env.CONTEXT_CONTINUITY_DSH_OBSERVATION_PATH;
  if (observationPath) {
    const observation = {
      schema_version: "1.0",
      native_tool_count: continuityTools.length,
      native_tool_confirmation_completed: Boolean(
        prepared.confirmation_prompt
          && recorded.changed_item_ids.includes("objective:release")
      ),
      validated_session_compaction_events_completed:
        start.type === "compaction/start"
          && summary.type === "compaction/summary"
          && end.type === "compaction/end"
          && start.data.compactionId === compactionId
          && end.data.compactionId === compactionId,
      pre_step_recovery_injected:
        decision.kind === "enter"
          && decision.messages[0].source.kind === "plugin"
          && recoveryText.includes("objective:release"),
      stale_next_action_removed_from_guard_view:
        nextAction.verification === "stale"
          && !after.execution_guard_view.open_commitments.includes("action:verify"),
      trusted_inbox_source_bound_without_model_argument:
        !Object.hasOwn(recordArguments, "source_event_id")
          && !Object.hasOwn(recordArguments, "task_ref")
          && recorded.changed_item_ids.includes("objective:release"),
      summary_content_ignored_as_truth:
        !recoveryText.includes("Platform summary intentionally omits the objective.")
          && recoveryText.includes("objective:release")
    };
    await fs.writeFile(
      observationPath,
      JSON.stringify(observation, null, 2) + "\n",
      "utf8"
    );
  }
});
