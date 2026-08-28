# Architecture

Context Continuity has one runtime core and four thin surfaces:

1. Codex Hooks observe lifecycle events and add bounded model context.
2. A bundled stdio MCP server exposes eight state operations and one read-only
   Skill resource.
3. The Skill tells the model when state changes are material.
4. An append-only task ledger projects the current effective state and writes
   bounded pre-compaction snapshots.

The repository is a Git marketplace. Only `plugins/context-continuity/` is
installed; tests, evaluation fixtures, schemas, receipts, and product documents
remain repository evidence.

## Authority order

For the same namespace, verified user state outranks verified evidence, which
outranks Agent inference. Unverified state cannot supersede verified state.
External handoffs, subagent results, and platform summaries enter as candidates.
Disputes remain parallel records until a later authoritative event resolves them.

## One effective projection

The ledger is the rebuildable event source. A snapshot is a content-addressed
recovery aid, not a competing truth. The latest snapshot is followed only through
the ledger's verified reference, so an orphan or newer-looking file cannot become
authoritative.

The core contains a reserved adapter contract for a user-intent provider, but
v0.1.0 exposes no public MCP binding path: the host cannot yet keep provider
identity and credentials outside model control. A future isolated adapter must
bind an immutable contract reference, monotonic version, canonical snapshot
hash, and item digest before it may own the intent namespace. Continuity keeps
operational freshness and lifecycle state. An execution guard receives only a
read-only projection.

## Failure behavior

- Hook or MCP unavailable: Codex continues; continuity guarantee is absent.
- Ledger corruption: no state is restored or mutated from the corrupt ledger.
- Stale workspace/version: prior completion becomes unsafe to inherit.
- Every lossy boundary: the old next-action cursor becomes stale and must be
  rederived before execution.
- Missing/mismatched PostCompact: recovery continues only with an explicit
  uncertainty marker.
- High-risk mismatch: ask before changing goal, scope, authorization, work object,
  publication, deletion, or another irreversible action.

## Cost controls

Snapshots are event-triggered, not per-turn summaries. Ordinary prompts use a
deterministic signal check and no extra model call. Limits include 128 active
items, 2,000 events, an 8 MiB ledger, three 512 KiB snapshots, and an 800-token
default / 1,500-token maximum model-visible recovery projection.
