---
name: data-saves
description: Persist player progress with DataStoreService — loading, saving, retries, session locks, leaderstats wiring. Use when the user asks to save progress, remember coins, DataStore, or "make it remember between sessions".
---

# Data saving playbook

## Requirements (tell the user first if not met)
- Game Settings > Security > **Enable Studio Access to API Services** ON, otherwise
  DataStore calls fail with "Access to DataStore is denied" in Studio.
- The game must be published (saved to Roblox) for cloud DataStores. In an unpublished
  Studio place, DataStoreService exists but GetAsync/SetAsync error.

## The pattern (pcall + retry + fallback — the scaffold's ObbyData does exactly this)
```lua
local DSS = game:GetService("DataStoreService")
local store = DSS:GetDataStore("RoForgeObby_v1") -- version your store name; changing it = fresh data

local function load(player)
    local key = "player_" .. player.UserId
    for attempt = 1, 3 do
        local ok, data = pcall(function() return store:GetAsync(key) end)
        if ok then return data end -- may be nil on first play
        task.wait(2)
    end
    warn("[ObbyData] DataStore unreachable; using in-memory session (progress won't persist)")
    return nil
end

local function save(player)
    local key = "player_" .. player.UserId
    local ok, err = pcall(function()
        store:SetAsync(key, { coins = ..., stage = ... })
    end)
    if not ok then warn("[ObbyData] save failed: " .. tostring(err)) end
end

-- save on leave and on shutdown:
game.Players.PlayerRemoving:Connect(function(p) save(p) end)
game:BindToClose(function()
    for _, p in ipairs(game.Players:GetPlayers()) do save(p) end
    task.wait(2)
end)
```

## Rules
- NEVER call GetAsync/SetAsync without pcall — network hiccups WILL happen.
- Version the store name (`RoForgeObby_v1`). When you change the data shape, bump to `_v2`
  and either migrate or start fresh — never silently break old saves.
- Load BEFORE gameplay starts (CharacterAdded / PlayerAdded early), save on
  PlayerRemoving + BindToClose, and periodically for big sessions (every ~30s or on
  stage change).
- For values that must never be lost mid-write, use UpdateAsync (transactional) —
  e.g. spending coins: `UpdateAsync(key, function(old) old.coins -= cost; return old end)`.
- Session lock (one active session per player, prevents double-spend on two tabs):
  store:UpdateAsync(key, function() return os.time() end) on load, clear on leave.
  Keep it simple for small games; the retry + fallback above is the 80%.
- In-memory fallback (what the scaffold does): if the store is unreachable, keep working
  in this session and tell the user in Output — never brick the game because saves fail.

## Wiring to gameplay
leaderstats IntValues are the live values; saves serialize from them
(`{coins = stats.Coins.Value, stage = stats.Stage.Value}`), load writes back into them.
Keep the DataStore layer in ONE module (the scaffold: ObbyData) so every game reads/writes
the same shape.
