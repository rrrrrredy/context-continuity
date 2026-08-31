import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MAX_ITEM_ID_CHARS,
  MAX_MCP_INPUT_BYTES,
  MAX_SCOPE_CHARS,
  MAX_SOURCE_REF_CHARS,
  MAX_STATE_ITEMS_PER_WRITE,
  MAX_SUPERSEDES_PER_ITEM,
  SERVER_VERSION
} from "./constants.mjs";
import { ContinuityError, publicError } from "./errors.mjs";
import { createServiceFromEnvironment } from "./service.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_URI = "context-continuity://skill/context-continuity";
export const MAX_MCP_RESPONSE_BYTES = 24 * 1024;
const MAX_MCP_HANDOFF_BYTES = 16 * 1024;
const MAX_MCP_STATE_PAGE_ITEMS = 8;
const SKILL_PATH = path.join(
  PLUGIN_ROOT,
  "skills",
  "context-continuity",
  "SKILL.md"
);

const STATE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "statement",
    "authority",
    "verification"
  ],
  properties: {
    id: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS },
    kind: {
      type: "string",
      enum: [
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
      ]
    },
    statement: { type: "string", minLength: 1, maxLength: 2000 },
    source_ref: { type: "string", minLength: 1, maxLength: MAX_SOURCE_REF_CHARS },
    recorded_at: { type: "string", format: "date-time" },
    scope: { type: "string", minLength: 1, maxLength: MAX_SCOPE_CHARS },
    status: {
      type: "string",
      enum: ["active", "superseded", "disputed", "unverified"]
    },
    authority: {
      type: "string",
      enum: ["user", "verified_evidence", "agent_inference"]
    },
    verification: {
      type: "string",
      enum: ["verified", "unverified", "stale", "unavailable"]
    },
    supersedes: {
      type: "array",
      maxItems: MAX_SUPERSEDES_PER_ITEM,
      items: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS }
    },
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1
    },
    evidence_digest: {
      type: "string",
      pattern: "^[a-f0-9]{64}$"
    }
  },
  allOf: [
    {
      if: {
        properties: { authority: { const: "agent_inference" } },
        required: ["authority"]
      },
      then: { required: ["source_ref", "confidence"] }
    },
    {
      if: {
        properties: { authority: { const: "verified_evidence" } },
        required: ["authority"]
      },
      then: { required: ["source_ref", "evidence_digest"] }
    },
    {
      if: {
        properties: { authority: { const: "user" } },
        required: ["authority"]
      },
      then: {
        required: ["id"],
        not: {
          anyOf: [
            { required: ["source_ref"] },
            { required: ["recorded_at"] },
            { required: ["evidence_digest"] },
            { required: ["confidence"] }
          ]
        }
      }
    },
    {
      if: {
        properties: { kind: { const: "authorization" } },
        required: ["kind"]
      },
      then: {
        properties: { authority: { const: "user" } },
        required: ["authority"]
      }
    }
  ]
};

const TASK_REF = {
  type: "string",
  minLength: 4,
  maxLength: 256,
  pattern: "^[A-Za-z][A-Za-z0-9_-]{1,31}:\\S{1,223}$",
  description: "Exact namespaced task reference injected by a trusted Hook, normally codex:<opaque-session-hash>. Never guess current or another alias."
};

const USER_STATE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "statement"],
  properties: {
    id: STATE_ITEM_SCHEMA.properties.id,
    kind: STATE_ITEM_SCHEMA.properties.kind,
    statement: STATE_ITEM_SCHEMA.properties.statement,
    scope: STATE_ITEM_SCHEMA.properties.scope,
    status: STATE_ITEM_SCHEMA.properties.status,
    authority: { const: "user" },
    verification: { const: "verified" },
    supersedes: STATE_ITEM_SCHEMA.properties.supersedes
  }
};

