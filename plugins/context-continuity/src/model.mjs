import {
  AUTHORITIES,
  HIGH_RISK_KINDS,
  INTENT_KINDS,
  ITEM_KINDS,
  ITEM_PRIORITY,
  ITEM_STATUSES,
  LEDGER_EVENT_TYPES,
  MAX_EVENTS_PER_TASK,
  MAX_ITEM_ID_CHARS,
  MAX_SCOPE_CHARS,
  MAX_SOURCE_REF_CHARS,
  MAX_STATEMENT_CHARS,
  MAX_SUPERSEDES_PER_ITEM,
  OPERATIONAL_KINDS,
  PROMPT_SIGNAL_SEVERITY,
  SCHEMA_VERSION,
  VERIFICATION_STATES
} from "./constants.mjs";
import { ContinuityError, assertCondition } from "./errors.mjs";
import { redactText } from "./redact.mjs";
import {
  canonicalJson,
  clone,
  makeId,
  nowIso,
  sha256,
  uniqueStrings
} from "./util.mjs";

const UNSAFE_METADATA_CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const LEDGER_ROOT_KEYS = new Set([
  "schema_version",
  "task_ref",
  "created_at",
  "updated_at",
  "events"
]);
const LEDGER_EVENT_KEYS = new Set([
  "schema_version",
  "event_id",
  "sequence",
  "event_type",
  "recorded_at",
  "source_ref",
  "previous_hash",
  "payload",
  "event_hash"
]);

function hasExactKeys(value, allowed) {
  const keys = Object.keys(value);
  return keys.length === allowed.size && keys.every((key) => allowed.has(key));
}

function isValidTimestamp(value) {
  return typeof value === "string"
    && value.length <= 64
    && Number.isFinite(new Date(value).valueOf());
}

export function createLedger(taskRef, clock = Date) {
  const timestamp = nowIso(clock);
  return {
    schema_version: SCHEMA_VERSION,
    task_ref: taskRef,
    created_at: timestamp,
    updated_at: timestamp,
    events: []
  };
}

function eventForHash(event) {
  const copy = clone(event);
  delete copy.event_hash;
  return copy;
}

export function appendSealedEvent(ledger, eventType, payload, options = {}) {
  assertCondition(LEDGER_EVENT_TYPES.has(eventType),
    "UNKNOWN_LEDGER_EVENT",
    "The ledger event type is not supported.",
    { event_type: eventType });
  assertCondition(payload && typeof payload === "object" && !Array.isArray(payload),
    "INVALID_LEDGER_EVENT", "Ledger event payload must be an object.");
  assertCondition(ledger.events.length < MAX_EVENTS_PER_TASK,
    "EVENT_LIMIT_REACHED",
    "The task event limit was reached. Export and reset the task before continuing.",
    { limit: MAX_EVENTS_PER_TASK });
  const previous = ledger.events.at(-1);
  const event = {
    schema_version: SCHEMA_VERSION,
    event_id: options.eventId || makeId("evt"),
    sequence: ledger.events.length + 1,
    event_type: eventType,
    recorded_at: options.recordedAt || nowIso(options.clock || Date),
    source_ref: options.sourceRef || "continuity:internal",
    previous_hash: previous ? previous.event_hash : null,
    payload: clone(payload)
  };
  event.event_hash = sha256(eventForHash(event));
  ledger.events.push(event);
  ledger.updated_at = event.recorded_at;
  return event;
}

