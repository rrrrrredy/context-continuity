# Context Continuity v0.2.0-beta.2

Release date: 2026-09-01
Status: release candidate; becomes a public prerelease after the tagged multi-OS CI gate passes

## What changed

- Aligned the frozen adjacent-product contract with Execution Fidelity Guard
  `0.2.2` and the separate unofficial DeepSeek Harness Guard adapter
  `0.1.0-alpha.2`.
- Recorded the Guard provider envelope and exact seven-field intent projection,
  immutable contract identity rules, and current wire-version boundaries.
- Clarified that Guard does not load the reserved Continuity snapshot and that
  no live Intent Loop or Continuity bridge ships.
- Clarified Codex `requires_user` behavior and that a DSH native ask authorizes
  only the exact pending call without mutating Intent or Continuity state.
- Refreshed installation pins and source-bound lifecycle/package receipts for
  the beta.2 source tree.
- Corrected the real lifecycle verifier so receipts record the tested Codex
  version dynamically instead of a historical fixed label.
- Bound all six Codex receipts to the resolved executable digest; the four
  lifecycle receipts also bind App Server identity.
- Added first-use guidance for product boundaries, DSH profiles,
  off/reset/delete semantics, ledger corruption, and default-path candidates.
- Hardened lock acquisition and real-path validation against transient
  removal races, including Windows `EPERM`, without masking real permission
  failures.

## What did not change

The recovery algorithm, state schema, privacy caps, exact user confirmation
protocol, Codex Hook surface, and DeepSeek Harness adapter contract remain
unchanged from beta.1. The shared core adds the path-race hardening above.
This remains a continuity plugin, not a memory platform or execution guard.

## Compatibility

| Surface | Version | Evidence boundary |
| --- | --- | --- |
| Context Continuity for Codex | `0.2.0-beta.2` | Real Windows manual/automatic lifecycle plus tagged Windows/macOS/Linux code/package CI |
| Context Continuity for DSH | `0.2.0-beta.2`, Harness `0.1.1-rc.2` | Published Host API lifecycle and isolated package; CLI profile and engine auto-compaction pending |
| Adjacent Codex Guard contract | `0.2.2` | Read-only contract alignment; no live Continuity bridge |
| Separate DSH Guard adapter | `0.1.0-alpha.2`, Harness `0.1.2-alpha.2` | Separate plugin; no automatic integration with Context Continuity |

## Important limits

This prerelease does not prove reduced context drift, rework, or recovery time.
The frozen three-arm real-task study has not run. Authenticated real Mac Codex
manual/automatic compaction, DSH CLI profile installation, and DSH
engine-generated automatic compaction also remain unverified.

## Install

Pin `v0.2.0-beta.2` using the Codex or DeepSeek Harness commands in the root
README. Review Hook or profile changes before installation and retain a removal
path. The project is opt-in and does not require a maintainer-side local install.
