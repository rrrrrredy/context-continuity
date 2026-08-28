# Independent installed-candidate user pilot

Date: 2026-08-29
Interaction candidate: `0.1.0+codex.20260828235955`
Decision: **GO for an explicitly bounded opt-in public beta; NO-GO for GA**

This was a short, independent Agent-driven usability pass against the installed
Codex cache package. It was not the frozen 30-task efficacy study and does not
show that the plugin reduces rework, drift, or recovery time.

The final package changes only the marketplace claim wording, line-ending
normalization, and cache-buster after this interaction run; the runtime schema,
Skill, Hooks, MCP behavior, and management guidance exercised below are
byte-identical.

## Observed flow

| User turn | Continuity activity | Result | Aggregated input tokens |
| --- | --- | --- | ---: |
| Ordinary task turn | No Skill resource or continuity tool call | Silent as designed | 20,704 |
| Protect goal and hard constraint | 2 Skill resource reads, 1 state read, 1 prepare call | Prepare succeeded on the first call with only `id`, `kind`, and `statement` | 221,965 |
| Send exact readable confirmation | 2 Skill resource reads, 1 state read, 1 record call | Write succeeded on the first call; two items became `user/verified/active` | 193,617 |
| Show state | 1 Skill resource read, 1 state read | Both protected claims displayed correctly | 128,042 |
| Request off | 1 Skill resource read, 1 state read, 1 prepare call | Complete confirmation phrase and token shown | 186,991 |
| Send exact off confirmation | 1 Skill resource read, 1 state read, 1 management call | First call preserved the complete `challenge:` prefix and disabled continuity | 202,286 |

The token figures are whole-turn Codex aggregates across repeated model samples,
not the token count of one model call. Most reported input was cached. They are
still useful evidence of latency and interaction cost, not a product-efficacy
metric.

## What passed

- Ordinary work caused no continuity call.
- The simplified public schema removed all confirmation-field retries.
- The second exact confirmation remained required; no arbitrary prompt was
  promoted to user authority.
- The protected objective and hard constraint were inspectable with authority,
  verification, and validity intact.
- The management flow used the complete one-time challenge on the first call.
- No shell, file, log, transcript, cache, `CODEX_HOME`, other-task, or network
  scan occurred.
- Earlier pilot coverage also confirmed that compaction makes an old
  `next_action` stale, the execution-guard view does not export it, challenge
  reissue is safe, and reset does not expose obsolete lifecycle pointers.

## Remaining usability limits

- Protect and record each caused the same MCP Skill resource to be read twice,
  despite the Skill's once-per-turn instruction. This adds model samples and
  user-visible latency; the observed key turns took roughly 30 to 60 seconds.
- The exact confirmation is readable but remains long when it includes two
  bounded provenance excerpts and hashes.
- A material prompt detail not selected for the proposal can remain as an
  unresolved signal. This is safer than silently treating it as confirmed, but
  may create visible noise.

The pilot also saw generic Codex `interface.icon_*` warnings. The warnings
contained no plugin identifier, and Context Continuity declares no icon fields,
so they cannot be attributed to this plugin from the available evidence.

## Release consequence

These findings are compatible with a self-hosted, opt-in beta whose promise is
state integrity around lossy transitions. They are not compatible with GA or
with claims of low-latency protection, measured rework reduction, or universal
Codex compatibility. Duplicate Skill reads and confirmation length are
post-beta usability work, while the frozen real-task three-arm study remains
the efficacy gate.