const AGENT_INFERENCE_ITEM_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "kind",
    "statement",
    "source_ref",
    "authority",
    "verification",
    "confidence"
  ],
  properties: {
    id: STATE_ITEM_SCHEMA.properties.id,
    kind: {
      type: "string",
      enum: STATE_ITEM_SCHEMA.properties.kind.enum.filter(
        (kind) => kind !== "authorization"
      )
    },
    statement: STATE_ITEM_SCHEMA.properties.statement,
    source_ref: STATE_ITEM_SCHEMA.properties.source_ref,
    recorded_at: STATE_ITEM_SCHEMA.properties.recorded_at,
    scope: STATE_ITEM_SCHEMA.properties.scope,
    status: STATE_ITEM_SCHEMA.properties.status,
    authority: { const: "agent_inference" },
    verification: {
      type: "string",
      enum: ["unverified", "stale", "unavailable"]
    },
    supersedes: STATE_ITEM_SCHEMA.properties.supersedes,
    confidence: STATE_ITEM_SCHEMA.properties.confidence
  }
};

const PUBLIC_RECORD_ITEM_SCHEMA = {
  oneOf: [
    USER_STATE_ITEM_SCHEMA,
    AGENT_INFERENCE_ITEM_SCHEMA
  ]
};

const CORRECTION_REPLACEMENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["id", "kind", "statement"],
  properties: {
    id: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS },
    kind: {
      type: "string",
      enum: [
        "objective", "hard_constraint", "authorization", "correction",
        "decision", "open_question", "dispute", "preference", "assumption"
      ]
    },
    statement: { type: "string", minLength: 1, maxLength: 2000 },
    scope: { type: "string", minLength: 1, maxLength: MAX_SCOPE_CHARS },
    status: {
      type: "string",
      enum: ["active", "superseded", "disputed", "unverified"]
    },
    supersedes: {
      type: "array",
      maxItems: MAX_SUPERSEDES_PER_ITEM,
      items: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS }
    }
  }
};

const EXTERNAL_CONTRACT_ITEM_SCHEMA = {
  ...STATE_ITEM_SCHEMA,
  required: [
    "id",
    "kind",
    "statement",
    "source_ref",
    "recorded_at",
    "scope",
    "status",
    "authority",
    "verification",
    "supersedes"
  ]
};