export function verifyLedger(ledger, expectedTaskRef = undefined) {
  assertCondition(ledger && typeof ledger === "object" && !Array.isArray(ledger),
    "INVALID_LEDGER", "Ledger must be an object.");
  assertCondition(hasExactKeys(ledger, LEDGER_ROOT_KEYS),
    "INVALID_LEDGER_FIELDS", "Ledger contains missing or unsupported root fields.");
  assertCondition(ledger.schema_version === SCHEMA_VERSION,
    "UNSUPPORTED_SCHEMA", "Unsupported ledger schema version.",
    { found: ledger.schema_version, supported: SCHEMA_VERSION });
  assertCondition(typeof ledger.task_ref === "string"
      && /^[A-Za-z][A-Za-z0-9_-]{1,31}:[^\s]{1,223}$/.test(ledger.task_ref)
      && ledger.task_ref.length <= 256,
    "INVALID_LEDGER", "Ledger task_ref is invalid.");
  assertCondition(isValidTimestamp(ledger.created_at)
      && isValidTimestamp(ledger.updated_at),
    "INVALID_LEDGER", "Ledger timestamps are invalid.");
  if (expectedTaskRef !== undefined) {
    assertCondition(ledger.task_ref === expectedTaskRef,
      "TASK_REF_COLLISION", "The task directory belongs to a different task_ref.");
  }
  assertCondition(Array.isArray(ledger.events),
    "INVALID_LEDGER", "Ledger events must be an array.");
  assertCondition(ledger.events.length <= MAX_EVENTS_PER_TASK,
    "EVENT_LIMIT_REACHED",
    "The task event limit was exceeded.",
    { limit: MAX_EVENTS_PER_TASK });
  let previousHash = null;
  for (let index = 0; index < ledger.events.length; index += 1) {
    const event = ledger.events[index];
    assertCondition(event && typeof event === "object" && !Array.isArray(event),
      "INVALID_LEDGER_EVENT", "Each ledger event must be an object.",
      { sequence: index + 1 });
    assertCondition(hasExactKeys(event, LEDGER_EVENT_KEYS),
      "INVALID_LEDGER_EVENT_FIELDS",
      "A ledger event contains missing or unsupported fields.",
      { sequence: index + 1 });
    assertCondition(event.schema_version === SCHEMA_VERSION,
      "UNSUPPORTED_SCHEMA", "A ledger event has an unsupported schema version.",
      { sequence: index + 1, found: event.schema_version });
    assertCondition(typeof event.event_id === "string"
        && event.event_id.length > 0
        && event.event_id.length <= MAX_ITEM_ID_CHARS
        && !UNSAFE_METADATA_CONTROL.test(event.event_id),
      "INVALID_LEDGER_EVENT", "A ledger event_id is invalid.",
      { sequence: index + 1 });
    assertCondition(LEDGER_EVENT_TYPES.has(event.event_type),
      "UNKNOWN_LEDGER_EVENT", "The ledger contains an unsupported event type.",
      { sequence: index + 1, event_type: event.event_type });
    assertCondition(isValidTimestamp(event.recorded_at),
      "INVALID_LEDGER_EVENT", "A ledger event timestamp is invalid.",
      { sequence: index + 1 });
    assertCondition(typeof event.source_ref === "string"
        && event.source_ref.length > 0
        && event.source_ref.length <= MAX_SOURCE_REF_CHARS
        && !UNSAFE_METADATA_CONTROL.test(event.source_ref),
      "INVALID_LEDGER_EVENT", "A ledger source_ref is invalid.",
      { sequence: index + 1 });
    assertCondition(event.payload && typeof event.payload === "object"
        && !Array.isArray(event.payload),
      "INVALID_LEDGER_EVENT", "A ledger event payload must be an object.",
      { sequence: index + 1 });
    assertCondition(event.previous_hash === null
        || /^[a-f0-9]{64}$/.test(event.previous_hash),
      "INVALID_LEDGER_EVENT", "A ledger previous_hash is invalid.",
      { sequence: index + 1 });
    assertCondition(/^[a-f0-9]{64}$/.test(event.event_hash || ""),
      "INVALID_LEDGER_EVENT", "A ledger event_hash is invalid.",
      { sequence: index + 1 });
    assertCondition(event.sequence === index + 1,
      "LEDGER_SEQUENCE_GAP", "Ledger event sequence is not contiguous.",
      { expected: index + 1, found: event.sequence });
    assertCondition(event.previous_hash === previousHash,
      "LEDGER_CHAIN_BROKEN", "Ledger previous_hash does not match.",
      { sequence: event.sequence });
    const expectedHash = sha256(eventForHash(event));
    assertCondition(event.event_hash === expectedHash,
      "LEDGER_HASH_MISMATCH", "Ledger event hash verification failed.",
      { sequence: event.sequence });
    previousHash = event.event_hash;
  }
  assertCondition(ledger.updated_at === (ledger.events.at(-1)?.recorded_at
      || ledger.created_at),
    "INVALID_LEDGER", "Ledger updated_at does not match its last event.");
  return true;
}

