# roforge-cli

**RoForge** — a Claude-Code-style local AI agent for Roblox Studio. Bring your
own API key, zero backend, zero npm dependencies.

```
roforge                     interactive TUI (auto-connects to Studio)
roforge chat -m "prompt"    one-shot mode (streams to stdout)
roforge providers           list providers, keys, and free-routing order
roforge login --provider <p> store an API key
roforge analyze <file...>   official Luau analyzer
```

## Install

```bash
npm i -g roforge-cli
roforge
```

Also on **GitHub Packages** as `@hacvilke/roforge-cli` (any GitHub token with
`read:packages` works), or clone the repo and run `node cli/bin/roforge.js`.

Requires Node ≥ 18.17. No other dependencies.

## Free tiers (no card needed)

`roforge providers` shows what you have. With `provider: "auto"` (default) the
CLI routes to the best free model you have a key for:

- **Gemini** — `gemini-2.5-flash` (~1,500 req/day free) → aistudio.google.com
- **Groq** — `llama-3.3-70b-versatile` (~1,000 req/day free) → console.groq.com
- **OpenRouter** — `:free` models (e.g. `qwen/qwen3-coder:free`) → openrouter.ai
- Anthropic / OpenAI — paid, highest priority when free tiers are exhausted

## Connecting to Studio

1. **Built-in MCP (recommended)**: Studio → File → Studio Settings → Beta
   Features → MCP Server, pick a port. `roforge` probes `http://127.0.0.1:8998`
   (configurable via `ROFORGE_MCP_URL`).
2. **RoForge Bridge plugin** (our fallback): install from the repo
   (`studio-bridge/`) — see the full README in the project repo.

With Studio connected, the agent can read the DataModel, read/write scripts,
create/delete instances, run Luau, **see the viewport** (vision), set
checkpoints and **undo its own edits**, find/bulk-create instances, and diff
the hierarchy.

## Where

Full docs live in the project repo — `README.md`, `docs/CLI.md`,
`docs/BRIDGE.md`, `PROGRESS.md`.

> **Publishing:** before `npm publish`, set a real `repository`/`homepage`/`bugs`
> URL in `cli/package.json` (left empty on purpose so no placeholder is
> shipped).