export const TOOLS = [
  {
    name: "continuity_get_state",
    description: "Read the one effective task-state projection, provenance, gaps, current generation, and execution-guard view.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["task_ref"],
      properties: {
        task_ref: TASK_REF,
        cursor: { type: "integer", minimum: 0 },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: MAX_MCP_STATE_PAGE_ITEMS
        },
        item_kinds: {
          type: "array",
          maxItems: 14,
          uniqueItems: true,
          items: { type: "string", minLength: 1 }
        }
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  },
  {
    name: "continuity_prepare_confirmation",
    description: "Build an exact, generation-bound user confirmation prompt without writing state. Ask the user to send the returned prompt exactly, then bind that new Hook event in record_state or correct_state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["task_ref", "expected_generation", "items"],
      properties: {
        task_ref: TASK_REF,
        expected_generation: { type: "integer", minimum: 0 },
        resolve_prompt_event_ids: {
          type: "array",
          maxItems: MAX_STATE_ITEMS_PER_WRITE,
          items: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS }
        },
        items: {
          type: "array",
          minItems: 1,
          maxItems: MAX_STATE_ITEMS_PER_WRITE,
          items: USER_STATE_ITEM_SCHEMA
        }
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true
    }
  },
  {
    name: "continuity_record_state",
    description: "Append minimal standalone state changes. User authority requires the exact prompt from prepare_confirmation; Agent inferences remain unverified. The public tool surface does not accept model-supplied provider credentials.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["task_ref", "expected_generation", "items"],
      properties: {
        task_ref: TASK_REF,
        expected_generation: { type: "integer", minimum: 0 },
        source_event_id: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS },
        resolve_prompt_event_ids: {
          type: "array",
          maxItems: MAX_STATE_ITEMS_PER_WRITE,
          items: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS }
        },
        items: {
          type: "array",
          minItems: 1,
          maxItems: MAX_STATE_ITEMS_PER_WRITE,
          items: PUBLIC_RECORD_ITEM_SCHEMA
        }
      }
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    }
  },
  {
    name: "continuity_correct_state",
    description: "Record an explicit user-intent correction without rewriting history. For work_object, completion, next_action, phase, or evidence updates, use continuity_record_state with explicit supersedes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: [
        "task_ref",
        "expected_generation",
        "source_event_id",
        "correction"
      ],
      properties: {
        task_ref: TASK_REF,
        expected_generation: { type: "integer", minimum: 0 },
        source_event_id: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS },
        resolve_prompt_event_ids: {
          type: "array",
          maxItems: MAX_STATE_ITEMS_PER_WRITE,
          items: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS }
        },
        correction: {
          type: "object",
          additionalProperties: false,
          required: ["id", "statement", "supersedes"],
          properties: {
            id: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS },
            statement: { type: "string", minLength: 1, maxLength: 2000 },
            scope: { type: "string", minLength: 1, maxLength: MAX_SCOPE_CHARS },
            supersedes: {
              type: "array",
              minItems: 1,
              maxItems: MAX_SUPERSEDES_PER_ITEM,
              items: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS }
            }
          }
        },
        replacements: {
          type: "array",
          maxItems: MAX_STATE_ITEMS_PER_WRITE - 1,
          items: CORRECTION_REPLACEMENT_SCHEMA
        }
      }
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    }
  },
  {
    name: "continuity_snapshot_state",
    description: "Create a manual minimum task snapshot. Lifecycle Hooks call the same core automatically before compaction.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["task_ref", "cwd"],
      properties: {
        task_ref: TASK_REF,
        cwd: { type: "string", minLength: 1, maxLength: 4096 },
      }
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    }
  },
  {
    name: "continuity_export_handoff",
    description: "Export a bounded, content-addressed handoff capsule. Importers must keep it candidate-only until verified.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["task_ref", "scope"],
      properties: {
        task_ref: TASK_REF,
        scope: { type: "string", minLength: 1, maxLength: MAX_SCOPE_CHARS },
        item_kinds: {
          type: "array",
          maxItems: 14,
          items: { type: "string", minLength: 1 }
        },
        max_bytes: {
          type: "integer",
          minimum: 4096,
          maximum: MAX_MCP_HANDOFF_BYTES
        }
      }
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false
    }
  },
  {
    name: "continuity_import_handoff",
    description: "Record a verified handoff capsule as an untrusted candidate. It never changes active state automatically.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["task_ref", "expected_generation", "capsule"],
      properties: {
        task_ref: TASK_REF,
        expected_generation: { type: "integer", minimum: 0 },
        capsule: { type: "object" }
      }
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false
    }
  },
  {
    name: "continuity_manage_state",
    description: "Rebuild state or use a two-stage one-time challenge plus exact second user prompt for off, on, reset, or delete. Pass the returned challenge_token verbatim, including its literal challenge: prefix.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["task_ref", "action"],
      properties: {
        task_ref: TASK_REF,
        action: {
          type: "string",
          enum: [
            "rebuild",
            "prepare_off",
            "prepare_on",
            "prepare_reset",
            "prepare_delete",
            "reset",
            "delete",
            "off",
            "on"
          ]
        },
        source_event_id: { type: "string", minLength: 1, maxLength: MAX_ITEM_ID_CHARS },
        challenge_token: {
          type: "string",
          minLength: 46,
          maxLength: 46,
          pattern: "^challenge:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
          description: "The complete one-time value returned by prepare_*. Copy it verbatim, including the literal challenge: prefix; never pass only the UUID."
        },
        reason: { type: "string", maxLength: 500 }
      }
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false
    }
  }
];

