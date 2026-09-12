# Self-hosting the RoForge backend

Requirements: **Node.js ≥ 18.17** (no npm dependencies).

## 1. Run the server

```bash
cd server
export ROFORGE_SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
npm start
# → [roforge] listening on http://0.0.0.0:8787
```

`ROFORGE_SECRET` keeps session tokens valid across restarts — always set it.

## 2. Create a user + token

```bash
curl -s -X POST http://127.0.0.1:8787/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"you","password":"at-least-8-chars"}'
# → { "token": "rf1.…", "username": "you", … }
```

First login with a username creates the account (MVP behavior — see
`SECURITY.md` for the OAuth upgrade).

## 3. Connect the plugin

1. In Roblox Studio: **File → Plug-ins → Manage**, install `client/dist/RoForge.rbxm`
   (build it first: `cd client && rojo build -o dist/RoForge.rbxm`).
2. Enable HTTP: **Game Settings → Security → Allow HTTP Requests**.
3. Open the **RoForge** toolbar button → **Settings** tab:
   - Provider: `anthropic` (or `openai`)
   - Model API key: your key (stays on your machine)
   - Backend URL: `http://127.0.0.1:8787` (or your hosted address)
   - Session token: the `rf1.…` token from step 2
   - **Save settings**, then **Test backend** (should say `Backend OK`) and
     **Refresh tools**.
4. Chat tab: talk to it. Try: *"List the scripts in ServerScriptService and
   summarize what each one does."*

## Optional configuration

| Env var | Default | Meaning |
|---|---|---|
| `PORT` / `HOST` | `8787` / `0.0.0.0` | Listen address |
| `ROFORGE_DATA_DIR` | `./data` | Where `users.json` lives |
| `SERPER_API_KEY` | — | Google results for `web_search` (best quality) |
| `BRAVE_API_KEY` | — | Brave results for `web_search` |
| `ROFORGE_SEARCH_PROVIDER` | `auto` | `auto` → serper > brave > Wikipedia (keyless fallback) |
| `ROFORGE_RATE_TOOL_PER_MIN` | `60` | Tool executions per user per minute |
| `ROFORGE_RATE_REQUEST_PER_MIN` | `300` | Requests per user per minute |

Without a search API key, `web_search` still works via the keyless Wikipedia
fallback (clearly labelled as such in results).

## Tests

```bash
cd server && npm test     # 21 tests: auth, rate limits, tools, end-to-end
```
