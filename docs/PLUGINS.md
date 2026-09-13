# RoForge plugins (strict declarative system)

A plugin is a **JSON file**. There is no other format.

The file is either `<project>/plugins/<name>.json` or `~/.roforge/plugins/<name>.json`
(`ROFORGE_PLUGINS_DIR` overrides for testing). All `*.json` in those folders are
loaded at session start; each one becomes zero or more `forge`-independent tools
that the agent can call.

## Why JSON only

The validation is a strict allowlist: any key that is not explicitly permitted,
at any depth, rejects the plugin. There is no `code` field, no handler, no
script, no eval, no template engine, no variable expansion from the
environment. A plugin therefore **cannot contain malicious intent by
construction** — it can only ask the CLI to do one of four declared things.

The four actions:

| action | does | restrictions |
|---|---|---|
| `http` | one HTTPS request | public host only (localhost / RFC1918 / `*.local` rejected at load time), default port 443, GET/POST/PUT, literal headers, `{{arg}}` placeholders only for declared args |
| `command` | run one allowlisted binary | default allowlist: `roforge` only; argv array (no shell, no metacharacters); 30 s timeout |
| `read-file` | read one project file | fixed relative path in the manifest, no `..`, resolved inside the project root, ≤ 1 MB (default 256 KB) |
| `transform` | fill a template with args | `{{arg}}` placeholders only for declared args; no other syntax |

Guarantees enforced by the CLI, not by the plugin author:

- **No secrets reach plugins.** The CLI passes no API keys, no environment
  variables, no tokens into any plugin action. The only substitution is
  `{{argname}}` where `argname` is a property of the tool's own
  `input_schema`.
- **Mutations are approval-gated.** `http` POST/PUT and `command` tools always
  prompt for approval (`y` / `n` / `always`), same as `forge_write` and friends.
- **Outputs are capped.** Per-tool `output_max_chars` (default 8,000), hard
  ceiling 65,536 — larger output is truncated with a note.
- **Rejection is loud.** A non-conforming or suspicious manifest is not
  loaded; the TUI's status line lists the file and the exact reason, and the
  system prompt tells the model which plugins were rejected.

## Manifest shape

```json
{
  "name": "game-stats",
  "version": "1.0.0",
  "description": "What the plugin does (≤ 300 chars).",
  "tools": [
    {
      "name": "game_info",
      "description": "What this tool does (≤ 300 chars).",
      "input_schema": {
        "type": "object",
        "properties": {
          "game_id": { "type": "integer", "description": "Roblox game id" }
        },
        "required": ["game_id"],
        "additionalProperties": false
      },
      "action": {
        "type": "http",
        "method": "GET",
        "url": "https://games.roblox.com/v1/games",
        "query": { "universeIds": "{{game_id}}" },
        "timeout_ms": 10000,
        "output_max_chars": 4000
      }
    }
  ]
}
```

Rules the validator enforces:

- top level: exactly `name`, `version`, `description`, `tools` — nothing else.
  Any key matching a code shape (`code`, `script`, `eval`, `shell`, …) is
  rejected with a named error even before the allowlist runs.
- `name`: `[a-z0-9][a-z0-9_-]{0,47}`; `forge_*` names are reserved.
- `version`: semver-like `1.2.3`.
- `tools`: 1–50; tool `name` same rules, no duplicates (across plugins too).
- `input_schema`: JSON-schema object; `additionalProperties` **must** be
  `false`; property types limited to string/integer/number/boolean/array.
- `action`: exactly one of the four types; every key inside is allowlisted per
  type; everything else rejects the tool.
- `{{...}}` expressions may only reference declared args. `{{env:X}}`,
  `{{args.x}}`, malformed or nested expressions are rejected.

## Examples

`cli/examples/plugins/` ships two working manifests:

- `game-stats.json` — one `http` GET tool against a public Roblox endpoint.
- `place-helper.json` — one `read-file`, one `transform`, one `command`
  (`roforge --version`) tool.

To try one: copy it into your project's `plugins/` folder and start the TUI —
the status line shows `plugins: <name>@<version>` and the new tools appear in
the tool list.

## Extending the command allowlist

The default `command` allowlist is `roforge` only. To let plugins run other
binaries, set `plugins.allowedCommands` in `~/.roforge/config.json`:

```json
{ "plugins": { "allowedCommands": ["roforge", "lrm"] } }
```

Entries must match `^[a-z0-9._-]{1,32}$` (anything else is dropped). Adding a
binary does **not** weaken the guarantees: argv-array execution (no shell),
literal/declared-arg values only, metacharacter rejection, 30 s timeout,
output cap, and the approval prompt on every command tool all still apply.

### Example: LRM (P2P version control) as an AI addon

[`lrm`](https://github.com/hacvilke/lrm) (Log Replication Manager) is a
zero-dependency Go binary — peer-to-peer, end-to-end-encrypted,
content-addressed version control with no central server. It fits the
"local-first, no backend" philosophy, so it's the natural add-on for
project history:

```json
{ "plugins": { "allowedCommands": ["roforge", "lrm"] } }
```

then copy `cli/examples/plugins/lrm-status.json` into your project's
`plugins/` folder. The agent then gets three read-only tools:
`lrm_repo_status`, `lrm_repo_log`, `lrm_repo_peers`. Writing commands
(`lrm commit`, `lrm sync`, …) can be added as further tools — each one
approval-gated like any command action.

## What a plugin cannot do

- run arbitrary binaries (only the allowlist)
- reach localhost or private networks over http
- read files outside the project root
- read environment variables or any CLI key
- execute any kind of code (there is no field for it)
- bypass approval on mutating actions

That list is the whole security model, and it holds by construction: the
validator is an allowlist, the executor knows four verbs, and nothing else
exists.
