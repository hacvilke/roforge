# RoForge Bridge Protocol

The bridge is how the local CLI reaches a live Studio session when Studio's
built-in MCP server isn't available. It is a **loopback-only** HTTP job queue.

```
roforge CLI (your machine)                     Roblox Studio (your machine)
┌───────────────────────────┐                  ┌──────────────────────────────┐
│ BridgeServer              │   127.0.0.1      │ RoForge Bridge plugin        │
│  http://127.0.0.1:8790    │◄────────────────►│  polls every ~1s             │
│  - job queue              │   HTTP (Bearer   │  executes LocalTools (Luau)  │
│  - token auth             │   bridge token)  │  posts results back          │
└───────────────────────────┘                  └──────────────────────────────┘
```

Endpoints (all require `Authorization: Bearer <token>` except `/health`):

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness (no auth) — used by `roforge studio` UI |
| `GET /v1/bridge/ping` | Heartbeat — CLI uses it to know Studio is connected |
| `GET /v1/bridge/jobs` | Plugin claims the next pending job: `{jobs:[{id, tool, args}]}` (empty list = idle) |
| `POST /v1/bridge/jobs/:id/result` | Plugin submits `{result: "..."}` or a structured vision result `{result: {text, imageBase64, mediaType}}` (or `{error: "..."}`) |

CLI side: `bridge.submit(tool, args)` → promise resolving to
`{ok:true, result:string}` (or `result:{text, imageBase64, mediaType}` for
vision tools) or `{ok:false, error:string}` (60s default timeout; the tool
result becomes the model's tool_result either way — errors are `ERROR: …`
strings the model adapts to).

## Vision results (image contract)

`forge_viewport` returns the actual pixels of the Studio 3D viewport to the
model:

```
plugin: Viewport.capture()  ──►  PNG bytes  ──►  base64
CLI:    {text, imageBase64, mediaType:"image/png"}
history: tool item {result, image:{base64, mediaType}}
Anthropic: tool_result content = [{type:"image", source:{type:"base64",…}}, {type:"text",…}]
OpenAI:    tool message (text) + follow-up user message [{type:"text"},{type:"image_url", image_url:{url:"data:image/png;base64,…"}}]
```

Capture in the plugin tries three strategies in order (each pcall-guarded):

1. **RenderSurfaceTexture** of `workspace.CurrentCamera` (temp Folder in
   Lighting, `FocusMode = Locks` when supported) → `Image:Read()` → encoded
   with the bundled **pure-Luau PNG encoder** (`PngEncoder.lua` — stored zlib
   blocks, no Roblox globals, no bitwise ops; validated pixel-by-pixel in
   `studio-bridge/test/validate_png.mjs`).
2. **`ImageLabel:CaptureScreenshot()`** → path → `plugin:ReadFile(path)`.
3. Descriptive error — the model falls back to `forge_screenshot` (saves a
   file to disk) + reasoning.

Sizes: default 1024×576, clamped to 256–1280 × 240–720. A full-size capture
encodes in ~1.5s and travels as ~3MB of base64 — hence the 16MB bridge body
cap (up from 4MB).

## Guarantees

- **Loopback only.** The server binds `127.0.0.1` (configurable but strongly
  discouraged). No external interface exists.
