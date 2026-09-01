# Release readiness: v0.2.0-beta.2

Decision date: 2026-09-01
Decision: **GO for a pinned public prerelease after all tagged CI matrix jobs
pass; NO RESULT for efficacy; NOT GA**

## What this decision means

The repository is suitable for an opt-in GitHub prerelease with a bounded
promise:

- Codex installs a local plugin with source-aware, task-scoped state;
- DeepSeek Harness installs a thin adapter against the pinned
  `0.1.1-rc.2` developer-preview contract;
- both hosts share the same ledger and recovery rules;
- real Codex compaction events and published DSH Host APIs are exercised;
- macOS, Windows, and Linux run the same code/package matrix;
- failures leave the host usable and expose explicit task-scoped deletion.

It does not mean the plugin has proved reduced user rework, target drift, or
recovery time. The frozen real-task three-arm study has not run, so product
efficacy remains **NO RESULT**.

## Executed evidence

| Surface | Evidence | Result |
| --- | --- | --- |
| Core behavior | Node test suite | 91 passed on the local release candidate; tagged CI is authoritative across OS/Node matrix |
| Codex source lifecycle | `validation/real-manual.json`, `validation/real-auto.json` | Real manual and at least two consecutive automatic compactions with Pre/PostCompact, compact SessionStart, App Server start/completion, and stale next action |
| Codex installed lifecycle | `validation/real-installed-manual.json`, `validation/real-installed-auto.json` | Same real lifecycle using a byte-identical installed cache package |
| Codex host discovery | `validation/installed-host-read.json` | Fresh ephemeral read-only process discovered the MCP and made exactly one physical state read without changing plugin data or Codex configuration |
| Codex installed package | `validation/installed-package.json` | Installed cache passed Hook observation, state write, cross-process recovery, redaction, two-stage deletion, and byte scan |
| DSH adapter | 7 adapter/integration tests | Published Cordis, AgentRegistry, Session, SystemPrompt, and ToolRuntime APIs exercised |
| DSH package | `validation/dsh-package.json` | Packed tarball installed in an isolated consumer, bundle/peers/files/import verified, scratch removed |
| DSH lifecycle | `validation/dsh-real-lifecycle.json` | Native confirmation, schema-validated compaction events, real pre-step waterfall, stale action and host-bound user source verified |
| Independent user flow | `docs/user-pilot-2026-08-29.md` | Six installed-candidate Codex turns covered silence, protect, exact write, show and off |
| Multi-OS | GitHub Actions | Ubuntu, Windows and `macos-latest`, Node 20/22; public tagged run is the release gate |
| Protocol evaluation | 30 frozen cases | Executable fixture for protocol regressions; explicitly not efficacy evidence |
| Artifact identity | All receipts | Source-tree and source-plugin SHA-256 must match the release candidate |

## Release gates

| Gate | Status | Reason |
| --- | --- | --- |
| Scope | Pass | Continuity-only; no memory platform, planner, permission system, database, daemon, or second Harness |
| Codex feasibility | Pass on tested Windows host | Real installed manual and automatic compaction loop |
| DSH feasibility | Pass for pinned published Host APIs | Native tools and lifecycle integration against `0.1.1-rc.2` |
| State integrity | Pass | Schema, hash chain, caps, atomic writes, generation, provenance, supersession, conflict, and corruption behavior exercised |
| Authority boundary | Pass | Exact second confirmation; host-bound identifiers; no model-visible provider/evidence credentials |
| Privacy/delete | Pass for prerelease | Minimal local state, redaction, caps, containment, task confirmation, uninstall separation |
| macOS code/package | Tagged CI required | Real `macos-latest` execution, not an authenticated Codex desktop lifecycle |
| Installability | Pass for packaged surfaces | Codex Git marketplace and isolated DSH distributable verification |
| Product efficacy | No result | Frozen real-task three-arm study remains unexecuted |
| Cross-product live bridge | Not shipped | Read-only contracts aligned; no live shared-state integration |

## Known limits

- Real Codex lifecycle receipts were produced on the tested Windows host, not on
  an authenticated Mac Codex host.
- `macos-latest` proves code, process, packaging, Hook, MCP, eval, and DSH
  adapter behavior; it does not prove real Codex desktop automatic compaction.
- The DSH CLI profile-add path and engine-generated automatic compaction were not
  exercised in the local release environment.
- DSH is a developer preview and compatibility is pinned to
  `0.1.1-rc.2`.
- No upgrade matrix across several Codex or DSH versions.
- No long-term independent-user dogfood or completed three-arm efficacy study.
- Ordinary source Hook startup was last measured on Windows/Node 20; installed
  client and Mac end-to-end latency require separate measurement.
- Intent Loop and Execution Fidelity Guard `0.2.2` contracts are aligned, but
  no live Intent Loop or Continuity bridge ships.
- A separate unofficial DeepSeek Harness Guard adapter `0.1.0-alpha.2` exists;
  it does not load the reserved Continuity snapshot or create an automatic
  three-product integration.

## Allowed market claims

- Local-first public prerelease for Codex and a pinned DeepSeek Harness developer
  preview.
- Same cross-platform core and state format on Windows, macOS, and Linux.
- Real Codex lifecycle verified on the tested Windows host.
- Core/package/Hook/MCP/eval/DSH adapter run on a real GitHub macOS runner after
  tagged CI passes.
- Published DSH Host API lifecycle and isolated distributable verified.
- Full transcript is not copied; state is task-scoped, source-aware, bounded, and
  explicitly deletable.
- Mechanical receipts are source-bound.

## Prohibited market claims

- “Proven to eliminate context loss, drift, or rework.”
- “Real Codex automatic compaction verified on Mac” until an authenticated host
  receipt exists.
- “Full DSH CLI and automatic compaction verified” until those exact paths run.
- “Works on every Codex/DSH version or every Agent product.”
- “Automatically integrates with Intent Loop or Execution Fidelity Guard.”
- “Secure secret vault” or “complete transcript recovery.”

## Exit criteria after prerelease

1. Run the frozen 30-task three-arm study without changing thresholds after
   results are visible.
2. Obtain an authenticated Mac Codex manual and automatic lifecycle receipt.
3. Exercise DSH CLI profile add/remove and engine-generated automatic
   compaction.
4. Complete an upgrade matrix across at least two relevant host releases.
5. Measure installed-client latency and user interruption rate.
6. Close critical findings from independent adversarial and user-perspective
   release reviews.

## Local cleanup requirement

Release verification may temporarily use isolated host homes and installation
caches. Before delivery, remove those exact temporary installs and confirm the
normal local Codex plugin list and DSH executable/profile state do not contain
Context Continuity. Project source dependencies are development files, not a
host plugin installation.