function emptyProjection(ledger) {
  return {
    schema_version: SCHEMA_VERSION,
    task_ref: ledger.task_ref,
    generation: 0,
    enabled: true,
    lifecycle_status: "active",
      contract: {
        source: "standalone",
        contract_ref: "continuity:" + ledger.task_ref,
        contract_version: 1,
        snapshot_sha256: null,
        items_digest: null,
        active_intent_item_ids: []
      },
    active_operational_item_ids: [],
    items: {},
    pending_prompt_signals: {},
    management_challenges: {},
    latest_workspace: null,
    latest_snapshot: null,
    latest_compaction: null,
    latest_restore: null,
    latest_subagent: null,
    last_event_sequence: 0,
    ledger_head: null,
    created_at: ledger.created_at,
    updated_at: ledger.updated_at
  };
}

function addActiveId(list, itemId) {
  if (!list.includes(itemId)) {
    list.push(itemId);
  }
}

function removeActiveId(list, itemId) {
  const index = list.indexOf(itemId);
  if (index >= 0) {
    list.splice(index, 1);
  }
}

function supersedeItem(projection, itemId, supersededBy) {
  const prior = projection.items[itemId];
  if (!prior) {
    return;
  }
  prior.status = "superseded";
  prior.superseded_by = supersededBy;
  removeActiveId(projection.contract.active_intent_item_ids, itemId);
  removeActiveId(projection.active_operational_item_ids, itemId);
}

function applyItems(projection, items) {
  for (const item of items) {
    for (const superseded of item.supersedes) {
      supersedeItem(projection, superseded, item.id);
    }
    projection.items[item.id] = clone(item);
    if (item.status !== "superseded") {
      if (item.namespace === "intent") {
        addActiveId(projection.contract.active_intent_item_ids, item.id);
      } else {
        addActiveId(projection.active_operational_item_ids, item.id);
      }
    }
  }
}

function clearActiveState(projection) {
  for (const itemId of [
    ...projection.contract.active_intent_item_ids,
    ...projection.active_operational_item_ids
  ]) {
    supersedeItem(projection, itemId, "continuity:clear");
  }
  projection.contract.active_intent_item_ids = [];
  projection.active_operational_item_ids = [];
  projection.pending_prompt_signals = {};
  projection.management_challenges = {};
}

function markPotentiallyStaleNextActions(projection, incomingItems) {
  const canChangeWorkPosition = incomingItems.some((item) =>
    ["completion", "evidence", "work_object"].includes(item.kind));
  if (!canChangeWorkPosition) {
    return;
  }
  const explicitlyHandled = new Set(incomingItems.flatMap((item) => [
    item.id,
    ...(item.supersedes || [])
  ]));
  for (const item of activeItems(projection)) {
    if (item.kind === "next_action" && !explicitlyHandled.has(item.id)) {
      item.verification = "stale";
    }
  }
}

function markWorkspaceDependentItemsStale(projection, incomingWorkspace) {
  const previous = projection.latest_workspace;
  if (!previous || previous.digest === incomingWorkspace?.digest) {
    return;
  }
  const workspaceDependentKinds = new Set([
    "work_object",
    "completion",
    "evidence",
    "next_action"
  ]);
  for (const item of activeItems(projection)) {
    if (workspaceDependentKinds.has(item.kind)
        && item.verification === "verified") {
      item.verification = "stale";
    }
  }
}

