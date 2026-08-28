# Changelog

All notable changes are documented here. This project follows Semantic Versioning.

## [0.1.0] - 2026-08-28

### Added

- Source-aware, append-only task-state ledger with hash-chain verification.
- Codex `PreCompact`, `PostCompact`, compact/resume `SessionStart`,
  `UserPromptSubmit`, and subagent lifecycle integration.
- Bounded recovery projection with explicit equivalent, repaired,
  continue-with-markers, and ask-before-high-risk outcomes.
- Eight bounded local stdio MCP tools for state inspection, exact authority
  confirmation, correction, snapshots, handoff, and task-scoped management.
- Privacy limits, expanded credential redaction, storage/input caps, optimistic
  concurrency, strict task references, and one-time two-stage confirmation for
  destructive task-state operations.
- Source-bound prompt observation: every non-empty prompt retains at most 512
  redacted characters plus hash, length, and signals; user-authoritative state
  requires the user's second exact confirmation of the complete readable,
  generation-bound proposal.
- Resume verification against the last recorded workspace fingerprint when no
  compaction snapshot is available.
- One-time consumption of observed user-prompt events for standalone intent and
  correction writes, preventing provenance replay.
- Reproducible disposable source Hook cold-start benchmark and an explicit beta
  latency disclosure.
- Public-provider isolation: no model-visible provider credential, external
  binding, or verified-evidence minting path; internal adapter contracts remain
  disabled until a trusted host can isolate caller identity.
- Content-aware bounded workspace fingerprints, stale action cursors at lossy
  boundaries, pure-read bounded handoff export, realpath containment, strict
  ledger allowlisting/size checks, and zero lifecycle writes while disabled.
- Opaque hashed host identifiers; bounded MCP success and error responses;
  symlink/junction-safe task, archive, snapshot, lock, and delete paths; visible
  reissuable management challenges; verified-only Guard action commitments; and
  reset cleanup of obsolete lifecycle pointers.
- Frozen 30-case protocol fixture and real Codex manual/automatic compaction
  lifecycle receipts.
- Git marketplace packaging and Windows/Linux CI.

### Known limitations

- Real-task three-arm efficacy evaluation has not yet been completed.
- Cross-product intent binding requires a provider with an immutable monotonic
  revision and canonical snapshot hash.
- Codex is the only supported host in this release.

[0.1.0]: https://github.com/rrrrrredy/context-continuity/releases/tag/v0.1.0
