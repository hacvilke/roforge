# RoForge CLI

`cli/bin/roforge.js` — the local agent. Zero npm dependencies (Node ≥ 18.17).

## Commands

| Command | What it does |
|---|---|
| `roforge` | Interactive TUI (starts the local bridge on 127.0.0.1:8790) |
| `roforge chat -m "prompt"` | One-shot mode; streams answer to stdout, tool trace to stderr |
| `roforge studio` | Keeps the bridge running + shows MCP/bridge connection status + the bridge token |
| `roforge tools` | List all tools (tier + approval flags) |
| `roforge login --provider <p>` | Store a key (gemini\|groq\|openrouter\|anthropic\|openai) in `~/.roforge/config.json` (0600) |
| `roforge providers` | List providers, which keys are set, and the auto-routing order |
| `roforge analyze <file.lua…>` | Official Luau analyzer, with expected Roblox-global notes filtered out |
| `roforge config [set key value]` | Show (key-masking) / set configuration |
| `roforge version` | Version |

## TUI

- `> ` prompt with history (↑/↓), `/help` `/tools` `/studio` `/clear`
  `/model <name>` (supports `provider:model`, e.g. `gemini:gemini-2.5-flash`)
  `/yolo` `/ask` `/save [path]` `/exit`.
- **`/save`** writes the whole conversation (messages, tool calls, tool
  results; images noted but not inlined) to a Markdown transcript —
  `roforge-transcript-<timestamp>.md` in your project dir, or a custom path.
- Streaming: assistant text streams in with **lightweight Markdown
  rendering** (headings, bullets, bold, inline code, dimmed code fences,
  blockquotes) — rendered line-by-line as tokens arrive, so it stays correct
  mid-stream. Tool calls print as `⚙ tool(args)` + `↳ first line of result`.
- **Approval gate**: destructive tools (`project_write`, `project_edit`,
  `project_run`, `forge_write/create/delete/run`, `forge_set_property`,
  `forge_set_attribute`, and MCP write tools) ask
  `✋ approve? [y]es / [n]o / [a]lways`. `/yolo` disables for the session;
  `approve: "yolo"` in config disables permanently (your call).
- **Colors**: run with `--no-color` (or `ROFORGE_NO_COLOR=1` / the standard
  `NO_COLOR=1`) for plain output — handy for piping or recording.
- **Expandable tool output**: every tool call is numbered —
  `⚙ [7] forge_find({"pattern":"car"})` — and multi-line results show the
  first line plus `(more: /out 7)`. `/out 7` prints the full output;
  `/out` (no arg) lists the last 10 calls. Last 30 kept in memory.
- **Windows**: the TUI verifies raw terminal mode works; on a legacy console
  it exits with a pointer to Windows Terminal / PowerShell 7+ (or
  `roforge chat -m "..."` one-shot, which works anywhere).
- **Ctrl+C** aborts the current turn (the model is told it was stopped);
  press again at an idle prompt to exit. **Ctrl+D** exits.
- Per-turn footer: `↑in ↓out tok  ≈ $cost` (approximate pricing, editable in
  config).

## Model providers & free tiers

BYOK, zero backend — your key goes only to the model provider. Five
providers, one of which is free to start:

| Provider | Key env | Free tier | Default model |
|---|---|---|---|
| **gemini** | `GEMINI_API_KEY` | yes — ~1,500 req/day, no card (aistudio.google.com) | `gemini-2.5-flash` |
| **groq** | `GROQ_API_KEY` | yes — ~1,000 req/day per model (console.groq.com) | `llama-3.3-70b-versatile` |
| **openrouter** | `OPENROUTER_API_KEY` | yes — `:free` models, req/day limits | `qwen/qwen3-coder` (free: `qwen/qwen3-coder:free`) |
| **anthropic** | `ANTHROPIC_API_KEY` | no | `claude-sonnet-4-5` |
| **openai** | `OPENAI_API_KEY` | no | `gpt-4.1` |