export function projectLedger(ledger) {
  verifyLedger(ledger);
  const projection = emptyProjection(ledger);
  for (const event of ledger.events) {
    projection.last_event_sequence = event.sequence;
    projection.ledger_head = event.event_hash;
    projection.updated_at = event.recorded_at;
    const payload = event.payload || {};
    switch (event.event_type) {
      case "workspace_observed":
        markWorkspaceDependentItemsStale(projection, payload.workspace);
        projection.latest_workspace = clone(payload.workspace);
        break;
      case "next_actions_revalidation_required":
        for (const itemId of payload.item_ids || []) {
          const item = projection.items[itemId];
          if (item?.kind === "next_action" && item.status !== "superseded") {
            item.verification = "stale";
          }
        }
        break;
      case "prompt_signal_observed":
        if (payload.signals && payload.signals.length > 0) {
          projection.pending_prompt_signals[event.event_id] = {
            event_id: event.event_id,
            prompt_sha256: payload.prompt_sha256,
            signals: clone(payload.signals),
            excerpt: payload.excerpt || null,
            excerpt_truncated: Boolean(payload.excerpt_truncated),
            recorded_at: event.recorded_at
          };
        }
        break;
      case "state_recorded":
        markPotentiallyStaleNextActions(projection, payload.items || []);
        applyItems(projection, payload.items || []);
        for (const eventId of payload.resolved_prompt_event_ids || []) {
          delete projection.pending_prompt_signals[eventId];
        }
        projection.generation += 1;
        projection.lifecycle_status = "active";
        if (projection.contract.source === "standalone"
            && (payload.items || []).some((item) => item.namespace === "intent")) {
          projection.contract.contract_version += 1;
        }
        break;
      case "external_contract_bound": {
        for (const itemId of [...projection.contract.active_intent_item_ids]) {
          supersedeItem(projection, itemId, event.event_id);
        }
        projection.contract = {
          source: "user-intent-plugin",
          contract_ref: payload.contract_ref,
          contract_version: payload.contract_version,
          snapshot_sha256: payload.snapshot_sha256,
          items_digest: payload.items_digest,
          active_intent_item_ids: []
        };
        applyItems(projection, payload.items || []);
        for (const eventId of payload.resolved_prompt_event_ids || []) {
          delete projection.pending_prompt_signals[eventId];
        }
        projection.generation += 1;
        projection.lifecycle_status = "active";
        break;
      }
      case "task_cleared":
      case "task_reset":
        clearActiveState(projection);
        projection.latest_snapshot = null;
        projection.latest_compaction = null;
        projection.latest_restore = null;
        projection.latest_subagent = null;
        projection.lifecycle_status = event.event_type === "task_cleared"
          ? "cleared"
          : "active";
        projection.contract = {
          source: "standalone",
          contract_ref: "continuity:" + ledger.task_ref + ":" + event.sequence,
          contract_version: 1,
          snapshot_sha256: null,
          items_digest: null,
          active_intent_item_ids: []
        };
        projection.generation += 1;
        break;
      case "enabled_changed":
        projection.enabled = Boolean(payload.enabled);
        if (payload.confirmed_prompt_event_id) {
          delete projection.pending_prompt_signals[payload.confirmed_prompt_event_id];
        }
        if (payload.action) {
          delete projection.management_challenges[payload.action];
        }
        projection.generation += 1;
        break;
      case "management_challenge_issued":
        projection.management_challenges[payload.action] = clone(payload);
        if (payload.prompt_event_id) {
          delete projection.pending_prompt_signals[payload.prompt_event_id];
        }
        projection.generation += 1;
        break;
      case "snapshot_created":
        projection.latest_snapshot = clone(payload);
        break;
      case "compaction_completed":
        projection.latest_compaction = clone(payload);
        break;
      case "restore_checked":
        projection.latest_restore = clone(payload);
        break;
      case "subagent_capsule_exported":
      case "subagent_result_observed":
      case "handoff_imported":
        projection.latest_subagent = {
          event_type: event.event_type,
          ...clone(payload)
        };
        break;
      default:
        break;
    }
  }
  return projection;
}

export function namespaceForKind(kind) {
  if (INTENT_KINDS.has(kind)) {
    return "intent";
  }
  if (OPERATIONAL_KINDS.has(kind)) {
    return "operational";
  }
  throw new ContinuityError("INVALID_ITEM_KIND", "Unsupported state item kind.", { kind });
}

const AUTHORITY_RANK = new Map([
  ["agent_inference", 1],
  ["verified_evidence", 2],
  ["user", 3]
]);

function validateSupersedes(
  values,
  projection,
  namespace,
  authority,
  verification
) {
  const result = uniqueStrings(values || [], "supersedes");
  assertCondition(result.length <= MAX_SUPERSEDES_PER_ITEM,
    "SUPERSEDES_LIMIT",
    "A state item cannot supersede more than " + MAX_SUPERSEDES_PER_ITEM + " items.");
  for (const itemId of result) {
    assertCondition(itemId.length <= MAX_ITEM_ID_CHARS,
      "INVALID_FIELD", "supersedes item IDs are too long.");
    assertCondition(Boolean(projection.items[itemId]),
      "UNKNOWN_SUPERSEDED_ITEM",
      "A superseded item does not exist in the current task.",
      { item_id: itemId });
    const prior = projection.items[itemId];
    assertCondition(prior.namespace === namespace,
      "CROSS_NAMESPACE_SUPERSESSION",
      "An intent item and an operational item cannot silently supersede each other.",
      { item_id: itemId });
    assertCondition((AUTHORITY_RANK.get(authority) || 0)
      >= (AUTHORITY_RANK.get(prior.authority) || 0),
    "LOWER_AUTHORITY_SUPERSESSION",
    "A lower-authority item cannot supersede a higher-authority item.",
    { item_id: itemId, prior_authority: prior.authority, new_authority: authority });
    if (prior.verification === "verified") {
      assertCondition(verification === "verified",
        "UNVERIFIED_SUPERSESSION",
        "An unverified item cannot supersede a verified item.",
        { item_id: itemId });
    }
  }
  return result;
}

