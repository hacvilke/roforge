# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 0.3.x (latest) | yes |
| < 0.3.0 | no (v0.1/v0.2 are superseded) |

## Reporting a vulnerability

**Do not open a public issue for a security problem.**

Report via GitHub's private vulnerability reporting
(this button appears in the repo's **Security** tab), or email the
maintainer (@hacvilke) with a description and, if possible, a minimal repro.

We aim to acknowledge reports within 48h and patch serious issues in the
next release.

## What counts as in-scope

- **CLI / bridge**: the loopback bridge (`127.0.0.1:8790`) is token-gated;
  anything that bypasses the `Bearer` token check, the 16MB job cap, or
  escapes loopback binding is in scope.
- **Studio plugin (Luau)**: arbitrary code execution in the place from
  untrusted tool input (e.g. a `forge_run`/`forge_write` payload path that
  skips the approval gate), or leaking the bridge token out of Studio.
- **Key handling**: API keys are stored in `~/.roforge/config.json` (0600)
  and must never appear in logs, error messages, or the model's context.

## What is out of scope (by design)

- **Local-first trust model**: the agent can read/edit files in the directory
  you launch it from and execute `project_run` commands — that is the
  product (a local Claude-Code-style agent). Run it where you'd run a shell.
- **Model provider**: prompts go to the provider you configure (BYOK);
  provider-side behavior is not RoForge's surface.
- **Roblox Studio**: Studio's own MCP server (localhost:3004) is Roblox's
  component, with its own trust model.
- **HQ experience / products**: Roblox-hosted; purchase and DevEx behavior
  is Roblox's platform, documented in `docs/MONETIZATION.md`.

## General notes

See the architecture write-up at [`docs/SECURITY.md`](../docs/SECURITY.md)
for the full threat-model discussion (loopback binding, token lifecycle,
approval gates, 16MB caps, key storage).
