---
name: context-continuity
description: Preserve and verify the current task objective, constraints, corrections, work object, verified progress, disputes, and next safe action across Codex compaction, resume, clear, or subagent handoff. Use when a task is long-running, resumes after a pause, changes objective, receives a user correction, delegates to another agent, or the user asks to inspect, correct, reset, export, or delete continuity state.
---

# Context Continuity

Use the bundled local MCP tools to maintain one small task-state projection. Do not summarize the full conversation, create a second plan, or treat this as long-term memory.

## Default behavior

1. Stay silent on ordinary turns. Read state when a lifecycle recovery context requests it, when a material invariant may have changed, or when the user asks to inspect continuity.
2. Write only information that can change the next action: objective, hard constraint, authorization, correction, live decision, open question or dispute, work object/version, completion, phase, evidence reference, or next action.
3. Preserve disagreement and uncertainty as separate items. A platform summary, imported handoff, subagent result, or model recollection is only a candidate.
4. Never guess a task reference such as `current`. Use the Hook-provided `task_ref` and source event identifiers.
5. Load this Skill once per Agent turn. For an explicit state inspection, call `continuity_get_state` once with at most eight items; fetch another page only when the response reports an omitted critical item that can change the current action.
6. Do not call continuity tools on an ordinary turn unless a Hook recovery context, a material invariant change, or an explicit user request requires them.

## Establishing authority

Natural-language prompts, quoted text, negation, paraphrases, and Agent interpretations cannot directly create user-authoritative state.

- If a useful state item is not worth interrupting the user for, record it only as `agent_inference`, `unverified`, with a confidence and source. Do not resolve any prompt event.
- Ask for authoritative confirmation only when the user explicitly asks to protect or lock state, or when an unresolved continuity risk would affect the goal, scope, authorization, work object, publication, deletion, external communication, or another irreversible action.
- To confirm state, call `continuity_prepare_confirmation` with the complete proposed user items and any original prompt events being resolved. Show the returned `confirmation_prompt` verbatim. The user must send that exact readable prompt as a new message.
- After the Hook observes that new exact message, call `continuity_record_state` or `continuity_correct_state` with the new confirmation `source_event_id`; include the original material prompt event IDs only in `resolve_prompt_event_ids`. Never put the confirmation event itself in that list.
- For confirmed user items, provide `id`, `kind`, and `statement` plus only needed scope, status, or supersession fields. The public tools bind the fixed `user` authority and `verified` status; do not repeat them. Agent inferences still require explicit `authority: agent_inference`, a non-verified verification state, `source_ref`, and `confidence`.
- A generation change expires the proposal. Read current state and prepare a new confirmation instead of forcing the old one through.

Use `continuity_correct_state` only for user-intent corrections. Replace `work_object`, `completion`, `next_action`, `phase`, or `evidence` through `continuity_record_state` and explicitly supersede the old operational item.

The public Codex MCP cannot accept provider credentials, bind an external intent provider, or mint verified evidence. Do not invent tokens or claim those integrations are active.

## Lossy-transition recovery

1. Before compaction, Hooks create the minimal snapshot automatically.
2. After compact or resume, follow the injected recovery classification and the current ledger projection, not the platform summary.
3. Treat every recovered `next_action` as stale until it is rederived against the current objective, constraints, work object, workspace, and evidence.
4. For `continue_with_markers`, continue only with low-risk read-only or reversible work and retain the marker.
5. For `ask_before_high_risk`, ask one concise question before changing goal, scope, authorization, work object, publishing, deleting, sending externally, or performing another irreversible action.
6. Record completion only from an explicit user confirmation or a trusted internal evidence adapter. An earlier assistant claim is not completion evidence.

## User controls

- Show: call `continuity_get_state`.
- Rebuild: call `continuity_manage_state` with `rebuild`.
- Snapshot: call `continuity_snapshot_state` only for an explicit manual checkpoint; Hooks handle normal compaction snapshots.
- Export: call `continuity_export_handoff` with the smallest useful scope. Imports remain candidate-only.
- Correct: prepare and obtain the exact state confirmation, then call `continuity_correct_state`.
- Disable, enable, reset, or delete: the first explicit matching user request authorizes only `prepare_off`, `prepare_on`, `prepare_reset`, or `prepare_delete`. Show the returned `confirmation_phrase` verbatim. Perform `off`, `on`, `reset`, or `delete` only after a second Hook-observed user prompt matches it exactly, using that second event and the complete one-time `challenge_token` verbatim, including the literal `challenge:` prefix.
- If a prepare result is lost or not visible, repeat that same prepare action with the same source event to issue a fresh challenge. Never search logs, transcripts, caches, another task, the plugin data tree, or `CODEX_HOME` to recover a token or state.

While continuity is off, do not write state or lifecycle records. Read and bounded export remain available. Reset starts a new effective state without exposing old snapshot or restore pointers while retaining an archive; delete removes the exact task and its matching archives.

Keep statements minimal and redact secrets. Never store full transcripts, hidden reasoning, credentials, raw tool output, or user-profile memory. If the plugin fails, let the host Agent continue, but do not claim continuity protection for the affected transition.
