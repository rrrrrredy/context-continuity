# macOS support record

Date: 2026-08-31

Context Continuity uses one cross-platform JavaScript core. macOS, Windows, and
Linux receive the same Codex plugin and DeepSeek Harness adapter; there is no
separate Mac fork or state format.

## User installation

### Codex on macOS

Requirements: a Codex build with plugin and Hook support, plus Node.js 20 or
newer.

Before installation, verify Node in the shell that will launch Codex:

```sh
command -v node
node --version
```

```sh
codex plugin marketplace add rrrrrredy/context-continuity --ref v0.2.0-beta.2
codex plugin add context-continuity@context-continuity
```

Restart or resume the Codex task, open `/hooks`, inspect the exact commands
from the installed cache, and explicitly trust only those definitions.

Before treating the Mac installation as active:

1. In the Codex task, run the read-only check `command -v node && node --version`.
2. Open `/hooks`; verify and trust `SessionStart`, `UserPromptSubmit`,
   `PreCompact`, `PostCompact`, `SubagentStart`, `SubagentStop`, and
   `SessionEnd` with no launch error.
3. Run `codex plugin list --json` and find
   `context-continuity@context-continuity`.
4. Run the 60-second protect/confirm/show smoke in the root README.

If the task or `/hooks` reports `node not found`, the plugin is not
protecting that task. Finder/Dock launches may omit a Homebrew, nvm, or asdf
PATH; an [upstream macOS PATH report](https://github.com/openai/codex/issues/20220)
documents this failure mode. The reliable beta fallback is the Codex CLI
launched from a terminal where `command -v node` succeeds. For Desktop, make
Node 20+ visible to the app process, restart the app, and rerun all four checks
before relying on continuity.

For complete deletion, first ask the installed plugin to delete the current
task, send its exact second confirmation, and verify the state is gone.

Then remove it with:

```sh
codex plugin remove context-continuity@context-continuity
codex plugin marketplace remove context-continuity
```

Removal alone preserves the local ledger. If the plugin cannot run, print and
inspect the resolved path before any manual cleanup:

```sh
printf '%s\n' "${CODEX_HOME:-$HOME/.codex}/plugin-data/context-continuity/v1"
```

### DeepSeek Harness on macOS

```sh
dsh plugin --profile <profile> add github:rrrrrredy/context-continuity#v0.2.0-beta.2
dsh --profile <profile> --dump-config
```

The dump must contain a layer/service whose `id` and `name` are both
`context-continuity`. Then start:

```sh
dsh --profile <profile>
```

See the adapter README for version pinning, restart, data, and removal details.

## Evidence boundary

| Claim | Evidence at release | Status |
| --- | --- | --- |
| Core state, recovery, Hook process, MCP process, package install, DSH adapter, protocol evals run on macOS | GitHub Actions `macos-latest` with Node 20 and 22 | Required release gate; public run URL is the final evidence |
| Same package paths and local state contract work without Windows-only separators | Cross-platform path tests and isolated package tests | Verified by source tests; macOS runner confirms the process behavior |
| Codex manual/automatic compaction lifecycle works on an authenticated real Mac Codex host | No authenticated Mac Codex host was available in the local release environment | Not yet verified |
| DSH CLI profile add and DSH engine-generated automatic compaction work on macOS | No complete real Mac DSH profile run was available | Not yet verified |

Passing `macos-latest` is real macOS execution for the code, packaging, Hooks,
MCP, and adapter tests. It does not prove an authenticated Codex desktop
automatic-compaction lifecycle. The release must keep those two claims separate.

## macOS-specific behavior

- Paths are resolved through Node's platform APIs; no drive letter is assumed.
- State remains local unless the user places `CODEX_HOME`, `DSH_HOME`, or an
  explicit data override in a synchronized location.
- The plugin does not request Keychain access, Full Disk Access, or a background
  daemon.
- Hook trust and host permissions remain owned by Codex or DSH.
- Host failure is fail-open: the Agent still runs, while continuity protection
  for that boundary is unavailable.

The installation and trust flow follows the current official
[Codex plugin packaging documentation](https://developers.openai.com/plugins/build/plugins)
and [Hooks documentation](https://learn.chatgpt.com/docs/hooks). The Hooks
documentation confirms plugin-bundled Hooks use the same explicit review and
trust flow on supported Codex surfaces.

A later release may upgrade real Mac lifecycle support from “not yet verified”
only after an authenticated run produces a source-bound receipt.
