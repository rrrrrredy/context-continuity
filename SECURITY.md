# Security policy

## Supported releases

Security fixes are applied to the latest tagged `0.2.x` prerelease. Codex is
the primary beta host; DeepSeek Harness support is developer preview and pinned
to the host version named in the release notes. Upgrade before reporting an
issue already fixed on `main`.

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository. Do not include
secrets, private transcripts, real task ledgers, or exploit details in a public
issue.

Please include:

- affected plugin version, host type, host version, and adapter version if applicable;
- operating system and installation source;
- the smallest redacted reproduction;
- whether the issue can expose state across tasks, bypass provenance checks,
  corrupt the ledger, or execute an unexpected command.

The maintainer aims to acknowledge a complete report within five business days.
There is no guaranteed response SLA.

## Security boundary

Context Continuity runs local Node.js processes with the permissions the host
grants to Codex Hooks/MCP servers or the DeepSeek Harness plugin layer. It does
not authenticate users, sandbox the host, decide tool permissions, or protect
against a malicious local administrator. Treat its state as task metadata, not
a secret vault. See [`docs/privacy.md`](docs/privacy.md) for storage and
deletion behavior.
