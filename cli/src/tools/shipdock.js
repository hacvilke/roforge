// shipdock — lets the agent drive ShipDock, the build + test + publish platform
// for this workspace's Roblox game, using a persistent machine credential token.
// Runs locally (no Studio bridge needed); talks to the ShipDock API over HTTP.
//
// Config (env vars, read into cfg by config.js):
//   SHIPDOCK_URL           e.g. https://shipdock.bootlab.blitz.cloud
//   SHIPDOCK_MACHINE_TOKEN sdmt. token minted in ShipDock (Settings → this workspace)
//   SHIPDOCK_WORKSPACE_ID  the workspace that token is scoped to
//   SHIPDOCK_GAME_ID       optional default game id (else pass gameId per call)
//
// The machine token is member-level and scoped to one workspace: it can build +
// read runs there, but cannot manage the workspace or touch other workspaces.

const TIMEOUT_MS = 30000;

function sdCfg(cfg) {
  const c = cfg || {};
  return {
    url: c.shipdockUrl || process.env.SHIPDOCK_URL || "",
    token: c.shipdockToken || process.env.SHIPDOCK_MACHINE_TOKEN || "",
    workspaceId: c.shipdockWorkspaceId || process.env.SHIPDOCK_WORKSPACE_ID || "",
    gameId: c.shipdockGameId || process.env.SHIPDOCK_GAME_ID || "",
  };
}

// True when the tools are usable (url + token set). The registry only adds them
// when this is true, so an unconfigured ShipDock never clutters the tool list.
export function hasShipdockConfig(cfg) {
  const c = sdCfg(cfg);
  return Boolean(c.url && c.token);
}

async function sd(c, path, { method = "GET", body } = {}) {
  if (!c.url || !c.token) throw new Error("ShipDock is not configured (set SHIPDOCK_URL + SHIPDOCK_MACHINE_TOKEN).");
  const res = await fetch(c.url.replace(/\/+$/, "") + path, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`ShipDock ${method} ${path} -> HTTP ${res.status}${data && data.error ? ": " + data.error : ""}`);
  }
  return data || {};
}

function needWs(c) {
  if (!c.workspaceId) return "ERROR: SHIPDOCK_WORKSPACE_ID is not set (the workspace your machine token is scoped to). Set it and try again.";
  return null;
}

function stageLine(s) {
  const mark = s.status === "passed" ? "v" : s.status === "failed" ? "x" : s.status === "running" ? ">" : " ";
  const ms = typeof s.ms === "number" && s.ms > 0 ? ` (${Math.round(s.ms)}ms)` : "";
  return `  [${mark}] ${s.label || s.name}${ms}`;
}

export function shipdockTools() {
  return [
    {
      name: "shipdock_build",
      requiresApproval: true,
      description:
        "Start a fresh build + test run of a game on ShipDock, the platform that compiles, lints, " +
        "runs headless tests, and publishes it to Roblox. Call this when the user asks you to build, " +
        "deploy, ship, or re-publish the game. Returns a run id — follow it with shipdock_status.",
      inputSchema: {
        type: "object",
        properties: {
          gameId: { type: "string", description: "Game id to build. Defaults to the configured game (SHIPDOCK_GAME_ID); use shipdock_games to list." },
        },
        additionalProperties: false,
      },
      execute: async (args, ctx) => {
        const c = sdCfg(ctx && ctx.cfg);
        const err = needWs(c);
        if (err) return err;
        const gid = String((args && args.gameId) || c.gameId || "").trim();
        if (!gid) return "ERROR: no gameId. Call shipdock_games to list the workspace's games, or set SHIPDOCK_GAME_ID.";
        try {
          const data = await sd(c, `/api/workspaces/${encodeURIComponent(c.workspaceId)}/deployments/simulate`, { method: "POST", body: { gameId: gid } });
          if (!data.runId) return "ERROR: ShipDock did not return a run id: " + JSON.stringify(data);
          return `Build started.\nrunId: ${data.runId}\nFollow it with shipdock_status (runId ${data.runId}).`;
        } catch (e) {
          return "ERROR: " + (e && e.message ? e.message : String(e));
        }
      },
    },
    {
      name: "shipdock_status",
      description:
        "Check the progress of a ShipDock build run: stage-by-stage status (fetch, build, lint, headless tests, publish, restart) plus recent log lines. " +
        "Omit runId to check the latest run. If a run is still in progress, call again in a few seconds.",
      inputSchema: {
        type: "object",
        properties: {
          runId: { type: "string", description: "Run id to inspect (from shipdock_build). Omit to check the latest run." },
        },
        additionalProperties: false,
      },
      execute: async (args, ctx) => {
        const c = sdCfg(ctx && ctx.cfg);
        const err = needWs(c);
        if (err) return err;
        try {
          let runId = String((args && args.runId) || "").trim();
          if (!runId) {
            const list = await sd(c, `/api/workspaces/${encodeURIComponent(c.workspaceId)}/deployments`);
            const runs = list.runs || [];
            if (!runs.length) return "No build runs yet for this workspace. Start one with shipdock_build.";
            runId = runs[0].id;
          }
          const data = await sd(c, `/api/deployments/${encodeURIComponent(runId)}`);
          const run = data.run || {};
          const lines = [`Run ${run.id} — ${run.status}`];
          const meta = [
            run.branch ? `branch ${run.branch}` : null,
            run.commit ? `commit ${run.commit}` : null,
            run.commitMsg ? `"${run.commitMsg}"` : null,
          ].filter(Boolean);
          if (meta.length) lines.push("  " + meta.join("  "));
          lines.push("stages:");
          for (const s of run.stages || []) {
            lines.push(stageLine(s));
            if (s.status === "running" || s.status === "failed") {
              for (const l of (s.logs || []).slice(-6)) lines.push("      " + l);
            }
          }
          if (!run.finishedAt) lines.push("", "(still in progress — call again in a few seconds)");
          return lines.join("\n");
        } catch (e) {
          return "ERROR: " + (e && e.message ? e.message : String(e));
        }
      },
    },
    {
      name: "shipdock_games",
      description: "List the games in the configured ShipDock workspace (id, name, Roblox universe id). Use to find a gameId for shipdock_build.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_args, ctx) => {
        const c = sdCfg(ctx && ctx.cfg);
        const err = needWs(c);
        if (err) return err;
        try {
          const data = await sd(c, `/api/workspaces/${encodeURIComponent(c.workspaceId)}/games`);
          const games = data.games || [];
          if (!games.length) return "ShipDock workspace has no games yet — add one in ShipDock first, then try again.";
          return games.map((g) => `${g.id}  ${g.name}  (Universe ${g.universeId})`).join("\n");
        } catch (e) {
          return "ERROR: " + (e && e.message ? e.message : String(e));
        }
      },
    },
  ];
}
