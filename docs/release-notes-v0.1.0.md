# Context Continuity v0.1.0

Context Continuity is a local-first Codex plugin that preserves and verifies a
small source-aware task projection around context compaction, resume, clear,
and subagent handoff.

## Highlights

- Strict append-only, task-scoped hash-chain ledger with provenance,
  supersession, event allowlisting, generation control, and pre-read size caps.
- Real `PreCompact`, `PostCompact`, and compact/resume recovery integration.
- Readable, generation-bound exact user confirmation for normalized authority;
  natural-language paraphrases, quotes, or stale prompt events cannot mint it.
- Old next actions become stale at every lossy boundary and must be rederived
  before execution.
- Explicit conflict and uncertainty instead of summary-created consensus.
- Bounded recovery context: 800-token default and 1,500-token hard ceiling.
- Candidate-only imported handoffs and subagent results.
- Eight-tool public MCP with bounded responses and no model-visible provider
  credential, external binding, or verified-evidence minting path.
- Read-only execution-guard interchange shape, with no claim of a live bridge.
- Local-only storage, no telemetry, no transcript parser, and no runtime
  dependencies.
- Two-stage exact confirmation for off, on, reset, and delete; strict namespaced
  task references; human-readable challenge recovery; archive-aware deletion;
  and fail-open host behavior.
- Opaque hashed host identifiers, 24 KiB success/error wire bounds, and
  symlink/junction containment for task, snapshot, archive, lock, and deletion
  paths.
- The read-only execution-guard view excludes stale and unverified next actions;
  reset clears obsolete lifecycle pointers while preserving audit history.

## Verification gates

- 87 automated tests on the hardened release candidate.
- A six-turn independent installed-candidate user flow with silent ordinary
  behavior and first-call success for protect, exact record, show, and off.
- One real manual and at least two consecutive real automatic compactions from
  both the source checkout and the byte-identical installed cache package.
- A fresh ephemeral Codex process discovers and calls the installed MCP.
- Installed-package persistence, redaction, Skill/license equality, bounded wire
  behavior, two-stage deletion, post-delete byte scans, and exact uninstall are
  required before the release is published.
- Validation receipts bind both the source tree and plugin package digests.

## Important beta limits

The real-task three-arm efficacy study has not run. This release does not claim
measured reductions in target drift, rework, or recovery time. Real resume,
parent/subagent round-trip handoff, broader operating-system coverage, other
Codex versions, other Agent adapters, and lower-cost explicit protection remain
future verification work.

See README.md, docs/prd.md, docs/release-readiness.md, and SECURITY.md before
installing.
