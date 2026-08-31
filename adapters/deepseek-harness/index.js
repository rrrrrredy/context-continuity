import os from "node:os";
import path from "node:path";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { validateJsonSchemaValue } from "@deepseek-ai/dsh-tools";
import {
  DEFAULT_TOKEN_BUDGET
} from "../../plugins/context-continuity/src/constants.mjs";
import { publicError } from "../../plugins/context-continuity/src/errors.mjs";
import {
  McpRuntime,
  TOOLS,
  successToolText
} from "../../plugins/context-continuity/src/mcp-server.mjs";
import {
  ContinuityService,
  taskRefForHostSession
} from "../../plugins/context-continuity/src/service.mjs";

export const name = "context-continuity";
export const inject = ["agents", "systemPrompt", "tools"];

const HOST_NAME = "dsh";
const POLICY_SECTION_ORDER = 2450;
const RECOVERY_WAIT_MS = 2500;
const RECOVERY_SOURCE = {
  resume: "resume",
  compact: "compact"
};
const MAX_RECENT_PROMPT_OBSERVATIONS = 8;
const RETRYABLE_SOURCE_ERRORS = new Set([
  "UNKNOWN_PROMPT_EVENT",
  "PROMPT_EVENT_ALREADY_RESOLVED",
  "USER_SEMANTIC_CONFIRMATION_REQUIRED",
  "MANAGEMENT_USER_SIGNAL_REQUIRED",
  "MANAGEMENT_CONFIRMATION_MISMATCH",
  "MANAGEMENT_CHALLENGE_EXPIRED"
]);

const POLICY_TEXT = [
  "Context Continuity protects only task invariants that could change execution after compaction, resume, or handoff.",
  "When the user states or corrects a goal, hard constraint, authorization, decision, dispute, work object, completion, or next action, read continuity_get_state before writing; use continuity_prepare_confirmation and show its exact prompt before assigning user authority.",
  "Never turn an inference, platform summary, or imported handoff into verified user intent.",
  "New explicit user instructions supersede older state, and every restored next_action must be re-derived before execution.",
  "Do not use continuity as a planner, permission system, profile, or general memory."
].join(" ");

function renderedError(error) {
  return error instanceof Error ? error.message : String(error);
}

function asJsonValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function extractPromptText(message) {
  const parts = [];
  for (const block of message?.content || []) {
    if (block?.type === "text" && typeof block.text === "string") {
      parts.push(block.text);
    } else if (block?.type) {
      parts.push("[non-text user content omitted]");
    }
  }
  return parts.join("\n").trim();
}

function taskRefForAgent(agent) {
  const sessionId = String(agent?.session?.id || agent?.id || "");
  if (!sessionId) {
    throw new Error("Context Continuity requires a live DSH Agent session.");
  }
  return taskRefForHostSession(HOST_NAME, sessionId);
}

function cwdForSession(session) {
  const cwd = session?.header?.cwd;
  return typeof cwd === "string" && cwd.trim().length > 0
    ? cwd
    : process.cwd();
}

function schemaAnnotation(node, output) {
  for (const key of ["description", "title", "default", "examples"]) {
    if (Object.hasOwn(node, key)) {
      output[key] = node[key];
    }
  }
  return output;
}

function dshSchema(node, options = {}) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return {};
  }
  if (Array.isArray(node.oneOf)) {
    return schemaAnnotation(node, {
      oneOf: node.oneOf.map((branch) => dshSchema(branch))
    });
  }
  const output = {};
  if (typeof node.type === "string") {
    output.type = node.type;
  }
  if (Array.isArray(node.enum)) {
    output.enum = [...node.enum];
  }
  if (Object.hasOwn(node, "const")) {
    output.const = node.const;
  }
  if (node.type === "object") {
    const omitted = new Set(options.omitProperties || []);
    const properties = {};
    for (const [key, child] of Object.entries(node.properties || {})) {
      if (omitted.has(key)) {
        continue;
      }
      properties[key] = dshSchema(child);
    }
    output.properties = properties;
    const required = (node.required || []).filter((key) =>
      !omitted.has(key));
    if (required.length > 0) {
      output.required = required;
    }
    if (typeof node.additionalProperties === "boolean") {
      output.additionalProperties = node.additionalProperties;
    }
  }
  if (node.type === "array" && node.items) {
    output.items = dshSchema(node.items);
  }
  return schemaAnnotation(node, output);
}

