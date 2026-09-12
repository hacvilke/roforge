# RoForge Security Model

## Threat model & what we protect

| Asset | Location | Protection |
|---|---|---|
| Model API key | Studio, in the user's own Plugin settings on their machine | Sent **only** to the model provider. Never to the backend, proxies, URLs, logs, or error strings. |
| Chat content | Studio memory (history array) | Never sent to the RoForge backend. Only tool args/results cross the wire. |
| Backend user accounts | `server/data/users.json` | scrypt-hashed passwords (16-byte salt, 64-byte hash), `timingSafeEqual` comparison. |
| Session tokens | client ↔ backend | HMAC-SHA256 signed (`rf1.payload.sig`), 7-day expiry, constant-time verification. |

## Why no proxy (no rpxy)

A third-party HTTP proxy sees **everything** in transit — including the
`Authorization`/`x-api-key` header. The RoForge design removes the middleman:

- Model calls go Studio → provider directly (Roblox HTTP can reach
  `api.anthropic.com` / `api.openai.com` fine; enable *Allow HTTP Requests* in
  Game Settings → Security).
- Backend calls carry a disposable session token, never the model key.

If you ever need proxying (e.g., in-game contexts that Roblox blocks from
reaching Roblox APIs), run your own endpoint and treat it as part of the
RoForge backend — never a third party.

## Key custody details (client)

- Stored via `Plugin:SetSetting` (per-user Studio settings, local disk).
- The only place the key is used: the `headers` table in `Providers/*.lua`.
- `Http.errorText` shows a 400-char body snippet of the *response* — request
  headers are never rendered into error text.
- No key material in URLs, query strings, or logs.

## Backend hardening

- **Auth**: `Authorization: Bearer <token>` on all `/v1` endpoints except login.
  Tokens are HMAC-signed with `ROFORGE_SECRET`; without a set secret the server
  warns and uses an ephemeral one (sessions don't survive restarts — set it).
- **Rate limits**: per-user sliding window (default 300 req/min, 60 tool/min).
  In-memory for single-node; swap `ratelimit.js` Map for Redis in production.
- **SSRF guard**: `url_fetch` resolves DNS first and blocks loopback/private/
  link-local/ULA addresses, re-checking on every redirect hop (max 5). Binary
  content types refused; 512 KB / 60k-char caps.
- **Roblox 403s**: surfaced as actionable errors (common from datacenter IPs).
- **Logging**: method, path, status, latency, username only. Never bodies,
  never auth headers, never tool args.

## What's different for a public hosted service (roadmap)

1. **Roblox OAuth** instead of username/password self-registration (the login
   function is isolated in `auth.js` — swap `login()` for an OAuth exchange,
   keep `issueToken`/`verifyToken` unchanged).
2. Admin-gated registration + account deletion.
3. Redis rate limiting + per-user tool spend quotas (search is a real cost:
   Serper/Brave are per-query priced).
4. TLS termination (put the server behind Caddy/nginx; it listens on plain
   HTTP by design so it works behind any proxy).
5. Optional (explicit opt-in) key vault: AES-GCM envelope encryption with a
   per-user DEK. Default stays "key never leaves the machine".

## Incident note

If a user believes their key was exposed: it can only have been visible to the
model provider itself (that's the designed data path). Audit your backend logs —
by construction, the key is not in them.
