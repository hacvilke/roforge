// RoForge Pro — CLI-side status plumbing.
//
// The entitlement itself is checked inside Studio by the bridge plugin
// (MarketplaceService only exists there). This module reaches the connected
// Studio and renders its `forge_pro` report for `roforge pro`.
//
// Two ways to reach Studio, tried in order:
//   1. ATTACH — if a bridge is already running on the configured port (e.g.
//      `roforge studio` is up and the plugin is bound to it), enqueue the
//      forge_pro job on that bridge and poll for the result. This is the
//      normal case: you check Pro while your Studio session is live.
//   2. OWN — otherwise start a throwaway bridge on the configured port, wait
//      for the plugin (bound to the same port + token) to connect, submit,
//      and stop. This lets `roforge pro` work standalone too.

import { BridgeServer } from "./bridge/server.js";

const HEALTH_PATH = "/health";

// Probe for an already-running bridge on baseUrl. Returns the /health body
// ({ok, service, connected, port}) or null when nothing is listening.
export async function probeBridge(baseUrl, { timeoutMs = 1200 } = {}) {
  try {
    const r = await fetch(`${baseUrl}${HEALTH_PATH}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!r.ok) return null;
    const j = await r.json();
    return j && j.service === "roforge-bridge" ? j : null;
  } catch {
    return null;
  }
}

// Enqueue `tool` on a running bridge and poll for the result. Resolves to
// {ok, result?/error}. `connected` lets the caller fail fast when the plugin
// isn't actually bound to this bridge.
export async function remoteSubmit(baseUrl, token, tool, args, { timeoutMs = 20000, pollMs = 150 } = {}) {
  const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const enq = await fetch(`${baseUrl}/v1/bridge/jobs/enqueue`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ tool, args }),
  });
  if (!enq.ok) {
    let msg = `HTTP ${enq.status}`;
    try { msg = (await enq.json()).error || msg; } catch { /* keep status */ }
    return { ok: false, error: msg };
  }
  const { id } = await enq.json();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const st = await (await fetch(`${baseUrl}/v1/bridge/jobs/${id}`, { headers: { authorization: `Bearer ${token}` } })).json();
    if (st.status === "done") {
      return st.error ? { ok: false, error: st.error } : { ok: true, result: st.result ?? "" };
    }
    if (st.status === "timeout") return { ok: false, error: st.error || "studio job timed out" };
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { ok: false, error: "timed out waiting for Studio" };
}

// Query Pro status, attaching to a running bridge when present. Returns
// { text } on success, { error } otherwise. `bridge` may be null to force the
// "own bridge" path (used by tests).
export async function queryProStatus(bridge, { port, token, baseUrl, timeoutMs = 20000 } = {}) {
  const base = baseUrl || `http://127.0.0.1:${port}`;

  // Path 1: attach to a running bridge.
  if (!bridge) {
    const health = await probeBridge(base);
    if (health) {
      if (!health.connected) {
        return {
          error:
            "A bridge is running but Studio is not connected. Open Roblox Studio with the " +
            "RoForge Bridge plugin active and paste the bridge token into it.",
        };
      }
      const out = await remoteSubmit(base, token, "forge_pro", {}, { timeoutMs });
      if (!out.ok) return { error: out.error };
      return { text: String(out.result ?? "") };
    }
  }

  // Path 2: own bridge (already started by the caller).
  if (!bridge || !bridge.connected) {
    return {
      error:
        "No Studio bridge connection. Pro status is checked inside Studio (MarketplaceService), " +
        "so this needs the RoForge Bridge plugin running and connected.",
    };
  }
  const out = await bridge.submit("forge_pro", {}, { timeoutMs });
  if (!out.ok) return { error: out.error };
  return { text: String(out.result ?? "") };
}

// Start a throwaway bridge for the "own bridge" path. Returns the started
// BridgeServer or throws on EADDRINUSE.
export function startOwnBridge({ port, host = "127.0.0.1", token }) {
  const bridge = new BridgeServer({ port, host, token });
  return bridge;
}

// Render the forge_pro report (plain text from the plugin) with minimal
// styling: the tier header gets color, the rest stays as-is.
export function renderProStatus(res, { bold, dim, red, green, magenta, yellow } = {}) {
  const id = (fn, s) => (fn ? fn(s) : String(s));
  if (res && res.error) {
    return (
      id(red, res.error) +
      "\n" +
      id(dim, "  1. open Roblox Studio with the RoForge Bridge plugin\n") +
      id(dim, "  2. run `roforge studio` here and paste the token it prints into the plugin\n") +
      id(dim, "  3. re-run `roforge pro` while both are running")
    );
  }
  const lines = String(res?.text ?? "").split("\n");
  const out = [];
  for (const line of lines) {
    if (line.startsWith("RoForge Pro: PRO")) out.push(id(green, line));
    else if (line.startsWith("RoForge Pro: FREE")) out.push(id(yellow, line));
    else if (line.startsWith("Unlock Pro:")) out.push(id(magenta, line));
    else out.push(line);
  }
  return out.join("\n");
}
