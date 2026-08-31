# Changelog

All notable changes are documented here. This project follows Semantic Versioning.

## [0.2.0-beta.1] - 2026-08-31

### Added

- DeepSeek Harness adapter for the pinned published `0.1.1-rc.2` Cordis,
  AgentRegistry, Session, SystemPrompt, and ToolRuntime contracts.
- DSH native tools with host-bound task, workspace, and user-source identity.
- DSH compaction start/end observation, explicit summary-content exclusion, and
  bounded recovery through the awaited `agent/pre-step` waterfall.
- Isolated DSH tarball install verification and published Host API lifecycle
  receipts.
- macOS Node 20/22 CI for the full core, adapter, repository, Hook, MCP, eval, and
  dependency-audit matrix.
- macOS and DSH installation, removal, capability, evidence, and failure-boundary
  documentation.

### Changed

- Core task references and provenance are host-namespaced while preserving the
  existing Codex behavior.
- Public MCP server helpers are reusable by host-native adapters.
- Three-product contract now aligns with Execution Fidelity Guard v0.2 while
  retaining one intent owner, read-only Guard input, and no live bridge.
- Release version advanced to `0.2.0-beta.1`.
- Ordinary prompts now persist only hash, length, and signals; a bounded
  redacted excerpt is retained only for material continuity-risk signals.
- DSH source matching keeps at most eight content-free observations and can use
  an earlier exact confirmation after an unrelated intervening message.
- DSH lifecycle receipts are derived from a structured integration observation,
  and direct Windows package verification no longer spawns `npm.cmd`.


### Security

- DSH state-changing tools no longer expose `task_ref`, `cwd`, or
  `source_event_id`; the host adapter supplies trusted values.
- The DSH adapter does not persist unknown custom session events and fails open
  on bounded adapter errors.

### Known limitations

- Real-task three-arm efficacy evaluation remains incomplete.
- Authenticated real Mac Codex manual/automatic compaction is not yet verified.
- DSH CLI profile installation and engine-generated automatic compaction are not
  yet release receipts.
- DSH compatibility is pinned to `0.1.1-rc.2`.

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

[0.2.0-beta.1]: https://github.com/rrrrrredy/context-continuity/releases/tag/v0.2.0-beta.1