export function successToolText(value) {
  if (typeof value?.confirmation_prompt === "string") {
    return "Show the following proposal verbatim and ask the user to send it as a new message:\n\n"
      + value.confirmation_prompt;
  }
  if (typeof value?.confirmation_phrase === "string"
      && typeof value?.challenge_token === "string") {
    return [
      "Show this exact one-time confirmation phrase to the user:",
      value.confirmation_phrase,
      "challenge_token: " + value.challenge_token,
      "Later pass the complete challenge_token verbatim, including its literal challenge: prefix. Do not extract the UUID.",
      "If this result is lost, repeat the same prepare action to issue a fresh challenge. Never search logs, transcripts, caches, another task, or CODEX_HOME for a token."
    ].join("\n");
  }
  if (value?.response_mode === "bounded_page") {
    return "Context Continuity state page (text fallback):\n"
      + JSON.stringify({
        task_ref: value.task_ref,
        generation: value.generation,
        enabled: value.enabled,
        lifecycle_status: value.lifecycle_status,
        items: value.items,
        page: value.page,
        pending_prompt_signal_count: value.pending_prompt_signal_count,
        coverage_gaps: value.coverage_gaps,
        latest_restore: value.latest_restore,
        execution_guard_view: value.execution_guard_view
      }, null, 2);
  }
  if (value?.response_mode === "mutation_summary"
      || value?.response_mode === "snapshot_summary") {
    return "Context Continuity result:\n" + JSON.stringify(value, null, 2);
  }
  return "Context Continuity returned structured data"
    + (value?.response_mode ? " (" + value.response_mode + ")" : "")
    + (value?.task_ref ? " for " + value.task_ref : "") + ".";
}

function successToolResult(value) {
  const buildResult = (text) => ({
    content: [
      {
        type: "text",
        text
      }
    ],
    structuredContent: value,
    isError: false
  });
  let result = buildResult(successToolText(value));
  let serializedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  if (serializedBytes > MAX_MCP_RESPONSE_BYTES && value?.response_mode === "bounded_page") {
    result = buildResult("Context Continuity state page summary:\n" + JSON.stringify({
      task_ref: value.task_ref,
      generation: value.generation,
      enabled: value.enabled,
      lifecycle_status: value.lifecycle_status,
      item_refs: value.items.map((item) => ({
        id: item.id,
        kind: item.kind,
        status: item.status,
        verification: item.verification
      })),
      page: value.page,
      pending_prompt_signal_count: value.pending_prompt_signal_count,
      coverage_gap_count: value.coverage_gap_count
    }, null, 2));
    serializedBytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  }
  if (serializedBytes > MAX_MCP_RESPONSE_BYTES) {
    throw new ContinuityError(
      "MCP_RESPONSE_LIMIT",
      "The bounded tool result exceeded the MCP response budget.",
      {
        maximum_bytes: MAX_MCP_RESPONSE_BYTES,
        actual_bytes: serializedBytes
      }
    );
  }
  return result;
}

function errorToolResult(error) {
  let value = publicError(error);
  const buildResult = () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2)
      }
    ],
    structuredContent: value,
    isError: true
  });
  let result = buildResult();
  if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_MCP_RESPONSE_BYTES) {
    value = {
      code: "MCP_ERROR_RESPONSE_LIMIT",
      message: "The request failed, but its diagnostic details exceeded the public response budget.",
      details: {
        original_code: String(publicError(error).code || "CONTINUITY_ERROR").slice(0, 128),
        maximum_bytes: MAX_MCP_RESPONSE_BYTES,
        diagnostic_details_omitted: true
      }
    };
    result = buildResult();
  }
  return result;
}

function boundedGuardView(view) {
  if (!view) {
    return null;
  }
  return {
    ...view,
    phase: String(view.phase || "unknown").slice(0, 256),
    open_commitments: view.open_commitments.slice(0, 4),
    evidence_refs: view.evidence_refs.slice(0, 4),
    omitted_open_commitments: Math.max(0, view.open_commitments.length - 4),
    omitted_evidence_refs: Math.max(0, view.evidence_refs.length - 4)
  };
}

function compactContract(contract) {
  if (!contract) {
    return null;
  }
  return {
    source: contract.source,
    contract_ref: contract.contract_ref,
    contract_version: contract.contract_version,
    snapshot_sha256: contract.snapshot_sha256,
    items_digest: contract.items_digest,
    active_intent_item_count: contract.active_intent_item_ids?.length || 0
  };
}

function compactLifecycle(value) {
  if (!value) {
    return null;
  }
  return {
    classification: value.classification || null,
    trigger: value.trigger || null,
    source: value.source || null,
    generation: value.generation ?? value.selected_generation ?? null,
    event_sequence: value.event_sequence ?? null,
    created_at: value.created_at || value.checked_at || null,
    snapshot_digest: value.snapshot_digest || null
  };
}

