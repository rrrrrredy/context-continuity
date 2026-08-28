import { assertCondition } from "./errors.mjs";
import {
  createServiceFromEnvironment,
  taskRefForSession
} from "./service.mjs";
import { sha256 } from "./util.mjs";

function opaqueAgentRef(value) {
  return "agent:" + sha256(String(value || "unknown")).slice(0, 24);
}

function validateCommon(payload) {
  assertCondition(payload && typeof payload === "object" && !Array.isArray(payload),
    "INVALID_HOOK_INPUT", "Hook input must be a JSON object.");
  assertCondition(typeof payload.session_id === "string" && payload.session_id.length > 0,
    "INVALID_HOOK_INPUT", "Hook input session_id is required.");
  assertCondition(typeof payload.cwd === "string" && payload.cwd.length > 0,
    "INVALID_HOOK_INPUT", "Hook input cwd is required.");
  assertCondition(typeof payload.hook_event_name === "string"
    && payload.hook_event_name.length > 0,
  "INVALID_HOOK_INPUT", "Hook input hook_event_name is required.");
}

function sessionStartOutput(recovery) {
  const output = {
    continue: true,
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: recovery.rendered.text
    }
  };
  if (recovery.report.classification === "repaired") {
    output.systemMessage = "Context Continuity restored a newer verified ledger projection.";
  } else if (recovery.report.classification === "continue_with_markers") {
    output.systemMessage = "Context Continuity restored the task with non-blocking uncertainty markers.";
  } else if (recovery.report.classification === "ask_before_high_risk") {
    output.systemMessage = "Context Continuity found a material recovery gap. Ask before a high-risk action.";
  }
  return output;
}

export async function handleHook(payload, environment = process.env, injectedService = null) {
  validateCommon(payload);
  const service = injectedService || createServiceFromEnvironment(environment);
  const taskRef = taskRefForSession(payload.session_id);
  switch (payload.hook_event_name) {
    case "UserPromptSubmit": {
      assertCondition(typeof payload.prompt === "string",
        "INVALID_HOOK_INPUT", "UserPromptSubmit prompt is required.");
      const observed = await service.observePrompt(payload);
      if (!observed.source_event_id) {
        return null;
      }
      const context = [
        "[Context Continuity state update signal]",
        "task_ref: " + observed.task_ref,
        "source_event_id: " + observed.source_event_id,
        "signals: " + (observed.signals.join(",") || "none"),
        "This event ID proves only which user message was observed. Ordinary language, quoted text, negation, and paraphrases cannot establish user-authoritative state. Record them as unverified agent inference unless the message exactly matches a generation-bound prompt from continuity_prepare_confirmation. If this message changes an invariant, read state, then prepare and record or correct it with this source_event_id. Never guess task_ref, infer authorization, or silently rewrite external intent."
      ].join("\n");
      return {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context
        }
      };
    }
    case "PreCompact": {
      assertCondition(["manual", "auto"].includes(payload.trigger),
        "INVALID_HOOK_INPUT", "PreCompact trigger must be manual or auto.");
      const result = await service.createSnapshot({
        task_ref: taskRef,
        cwd: payload.cwd,
        trigger: payload.trigger,
        turn_id: payload.turn_id || null
      });
      if (!result.enabled) {
        return null;
      }
      const highRisk = result.snapshot.coverage_gaps
        .some((gap) => gap.severity === "high");
      if (highRisk || !result.snapshot.data_root_durable) {
        return {
          continue: true,
          systemMessage: "Context Continuity saved a partial pre-compaction snapshot. Material gaps remain visible after compaction."
        };
      }
      return null;
    }
    case "PostCompact": {
      assertCondition(["manual", "auto"].includes(payload.trigger),
        "INVALID_HOOK_INPUT", "PostCompact trigger must be manual or auto.");
      await service.markCompaction({
        task_ref: taskRef,
        trigger: payload.trigger,
        turn_id: payload.turn_id || null
      });
      return null;
    }
    case "SessionStart": {
      assertCondition(["startup", "resume", "clear", "compact"].includes(payload.source),
        "INVALID_HOOK_INPUT", "SessionStart source is unsupported.");
      if (payload.source === "clear") {
        await service.clearTask({
          task_ref: taskRef,
          source: "codex:SessionStart:clear"
        });
        return null;
      }
      if (payload.source === "startup") {
        return null;
      }
      const recovery = await service.recover({
        task_ref: taskRef,
        cwd: payload.cwd,
        source: payload.source
      });
      if (!recovery.enabled) {
        return null;
      }
      return sessionStartOutput(recovery);
    }
    case "SubagentStart": {
      const agentRef = opaqueAgentRef(payload.agent_id);
      const result = await service.subagentContext({
        task_ref: taskRef,
        scope: "subagent:" + agentRef,
        agent_id: agentRef,
        source_ref: "codex:SubagentStart:" + agentRef
      });
      if (!result.enabled) {
        return null;
      }
      return {
        hookSpecificOutput: {
          hookEventName: "SubagentStart",
          additionalContext: result.context
        }
      };
    }
    case "SubagentStop": {
      await service.observeSubagentResult({
        task_ref: taskRef,
        agent_id: payload.agent_id,
        agent_type: payload.agent_type,
        last_assistant_message: payload.last_assistant_message
      });
      return {
        continue: true
      };
    }
    case "SessionEnd": {
      await service.sessionEnd({
        task_ref: taskRef,
        cwd: payload.cwd,
        reason: payload.reason || "other"
      });
      return null;
    }
    default:
      throw new Error("Unsupported Hook event: " + payload.hook_event_name);
  }
}