export function normalizeStateItem(input, context) {
  assertCondition(input && typeof input === "object" && !Array.isArray(input),
    "INVALID_STATE_ITEM", "Each state item must be an object.");
  assertCondition(ITEM_KINDS.has(input.kind),
    "INVALID_ITEM_KIND", "Unsupported state item kind.", { kind: input.kind });
  const namespace = namespaceForKind(input.kind);
  const statementResult = redactText(input.statement, MAX_STATEMENT_CHARS);
  assertCondition(statementResult.text.trim().length > 0,
    "EMPTY_STATEMENT", "State item statement must not be empty.");
  const authority = input.authority || "agent_inference";
  const verification = input.verification || "unverified";
  const status = input.status || (verification === "verified" ? "active" : "unverified");
  assertCondition(AUTHORITIES.has(authority),
    "INVALID_AUTHORITY", "Unsupported authority.", { authority });
  assertCondition(VERIFICATION_STATES.has(verification),
    "INVALID_VERIFICATION", "Unsupported verification state.", { verification });
  assertCondition(ITEM_STATUSES.has(status),
    "INVALID_STATUS", "Unsupported item status.", { status });
  if (authority === "agent_inference") {
    assertCondition(typeof input.confidence === "number"
      && input.confidence >= 0
      && input.confidence <= 1,
    "INFERENCE_CONFIDENCE_REQUIRED",
    "Agent inferences require confidence between 0 and 1.");
    assertCondition(verification !== "verified",
      "INFERENCE_CANNOT_SELF_VERIFY",
      "An agent inference cannot mark itself verified.");
  }
  if (authority === "user") {
    assertCondition(typeof input.id === "string" && input.id.trim().length > 0,
      "USER_ITEM_ID_REQUIRED",
      "User-authoritative items require an explicit stable item id.");
  }
  if (authority === "user"
      && !["external_contract", "confirmation_preview"].includes(context.mode)) {
    assertCondition(typeof context.sourceEventId === "string"
      && context.promptEventIds.has(context.sourceEventId),
    "USER_SOURCE_REQUIRED",
    "User-authoritative items must reference an observed UserPromptSubmit event.");
    assertCondition(input.source_ref === undefined,
      "USER_SOURCE_REF_DERIVED",
      "source_ref for user-authoritative items is derived from the confirmation event.");
    assertCondition(input.recorded_at === undefined,
      "USER_RECORDED_AT_DERIVED",
      "recorded_at for user-authoritative items is derived from the confirmation event.");
    assertCondition(input.evidence_digest === undefined,
      "USER_EVIDENCE_DIGEST_FORBIDDEN",
      "User-authoritative state cannot self-assert an evidence digest.");
  }
  if (authority === "user" && context.mode === "confirmation_preview") {
    assertCondition(input.source_ref === undefined,
      "USER_SOURCE_REF_DERIVED",
      "source_ref for user-authoritative items is derived from the confirmation event.");
    assertCondition(input.recorded_at === undefined,
      "USER_RECORDED_AT_DERIVED",
      "recorded_at for user-authoritative items is derived from the confirmation event.");
    assertCondition(input.evidence_digest === undefined,
      "USER_EVIDENCE_DIGEST_FORBIDDEN",
      "User-authoritative state cannot self-assert an evidence digest.");
  }
  if (authority === "verified_evidence") {
    assertCondition(context.provider === "verified-evidence",
      "VERIFIED_EVIDENCE_PROVIDER_REQUIRED",
      "Verified evidence can be written only through the authenticated evidence provider.");
  }
  if (input.kind === "authorization") {
    assertCondition(authority === "user",
      "AUTHORIZATION_REQUIRES_USER",
      "Task authorization can only come from an explicit user source.");
  }
  const sourceRef = input.source_ref
    || (context.sourceEventId ? "prompt:" + context.sourceEventId : null);
  assertCondition(typeof sourceRef === "string" && sourceRef.trim().length > 0,
    "SOURCE_REF_REQUIRED", "Every state item requires source_ref.");
  const sourceRefResult = redactText(sourceRef.trim(), MAX_SOURCE_REF_CHARS);
  assertCondition(!UNSAFE_METADATA_CONTROL.test(sourceRefResult.text),
    "UNSAFE_SOURCE_REF",
    "source_ref cannot contain line breaks, control characters, or bidi controls.");
  const scope = input.scope || "task";
  assertCondition(typeof scope === "string" && scope.trim().length > 0,
  "SCOPE_LIMIT", "scope must be a non-empty string no longer than "
    + MAX_SCOPE_CHARS + " characters.");
  const scopeResult = redactText(scope.trim(), MAX_SCOPE_CHARS);
  assertCondition(!scopeResult.truncated,
    "SCOPE_LIMIT", "scope must be a non-empty string no longer than "
      + MAX_SCOPE_CHARS + " characters.");
  assertCondition(!scopeResult.redacted,
    "SENSITIVE_SCOPE",
    "scope cannot contain credentials or secret-like values.");
  assertCondition(!UNSAFE_METADATA_CONTROL.test(scopeResult.text),
    "UNSAFE_SCOPE",
    "scope cannot contain line breaks, control characters, or bidi controls.");
  const supersedes = validateSupersedes(
    input.supersedes || [],
    context.projection,
    namespace,
    authority,
    verification
  );
  if (input.kind === "correction") {
    assertCondition(supersedes.length > 0,
      "CORRECTION_TARGET_REQUIRED",
      "A correction must identify at least one superseded item.");
  }
  if (verification === "verified"
      && authority === "verified_evidence"
      && ["completion", "work_object", "evidence"].includes(input.kind)) {
    assertCondition(typeof input.evidence_digest === "string"
      && /^[a-f0-9]{64}$/.test(input.evidence_digest),
    "EVIDENCE_DIGEST_REQUIRED",
    "Verified operational evidence requires a sha256 evidence_digest.");
  }
  let explicitItemId = null;
  if (input.id !== undefined) {
    assertCondition(typeof input.id === "string"
      && input.id.trim().length > 0,
    "ITEM_ID_LIMIT", "item id must be a non-empty string no longer than "
      + MAX_ITEM_ID_CHARS + " characters.");
    const idResult = redactText(input.id.trim(), MAX_ITEM_ID_CHARS);
    assertCondition(!idResult.truncated,
      "ITEM_ID_LIMIT", "item id must be a non-empty string no longer than "
        + MAX_ITEM_ID_CHARS + " characters.");
    assertCondition(!idResult.redacted,
      "SENSITIVE_ITEM_ID",
      "item id cannot contain credentials or secret-like values.");
    assertCondition(!UNSAFE_METADATA_CONTROL.test(idResult.text),
      "UNSAFE_ITEM_ID",
      "item id cannot contain line breaks, control characters, or bidi controls.");
    explicitItemId = idResult.text;
  }
  assertCondition(input.origin_authority === undefined
    || input.origin_authority === null,
  "ORIGIN_AUTHORITY_RESERVED",
  "origin_authority is reserved for verified import adapters.");
  const itemId = explicitItemId || "item:" + sha256({
    kind: input.kind,
    statement: statementResult.text,
    scope: scopeResult.text,
    source_ref: sourceRefResult.text
  }).slice(0, 20);
  const promptRecordedAt = authority === "user"
      && !["external_contract", "confirmation_preview"].includes(context.mode)
    ? context.promptEventIds.get(context.sourceEventId)?.recorded_at
    : null;
  const recordedAt = promptRecordedAt || input.recorded_at || nowIso(context.clock || Date);
  const recordedDate = new Date(recordedAt);
  assertCondition(Number.isFinite(recordedDate.valueOf()),
    "INVALID_RECORDED_AT", "recorded_at must be a valid date-time.");
  const normalized = {
    id: itemId,
    namespace,
    kind: input.kind,
    statement: statementResult.text,
    source_ref: sourceRefResult.text,
    recorded_at: recordedDate.toISOString(),
    scope: scopeResult.text,
    status,
    authority,
    verification,
    supersedes,
    superseded_by: null,
    confidence: authority === "agent_inference" ? input.confidence : null,
    evidence_digest: input.evidence_digest || null,
    provider: context.provider,
    origin_authority: null,
    redacted: statementResult.redacted || sourceRefResult.redacted,
    truncated: statementResult.truncated || sourceRefResult.truncated
  };
  const existing = context.projection.items[itemId];
  if (existing) {
    const sameMeaning = canonicalJson(stateItemIdentity(existing))
      === canonicalJson(stateItemIdentity(normalized));
    assertCondition(sameMeaning,
      "ITEM_ID_COLLISION",
      "An existing item ID cannot be silently rewritten. Create a new item and supersede the old one.",
      { item_id: itemId });
  }
  return normalized;
}

