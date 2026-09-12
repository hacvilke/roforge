// Roblox API tools, run locally against official public endpoints.
const UA = "RoForge/0.2 (+local; roblox studio agent)";

async function robloxGet(url, timeoutMs = 10000) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": UA, Accept: "application/json" },
  }).catch((e) => {
    throw new Error(`Roblox API unreachable: ${e.cause?.code || e.message}`);
  });
  if (res.status === 403) {
    throw new Error("Roblox API refused the request (403) — commonly from datacenter IPs. Retry later.");
  }
  if (!res.ok) throw new Error(`Roblox API HTTP ${res.status}`);
  return res.json();
}

function positiveInt(v, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${field} must be a positive integer`);
  return n;
}

export async function gameByUniverse(universeId) {
  const n = positiveInt(universeId, "universeId");
  const data = await robloxGet(`https://games.roblox.com/v1/games?universeIds=${n}`);
  const g = (data.data || [])[0];
  if (!g) return `No game found for universeId ${n}.`;
  return [
    `Game: ${g.name}`,
    `  gameId: ${g.id}`,
    `  universeId: ${g.universeId}`,
    `  playing: ${g.playing}`,
    `  visits: ${g.visits}`,
    `  maxPlayers: ${g.maxPlayers}`,
    `  updated: ${g.updated}`,
  ].join("\n");
}

export async function gameByPlace(placeId) {
  const n = positiveInt(placeId, "placeId");
  const data = await robloxGet(`https://apis.roblox.com/universes/v1/places/${n}/universe`);
  const uid = data && data.universeId;
  if (!uid) return `No universe found for placeId ${n}.`;
  return `placeId ${n} → universeId ${uid}\n\n${await gameByUniverse(uid)}`;
}

export async function userLookup(usernames) {
  if (!Array.isArray(usernames) || !usernames.length) throw new Error("usernames must be a non-empty array");
  const list = usernames.slice(0, 10).map((u) => String(u).trim()).filter(Boolean);
  const data = await robloxGet(`https://users.roblox.com/v1/users?userNames=${encodeURIComponent(list.join(","))}`);
  const users = data.data || [];
  if (!users.length) return `No users found for: ${list.join(", ")}`;
  return users
    .map((u) => `User: ${u.name}\n  id: ${u.id}\n  displayName: ${u.displayName}\n  createdAt: ${u.created}`)
    .join("\n\n");
}

export function robloxTools() {
  return [
    {
      name: "roblox_game_lookup",
      description: "Look up a Roblox game by universeId. Returns name, id, players, visits.",
      inputSchema: {
        type: "object",
        properties: { universeId: { type: "integer" } },
        required: ["universeId"],
        additionalProperties: false,
      },
      execute: async (args) => gameByUniverse(args.universeId),
    },
    {
      name: "roblox_game_by_place",
      description: "Look up a Roblox game by placeId (the number in the Studio place URL).",
      inputSchema: {
        type: "object",
        properties: { placeId: { type: "integer" } },
        required: ["placeId"],
        additionalProperties: false,
      },
      execute: async (args) => gameByPlace(args.placeId),
    },
    {
      name: "roblox_user_lookup",
      description: "Look up Roblox users by username (1-10). Returns ids, display names, created dates.",
      inputSchema: {
        type: "object",
        properties: { usernames: { type: "array", items: { type: "string" } } },
        required: ["usernames"],
        additionalProperties: false,
      },
      execute: async (args) => userLookup(args.usernames),
    },
  ];
}
