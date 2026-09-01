# Changelog

All notable changes are documented here. This project follows Semantic Versioning.

## [0.2.0-beta.2] - 2026-09-01

### Changed

- Frozen the adjacent-product boundary against Execution Fidelity Guard
  `0.2.2` and the separate unofficial DeepSeek Harness Guard adapter
  `0.1.0-alpha.2`.
- Documented the exact seven-field Guard intent projection, immutable
  `contract_ref/version` semantics, current wire versions, and the reserved
  Continuity snapshot.
- Distinguished the Context Continuity DSH adapter from the separate Guard DSH
  adapter. Both Guard-facing contracts are read-only with no state write-back;
  the Continuity adapter still writes only its own ledger.
- Release version advanced to `0.2.0-beta.2`; install examples now pin the new
  prerelease.
- Clarified DSH profile initialization, adjacent-product responsibilities,
  off/reset/delete effects, ledger-corruption recovery, and the difference
  between default path candidates and actual runtime paths.
- Hardened lock acquisition and real-path validation against transient
  lstat/realpath removal races, including Windows `EPERM`, without masking
  persistent permission failures.

### Evidence

- Refreshed all eight source-bound receipts. Four Codex installed receipts also
  bind the byte-identical installed cache; the DSH package receipt binds its
  isolated tarball.
- Repository validation rejects stale Guard version claims, missing beta.2
  release notes, or documentation that implies a live Continuity bridge.
- Expanded the core suite to 91 tests with deterministic removal-race and
  Windows permission-classification regressions.

### Known limitations

- Guard `0.2.2` does not load the reserved Continuity snapshot.
- No live Intent Loop or Continuity producer/consumer bridge ships.
- The separate DSH Guard adapter targets Harness `0.1.2-alpha.2`, while this
  project's Continuity adapter remains pinned to Harness `0.1.1-rc.2`.
- Real-task efficacy, authenticated real-Mac Codex lifecycle, DSH CLI profile
  installation, and engine-generated automatic compaction remain unverified.

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
- Core and DSH test entry points now work identically on Node 20 and 22; release
  digests canonicalize known text line endings while preserving binary bytes.

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
[0.2.0-beta.2]: https://github.com/rrrrrredy/context-continuity/releases/tag/v0.2.0-beta.2