function boundedStateResult(state, args = {}) {
  const cursor = Number.isInteger(args.cursor) ? args.cursor : 0;
  const limit = Number.isInteger(args.limit)
    ? Math.min(MAX_MCP_STATE_PAGE_ITEMS, args.limit)
    : MAX_MCP_STATE_PAGE_ITEMS;
  const allowedKinds = Array.isArray(args.item_kinds)
    ? new Set(args.item_kinds)
    : null;
  const allItems = state.items.filter((item) =>
    !allowedKinds || allowedKinds.has(item.kind));
  const base = {
    schema_version: state.schema_version,
    task_ref: state.task_ref,
    generation: state.generation,
    enabled: state.enabled,
    lifecycle_status: state.lifecycle_status,
    contract: compactContract(state.contract),
    items: [],
    page: {
      cursor,
      limit,
      returned: 0,
      total: allItems.length,
      next_cursor: null,
      omitted: Math.max(0, allItems.length - cursor)
    },
    pending_prompt_signals: state.pending_prompt_signals.slice(0, 2).map((signal) => ({
      event_id: signal.event_id,
      prompt_sha256: signal.prompt_sha256,
      signals: signal.signals,
      excerpt: signal.excerpt ? signal.excerpt.slice(0, 240) : null,
      excerpt_truncated: Boolean(signal.excerpt_truncated
        || (signal.excerpt && signal.excerpt.length > 240)),
      recorded_at: signal.recorded_at
    })),
    pending_prompt_signal_count: state.pending_prompt_signals.length,
    coverage_gaps: state.coverage_gaps.slice(0, 8),
    coverage_gap_count: state.coverage_gaps.length,
    latest_workspace: state.latest_workspace ? {
      digest: state.latest_workspace.digest,
      git_head: state.latest_workspace.git_head,
      content_sha256: state.latest_workspace.content_sha256,
      observed_at: state.latest_workspace.observed_at
    } : null,
    latest_snapshot: compactLifecycle(state.latest_snapshot),
    latest_compaction: compactLifecycle(state.latest_compaction),
    latest_restore: compactLifecycle(state.latest_restore),
    projection_digest: state.projection_digest,
    ledger_head: state.ledger_head,
    updated_at: state.updated_at,
    execution_guard_view: boundedGuardView(state.execution_guard_view),
    storage: state.storage,
    response_mode: "bounded_page"
  };
  for (const item of allItems.slice(cursor, cursor + limit)) {
    const candidate = {
      ...base,
      items: [...base.items, item]
    };
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8")
        > MAX_MCP_RESPONSE_BYTES - 1024) {
      break;
    }
    base.items.push(item);
  }
  base.page.returned = base.items.length;
  const next = cursor + base.items.length;
  base.page.next_cursor = next < allItems.length ? next : null;
  base.page.omitted = Math.max(0, allItems.length - next);
  base.response_bytes = Buffer.byteLength(JSON.stringify(base), "utf8");
  return base;
}

function mutationSummary(value, args = {}) {
  const requestedIds = [
    ...(args.items || []).map((item) => item.id).filter(Boolean),
    ...(args.replacements || []).map((item) => item.id).filter(Boolean),
    args.correction?.id
  ].filter(Boolean);
  return {
    schema_version: value.schema_version,
    task_ref: value.task_ref,
    generation: value.generation,
    enabled: value.enabled,
    lifecycle_status: value.lifecycle_status,
    contract: compactContract(value.contract),
    projection_digest: value.projection_digest,
    changed_item_ids: [...new Set(requestedIds)],
    active_item_count: Array.isArray(value.items) ? value.items.length : null,
    pending_prompt_signal_count: Array.isArray(value.pending_prompt_signals)
      ? value.pending_prompt_signals.length
      : null,
    coverage_gap_count: Array.isArray(value.coverage_gaps)
      ? value.coverage_gaps.length
      : null,
    high_risk_gap_count: Array.isArray(value.coverage_gaps)
      ? value.coverage_gaps.filter((gap) => gap.severity === "high").length
      : null,
    response_mode: "mutation_summary"
  };
}

