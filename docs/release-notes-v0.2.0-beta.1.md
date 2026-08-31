# Context Continuity v0.2.0-beta.1

Release date: 2026-08-31  
Status: release candidate; publish only after the public multi-OS CI gate passes

## What changed

- Added a DeepSeek Harness adapter for the published `0.1.1-rc.2` plugin
  contract.
- Reused the same ledger, invariant model, confirmation protocol, privacy caps,
  and recovery rules across Codex and DSH.
- Added host-bound DSH user provenance so models cannot supply task, workspace,
  or authority-source identifiers.
- Added durable DSH compaction observation and bounded recovery through the real
  pre-step waterfall.
- Added isolated DSH package verification and published-host API lifecycle
  receipts.
- Added `macos-latest` to the complete Node 20/22 CI matrix.
- Added macOS installation, removal, support, and verification-boundary
  documentation.
- Updated the three-product integration contract to remain read-only and
  single-owner.

## Compatibility

| Host | Supported release | Level |
| --- | --- | --- |
| Codex | Plugin/Hook builds compatible with the v0.1 lifecycle contract | Public beta |
| DeepSeek Harness | `0.1.1-rc.2` | Developer-preview beta |
| Windows | Node 20/22 CI and real Codex lifecycle receipts | Verified beta |
| macOS | Node 20/22 CI for core, package, Hook, MCP, eval, and DSH adapter | Public CI required; real Codex automatic lifecycle pending |
| Linux | Node 20/22 CI for core, package, Hook, MCP, eval, and DSH adapter | Verified code/package beta |

## Important limits

This release does not copy the full transcript, provide long-term memory, plan
the task, grant permission, or block host execution. It does not claim proven
reductions in drift or rework before the frozen three-arm study is complete.

DeepSeek Harness CLI profile installation and engine-generated automatic
compaction were not locally exercised. An authenticated real Mac Codex
automatic-compaction run was also unavailable. These limits are explicit release
conditions, not inferred passes.

## Install

Codex and DeepSeek Harness commands are in the project README. This is a
prerelease: pin `v0.2.0-beta.1`, inspect Hooks or profile changes, and retain a
recovery path before using it on important work.