export function stateItemIdentity(item) {
  return {
    id: item.id,
    namespace: item.namespace,
    kind: item.kind,
    statement: item.statement,
    source_ref: item.source_ref,
    recorded_at: item.recorded_at,
    scope: item.scope,
    status: item.status,
    authority: item.authority,
    verification: item.verification,
    supersedes: item.supersedes,
    confidence: item.confidence ?? null,
    evidence_digest: item.evidence_digest ?? null,
    provider: item.provider,
    origin_authority: item.origin_authority ?? null,
    redacted: Boolean(item.redacted),
    truncated: Boolean(item.truncated)
  };
}

export function activeItems(projection) {
  const ids = [
    ...projection.contract.active_intent_item_ids,
    ...projection.active_operational_item_ids
  ];
  return ids
    .map((id) => projection.items[id])
    .filter(Boolean)
    .filter((item) => item.status !== "superseded")
    .sort((left, right) => {
      const priorityDifference = (ITEM_PRIORITY.get(right.kind) || 0)
        - (ITEM_PRIORITY.get(left.kind) || 0);
      if (priorityDifference !== 0) {
        return priorityDifference;
      }
      return left.recorded_at.localeCompare(right.recorded_at);
    });
}

export function projectionDigest(projection) {
  return sha256({
    task_ref: projection.task_ref,
    generation: projection.generation,
    contract: projection.contract,
    active_operational_item_ids: projection.active_operational_item_ids,
    items: activeItems(projection),
    pending_prompt_signals: projection.pending_prompt_signals,
    lifecycle_status: projection.lifecycle_status
  });
}

