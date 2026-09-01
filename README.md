# Context Continuity

[中文说明](README.zh-CN.md) · [Release evidence](docs/release-readiness.md) · [Privacy](docs/privacy.md)

Context Continuity keeps a small, source-aware record of what a long Agent task
must not forget, then checks that record after compaction, resume, or handoff
before work continues.

It is available as one shared-core package for Codex and DeepSeek Harness on
Windows, macOS, and Linux.

## Why this exists

A host can preserve enough text for an Agent to keep talking while losing the
actual objective, a hard constraint, a user correction, the reason for a
decision, the current file/version, or whether the old next step is still safe.
Host summaries and memory remain useful inputs, but they are not authoritative
task state.

Context Continuity stores a bounded task projection with source, time, status,
supersession, conflict, and verification metadata. It does not copy the full
transcript, create long-term memory, plan the task, or replace host permissions.

## Status

Version `0.2.0-beta.2` is the release candidate. It becomes the pinned public
prerelease, and the install commands below become valid, only after the matching
public tag and GitHub prerelease exist.

| Host / platform | Support level |
| --- | --- |
| Codex | Beta release candidate; real manual and consecutive automatic compaction lifecycle receipts on the tested Windows host |
| DeepSeek Harness | Developer-preview candidate pinned to `0.1.1-rc.2`; published Host API lifecycle and isolated package verified |
| Windows | Full release test matrix plus real Codex lifecycle evidence |
| macOS | Release gate: the full source, Hook, MCP, package, eval, and DSH adapter matrix must pass on `macos-latest`; authenticated Codex automatic lifecycle is not yet verified |
| Linux | Release gate: the full source, Hook, MCP, package, eval, and DSH adapter matrix must pass on `ubuntu-latest` |

The frozen three-arm real-task study has not been completed. This release proves
mechanics and bounded failure behavior, not yet a measured reduction in user
rework or target drift.

## Install: Codex

Requirements: a Codex build with plugin and Hook support, Node.js 20 or newer,
and permission to inspect local Hooks.

The commands are the same on macOS, Linux, and Windows shells:

```sh
codex plugin marketplace add rrrrrredy/context-continuity --ref v0.2.0-beta.2
codex plugin add context-continuity@context-continuity
```

Then:

1. Restart or resume the Codex task.
2. Open `/hooks`.
3. Inspect the exact commands in the installed cache and trust only those
   definitions.
4. Work normally. Ordinary turns remain silent and do not call another model.

Verify installation:

```sh
codex plugin list --json
```

The JSON output must include `context-continuity@context-continuity`. In
`/hooks`, verify and trust these seven groups from the installed cache:
`SessionStart`, `UserPromptSubmit`, `PreCompact`, `PostCompact`,
`SubagentStart`, `SubagentStop`, and `SessionEnd`. If any command reports
`node not found`, continuity protection is not active.

Run this 60-second, no-file-change smoke test in a disposable task:

1. Say: “Protect this objective: keep the smoke test local. Hard constraint:
   do not edit files.”
2. Read the proposed state and send the exact confirmation text the Agent
   returns.
3. Say: “Show the current continuity state.”
4. Pass only if the objective and constraint are both `verified` and no file
   was changed.

For Mac-specific evidence and limits, see
[macOS support](docs/platform/macos-support-2026-08-31.md).

## Install: DeepSeek Harness

