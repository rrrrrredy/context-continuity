# DeepSeek Harness capability record

Date: 2026-08-31
Tested host contract: `@deepseek-ai/dsh 0.1.1-rc.2` family

## Capability matrix

| Continuity need | DSH extension point | Adapter capability | Release use |
| --- | --- | --- | --- |
| Observe user input | `agent/inbox/inserted` | Observe | Records bounded, redacted provenance and keeps the trusted event ID outside model arguments |
| Capture the start-boundary ledger state | `session/event: compaction/start` | Observe after event commit | Queues the minimum Continuity-ledger snapshot; it cannot prove the write finished before the engine rewrote chat messages |
| Handle compaction summary content | `session/event: compaction/summary` | Observe only at the host | Intentionally ignored by the adapter and never persisted as task truth |
| Detect success or failure | `session/event: compaction/end` | Observe | Recovers only a successful matching boundary; failure does not create a false restore |
| Inject recovered state | `agent/pre-step` waterfall | Control model input before the step | Inserts the bounded recovery projection before the current message |
| Resume a task | `agent/session-start` resume source | Observe and recover | Rechecks the last durable task state and workspace |
| Detect a compact-specific session start | Type reserves `compact`; current emitted runtime was not verified | Unavailable as a guarantee | Uses durable compaction events plus the next pre-step instead |
| Parent/child handoff | Agent session metadata and start events | Observe and import as candidate | Never upgrades a handoff to verified user intent |
| Block or rewrite the engine's compaction | No verified pre-commit compaction transformer | Cannot control | The engine summary remains an untrusted cache |
| Store custom continuity events in the DSH session log | Unknown custom event persistence was not reliable in the tested release | Intentionally unused | Uses the plugin-owned bounded ledger |

`session/event` is a post-commit observer. It is sufficient to mirror durable
lifecycle evidence but cannot prevent or rewrite a compaction event.
`agent/pre-step` is awaited and may replace model messages, so it is the
recovery insertion point.

The adapter therefore cannot claim a pre-commit DSH snapshot Hook. It queues the
start-boundary job before the matching end-boundary recovery in a per-session
queue. The protected projection lives in the independent Continuity ledger, not
inside the DSH message list being compacted. This provides ordered recovery
evidence, while remaining a documented downgrade from a true blocking
pre-compaction extension point.

## Host-bound user authority

A first integration attempt exposed `source_event_id` as a native tool
argument. That would have allowed model-generated or stale identifiers to claim
user authority. The released adapter instead retains the latest trusted
`agent/inbox/inserted` observation inside the host process and binds it to
record, correction, and management calls. The public schemas hide
`task_ref`, `cwd`, and `source_event_id`.

This does not make the model's interpretation automatically correct. A
user-authoritative structured proposal still requires the existing exact
second-confirmation protocol.

## Verified evidence

`validation/dsh-real-lifecycle.json` records an integration run using the
published Cordis, AgentRegistry, Session, SystemPrompt, and ToolRuntime packages.
It verifies:

- native confirmation behavior;
- schema-valid `compaction/start`, `compaction/summary`, and
  `compaction/end` host events, with summary content intentionally ignored;
- recovery through the real `agent/pre-step` waterfall;
- preservation of objective and hard constraint;
- forced staleness of the old next action;
- host binding of the trusted user source.

`validation/dsh-package.json` records an isolated tarball install and module
import. Both receipts bind the current source tree and Codex plugin package
digests.

## Remaining limits

- The DSH CLI profile installation path was not exercised in the local release
  run because the full CLI dependency installation did not complete
  deterministically.
- The automatic DSH compaction engine itself was not triggered; the lifecycle
  integration uses schema-validated events through the published Session API.
- DSH is a developer preview. Compatibility is pinned to `0.1.1-rc.2`.
- No claim is made that this release improves user outcomes until the frozen
  three-arm efficacy study is complete.
