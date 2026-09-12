# RoForge Tool Specification

A tool is the unit of capability the model can invoke. RoForge has two tool
families that the agent merges into one schema list per request.

## Contract

Every tool is:

```
{
  name:         string,          // unique across merged list (local wins on clash)
  description:  string,          // shown to the model — write it like an instruction
  input_schema: JSON Schema (draft-07 object),
  execute:      fn(args) -> string   // errors as "ERROR: ..." text, never thrown to the loop
}
```

Rules:

1. **Return a string, always.** The model only sees strings. Pretty-print
   structured data into readable lines.
2. **Errors are strings.** `ERROR: <what went wrong> + <how the model should adapt>`.
   The agent loop pcalls every tool; an uncaught error becomes `ERROR: <trace>`.
3. **Names.** Local tools use the `forge_` prefix. Server tools use lowercase
   `snake_case` (`web_search`, `roblox_game_lookup`).
4. **Schemas are strict.** Use `additionalProperties: false` and `required` so the
   model can't hallucinate arguments. Keep descriptions short and concrete.
5. **Output budgets.** Server tools should emit ≤ ~60k chars (the server truncates
   anyway). Local tools aim for ≤ ~20k. The client truncates all results at 12k.
6. **No secrets in args or results.** Anything that looks like a credential must
   not pass through the tool pipeline.

## Adding a LOCAL tool (client)

`client/src/Root/RoForge/Tools/LocalTools.lua` — append to the `TOOLS` table:

```lua
{
	name = "forge_my_tool",
	description = "What it does, when to use it, when NOT to use it.",
	input_schema = {
		type = "object",
		properties = {
			path = { type = "string", description = "Dotted instance path" },
		},
		required = { "path" },
		additionalProperties = false,
	},
	run = function(args)
		local inst, err = resolvePath(args.path)
		if not inst then
			return "ERROR: " .. err
		end
		-- do the work; return a string
		return "OK"
	end,
},
```

Rebuild with Rojo (`rojo build -o dist/RoForge.rbxm`). Local tools never touch the
network — keep it that way (that's what makes them fast and offline-safe).

## Adding a SERVER tool (backend)

`server/src/tools/registry.js` — append to the `tools` array:

```js
{
  name: "my_tool",
  description: "What it does, when to use it.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
    additionalProperties: false,
  },
  execute: async (args) => {
    // validate args, call your API, return a string
    // throw HttpError(msg, status, code) for user-readable failures
    return "result text";
  },
},
```

That's the whole integration — the plugin discovers it automatically via
`GET /v1/tools` (cached 5 minutes, refreshable from the Settings tab) and calls it
via `POST /v1/tools/my_tool`.

Server-side guardrails to keep:

- **Validate args** before use (the model is a user).
- **Time-box** every upstream call (`AbortSignal.timeout`).
- **Cap output** with `truncate()`.
- **No SSRF**: anything that fetches user-supplied URLs must go through
  `assertPublicHost` (see `tools/urlfetch.js`).

## Discovery & routing (client)

```
buildToolList(cfg)
  = LocalTools.all()
  + RemoteTools.getToolDefs(cfg)            -- GET /v1/tools, 5-min cache
        (skipped with a warning if the backend is down)
  with name clashes resolved in favour of local tools
```

`Agent.run` routes each call by name through the merged table; remote tools wrap
`RemoteTools.call`, which returns `"ERROR: …"` strings on failure — the same
contract as local tools, so the model handles both identically.
