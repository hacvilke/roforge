# PR

**What it does** (1–2 sentences):

**Area:** `area: cli` · `area: bridge` · `area: hq` (keep the others)

## Checklist (what CI runs)

- [ ] `(cd cli && npm test)` — all CLI tests pass (94+)
- [ ] `(cd cli && node demo/e2e-demo.mjs)` — offline e2e OK
- [ ] Luau: no `SyntaxError` from `luau-analyze` in any touched `.lua`
      (no chained colon calls — `a.b:c(x)`, never `a:b:c(x)`)
- [ ] If you touched `studio-bridge/` or `client/` or `hq/` source:
      rebuilt the artifact and committed it
      (`rojo build -o <dir>/dist/<Name>.rbxm <dir>/default.project.json`)
- [ ] If you touched a `forge_*` tool: updated its entry in
      `cli/src/tools/studio.js` (name, description, schema, and the
      `DESTRUCTIVE` set **only if it mutates Studio state**)
- [ ] If you touched `Pro.lua` limits: `studio-bridge/test/pro_test.lua`
      still passes (`node test/validate_pro.mjs ../bin/luau`)
- [ ] README / docs / CHANGELOG updated where user-visible behavior changed

## Notes for review

<!-- anything surprising: design tradeoffs, known gaps, follow-up issues -->
