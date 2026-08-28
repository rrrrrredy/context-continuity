# Release readiness: v0.1.0

Decision date: 2026-08-28
Decision: **GO for public self-hosted beta; ITERATE for efficacy; NOT READY for GA or universal-directory submission**

## What this decision means

The repository is suitable for an opt-in GitHub beta with a bounded promise:

- it installs as a Codex plugin;
- it keeps local, source-aware, task-scoped state;
- it observes real compaction lifecycle events;
- it can recover the same verified invariants after compaction while forcing the
  old action cursor to be rederived;
- it fails open for Codex and exposes explicit deletion controls.

It does **not** mean the plugin has already proved that it reduces user rework,
target drift, or recovery time. The frozen real-task three-arm study has not
been run, so product efficacy remains **NO RESULT**.

## Executed evidence

| Surface | Evidence | Result |
| --- | --- | --- |
| Automated behavior | Node test suite | 87 passed, 0 failed, 0 skipped on the hardened release candidate; final tagged CI remains required |
| Source lifecycle | validation/real-manual.json and validation/real-auto.json | One real manual and at least two consecutive real automatic compactions; each pairs PreCompact, PostCompact, SessionStart(compact), and App Server contextCompaction started/completed; next_action becomes stale by design |
| Installed lifecycle | validation/real-installed-manual.json and validation/real-installed-auto.json | Same real lifecycle using a byte-identical installed cache package |
| Real host discovery | validation/installed-host-read.json | Fresh ephemeral Codex process discovered context_continuity and performed exactly one physical state read; the complete plugin-data tree and Codex configuration were byte-identical before/after, with no command, file, network, or unrelated MCP action |
| Installed package E2E | validation/installed-package.json | Hardened installed cache passed Hook observation, three-item write, cross-process recovery, exact Skill/license checks, redaction, two-stage deletion, and post-delete byte scan |
| Independent user flow | docs/user-pilot-2026-08-29.md | Six real installed-candidate Codex turns: ordinary work stayed silent; protect, exact record, show, and off succeeded without business errors after the final schema and token guidance fixes |
| Authority and data claims | Automated and installed checks | Complete readable state proposals require a second exact user prompt; management challenges are visible in text and safely reissuable; quoted/negated/paraphrased prompts cannot mint authority; raw prompt/assistant content is omitted from receipts; host IDs are hashed; no persistent Hook-trust change |
| Artifact identity | All validation receipts | Source-tree, source-plugin, and tested-plugin SHA-256 digests must match the release candidate |
| Protocol evaluation | 30 frozen cases | Evaluation pipeline is executable; fixture results are not efficacy evidence |
| Ordinary-turn source Hook cost | scripts/benchmark-hook.mjs | Final Windows/Node 20 run, 30 cold starts: p50 121.32 ms, p95 148.34 ms; no extra model call |

The final tag additionally requires repository validation, Hook and MCP smoke
tests, dependency audit, the official plugin validator, and public GitHub CI.
Their final result is recorded in the tagged release and must not be inferred
from this pre-tag document.

## Release gates

| Gate | Status | Reason |
| --- | --- | --- |
| Scope | Pass | Plugin remains continuity-only, not memory platform, planner, permission system, or Harness |
| Codex feasibility | Pass | Real installed Pre/PostCompact and compact SessionStart loop observed |
| State integrity | Pass | Strict event/root schema, hash chain, pre-read size cap, atomic writes, generation control, provenance, supersession, conflict, and corruption behavior are exercised |
| Privacy/delete | Pass for synthetic beta | Minimal local state, caps, expanded redaction, one-time destructive confirmation, hashed host IDs, bounded success/error responses, symlink/junction containment, installed-cache deletion, and byte scans are exercised |
| Installability | Pass | Standard Git marketplace package and installed cache runtime work on the tested Codex build |
| Open-source operations | Pass pending final public CI | Apache-2.0, contribution/security/support files, issue templates, CI, changelog, and release notes exist |
| Product efficacy | No result | Real three-arm study has not run |
| Broad compatibility | Not passed | Only codex-cli 0.150.0-alpha.8 on Windows has real-host evidence |

## Known limits

- No completed real cross-process thread/resume lifecycle receipt.
- No completed real parent-to-subagent-to-parent handoff receipt.
- A short independent installed-candidate flow passed, but there is no
  independent long-running user dogfood before this beta.
- No upgrade matrix across Codex versions, macOS, or Linux hosts.
- User-authoritative semantic updates require a second exact, readable
  confirmation. This is intentionally limited to explicit protection requests
  or material risk, but independent dogfood must still measure the interruption
  cost.
- One 30-run source UserPromptSubmit process measurement was 121.32 ms p50 and
  148.34 ms p95 on the release Windows/Node 20 host. Installed-client, macOS,
  and Linux latency have not been measured.
- In the short pilot, explicit protect and confirmation turns each read the MCP
  Skill resource twice and accumulated high whole-turn input usage, mostly
  cached; user-visible latency was roughly 30 to 60 seconds. This is a beta
  usability issue, not evidence of ordinary-turn overhead.
- No Claude Code, Cursor, Gemini CLI, or WorkBuddy adapter is shipped.
- Installing Intent Loop and Context Continuity together does not yet create
  automatic shared truth: Intent Loop v1 does not expose an immutable monotonic
  snapshot revision and canonical snapshot hash required by the binding
  contract. Manual or inferred version synthesis is prohibited.
- The Continuity-to-Execution-Guard seven-field read-only schema is aligned,
  and was rechecked against the released Guard v0.1.0 contract; neither
  repository ships a live bridge in 0.1.0.
- The public MCP does not expose external intent binding or verified-evidence
  provider credentials. Internal adapter contracts are not a market feature.

## Allowed market claims

- Local-first Codex public beta.
- Real manual and automatic compaction lifecycle observed on the stated build.
- Minimal source-aware state, no transcript backup, no network or telemetry.
- Installed package persistence, exact authority confirmation, redaction,
  bounded responses, two-stage management actions, and fail-open behavior are
  tested.

## Prohibited market claims

- “Prevents context loss” without qualification.
- “Proven to reduce rework, target drift, or recovery time.”
- “Works on all Codex versions or all Agent products.”
- “Provides a complete memory system.”
- “Automatically integrates with Intent Loop” until the missing version/hash
  contract exists and is tested.

## Exit criteria after beta

Run the frozen 30-task three-arm evaluation without changing thresholds after
seeing results. A stable release requires the PRD thresholds for invariant
retention, next-action equivalence, drift reduction, erroneous restoration,
token cost, interruption rate, rework, recovery time, and user acceptance. It
also requires independent dogfood plus real resume and subagent handoff.

## Local cleanup requirement

Release verification may temporarily install the plugin and its marketplace.
Before final delivery, remove exactly context-continuity@context-continuity,
the context-continuity marketplace, its installed cache, and its empty or
synthetic plugin-data directory. Do not modify unrelated plugins, marketplaces,
Hook trust entries, or user projects.
