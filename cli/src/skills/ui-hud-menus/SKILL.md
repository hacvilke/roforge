---
name: ui-hud-menus
description: Build Roblox UI — ScreenGui, HUD (coins/stage readouts), buttons, menus, mobile controls. Use when the user asks for a HUD, menu, button, text on screen, shop UI, or any GUI.
---

# UI / HUD / menu playbook

## The structure that always works
GUIs are Instances — build them with forge_import (parent the ScreenGui into the RIGHT
place) or forge_create + parenting:

```
StarterPlayer > StarterPlayerScripts > ObbyHUD (LocalScript)  -- script that BUILDS the gui
PlayerGui                                          -- where a player's gui actually lives at runtime
```

Rule: a LocalScript creates ScreenGuis and parents them to
`game.Players.LocalPlayer:WaitForChild("PlayerGui")` at runtime. Do NOT put ScreenGuis
directly in StarterGui unless the user wants a plain always-on gui (works too).

## Minimal HUD (the pattern the scaffold's ObbyHUD uses)
LocalScript:
```lua
local Players = game:GetService("Players")
local player = Players.LocalPlayer
local stats = player:WaitForChild("leaderstats")

local gui = Instance.new("ScreenGui")
gui.Name = "ObbyHUD"
gui.ResetOnSpawn = false
gui.DisplayOrder = 10

local coins = Instance.new("TextLabel")
coins.Size = UDim2.fromOffset(180, 36)
coins.Position = UDim2.fromScale(0, 0) + UDim2.fromOffset(12, 12)
coins.BackgroundColor3 = Color3.fromRGB(20, 20, 25)
coins.TextColor3 = Color3.fromRGB(255, 210, 60)
coins.Font = Enum.Font.GothamBold
coins.TextSize = 20
coins.TextXAlignment = Enum.TextXAlignment.Left
coins.Text = "Coins: 0"

local stage = Instance.new("TextLabel") -- same style, Position offset(12, 52), white text
coins.Parent = gui; stage.Parent = gui
gui.Parent = player:WaitForChild("PlayerGui")

task.spawn(function()
    while true do
        coins.Text = "Coins: " .. tostring(stats:FindFirstChild("Coins") and stats.Coins.Value or 0)
        stage.Text = "Stage: " .. tostring(stats:FindFirstChild("Stage") and stats.Stage.Value or 0)
        task.wait(0.5)
    end
end)
```

## Sizing rules
- `UDim2.fromScale(x, y)` — fraction of screen (responsive).
- `UDim2.fromOffset(x, y)` — absolute pixels.
- Buttons on mobile: height >= 44 offset px, width >= 120. Corner via a UIStroke or a
  UICorner child (UIStroke/Corner are real Instances).
- ZIndex: base 1, overlays 2-5, modals 10, toasts 20. Set per-label; don't rely on order.
- `AutomaticSize` for labels that must fit text: `Enum.AutomaticSize.XY` (with a
  UIPadding for breathing room).

## Menus (main menu / pause)
- ScreenGui with `ResetOnSpawn = false` + a full-screen Frame (fromScale(1,1),
  BackgroundTransparency 0, BackgroundColor3 dark) + centered TextButtons.
- Pause: a full-screen Frame + buttons on top; resume = `gui.Enabled = false`.
- MobileButtons (Instance) for mobile players: create a `MobileButtons` in the gui for
  touch movement (JogButtons).

## Pitfalls
- Gui is invisible? Check: Parent chain reaches PlayerGui, Visible=true,
  BackgroundTransparency < 1, ZIndex above what's behind, and the LocalScript actually
  ran (check Output for errors).
- Text cut off → TextScaled or bigger TextSize, or AutomaticSize.
- One GUI per concern (HUD, Shop, Menu) with separate DisplayOrder — don't build one
  mega-gui that's impossible to iterate on.