export function coverageGaps(projection) {
  const items = activeItems(projection);
  const kinds = new Set(items.map((item) => item.kind));
  const gaps = [];
  if (projection.generation > 0 && !kinds.has("objective")) {
    gaps.push({
      code: "missing_objective",
      severity: "high"
    });
  }
  if (projection.generation > 0 && !kinds.has("work_object")) {
    gaps.push({
      code: "missing_work_object",
      severity: "medium"
    });
  }
  if (projection.generation > 0 && !kinds.has("next_action")) {
    gaps.push({
      code: "missing_next_action",
      severity: "medium"
    });
  }
  const objectiveCount = items.filter((item) => item.kind === "objective").length;
  if (objectiveCount > 1) {
    gaps.push({
      code: "multiple_active_objectives",
      severity: "high",
      count: objectiveCount
    });
  }
  for (const signal of Object.values(projection.pending_prompt_signals)) {
    const severity = signal.signals.reduce((current, name) => {
      const candidate = PROMPT_SIGNAL_SEVERITY.get(name) || "low";
      if (candidate === "high" || current === "high") {
        return "high";
      }
      if (candidate === "medium" || current === "medium") {
        return "medium";
      }
      return "low";
    }, "low");
    gaps.push({
      code: "unresolved_prompt_signal",
      severity,
      event_id: signal.event_id,
      signals: signal.signals
    });
  }
  for (const item of items) {
    if (item.status === "disputed") {
      gaps.push({
        code: "disputed_item",
        severity: HIGH_RISK_KINDS.has(item.kind) ? "high" : "medium",
        item_id: item.id,
        kind: item.kind
      });
    } else if (HIGH_RISK_KINDS.has(item.kind)
        && ["stale", "unavailable"].includes(item.verification)) {
      gaps.push({
        code: "critical_item_not_current",
        severity: item.kind === "next_action" ? "medium" : "high",
        item_id: item.id,
        kind: item.kind,
        verification: item.verification
      });
    } else if (item.verification === "unverified") {
      gaps.push({
        code: "unverified_item",
        severity: HIGH_RISK_KINDS.has(item.kind) ? "high" : "low",
        item_id: item.id,
        kind: item.kind
      });
    }
  }
  return gaps;
}

export function effectiveState(projection) {
  const items = activeItems(projection);
  return {
    schema_version: SCHEMA_VERSION,
    task_ref: projection.task_ref,
    generation: projection.generation,
    enabled: projection.enabled,
    lifecycle_status: projection.lifecycle_status,
    contract: clone(projection.contract),
    items,
    pending_prompt_signals: Object.values(projection.pending_prompt_signals),
    coverage_gaps: coverageGaps(projection),
    latest_workspace: clone(projection.latest_workspace),
    latest_snapshot: clone(projection.latest_snapshot),
    latest_compaction: clone(projection.latest_compaction),
    latest_restore: clone(projection.latest_restore),
    projection_digest: projectionDigest(projection),
    ledger_head: projection.ledger_head,
    updated_at: projection.updated_at
  };
}

