---
name: character-player
description: Player and character work — humanoid stats, movement feel, respawn, character model structure, player attributes, leaderstats. Use when the user asks about the player, movement, jumping, respawning, character appearance, or player data.
---

# Player & character playbook

## Character structure (read before touching)
Each player spawns `Workspace.<PlayerName>` — a Model with `HumanoidRootPart` (the
position anchor), `Humanoid` (the controller), and body parts. Standard access:

```lua
local player = game.Players.LocalPlayer -- client; on server iterate game.Players
local character = player.Character
local humanoid = character:WaitForChild("Humanoid")
local root = character:WaitForChild("HumanoidRootPart")
```

## Movement feel (tune, don't rebuild)
On the Humanoid: `WalkSpeed` (default 16), `JumpPower` (default 50), `UseJumpPower`,
`MaxHealth` (default 100). A "floaty" obby feel: JumpPower 55-65. A snappy runner:
WalkSpeed 18, JumpPower 45. Set them in a ServerScript (applies to all players) via a
CharacterAdded connection, or set per-game in one script:

```lua
local Players = game:GetService("Players")
Players.CharacterAdded:Connect(function(char)
    local hum = char:WaitForChild("Humanoid")
    hum.WalkSpeed = 17
    hum.JumpPower = 55
end)
```

## Death & respawn
- `Humanoid.Died` fires when health hits 0. Kill bricks: `humanoid:TakeDamage(math.huge)`.
- Default respawn: Roblox respawns at the SpawnLocation/SpawnArea. For checkpoint respawn
  (the obby pattern): store the respawn CFrame on a PLAYER ATTRIBUTE (`ObbyCheckpoint`,
  a string like "Workspace.Obby.Checkpoint2"), then on Died:

```lua
local pcf = player:GetAttribute("ObbyCheckpoint") -- full instance name or nil
local target = pcf and game:GetService("Workspace"):FindFirstChildWhichIsA("Model") -- resolve name
-- set root.CFrame = target's CFrame + (0, 2.5, 0); the Humanoid auto-spawns there
```
- NEVER manually `character:Destroy()` as respawn — break the humanoid (`hum.Health = 0`
  or `TakeDamage(math.huge)`) so Roblox's respawn flow runs (it re-fires CharacterAdded).

## Player attributes & leaderstats
- `player:SetAttribute("Obby2x", true)` / `player:GetAttribute("Obby2x")` — attributes
  replicate to clients and are the cleanest cross-script signal.
- leaderstats: a folder named `leaderstats` inside the Player; IntValue children show in
  the player list. Obby scaffold: `Coins`, `Stage`.

## Pitfalls
- `player.Character` is nil for the first ~1s of join — always WaitForChild, never assume.
- Server scripts can't touch the camera or the player's GUI; client (LocalScript) can.
- Changing WalkSpeed every Heartbeat is wasted work — do it once per character.
- Never name a variable `game` or shadow `workspace` — Luau globals are sacred.
