# Data Sources & Asset Policy

This document tracks where data and assets come from and how they may be used.
See `DESIGN.md` §9 and §15 for the full rationale.

## 1. Path of Building 2 (vendored)

- **Source:** https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2
- **Location:** `vendor/PathOfBuilding-PoE2` (git submodule, branch `dev`)
- **License:** MIT
- **Use:** Calculation core, game data, passive tree data. Preserved as-is;
  never edited in place (changes go in `overlays/`).

## 2. PoE2DB (localization enrichment)

- **Source:** https://poe2db.tw/kr/
- **Use:** Korean ↔ English term mapping (keywords, items, gems, passives).
- **Policy:** Reference/derived **mapping only**, generated into a localization
  dictionary with source attribution. Rate-limited, cached importer
  (`tools/poe2db-importer`). **Not** bundled wholesale; HTML parser changes must
  fail CI rather than silently degrade (`DESIGN.md` §14.3).

## 3. GGG / Path of Exile assets (icons, images)

- **Owner:** Grinding Gear Games.
- **Policy:** Default `do_not_bundle`. Item/skill icons are referenced remotely
  with user-side cache; offline asset packs require prior legal review
  (`DESIGN.md` §9.3). Users can disable external image loading.
- **Attribution:** Surfaced in Settings → About → Data/Image sources.

## 4. lua-utf8 (native runtime dependency)

- **Source:** https://github.com/starwing/luautf8 (luarocks rock `luautf8`).
- **Use:** Native (`.so`) C module the headless boot path requires —
  `vendor/PathOfBuilding-PoE2/src/Modules/Common.lua` calls `require('lua-utf8')`.
  The vendored `runtime/` ships only a Windows `lua-utf8.dll`, so on PUC Lua 5.1
  it is provisioned per environment, never bundled as a binary blob.
- **License:** MIT.
- **Policy:** Provisioned via `luarocks install --local luautf8`; no `lua-utf8.so`
  binary is committed to git. The boot-prerequisite probe
  (`tools/dev-workflow/ensure-lua-deps.sh`) and `overlays/lua/README.md` →
  "Boot prerequisites" document the install step. Third-party notice retained per
  `DESIGN.md` §15.1.

## Release artifacts

Releases must ship `LICENSE`, `NOTICE.md`, this file, and component version
manifests (`DESIGN.md` §17.2).