export function executionGuardView(projection) {
  const items = activeItems(projection);
  const firstVerified = (kind) => items.find((item) =>
    item.kind === kind && item.verification === "verified");
  return {
    schema_version: SCHEMA_VERSION,
    contract_ref: projection.contract.contract_ref,
    contract_version: projection.contract.contract_version,
    phase: firstVerified("phase")?.statement || "unknown",
    open_commitments: items
      .filter((item) => ["open_question", "dispute"].includes(item.kind)
        || (item.kind === "next_action" && item.verification === "verified"))
      .map((item) => item.id),
    evidence_refs: [...new Set(items
      .filter((item) => item.evidence_digest && item.verification === "verified")
      .map((item) => item.source_ref))],
    captured_at: projection.updated_at
  };
}

export function findPromptEvents(ledger) {
  return new Map(ledger.events
    .filter((event) => event.event_type === "prompt_signal_observed")
    .map((event) => [event.event_id, event]));
}

export function validateExpectedGeneration(projection, expectedGeneration) {
  assertCondition(Number.isInteger(expectedGeneration) && expectedGeneration >= 0,
    "EXPECTED_GENERATION_REQUIRED",
    "A non-negative expected_generation is required for state writes.");
  assertCondition(projection.generation === expectedGeneration,
    "GENERATION_CONFLICT",
    "The task state changed after it was read. Reload state before writing.",
    {
      expected: expectedGeneration,
      current: projection.generation
    });
}

export function externalContractDigest(items) {
  return sha256(items.map((item) => {
    assertCondition(typeof item.recorded_at === "string",
      "EXTERNAL_RECORDED_AT_REQUIRED",
      "Every external intent item requires a stable recorded_at timestamp.");
    assertCondition(item.origin_authority === undefined
      || item.origin_authority === null,
    "ORIGIN_AUTHORITY_RESERVED",
    "origin_authority is reserved for verified import adapters.");
    const recordedDate = new Date(item.recorded_at);
    assertCondition(Number.isFinite(recordedDate.valueOf()),
      "INVALID_RECORDED_AT", "recorded_at must be a valid date-time.");
    const statementResult = redactText(item.statement, MAX_STATEMENT_CHARS);
    const sourceRefResult = redactText(item.source_ref, MAX_SOURCE_REF_CHARS);
    const scopeResult = redactText((item.scope || "task").trim(), MAX_SCOPE_CHARS);
    const idResult = item.id === undefined
      ? null
      : redactText(String(item.id).trim(), MAX_ITEM_ID_CHARS);
    assertCondition(!scopeResult.redacted && !scopeResult.truncated,
      "SENSITIVE_SCOPE",
      "External intent scope cannot contain credentials or exceed its limit.");
    assertCondition(!idResult || (!idResult.redacted && !idResult.truncated),
      "SENSITIVE_ITEM_ID",
      "External intent item id cannot contain credentials or exceed its limit.");
    const authority = item.authority || "agent_inference";
    const verification = item.verification || "unverified";
    const status = item.status
      || (verification === "verified" ? "active" : "unverified");
    const supersedes = uniqueStrings(item.supersedes || [], "supersedes");
    const id = idResult?.text || "item:" + sha256({
      kind: item.kind,
      statement: statementResult.text,
      scope: scopeResult.text,
      source_ref: sourceRefResult.text
    }).slice(0, 20);
    return stateItemIdentity({
      id,
      namespace: item.namespace || namespaceForKind(item.kind),
      kind: item.kind,
      statement: statementResult.text,
      source_ref: sourceRefResult.text,
      recorded_at: recordedDate.toISOString(),
      scope: scopeResult.text,
      status,
      authority,
      verification,
      supersedes,
      confidence: authority === "agent_inference" ? item.confidence : null,
      evidence_digest: item.evidence_digest || null,
      provider: item.provider || "user-intent-plugin",
      origin_authority: null,
      redacted: Boolean(item.redacted
        || statementResult.redacted
        || sourceRefResult.redacted),
      truncated: Boolean(item.truncated
        || statementResult.truncated
        || sourceRefResult.truncated)
    });
  }));
}