function needsObservedSource(name, args) {
  if (name === "continuity_correct_state") {
    return true;
  }
  if (name === "continuity_record_state") {
    return Array.isArray(args.items)
      && args.items.some((item) => item?.authority !== "agent_inference");
  }
  if (name === "continuity_manage_state") {
    return args.action !== "rebuild";
  }
  return false;
}

function toolArguments(name, args, agent, sourceEventId = null) {
  const taskRef = taskRefForAgent(agent);
  const resolved = {
    ...args,
    task_ref: taskRef
  };
  if (name === "continuity_snapshot_state") {
    resolved.cwd = cwdForSession(agent.session);
  }
  if (sourceEventId && needsObservedSource(name, args)) {
    resolved.source_event_id = sourceEventId;
  }
  return resolved;
}

function recoveryMessage(value) {
  const text = value?.rendered?.text || value?.context || null;
  if (!text) {
    return null;
  }
  return createUserMessage({
    content: [{ type: "text", text }],
    source: {
      kind: "plugin",
      plugin: name,
      form: "snapshot",
      sections: [{ name, text }]
    }
  });
}

async function settleWithin(promise, signal) {
  if (signal?.aborted) {
    return { status: "aborted" };
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = () => finish({ status: "aborted" });
    const timer = setTimeout(
      () => finish({ status: "timeout" }),
      RECOVERY_WAIT_MS
    );
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish({ status: "settled", value }),
      (error) => finish({ status: "settled", value: null, error })
    );
  });
}

export function resolveDshDataRoot(
  environment = process.env,
  homeDirectory = os.homedir()
) {
  if (environment.CONTEXT_CONTINUITY_DATA_DIR?.trim()) {
    return {
      path: path.resolve(environment.CONTEXT_CONTINUITY_DATA_DIR),
      durable: true,
      source: "CONTEXT_CONTINUITY_DATA_DIR"
    };
  }
  const dshHome = environment.DSH_HOME?.trim()
    ? path.resolve(environment.DSH_HOME)
    : path.join(homeDirectory, ".dsh");
  return {
    path: path.join(
      dshHome,
      "plugin-data",
      "context-continuity",
      "v1"
    ),
    durable: true,
    source: environment.DSH_HOME?.trim() ? "DSH_HOME" : "DSH_HOME_DEFAULT"
  };
}

class SessionWorkQueue {
  constructor(logger) {
    this.logger = logger;
    this.jobs = new Map();
  }

  enqueue(sessionId, label, operation) {
    const key = String(sessionId);
    const previous = this.jobs.get(key) || Promise.resolve(null);
    const job = previous
      .catch(() => null)
      .then(operation)
      .catch((error) => {
        this.logger.warn(
          "context-continuity: " + label + " failed open: " + renderedError(error)
        );
        return null;
      });
    this.jobs.set(key, job);
    void job.finally(() => {
      if (this.jobs.get(key) === job) {
        this.jobs.delete(key);
      }
    });
    return job;
  }

  pending(sessionId) {
    return this.jobs.get(String(sessionId)) || Promise.resolve(null);
  }

  async drain() {
    await Promise.allSettled([...this.jobs.values()]);
  }
}

export class DshContinuityAdapter {
  constructor(ctx, service) {
    this.ctx = ctx;
    this.service = service;
    this.runtime = new McpRuntime(service);
    this.queue = new SessionWorkQueue(ctx.logger);
    this.pendingRecovery = new Map();
    this.inboxSequence = new Map();
    this.promptObservations = new Map();
  }

  nextInboxSequence(sessionId) {
    const key = String(sessionId);
    const next = (this.inboxSequence.get(key) || 0) + 1;
    this.inboxSequence.set(key, next);
    return next;
  }

  onInboxInserted({ agent, message }) {
    if (message?.source?.kind !== "user") {
      return;
    }
    const prompt = extractPromptText(message);
    if (!prompt) {
      return;
    }
    const sessionId = String(agent.session.id);
    const turnId = "inbox-" + this.nextInboxSequence(sessionId);
    const observation = this.queue.enqueue(
      sessionId,
      "user prompt observation",
      () =>
      this.service.observePrompt({
        session_id: sessionId,
        turn_id: turnId,
        cwd: cwdForSession(agent.session),
        prompt
      }));
    const recent = this.promptObservations.get(sessionId) || [];
    recent.push(observation);
    if (recent.length > MAX_RECENT_PROMPT_OBSERVATIONS) {
      recent.splice(0, recent.length - MAX_RECENT_PROMPT_OBSERVATIONS);
    }
    this.promptObservations.set(sessionId, recent);
  }

