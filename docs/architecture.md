# Architecture

Context Continuity has one host-neutral runtime core and two thin adapters.

## Runtime surfaces

1. The core owns the append-only task ledger, schemas, authority rules,
   snapshots, recovery comparison, handoff capsules, caps, and deletion
   containment.
2. The Codex adapter uses Hooks for lifecycle observation and bounded context,
   a local stdio MCP server for eight state operations, and a Skill for model
   interaction guidance.
3. The DeepSeek Harness adapter uses native Session and Agent events, native
   tools, SystemPrompt, and the awaited `agent/pre-step` waterfall.
4. Both adapters derive a namespaced task reference from host-owned session and
   workspace identity. Model-facing calls cannot choose the namespace.
5. Snapshots are recovery aids addressed by the verified ledger. They are never
   a second source of truth.

Only `plugins/context-continuity/` is installed into Codex. The repository root
package carries the DSH adapter and `dsh.bundle.patch`.

## Authority order

For the same namespace, verified user state outranks verified evidence, which
outranks Agent inference. Unverified state cannot supersede verified state.

External handoffs, subagent results, platform summaries, retrieval assemblies,
and model memory enter as candidates. Disputes remain parallel records until a
later authoritative event resolves them. Timestamp alone does not grant
authority.

## One effective projection

The ledger is the rebuildable event source. The current projection contains only
items valid under source, verification, supersession, conflict, workspace, and
generation rules.

A snapshot is followed only through the ledger's verified reference. A
newer-looking orphan file, host summary, or imported capsule cannot become
authoritative by position or recency.

The core contains a reserved intent-provider adapter contract. The public Codex
MCP and DSH tools expose no provider credential or external binding path because
model-facing surfaces cannot isolate provider identity safely. A future trusted
host adapter must bind an immutable contract reference, monotonic version,
canonical snapshot hash, and item digest. Continuity then owns lifecycle and
operational freshness while intent remains provider-owned.

Execution Fidelity Guard receives only a read-only projection. It cannot write
back, and no live bridge ships in this release.

## Codex lifecycle

```text
UserPromptSubmit -> bounded provenance
PreCompact      -> minimum snapshot
PostCompact     -> successful boundary marker
SessionStart    -> compare, repair/mark/ask, inject bounded projection
SubagentStart   -> export candidate capsule
SubagentStop    -> import unverified result
```

Real manual and consecutive automatic Codex compactions are release evidence on
the tested Windows host.

## DeepSeek Harness lifecycle

```text
agent/inbox/inserted   -> trusted user-source observation
compaction/start       -> queue minimum ledger snapshot
compaction/summary     -> intentionally ignored; never persisted as truth
compaction/end         -> success/failure boundary
agent/pre-step         -> compare and inject before current message
agent/session-start    -> resume or parent/child candidate recovery
```

DSH lifecycle events are observed after the Session commits them. The adapter
cannot block or rewrite engine compaction. It can control the next model input
through the awaited pre-step waterfall.

## Failure behavior

- Hook, MCP, or adapter unavailable: the host continues; continuity guarantee is
  absent for that boundary.
- Ledger corruption: no state is restored or mutated from the corrupt ledger.
- Stale workspace/version: prior completion becomes unsafe to inherit.
- Every lossy boundary: the old action cursor becomes stale and must be
  rederived.
- Missing or failed completion event: recovery carries an explicit uncertainty
  marker and cannot claim an equivalent boundary.
- High-risk mismatch: ask before changing goal, scope, authorization, work
  object, publication, deletion, external side effect, or irreversible action.
- Adapter timeout: fail open within a bounded host wait.

## Cost controls

Snapshots are event-triggered, not per-turn summaries. Ordinary prompts use a
deterministic signal check, persist no prompt body, and call no extra model.
Only material continuity-risk signals retain a bounded redacted excerpt. Limits include 128 active
items, 2,000 events, an 8 MiB ledger, three 512 KiB snapshots, and an 800-token
default / 1,500-token maximum model-visible recovery projection.

No database, vector index, background daemon, or full transcript copy is
required.
