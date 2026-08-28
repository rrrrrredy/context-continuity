# Contributing

Contributions are welcome when they keep the product inside its narrow boundary:
preserve and verify minimal task invariants across lossy context transitions.
This is not a transcript archive, general memory service, task manager, planner,
permission system, or replacement Agent harness.

## Before opening a change

1. Open an issue for protocol or lifecycle changes.
2. State the concrete continuity failure the new mechanism addresses.
3. Explain its token, latency, storage, privacy, and conflict costs.
4. Preserve source, time, validity, supersession, disagreement, and verification.

## Local checks

Use Node.js 20 or newer:

```text
npm ci --ignore-scripts
npm test
npm run validate
npm run smoke:hooks
npm run smoke:mcp
npm run eval:protocol
```

Real lifecycle checks additionally require a compatible local Codex CLI:

```text
npm run verify:lifecycle:manual
npm run verify:lifecycle:auto
```

Lifecycle receipts and protocol fixtures prove implementation behavior only.
Do not present them as real-task efficacy.

## Pull requests

- Add a regression test for every repaired failure.
- Do not persist full transcripts, hidden reasoning, credentials, or raw tool
  output.
- Keep Hooks inspectable, bounded, silent on ordinary turns, and fail-open.
- Do not add network access, telemetry, or a dependency without an explicit
  product and privacy justification.
- Update schemas and compatibility notes for contract changes.
- Use clear commits and accept the repository's Apache-2.0 license for submitted
  contributions.