Requirements: DeepSeek Harness `0.1.1-rc.2`, Node.js 20 or newer, and `pnpm`.
`<profile>` names one runnable DSH composition under
`$DSH_HOME/profiles/<name>`. Use an existing profile or a dedicated preview
name; the first official `dsh plugin --profile <name> add ...` call initializes
that profile. See the
[official profile/plugin guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

```sh
dsh plugin --profile <profile> add github:rrrrrredy/context-continuity#v0.2.0-beta.2
dsh --profile <profile> --dump-config
```

The dumped configuration must contain a layer/service with both `id` and
`name` equal to `context-continuity`. Then start the profile with:

```sh
dsh --profile <profile>
```

Use the same plain-language smoke test above after the profile starts.

If that profile was already running during installation, restart its process
before the smoke test. The DSH bundle patch inserts the adapter; no separate
state schema or fork is used. See the
[adapter guide](adapters/deepseek-harness/README.md) and
[capability record](docs/platform/deepseek-harness-capability-2026-08-31.md).

Context Continuity and Execution Fidelity Guard are separate products:

| Product | Responsibility |
| --- | --- |
| Context Continuity | Preserves and verifies task state across lossy context boundaries |
| Execution Fidelity Guard | Classifies pending actions and completion claims against current state |

There is no live bridge between them. This repository's DSH adapter targets
Harness `0.1.1-rc.2`; the separate Guard DSH adapter targets
`0.1.2-alpha.2`. Do not treat them as an automatically integrated pair in one
profile.

## What users see

Most of the time: nothing.

When a lossy boundary occurs, the plugin:

1. snapshots only the active task invariants;
2. records whether the boundary completed;
3. restores a bounded projection before the next model step;
4. preserves unresolved conflicts instead of inventing agreement;
5. marks the old `next_action` stale so it must be rederived.

If reliable evidence can repair a mismatch, recovery is automatic. Low-risk
uncertainty is marked while reversible work may continue. A mismatch that could
change objective, scope, authorization, work object, publication, deletion, or
another irreversible action requires one necessary user question.

Users can say:

- “Show the current continuity state.”
- “Protect the current objective and constraints.”
- “This recovered item is wrong; replace it with …”
- “Export a minimal handoff.”
- “Turn continuity protection off for this task.”
- “Delete this task's continuity state.”

| Action | Exact effect |
| --- | --- |
| Off | Stops new automatic continuity writes for this task; existing state remains readable and exportable |
| Reset | Clears the active projection and starts a fresh generation while preserving append-only history; the diagnostic CLI archives the old task directory |
| Delete | Removes only this task's Continuity state and matching Continuity archives; it does not delete project files, transcripts, host memory, or other tasks |

Off, on, reset, and delete all require the readable exact second confirmation.
User-authoritative structured state uses a readable, exact second confirmation.
A model paraphrase or an old message cannot mint authority.

## Data and guarantees

- Local, task-scoped append-only ledger with hash-chain verification.
- At most three recent compaction snapshots.
- Bounded recovery projection: 800-token default, 1,500-token maximum.
- Full transcript, hidden reasoning, and full tool output are not copied.
- Platform summaries, retrieval results, handoffs, and subagent output enter as
  untrusted caches or candidates.
- Every lossy boundary invalidates the old action cursor.
- Hook or adapter failure is fail-open for the host. Continuity protection for
  that boundary is then unavailable.
- Corrupt continuity state is not restored or mutated.
- Other installed products do not become automatic integrations. The
  [shared-state contract](docs/integration-contracts.md) is read-only and
  single-owner.

Codex data defaults to
`$CODEX_HOME/plugin-data/context-continuity/v1`. DSH data defaults to
`$DSH_HOME/plugin-data/context-continuity/v1`. An explicit
`CONTEXT_CONTINUITY_DATA_DIR` is supported for isolated or managed runs.

| Failure | Safe response |
| --- | --- |
| Node or Hook startup failure | Protection is inactive. Put Node.js 20+ on the host process PATH, restart, inspect `/hooks`, and repeat the smoke test |
| Recovered state is wrong | Submit a correction and its exact confirmation; pause any affected high-risk action until the correction is effective |
| Ledger hash corruption | Preserve the damaged data. `rebuild` verifies and reprojects a valid ledger; it cannot repair a hash mismatch. Use task-scoped diagnostic deletion only when the exact task reference and actual data directory are independently known |
| DSH layer missing | Protection is inactive. Re-add the pinned tag, restart the profile, and verify it with `--dump-config` |

The default-path commands in the
[usage guide](docs/usage.md#数据位置与卸载) print candidates, not guaranteed
runtime-resolved paths. Verify overrides and installed-cache inference before
manual deletion.

## Evidence

The repository requires:

- 91 core tests and 7 DeepSeek Harness adapter/integration tests;
- real Codex manual and consecutive automatic compaction receipts;
- byte-identical installed-cache lifecycle receipts;
- an installed-host read-only discovery receipt;
- an isolated DSH tarball install receipt;
- a published DSH Host API lifecycle receipt;
- Hook, MCP, repository, protocol-eval, audit, and multi-OS CI gates.

Receipts bind the current source tree and plugin package SHA-256. Fixture
protocol results are explicitly excluded from efficacy claims.

## Local development

```sh
npm ci
npm test
npm run test:dsh
npm run smoke:hooks
npm run smoke:mcp
npm run eval:protocol
npm run verify:dsh:package
npm run verify:dsh:lifecycle
npm run validate
npm audit --audit-level=high
```

Only `plugins/context-continuity/` is the installable Codex package. The root
package also carries the DeepSeek Harness adapter and its bundle patch.

## Update or remove

Upgrade Codex to `<new-tag>` while preserving its local ledger:

```sh
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
codex plugin marketplace add rrrrrredy/context-continuity --ref <new-tag>
codex plugin add context-continuity@context-continuity
```

Upgrade DeepSeek Harness to `<new-tag>`:

```sh
dsh plugin --profile <profile> remove context-continuity
dsh plugin --profile <profile> add github:rrrrrredy/context-continuity#<new-tag>
```

To remove from Codex without deleting its ledger:

```sh
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
```

To remove from DSH without deleting its ledger:

```sh
dsh plugin --profile <profile> remove context-continuity
```

Removal does not silently delete ledgers. For a complete deletion, first say
“Delete this task's continuity state,” send the exact second confirmation, and
verify that the task state is gone. Only if the plugin cannot run, locate the
actual data directory from runtime configuration and installed-cache inference;
do not assume the default-path candidate is exact. Review the target before
removing `plugin-data/context-continuity`; see
[privacy and deletion](docs/privacy.md).

## License and support

Apache License 2.0. Commercial and private use are allowed subject to the
license terms. Report reproducible problems through
[GitHub Issues](https://github.com/rrrrrredy/context-continuity/issues).
