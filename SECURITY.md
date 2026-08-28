# Security policy

## Supported releases

Security fixes are applied to the latest tagged `0.1.x` release. This project is
an early public release; users should upgrade before reporting an issue already
fixed on `main`.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not include
secrets, private transcripts, real task ledgers, or exploit details in a public
issue.

Please include:

- affected version and Codex version;
- operating system and installation source;
- the smallest redacted reproduction;
- whether the issue can expose state across tasks, bypass provenance checks,
  corrupt the ledger, or execute an unexpected command.

The maintainer aims to acknowledge a complete report within five business days.
There is no guaranteed response SLA.

## Security boundary

Context Continuity runs local Node.js processes with the permissions Codex grants
to plugin Hooks and MCP servers. It does not authenticate users, sandbox Codex,
decide tool permissions, or protect against a malicious local administrator.
Treat its state as task metadata, not a secret vault. See
[`docs/privacy.md`](docs/privacy.md) for storage and deletion behavior.