**Auto-routing (default):** `provider: "auto"` picks the first configured
key, **free tiers first** (gemini → groq → openrouter → anthropic →
openai) and uses that provider's free model when one exists. So with just a
free AI Studio key, `roforge` works out of the box at $0. Pin explicitly with
`--provider <p>`, `ROFORGE_PROVIDER`, or a `provider:model` model ref
(`--model gemini:gemini-2.5-flash`, `/model gemini:gemini-2.5-flash`).
`freeFirst: false` / `ROFORGE_FREE_FIRST=0` reverses the order. OpenRouter and
Groq are OpenAI-compatible, so any OpenAI-compatible base URL works too
(`openrouterBaseUrl`, `groqBaseUrl`).

## Configuration

File: `~/.roforge/config.json` (override dir with `ROFORGE_CONFIG_DIR`).
Env wins over file: `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ROFORGE_MODEL`, `ROFORGE_PROVIDER`,
`ROFORGE_FREE_FIRST` (0 = paid-first), `ROFORGE_MCP_URL`,
`ROFORGE_BRIDGE_PORT`, `ROFORGE_STUDIO_MODE` (auto|mcp|bridge),
`ROFORGE_MAX_ITERATIONS`, `ROFORGE_LUAU_ANALYZE` (path to the analyzer binary).

```jsonc
{
  "provider": "auto",               // auto | gemini | groq | openrouter | anthropic | openai
  "model": "",                      // "" = provider default; "gemini:gemini-2.5-flash" pins
  "freeFirst": true,                // auto mode: prefer free tiers
  "geminiKey": "…", "groqKey": "…", "openrouterKey": "…",
  "anthropicKey": "…", "openaiKey": "…",
  "geminiBaseUrl": "https://generativelanguage.googleapis.com",
  "groqBaseUrl": "https://api.groq.com/openai",
  "openrouterBaseUrl": "https://openrouter.ai/api",
  "anthropicBaseUrl": "https://api.anthropic.com",
  "openaiBaseUrl": "https://api.openai.com",
  "maxTokens": 8000,                // per-response cap
  "maxIterations": 12,              // agent loop safety cap
  "searchProvider": "auto",         // auto | serper | brave | wikipedia
  "serperKey": "", "braveKey": "",
  "studioMode": "auto",             // auto: MCP if reachable, else bridge
  "mcpUrl": "http://localhost:3004/mcp",
  "bridge": { "port": 8790, "host": "127.0.0.1", "token": "auto" },
  "approve": "ask",                 // "ask" | "yolo"
  "pricing": { "claude-sonnet-4-5": { "input": 3, "output": 15 } }
}
```

## Typical workflows

**Build a feature in a Rojo project (no Studio needed):**
```
> read src/ServerScripts and add a leaderstats system for players
```
The agent reads the tree, reads files, writes new ones (asks approval), runs
`rojo build`, and analyzes the new Luau.

**Fix what you see in Studio (vision):**
```
> the car in workspace/Vehicles doesn't accelerate — inspect it and fix the script
```
With the bridge plugin, the agent can call `forge_viewport` to **see** the
viewport (a real PNG rendered to the model) — e.g. "does the part look
centered?", "why is the lighting flat?" — then act with `forge_*` tools and
re-capture to verify. The MCP tier is no longer text-only: Studio's built-in
MCP tools that return image content (screenshots/captures) are detected,
annotated in their description, and the image is passed to the model the same
way. And because Studio edits can be rolled back, the bridge also exposes
`forge_checkpoint` / `forge_undo` / `forge_checkpoints` (`ChangeHistoryService`
wrappers): checkpoint before a destructive batch, undo if it goes wrong.

**Research + implement:**
```
> how do I persist a player's coins? web search the best practice, then implement it in this project
```

## Testing & demo

```bash
cd cli
npm test                 # 56 tests, offline (mock providers incl. Gemini + mock MCP + vision on both tiers)
npm run demo             # full agent loop vs mock Studio MCP + mock model
```

Studio plugins are gated in CI too (`studio-bridge/`): the PNG encoder is
validated pixel-by-pixel under the standalone `luau` interpreter,
`luau-analyze` runs with a syntax-error-only gate (Roblox globals are
expected unknowns outside Studio), and Rojo builds both plugins.
