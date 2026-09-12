// Roblox API tools. These call official Roblox endpoints that do not
// require auth. Note: Roblox may 403 datacenter IPs on some endpoints —
// we surface that as a clear, actionable error.
import { config } from "../config.js";
import { HttpError } from "../util.js";

async function robloxGet(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(config.robloxTimeoutMs),
    headers: { "User-Agent": config.userAgent, Accept: "application/json" },
  }).catch((e) => {
    throw new HttpError(`Roblox API unreachable: ${e.cause?.code || e.message}`, 502, "ROBLOX_UNREACHABLE");
  });
  if (res.status === 403) {
    throw new HttpError(
      "Roblox API refused the request (403). This commonly happens from datacenter IPs — " +
        "retry later, or self-host on a residential connection.",
      502,
      "ROBLOX_FORBIDDEN"
    );
  }
  if (!res.ok) throw new HttpError(`Roblox API HTTP ${res.status}`, 502, "ROBLOX_STATUS");
  return res.json();
}

function positiveInt(v, field) {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(`${field} must be a positive integer`, 400, "BAD_ARGS");
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
    `  created: ${g.created}`,
    `  updated: ${g.updated}`,
  ].join("\n");
}

export async function gameByPlace(placeId) {
  const n = positiveInt(placeId, "placeId");
  const data = await robloxGet(`https://apis.roblox.com/universes/v1/places/${n}/universe`);
  const uid = data && data.universeId;
  if (!uid) return `No universe found for placeId ${n}.`;
  const game = await gameByUniverse(uid);
  return `placeId ${n} → universeId ${uid}\n\n${game}`;
}

export async function userLookup(usernames) {
  if (!Array.isArray(usernames) || usernames.length === 0) {
    throw new HttpError("usernames must be a non-empty array", 400, "BAD_ARGS");
  }
  const list = usernames.slice(0, 10).map((u) => String(u).trim()).filter(Boolean);
  if (!list.length) throw new HttpError("usernames must be a non-empty array", 400, "BAD_ARGS");
  const data = await robloxGet(`https://users.roblox.com/v1/users?userNames=${encodeURIComponent(list.join(","))}`);
  const users = data.data || [];
  if (!users.length) return `No users found for: ${list.join(", ")}`;
  return users
    .map(
      (u) =>
        `User: ${u.name}\n  id: ${u.id}\n  displayName: ${u.displayName}\n  createdAt: ${u.created}\n  isBanned: ${u.isBanned}`
    )
    .join("\n\n");
}
