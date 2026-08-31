export const SCHEMA_VERSION = "1.0";
export const SERVER_VERSION = "0.2.0-beta.1";
export const DEFAULT_TOKEN_BUDGET = 800;
export const MAX_TOKEN_BUDGET = 1500;
export const MAX_STATEMENT_CHARS = 2000;
export const MAX_PROMPT_EXCERPT_CHARS = 512;
export const MAX_USER_CONFIRMATION_CHARS = 4096;
export const MAX_ITEM_ID_CHARS = 256;
export const MAX_SOURCE_REF_CHARS = 512;
export const MAX_SCOPE_CHARS = 256;
export const MAX_SUPERSEDES_PER_ITEM = 32;
export const MAX_STATE_ITEMS_PER_WRITE = 64;
export const MAX_ACTIVE_ITEMS = 128;
export const MAX_HANDOFF_BYTES = 256 * 1024;
export const MAX_SNAPSHOT_BYTES = 512 * 1024;
export const MAX_LEDGER_BYTES = 8 * 1024 * 1024;
export const MAX_EVENTS_PER_TASK = 2000;
export const MAX_MCP_INPUT_BYTES = 1024 * 1024;
export const SNAPSHOT_RETENTION = 3;

export const LEDGER_EVENT_TYPES = new Set([
  "workspace_observed",
  "prompt_signal_observed",
  "state_recorded",
  "external_contract_bound",
  "task_cleared",
  "task_reset",
  "enabled_changed",
  "management_challenge_issued",
  "next_actions_revalidation_required",
  "snapshot_created",
  "compaction_completed",
  "restore_checked",
  "subagent_capsule_exported",
  "subagent_result_observed",
  "handoff_imported",
  "session_ended"
]);

export const ITEM_KINDS = new Set([
  "objective",
  "hard_constraint",
  "authorization",
  "correction",
  "decision",
  "open_question",
  "dispute",
  "preference",
  "assumption",
  "work_object",
  "completion",
  "next_action",
  "phase",
  "evidence"
]);

export const INTENT_KINDS = new Set([
  "objective",
  "hard_constraint",
  "authorization",
  "correction",
  "decision",
  "open_question",
  "dispute",
  "preference",
  "assumption"
]);

export const OPERATIONAL_KINDS = new Set([
  "work_object",
  "completion",
  "next_action",
  "phase",
  "evidence"
]);

export const ITEM_STATUSES = new Set([
  "active",
  "superseded",
  "disputed",
  "unverified"
]);

export const AUTHORITIES = new Set([
  "user",
  "verified_evidence",
  "agent_inference"
]);

export const VERIFICATION_STATES = new Set([
  "verified",
  "unverified",
  "stale",
  "unavailable"
]);

export const ITEM_PRIORITY = new Map([
  ["authorization", 100],
  ["hard_constraint", 95],
  ["correction", 92],
  ["objective", 90],
  ["work_object", 85],
  ["completion", 80],
  ["dispute", 75],
  ["open_question", 72],
  ["next_action", 70],
  ["decision", 60],
  ["phase", 55],
  ["evidence", 50],
  ["assumption", 35],
  ["preference", 30]
]);

export const HIGH_RISK_KINDS = new Set([
  "objective",
  "hard_constraint",
  "authorization",
  "correction",
  "work_object",
  "completion",
  "next_action"
]);

export const PROMPT_SIGNAL_SEVERITY = new Map([
  ["reset", "high"],
  ["management_delete", "high"],
  ["management_confirm", "high"],
  ["continuity_off", "high"],
  ["continuity_on", "high"],
  ["goal_change", "high"],
  ["correction", "high"],
  ["authorization", "high"],
  ["constraint", "high"],
  ["dispute", "medium"],
  ["first_prompt", "medium"]
]);
