---
name: obby-course
description: Build or extend obby/obstacle-course games (platforms, lava, coins, checkpoints, moving platforms). Use when the user asks for an obby, parkour, obstacle course, or to extend the obby scaffold.
---

# Obby course playbook

## First: use the scaffold
If the place does not already contain an `Obby` model in Workspace, tell the user to run
`roforge scaffold obby` (terminal) — it pushes a playable, monetizable obby with all
gameplay scripts wired. Then extend it. Never hand-build the gameplay scripts from
scratch: the scaffold's scripts live in `ServerScriptService.ObbyScripts` (ObbyData,
ObbyGameplay, ObbyShop) and read the attribute contract below.

## The attribute contract (this is how scripts find things)
Parts get tagged with attributes; the scaffold's gameplay code scans for them:
- `KillBrick` (bool) — touching it kills the player (lava, spikes, void).
- `CoinValue` (number) — touching it grants that many coins (default 10).
- `CheckpointStage` (number) — stepping on it sets the player's respawn point + stage.
- `MoveRange` (number) + `MoveSpeed` (number) — makes the platform a tweened mover.
- `ShopKiosk` (bool) — the gamepass shop part (kiosk prompt auto-attaches).

Set attributes with forge_set (or include them in forge_import properties). When you add
parts, TAG THEM — an untagged part is invisible to gameplay.

## Building course geometry
- Call forge_import ONCE with a full scene JSON for any batch of parts. Part properties:
  Size {X,Y,Z}, Position {X,Y,Z} (world center), Color {R,G,B} (0-1 floats — the property
  is named Color, NOT Color3), Material, Anchored=true (always anchor course parts).
- Platform recipe: Size ~ (12, 1, 12) or wider for starts; gaps: 6-10 studs horizontal,
  2-4 studs up per step for normal difficulty. Jump height with default Humanoid is
  ~5 studs, horizontal reach over a flat ~12-14 studs — keep gaps under that.
- Lava: red/orange parts, Material Neon for glow, KillBrick=true.
- Coins: small parts (Size 2,1,2 or a cylinder), yellow, Material Neon, CanCollide=false,
  CoinValue=10 (25 for milestone coins).
- Moving platforms: flat part + MoveRange (how far to travel) + MoveSpeed (speed).
- Checkpoints: a flat pad part + CheckpointStage=N (stage numbers increasing up the course).
- Name parts descriptively (Platform6, Lava3) — forge_tree and the user will read them.

## Difficulty curve
- Early (stages 1-2): flat runs, small gaps, no moving parts. Teaches movement.
- Mid: 1-2 moving platforms, coins that require a precise jump.
- Late: tighter gaps (8-10), moving platforms with longer range, lava below.
- Never two hard mechanics in one jump.

## Verify (mandatory)
1. forge_viewport {small: true} after building — SEE the course from the side; check
   gaps, floats, z-fighting (two parts sharing a face → offset by 0.1 studs).
2. Tell the user to press F5 and play: spawn → platform 1 → first coin → checkpoint →
   death → respawn at checkpoint → 2x badge after pass.
3. Fix what looks/feels wrong by MOVING parts (forge_set Position), not deleting and
   rebuilding.
