---
name: visuals-presentation
description: Make the game look good with parts — colors, materials, neon, meshes, lights, decals, sound, particles. Use when the user asks to make it look better, pretty, colorful, themed, "add lights/sounds/effects", or improve the aesthetic.
---

# Visuals & presentation playbook

## Color & material (the 80% of "looks good")
- Pick a palette first and STICK to it: 1 base (platforms), 1 accent (coins/checkpoints),
  1 danger (lava/red), 1 neutral (sky/background). Max ~4 colors.
- Material is half the look:
  - `Neon` — glow, use for accents, coins, lava, checkpoints (cheap "special").
  - `SlabConcrete` / `Concrete` — solid, industrial platforms.
  - `Slate` / `Granite` — rocky, natural.
  - `SmoothPlastic` — toy/arcade vibe (classic obby).
  - `WoodPlanks` / `Wood` — cozy; `Brick` — classic Roblox.
  - `Glass` — decorative only (players see through; fine for decor).
- `Color3.fromRGB(r, g, b)` takes 0-255; the forge_import JSON uses 0-1 floats —
  convert (255→1.0).
- Background: `Lighting` > Ambient/OutdoorAmbient/ColorShift_Bottom set the mood
  (forge_set on Lighting properties); a dusk ColorShift + lower Ambient = instant drama.

## Shape variety
- Default part is a box. `part.Shape = Enum.PartType.Cylinder` (rotated) or
  `Enum.PartType.Ball` for variety: cylinders for pillars, balls for coins (size 1.5),
  slabs (thin, wide) for platforms look deliberate.
- Keep it part-based: forge_import handles Part properties; WeldConstraint joins parts
  into a Model (add `WeldConstraint` with Part0/Part1 — for static decor a Model whose
  parts are all Anchored is fine without welds).

## Lights (cheap, high impact)
- `PartLight` child of a part (or `PointLight`): PointLight with
  `Color = Color3.fromRGB(255, 200, 80)`, Brightness 1-2, Range 10-15 for warm accents;
  Range 20-30 to fake a sky glow. Use sparingly: 3-6 lights per view, not everywhere —
  lights are expensive and wash out color.
- Neon material already glows without a light; don't double up.

## Decals & textures
- `part.TextureId = "rbxassetid://..."` for any face (decals). Free texture ids from
  the Creator Store exist, but part colors + materials are the reliable, safe default —
  don't hunt for asset ids in a scaffold; add decals when the user provides ids.

## Sound (atmosphere)
- A `Sound` instance (child of the relevant part or SoundService):
  `Sound.SoundId = "rbxassetid://..."`, `Loops = true`, `Volume = 0.3`.
- For a game-wide ambient: parent to `SoundService` in a ServerScript. Only add sounds
  the user asked for or that clearly fit (lava = low rumble; finish = chime).
- No asset id → skip; a silent game is fine, a buzzing wrong sound is not.

## Particles
- `ParticleEmitter` child of a part: `Rate` (particles/sec), `Lifetime`,
  `Color` (ColorSequence), `Size` (NumberSequence). Lava bubbles: rate 4, small orange
  particles rising (Speed 1-2). Finish platform confetti: burst on stage complete.
  One or two emitters — more is noise and cost.

## The verify loop (non-negotiable)
1. forge_viewport {small: true} after EVERY visual batch — check: consistent palette,
   nothing floating, neon actually glowing, z-fighting.
2. forge_screenshot for a record the user can see.
3. Iterate with forge_set (Color3, Material, CFrame) — 3-4 small adjustments beat one
   big rebuild.
4. Ask the user what they think; taste is theirs, your job is fast execution.