function snapshotSummary(value) {
  const snapshot = value.snapshot;
  return {
    schema_version: value.schema_version,
    task_ref: value.task_ref,
    enabled: value.enabled,
    generation: value.generation,
    snapshot: snapshot ? {
      snapshot_id: snapshot.snapshot_id,
      snapshot_digest: snapshot.snapshot_digest,
      created_at: snapshot.created_at,
      trigger: snapshot.trigger,
      item_count: snapshot.items?.length || 0,
      coverage_gap_count: snapshot.coverage_gaps?.length || 0,
      workspace_digest: snapshot.workspace?.digest || null
    } : null,
    response_mode: "snapshot_summary"
  };
}

function withImplicitConfirmedUserFields(args) {
  if (!args || !Array.isArray(args.items)) {
    return args;
  }
  return {
    ...args,
    items: args.items.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return item;
      }
      if (item.authority !== undefined && item.authority !== "user") {
        return item;
      }
      return {
        ...item,
        authority: item.authority ?? "user",
        verification: item.verification ?? "verified"
      };
    })
  };
}

export class McpRuntime {
  constructor(service) {
    this.service = service;
  }

  async callTool(name, args) {
    switch (name) {
      case "continuity_get_state":
        return boundedStateResult(await this.service.getState({
          ...args,
          create_if_missing: false
        }), args);
      case "continuity_prepare_confirmation":
        return this.service.prepareStateConfirmation(
          withImplicitConfirmedUserFields(args)
        );
      case "continuity_record_state":
        {
          const publicArgs = args?.source_event_id
            ? withImplicitConfirmedUserFields(args)
            : args;
        return mutationSummary(await this.service.recordState({
          ...publicArgs,
          provider: "standalone",
          evidence_provider_token: undefined
        }), publicArgs);
        }
      case "continuity_correct_state":
        return mutationSummary(await this.service.correctState(args), args);
      case "continuity_snapshot_state":
        return snapshotSummary(await this.service.createSnapshot({
          task_ref: args.task_ref,
          cwd: args.cwd,
          trigger: "manual",
          turn_id: "mcp"
        }));
      case "continuity_export_handoff":
        return this.service.exportHandoff({
          ...args,
          max_bytes: Math.min(
            MAX_MCP_HANDOFF_BYTES,
            args.max_bytes || MAX_MCP_HANDOFF_BYTES
          )
        });
      case "continuity_import_handoff":
        return this.service.importHandoff(args);
      case "continuity_manage_state":
        {
          const value = await this.service.manageState(args);
          if (value.state?.items) {
            return {
              ...value,
              state: boundedStateResult(value.state, {})
            };
          }
          if (value.items) {
            return mutationSummary(value, args);
          }
          return value;
        }
      default:
        throw Object.assign(new Error("Unknown MCP tool: " + name), {
          code: "UNKNOWN_MCP_TOOL"
        });
    }
  }

  async handle(message) {
    if (message.method === "initialize") {
      return {
        protocolVersion: message.params?.protocolVersion || "2025-06-18",
        capabilities: {
          resources: {
            listChanged: false
          },
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: "context-continuity",
          version: SERVER_VERSION
        },
        instructions: "Read continuity_get_state before writes. Preserve source, supersession, disputes, and uncertainty. User authority requires the exact generation-bound prompt from continuity_prepare_confirmation; natural language, quotes, negation, and paraphrases remain unverified. The public tool surface does not accept model-supplied provider credentials or allow the model to mint verified evidence. Imported handoffs and platform summaries are candidates only. If the host cannot read the installed Skill file directly, read context-continuity://skill/context-continuity. Never use this server as a memory platform, planner, permission system, or completion oracle."
      };
    }
    if (message.method === "ping") {
      return {};
    }
    if (message.method === "tools/list") {
      return {
        tools: TOOLS
      };
    }
    if (message.method === "resources/list") {
      return {
        resources: [
          {
            uri: SKILL_URI,
            name: "Context Continuity Skill",
            description: "Read-only fallback for the bundled Context Continuity operating policy.",
            mimeType: "text/markdown"
          }
        ]
      };
    }
    if (message.method === "resources/read") {
      if (message.params?.uri !== SKILL_URI) {
        const error = new Error("Resource not found: " + message.params?.uri);
        error.code = "RESOURCE_NOT_FOUND";
        throw error;
      }
      return {
        contents: [
          {
            uri: SKILL_URI,
            mimeType: "text/markdown",
            text: await fs.readFile(SKILL_PATH, "utf8")
          }
        ]
      };
    }
    if (message.method === "resources/templates/list") {
      return {
        resourceTemplates: []
      };
    }
    if (message.method === "tools/call") {
      try {
        const value = await this.callTool(
          message.params?.name,
          message.params?.arguments || {}
        );
        return successToolResult(value);
      } catch (error) {
        return errorToolResult(error);
      }
    }
    if (message.method === "notifications/initialized"
        || message.method === "notifications/cancelled") {
      return undefined;
    }
    throw new ContinuityError(
      "METHOD_NOT_FOUND",
      "Method not found: " + message.method
    );
  }
}