  onSessionEvent(session, event) {
    const sessionId = String(session.id);
    if (event.type === "compaction/start") {
      const trigger = event.data.turn === null ? "manual" : "auto";
      this.queue.enqueue(sessionId, "pre-compaction snapshot", () =>
        this.service.createSnapshot({
          task_ref: taskRefForHostSession(HOST_NAME, sessionId),
          cwd: cwdForSession(session),
          trigger,
          turn_id: String(event.data.compactionId)
        }));
      return;
    }
    if (event.type !== "compaction/end") {
      return;
    }
    if (event.data.error) {
      this.ctx.logger.warn(
        "context-continuity: DSH compaction ended without a committed replacement; "
          + "the pre-compaction snapshot remains available."
      );
      return;
    }
    const trigger = event.data.turn === null ? "manual" : "auto";
    const recovery = this.queue.enqueue(
      sessionId,
      "post-compaction recovery",
      async () => {
        const taskRef = taskRefForHostSession(HOST_NAME, sessionId);
        await this.service.markCompaction({
          task_ref: taskRef,
          trigger,
          turn_id: String(event.data.compactionId)
        });
        return this.service.recover({
          task_ref: taskRef,
          cwd: cwdForSession(session),
          source: "compact",
          token_budget: DEFAULT_TOKEN_BUDGET
        });
      }
    );
    this.pendingRecovery.set(sessionId, recovery);
  }

  onSessionStart({ agent, source }) {
    const sessionId = String(agent.session.id);
    if (source === "clear") {
      this.queue.enqueue(sessionId, "session clear", () =>
        this.service.clearTask({
          task_ref: taskRefForAgent(agent),
          source: "dsh:clear"
        }));
      return;
    }
    const recoverySource = RECOVERY_SOURCE[source];
    if (recoverySource) {
      const recovery = this.queue.enqueue(
        sessionId,
        source + " recovery",
        () => this.service.recover({
          task_ref: taskRefForAgent(agent),
          cwd: cwdForSession(agent.session),
          source: recoverySource,
          token_budget: DEFAULT_TOKEN_BUDGET
        })
      );
      this.pendingRecovery.set(sessionId, recovery);
      return;
    }
    const parentSession = agent.session.header?.parentSession;
    if (source === "startup" && parentSession) {
      const handoff = this.queue.enqueue(
        sessionId,
        "parent handoff",
        () => this.prepareParentHandoff(agent, String(parentSession))
      );
      this.pendingRecovery.set(sessionId, handoff);
    }
  }

  async prepareParentHandoff(agent, parentSessionId) {
    const parentTaskRef = taskRefForHostSession(HOST_NAME, parentSessionId);
    const parentState = await this.service.getState({
      task_ref: parentTaskRef,
      create_if_missing: false
    });
    if (parentState.items.length === 0
        && parentState.pending_prompt_signals.length === 0
        && parentState.coverage_gaps.length === 0) {
      return null;
    }
    const handoff = await this.service.subagentContext({
      task_ref: parentTaskRef,
      scope: "dsh-child:" + String(agent.session.id),
      token_budget: DEFAULT_TOKEN_BUDGET
    });
    const childTaskRef = taskRefForAgent(agent);
    const childState = await this.service.getState({
      task_ref: childTaskRef,
      create_if_missing: true
    });
    await this.service.importHandoff({
      task_ref: childTaskRef,
      expected_generation: childState.generation,
      capsule: handoff.capsule
    });
    return handoff;
  }

  async consumeRecovery(sessionId, signal) {
    const key = String(sessionId);
    const recovery = this.pendingRecovery.get(key);
    if (!recovery) {
      return null;
    }
    const outcome = await settleWithin(recovery, signal);
    if (outcome.status !== "settled") {
      if (outcome.status === "timeout") {
        this.ctx.logger.warn(
          "context-continuity: recovery exceeded "
            + RECOVERY_WAIT_MS + "ms; this step continues and recovery will retry."
        );
      }
      return null;
    }
    if (this.pendingRecovery.get(key) === recovery) {
      this.pendingRecovery.delete(key);
    }
    return outcome.value;
  }

