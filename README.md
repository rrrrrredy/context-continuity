# Context Continuity

[![CI](https://github.com/rrrrrredy/context-continuity/actions/workflows/ci.yml/badge.svg)](https://github.com/rrrrrredy/context-continuity/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

Context Continuity is a local-first Codex plugin that helps a long-running Agent
resume with the same goal, constraints, corrections, work object, verified
progress, and unresolved disagreements after context compaction, session resume,
clear, or subagent handoff.

It is not a transcript backup, long-term memory, planner, permission system, or a
second Agent harness.

[中文说明](README.zh-CN.md)

## Why this exists

A platform summary can sound coherent while dropping a corrected requirement,
reviving an obsolete decision, hiding a disagreement, or continuing against the
wrong file version. This plugin stores a small, source-aware task projection and
checks it around lossy context transitions. Platform summaries and imported
handoffs remain untrusted candidates, not the source of truth.

## Status

Version `0.1.0` is an opt-in public beta for Codex.

- Verified with `codex-cli 0.150.0-alpha.8` on Windows.
- Real manual and repeated automatic compaction are release gates for both the
  source package and installed cache package.
- The bundled Hooks, MCP, Skill fallback, persistence, redaction, bounded wire
  responses, exact user confirmation, task deletion, and uninstall path are
  covered by automated and installed-package checks.
- The 30-case evaluation protocol is frozen, but the real-task three-arm efficacy
  study is not complete. This beta does not claim measured reductions in rework,
  target drift, or recovery time.
- A short independent installed-candidate flow passed ordinary silence,
  protect, exact record, show, and off. It also found repeated Skill reads and
  30-to-60-second explicit-protection turns, so this remains an opt-in beta.

See the [research and PRD](docs/prd.md),
[release readiness](docs/release-readiness.md), and
[implementation evidence](docs/implementation-status.md).
The [independent user pilot](docs/user-pilot-2026-08-29.md) records the observed
interaction cost and evidence limits.

## Install from GitHub

Requirements: Codex with plugin support, Node.js 20 or newer, and permission to
review local Hooks.

```powershell
codex plugin marketplace add rrrrrredy/context-continuity --ref v0.1.0
codex plugin add context-continuity@context-continuity
```

Then:

1. Open `/hooks` in Codex.
2. Review the Context Continuity commands and trust only the exact installed
   definition.
3. Start a new task or reopen the task you want to protect.
4. Work normally. Ordinary turns remain silent.

Verify the installed package:

```powershell
codex plugin list --json
codex mcp get context_continuity --json
```

The MCP namespace uses an underscore; the product and plugin names use a hyphen.

## What users see

- Ordinary work: no status chatter and no extra model call.
- When a stable goal, constraint, correction, or other material claim needs user
  authority: the Agent shows one readable, generation-bound proposal and asks the
  user to send it exactly. This happens only for explicit protection requests or
  material continuity risk, not every turn.
- Before compaction: Hooks write a minimal local snapshot.
- After compaction or resume: verified invariants are restored from the ledger;
  the old next action is marked stale and rederived against the current state.
  Low-risk uncertainty is marked. A gap that could alter scope, authorization,
  publication, deletion, external communication, or another irreversible action
  causes one necessary question.
- On correction: the confirmed replacement supersedes the old item without
  erasing provenance or disagreement history.

Useful requests:

- "Show the current continuity state."
- "Protect the current goal and constraints."
- "The restored goal is wrong; the correct goal is ..."
- "Export a minimal handoff for this subtask."
- "Disable continuity for this task."
- "Delete continuity state for this task."

Off, on, reset, and delete require an observed matching request plus a second
exact, one-time confirmation. The local diagnostic CLI instead requires the
exact namespaced `task_ref` twice. Guessed aliases such as `current` are rejected.
If a prepare response is lost, the same unexpired request may reissue a fresh
challenge; the Agent must never search logs, transcripts, caches, other tasks,
plugin data, or `CODEX_HOME` for a token.

## Design guarantees

- One append-only, task-scoped, hash-chained ledger with strict event validation;
  no last-write-wins.
- Provenance, time, validity, authority, verification, supersession,
  disagreement, and uncertainty remain explicit.
- A natural-language prompt cannot by itself mint normalized user-authoritative
  state. Authority requires the user's second exact confirmation of the complete
  readable proposal. Agent paraphrases remain unverified inference.
- Prompt excerpts are bounded, redacted audit signals; they are not semantic
  proof. Full transcripts are never copied.
- Every lossy boundary invalidates the previous action cursor. The next action is
  rederived before execution, with an explicit question before high-risk work.
- The execution-guard view exports only verified next actions; stale or
  unverified actions remain visible for audit but are not executable commitments.
- Imported handoffs and subagent results are candidate-only.
- Workspace comparison includes bounded tracked and untracked content hashes,
  not only Git HEAD or a dirty flag.
- The public MCP exposes eight bounded tools and no provider credential or
  verified-evidence minting path. Cross-product contracts are documented but not
  presented as a live integration.
- Every MCP success or error response is capped at 24 KiB. Host session and turn
  identifiers are stored only as opaque hashes.
- Task, snapshot, archive, lock, and deletion paths reject symlinks and Windows
  junctions before reading or writing outside the plugin data root.
- Default recovery context is at most 800 estimated tokens; hard ceiling 1,500.
- No network calls, telemetry, runtime dependencies, transcript parsing, vector
  database, or cloud service.
- Hook failure is fail-open for Codex. Corrupt continuity state fails closed only
  for continuity recovery.

The [product contract](docs/product-contract.md),
[cross-product integration contract](docs/integration-contracts.md),
[privacy policy](docs/privacy.md), and [architecture](docs/architecture.md)
define the exact boundary.

## Local development

```text
npm ci --ignore-scripts
npm test
npm run validate
npm run smoke:hooks
npm run smoke:mcp
npm run eval:protocol
```

Real lifecycle validation additionally requires a compatible local Codex CLI:

```text
npm run verify:lifecycle:manual
npm run verify:lifecycle:auto
```

The installable package is `plugins/context-continuity/`. Tests, schemas,
evaluation fixtures, receipts, and product documents remain repository evidence.

## Update or uninstall

```powershell
codex plugin marketplace upgrade context-continuity
codex plugin remove context-continuity@context-continuity
codex plugin add context-continuity@context-continuity
```

To uninstall:

```powershell
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
```

Removing the plugin does not silently delete task ledgers. Use the two-stage
task deletion control first, or separately inspect and remove the exact
`CODEX_HOME/plugin-data/context-continuity` directory when full local data
removal is intended.

## License and support

Apache License 2.0. It permits commercial and private use, includes an express
patent grant, and requires preservation of license notices.

See [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), and
[SUPPORT.md](SUPPORT.md).