export class StdioMessageParser {
  constructor(onMessage) {
    this.onMessage = onMessage;
    this.buffer = Buffer.alloc(0);
  }

  async push(chunk) {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)]);
    if (this.buffer.length > MAX_MCP_INPUT_BYTES) {
      throw new Error("MCP input exceeds the " + MAX_MCP_INPUT_BYTES + " byte limit.");
    }
    while (this.buffer.length > 0) {
      const asText = this.buffer.toString("utf8");
      if (/^Content-Length:/i.test(asText)) {
        const headerEnd = this.buffer.indexOf(Buffer.from("\r\n\r\n"));
        if (headerEnd < 0) {
          return;
        }
        const header = this.buffer.slice(0, headerEnd).toString("ascii");
        const match = /Content-Length:\s*(\d+)/i.exec(header);
        if (!match) {
          throw new Error("Invalid Content-Length frame.");
        }
        const length = Number.parseInt(match[1], 10);
        if (length > MAX_MCP_INPUT_BYTES) {
          throw new Error("MCP Content-Length exceeds the input byte limit.");
        }
        const bodyStart = headerEnd + 4;
        if (this.buffer.length < bodyStart + length) {
          return;
        }
        const body = this.buffer.slice(bodyStart, bodyStart + length).toString("utf8");
        this.buffer = this.buffer.slice(bodyStart + length);
        await this.onMessage(JSON.parse(body), "content-length");
        continue;
      }
      const newline = this.buffer.indexOf(10);
      if (newline < 0) {
        return;
      }
      const line = this.buffer.slice(0, newline).toString("utf8").trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        await this.onMessage(JSON.parse(line), "ndjson");
      }
    }
  }

  async finish() {
    const remaining = this.buffer.toString("utf8").trim();
    this.buffer = Buffer.alloc(0);
    if (remaining) {
      await this.onMessage(JSON.parse(remaining), "ndjson");
    }
  }
}

function sendMessage(message, framing) {
  const body = JSON.stringify(message);
  if (framing === "content-length") {
    process.stdout.write(
      "Content-Length: " + Buffer.byteLength(body, "utf8") + "\r\n\r\n" + body
    );
  } else {
    process.stdout.write(body + "\n");
  }
}

export async function runMcpServer(environment = process.env) {
  const runtime = new McpRuntime(createServiceFromEnvironment(environment));
  const parser = new StdioMessageParser(async (message, framing) => {
    if (!Object.hasOwn(message, "id")) {
      await runtime.handle(message);
      return;
    }
    try {
      const result = await runtime.handle(message);
      sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        result
      }, framing);
    } catch (error) {
      const publicValue = publicError(error);
      sendMessage({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: publicValue.message,
          data: publicValue
        }
      }, framing);
    }
  });
  let processing = Promise.resolve();
  process.stdin.on("data", (chunk) => {
    processing = processing.then(() => parser.push(chunk)).catch(() => {
      process.exitCode = 1;
    });
  });
  process.stdin.on("end", () => {
    processing.then(() => parser.finish()).catch(() => {
      process.exitCode = 1;
    });
  });
  process.stdin.resume();
}

const invokedDirectly = process.argv[1]
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  await runMcpServer();
}