- **Token auth.** A random 48-hex token is generated once and persisted in
  `~/.roforge/config.json`; it is printed by `roforge studio` and pasted into
  the plugin (stored in Studio plugin settings on the user's machine).
- **Timeouts.** Claimed jobs that never get a result resolve as errors after
  60s, so a dead Studio session can't wedge the agent.
- **No secrets in transit.** Only tool name + args + results (project content
  you already have on this machine). No API keys, no chat history.

## Plugin behavior (`studio-bridge/`)

1. On load: read URL + token from plugin settings; show a status dock.
2. Loop (1s cadence): `ping` → `jobs` → execute first job via the tool
   registry (`LocalTools` + bridge-only `ExtraTools`) → `POST result`.
   On network error: back off to 3s.
3. Status dock: connected/waiting, last job, jobs executed, URL + token fields.

### Toolset (24 `forge_*` tools)

| Tool | Does | Approve-gated |
|---|---|---|
| `forge_selected` | List the current Studio selection | |
| `forge_tree` | Indented instance tree (root + max_depth) | |
| `forge_read` | Script source by path, or instance property dump | |
| `forge_write` | Write COMPLETE script source (creates if missing) | ✋ |
| `forge_create` | Create an instance under a parent path | ✋ |
| `forge_delete` | Delete an instance | ✋ |
| `forge_run` | Run a Luau snippet (diagnostics) | ✋ |
| `forge_screenshot` | Save a viewport screenshot to disk | |
| `forge_viewport` | **Capture the viewport as an image the model can see** | |
| `forge_get_property` | Read one property by path | |
| `forge_set_property` | Set one property (string/number/bool coerced) | ✋ |
| `forge_get_attributes` | List all attributes on an instance | |
| `forge_set_attribute` | Set a string/number/boolean attribute | ✋ |
| `forge_select` | Set the Studio selection to given paths | |
| `forge_find` | Find instances by name substring and/or ClassName (paths, limit) | |
| `forge_bulk_create` | Paste-style: create many instances in one call (`items[]`) | ✋ |
| `forge_snapshot` | Capture the instance tree under a name (last 10 kept) | |
| `forge_diff` | Snapshot vs now: added (+) / removed (−) / changed (~) instances + properties | |
| `forge_export` | Subtree → JSON (name, props, script sources, attributes; depth ≤ 6) | |
| `forge_import` | Apply a `forge_export` JSON back: recreate tree + props + attributes under a parent (`dry_run` supported; ≤ 500 nodes) | ✋ |
| `forge_checkpoint` | Mark the undo history with a named checkpoint (via `ChangeHistoryService`) | |
| `forge_undo` | Roll back to a named checkpoint, or undo one step | ✋ |
| `forge_checkpoints` | List checkpoints (name, index, steps back) + current index | |
| `forge_game_info` | Place id, job id, Studio mode, selection count | |

**Undo safety for destructive batches.** `forge_checkpoint` calls
`ChangeHistoryService:SetChangePoint(name)`, which marks a point in Studio's
native undo history; `forge_undo` jumps back with `SetChangeHistoryIndex`
(accepts a checkpoint name, or omits it to undo one step). The usual pattern
for a multi-step edit job:

1. `forge_checkpoint {name: "before-car-tweaks"}`
2. …`forge_set_property` / `forge_write` / … (each approve-gated)
3. if something looks wrong → `forge_undo {to: "before-car-tweaks"}`

All calls are pcall-guarded: if the Studio build lacks the API, the tool
returns a clear error instead of crashing the plugin.

**Working with big places.** The discovery/export/diff tools complement the
edits:

- `forge_find {pattern: "wheel"}` or `{class_name: "BillboardGui"}` — locate
  things without dumping the whole tree.
- `forge_snapshot` before a big refactor, `forge_diff` after — a clean
  "what changed" list of the instance tree, independent of (and complementary
  to) undo checkpoints.
- `forge_export {path: "workspace/Vehicles", depth: 4}` — JSON dump with
  properties, script sources (truncated), and attributes; the model can read
  a subtree without dozens of individual reads.
- `forge_bulk_create` — paste a whole structure in one approval:
  `{items: [{path, class_name, name, properties}...]}` (max 200).

**Vision on the MCP tier too.** When you use Studio's built-in MCP server
(`studioMode: auto` with MCP reachable), its tools are wrapped as
`studio_*` and any tool whose name/description looks like a scene capture
(`screenshot`, `capture`, `render`, `image`, `viewport`) is annotated in its
description and its returned image content is surfaced to the model — the
same vision contract as `forge_viewport`. The system prompt lists which
`studio_*` capture tools are available in your Studio build.

Note: plugin `HttpService` requests are not gated by the game's "Allow HTTP
Requests" setting (that applies to game scripts) — the bridge works as long as
the CLI process is running.

## Why not just use MCP?

Studio's built-in MCP server (beta, `localhost:3004`) is the preferred path —
it's official and needs no plugin. The bridge remains because: (a) the beta
flag may not be available on every Studio build, (b) our `forge_*` toolset is
tuned for RoForge's prompts and path conventions, and (c) it's a proven
pattern in the community (several Studio MCP bridges use the same poll design).
`studioMode: "auto"` uses MCP when reachable and falls back to bridge tools.