  async onPreStep(payload, next) {
    const decision = await next();
    if (decision.kind !== "enter") {
      return decision;
    }
    const value = await this.consumeRecovery(payload.agent.session.id, payload.signal);
    const message = recoveryMessage(value);
    if (!message) {
      return decision;
    }
    return {
      ...decision,
      messages: [message, ...decision.messages],
      startsRequestSeries: true
    };
  }

  onAgentDisposed({ agent }) {
    const sessionId = String(agent.session.id);
    this.pendingRecovery.delete(sessionId);
    this.inboxSequence.delete(sessionId);
    this.promptObservations.delete(sessionId);
    this.queue.enqueue(sessionId, "session end", () =>
      this.service.sessionEnd({
        task_ref: taskRefForAgent(agent),
        cwd: cwdForSession(agent.session),
        reason: "other"
      }));
  }

  toolDefinitions() {
    return TOOLS.map((tool) => {
      const omitProperties = ["task_ref"];
      if ([
        "continuity_record_state",
        "continuity_correct_state",
        "continuity_manage_state"
      ].includes(tool.name)) {
        omitProperties.push("source_event_id");
      }
      if (tool.name === "continuity_snapshot_state") {
        omitProperties.push("cwd");
      }
      const parameters = dshSchema(tool.inputSchema, { omitProperties });
      return {
        name: tool.name,
        description: tool.description,
        parameters,
        output: {
          schema: {},
          render: (_args, value) => [{
            type: "text",
            text: successToolText(value)
          }]
        },
        execute: async (args, exec) => {
          const violations = validateJsonSchemaValue(parameters, args, "");
          if (violations.length > 0) {
            throw new Error("Invalid Context Continuity arguments: "
              + violations.join("; "));
          }
          if (!exec.agent) {
            throw new Error(
              "Context Continuity tools require a live DSH Agent session."
            );
          }
          const sessionId = String(exec.agent.session.id);
          await this.queue.pending(sessionId);
          const observations = await Promise.all(
            this.promptObservations.get(sessionId) || []
          );
          const sourceRequired = needsObservedSource(tool.name, args);
          const candidates = sourceRequired
            ? [...observations].reverse()
            : [observations.at(-1) || null];
          if (candidates.length === 0) {
            candidates.push(null);
          }
          let lastError = null;
          for (const observation of candidates) {
            try {
              const value = await this.runtime.callTool(
                tool.name,
                toolArguments(
                  tool.name,
                  args,
                  exec.agent,
                  observation?.source_event_id || null
                )
              );
              return asJsonValue(value);
            } catch (error) {
              lastError = error;
              if (sourceRequired && RETRYABLE_SOURCE_ERRORS.has(error?.code)) {
                continue;
              }
              throw new Error(
                "Context Continuity rejected the request: "
                  + JSON.stringify(publicError(error))
              );
            }
          }
          throw new Error(
            "Context Continuity rejected the request: "
              + JSON.stringify(publicError(lastError))
          );
        }
      };
    });
  }

  async drain() {
    await this.queue.drain();
  }
}

export function apply(ctx) {
  const service = new ContinuityService({
    dataRootInfo: resolveDshDataRoot(),
    hostName: HOST_NAME,
    tokenBudget: DEFAULT_TOKEN_BUDGET
  });
  const adapter = new DshContinuityAdapter(ctx, service);

  ctx.systemPrompt.section({
    name: "context-continuity:policy",
    order: POLICY_SECTION_ORDER,
    text: POLICY_TEXT
  });
  for (const definition of adapter.toolDefinitions()) {
    ctx.tools.register(definition);
  }
  ctx.on("agent/inbox/inserted", (payload) => {
    adapter.onInboxInserted(payload);
  });
  ctx.on("session/event", (session, event) => {
    adapter.onSessionEvent(session, event);
  });
  ctx.on("agent/session-start", (payload) => {
    adapter.onSessionStart(payload);
  });
  ctx.on("agent/pre-step", (payload, next) =>
    adapter.onPreStep(payload, next));
  ctx.on("agent/disposed", (payload) => {
    adapter.onAgentDisposed(payload);
  });
  ctx.effect(() => () => adapter.drain(), "context-continuity.drain");
}

export default apply;
