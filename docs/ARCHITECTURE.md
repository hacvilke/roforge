# RoForge Architecture

## The one rule

**The model API key never leaves the user's machine except for direct calls to
the model provider.** No backend, no proxy, no rpxy. It is not in URLs, logs,
or error strings. Everything else stays local too.

## The local-first design (v0.2)

```
┌──────────────────────────────── your machine ───────────────────────────────┐
│                                                                             │
│  roforge CLI/TUI (Node, zero deps)                                          │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  session.js ── agent loop (agent.js)                                  │  │
│  │     │   streaming (SSE) via providers/                                │  │
│  │     │   tool dispatch w/ approval gates + iteration cap + history trim│  │
│  │     ▼                                                                 │  │
│  │  tools/                                                                │  │
│  │     web_search, url_fetch            (local, SSRF-guarded)            │  │
│  │     roblox_game_*, roblox_user_*     (local, official APIs)           │  │
│  │     project_tree/read/write/edit/    (your Rojo project on disk)      │  │
│  │       search/run, luau_analyze                                │       │  │
│  │     forge_*  ──► BridgeServer ── 127.0.0.1:8790 ──► Studio plugin    │  │
│  │     studio_* ──► mcp.js (Streamable HTTP) ──► Studio built-in MCP     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ direct HTTPS (your key)
                                       ▼
                         api.anthropic.com / api.openai.com
```

### Why the brain lives in a local process (not in Studio)

- **Streaming.** Studio's `HttpService` returns whole bodies — no SSE. A local
  process gets real token streaming for free.
- **Full HTTP.** Can listen (bridge server), follow redirects, read streams.
- **Familiar UX.** Claude-Code-style TUI: transcript, tool trace, approvals,
  slash commands, cost footer.
- **Project workflow.** The agent edits *your repo* (Rojo project files) the
  way Claude Code edits a codebase — build, test, and analyze locally. Studio
  becomes one more tool surface, not the whole product.

### Studio connection — two tiers

| Tier | How | When |
|---|---|---|
| **MCP (official)** | `mcp.js` speaks MCP Streamable-HTTP to Studio's built-in server (`localhost:3004/mcp`, beta feature) | Preferred; zero plugins |
| **Bridge (ours)** | `BridgeServer` on `127.0.0.1:8790`; `studio-bridge` plugin polls for jobs | When MCP isn't available |

`studioMode: "auto"` probes MCP at session start (4s) and uses it if
reachable; bridge tools are always registered alongside (the `forge_*` names
never clash with `studio_*` MCP names).

### Conversation model (shared by both provider adapters)

```
{ role: "user",      text }
{ role: "assistant", text?, calls: [{id, name, args}]? }
{ role: "tool",      id, name, result }
```

History is trimmed to the most recent 60 items and re-anchored with a user
message so both APIs stay happy. Tool results are truncated at 24k chars.

### Agent loop (agent.js)

1. Send history + tool schemas to the provider (streaming).
2. Stream text deltas to the UI.
3. If tool calls: record the assistant turn, execute each tool (approval gate
   first for destructive ones), append `tool` results, loop.
4. Stop on: final answer, `maxIterations` (safety cap), user abort (Ctrl+C →
   abort signal + "aborted" state), or provider error.
5. Accumulate usage → per-turn cost footer.

### Error philosophy

Every tool returns a **string**; failures are `ERROR: …` text the model reads
and adapts to. Network tools time-box every upstream call. `url_fetch` is
SSRF-guarded (DNS pre-check + per-redirect re-check; private ranges blocked).

## What the v0.1 pieces are now

- `client/` (in-Studio full agent plugin): still works standalone if you want
  chat *inside* Studio without a terminal. Its LocalTools registry is the same
  code the bridge plugin executes.
- `server/` (hosted tool backend): optional extension — e.g. a team shared
  instance with managed search quotas. The core product no longer needs it.

## Known limitations (v0.2)

- Screenshot tool saves to disk; **vision** (image into the model) is next.
- Bridge round-trip latency ≈ 1s poll cadence (MCP has no such latency).
- Single-user local config; teams/SSO are the hosted-service story.
- Pricing table is approximate/editable; per-provider exact rates vary.
