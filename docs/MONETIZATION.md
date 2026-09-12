# RoForge monetization — open-core, Robux-first

Goal: keep the project **primarily open source and free**, while earning a
small, honest commission in Robux to fund continued work.

## The model: open-core

| Layer | License / price | What it is |
|---|---|---|
| `cli/` (npm `roforge-cli`) | MIT, **free forever** | The whole local agent, all 24 `forge_*` tools, all 5 providers incl. free tiers |
| `studio-bridge/` plugin | MIT, **free forever** | Full Studio bridge — nothing gated inside the free path |
| `client/` in-Studio chat | MIT, **free** | Original BYOK chat plugin |
| `server/` hosted backend | MIT (open), self-hostable | The optional sync/hosting layer |
| **RoForge Pro** | Proprietary, paid in Robux | Closed-source module + hosted convenience features, gated by Game Pass / Developer Product |

Principle: **the free tier is the product.** A dev who never pays gets a
complete, zero-cost toolchain (BYOK + free-tier models = $0/mo). Pro is
*convenience and collaboration*, not a paywall on core features.

## Channel A — Hub experience + passes (primary Robux stream)

Create one small experience — **"RoForge HQ"** — a clean lobby that:

1. shows the tool in action (a live demo place the agent edits in real time),
2. links to the GitHub repo, npm install, and devforum thread,
3. hosts the monetization (Roblox passes *must* live inside an experience).

Monetization in it:

- **Game Pass "RoForge Pro"** — one-time, e.g. **499 R$** → unlocks Pro
  features (see below).
- **Developer Product "Pro month"** — e.g. **199 R$/month** (repeatable
  purchase; Roblox has no auto-subscriptions, so Pro features also stay
  unlocked by the pass — the product is for those who prefer monthly).
- **Premium Payouts** — free anyway: anyone who plays the HQ experience
  while subscribed to Premium generates passive payout.

**Split: Roblox takes 30%, you keep 70%** of pass/product sales.
499 R$ pass → ~349 R$ to you → ~$1.33 via DevEx (≈ $0.0038/R$, 18+, min
50k R$ cash-out). It's a small per-unit number — the volume and the
*audience* (devs with projects to build) are the point.

### What Pro gates (proposed — none of it touches the local/free path)

- **Cloud snapshots**: back up instance trees to your hosted backend,
  restore from any machine (free tier: last 10 local snapshots only).
- **Team workspaces**: share a place + checkpoints with a dev team
  (uses the `server/` you already have).
- **Raised limits**: export depth 6→10, import nodes 500→2500,
  viewport capture up to 1920×1080.
- **Pro MCP endpoint**: hosted, always-on Studio bridge relay (no local
  port forwarding).

### How the gate works (technical)

- Open plugin reads two config ids at startup (GamePassId,
  DeveloperProductId).
- `MarketplaceService:UserOwnsGamePassAsync(userId, PRO_PASS_ID)` →
  `state.Pro = true` (plus the dev-product ownership check).
- If Pro: the plugin `require`s a **separate closed-source ModuleScript**
  (published as its own asset, embedded only in a *Pro build* of the
  plugin) that implements the cloud/team features.
- The open repo contains **zero** pro code — only the pass check and a
  "you're on Free" notice. Open-core, not obfuscated-core.

## Channel B — Premium-only Toolbox plugin (passive)

Publish the Studio plugin asset as **premium-only**. When a Roblox Premium
subscriber uses your asset in a place, Roblox allocates a share of that
subscriber's monthly Premium payout to you. Small, passive, and a great
discovery channel (Toolbox search). The free CLI + GitHub repo stay the
real product; the Toolbox copy is the same code.

## Channel C — real money, later (outside Roblox)

When teams/studios show up (they will — this is a *dev* tool):

- **Team plan via Stripe** on the hosted backend: shared instances,
  SSO, API credits, SLA. Robux doesn't work for B2B invoicing.
- The npm package stays free forever — it's the top of the funnel.

## Setup checklist (things only your Roblox account can do)

1. **Create "RoForge HQ" experience** in Studio (empty lobby is fine),
   publish it.
2. **Create the Game Pass** (499 R$) + **Developer Product** (199 R$)
   for it in Creator Dashboard → copy both ids into
   `studio-bridge/src/Root/Bridge/Settings` (new `ProGamePassId` /
   `ProDevProductId` fields — the plugin already has a Settings
   pattern; we wire the check next turn).
3. **Publish the plugin** (File → Publish to Roblox as a Plugin).
4. **Enable DevEx** (Creator Dashboard → Payments) so Robux can become
   real money at the 50k R$ threshold.
5. Optional: flip the Toolbox plugin asset to premium-only.

## What we build for this (next turns, no account needed)

- [ ] `ProGamePassId`/`ProDevProductId` in bridge Settings + the
      `MarketplaceService` ownership check + `forge_pro` status tool
      (reports Free/Pro, which features are active).
- [ ] `roforge pro` CLI subcommand (prints license status when connected
      to a Pro-bridged Studio).
- [ ] HQ experience starter place (a redacted demo the agent can
      demonstrate on).
- [ ] GitHub repo polish: `LICENSE` (MIT), `LICENSE-PRO` notice,
      Contributing, issue templates.
