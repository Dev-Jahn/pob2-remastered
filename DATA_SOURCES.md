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

## 5. PoE2DB importer (localization mapping + attribution)

This section pins down the legal/attribution boundary for the Phase 6 PoE2DB
importer (`DESIGN.md` §18) and complements the short PoE2DB entry in section 2
above. See `DESIGN.md` §8.4–§8.5 (import pipeline), §14.3 (importer constraints),
and §15.2–§15.3 (legal policy).

- **Source:** PoE2DB `kr/` and `us/` category pages (keywords, item bases, skill
  gems; `https://poe2db.tw/kr/` and `https://poe2db.tw/us/`).
- **Use — mapping + attribution source ONLY:** PoE2DB pages are consumed as a
  Korean ↔ English **localization mapping** (slug → bilingual name/stat text) and
  as an **attribution source**. They are **not** an asset-redistribution channel:
  the importer derives a term dictionary, it does **not** copy or re-host PoE2DB
  pages or GGG-owned assets. Icon URLs are recorded as remote references only.
- **§14.3 constraints (importer policy):**
  - **Rate-limited and cached** — any live fetch is throttled and writes to a
    local cache; the importer never re-fetches a page it already has.
  - **robots/ToU-aware** — fetching respects PoE2DB `robots.txt` and Terms of Use.
  - **Offline fixtures only at CI** — CI and `pnpm build`/dictionary generation run
    purely over checked-in cached HTML under
    `packages/localization/fixtures/poe2db/{us,kr}/` (`importFromFixtures` reads
    disk, never HTTP). A malformed/changed source schema **fails** rather than
    silently degrading (`FixtureParseError` → CI failure), per §14.3.
  - **No unbounded runtime scraping** — the shipped app performs no scraping; there
    is no app-runtime crawl loop. Dictionary refresh is an offline, bounded,
    developer-run import — not a background job.
- **§15.2 GGG-asset boundary:** Icons/images surfaced via PoE2DB remain GGG-owned.
  They stay `do_not_bundle` by default (`DESIGN.md` §9.3): referenced remotely with
  user-side cache, never packaged, pending separate legal review. The importer only
  records icon `remoteUrl`/attribution; it bundles no image bytes.
- **Where the generated artifacts live:**
  - Generated dictionary: `packages/localization/generated/dictionary.json`
    (deterministic output of `scripts/build-dictionary.mjs`; `source: generated`,
    with PoE2DB-derived terms carrying `source: poe2db` attribution).
  - Manual overrides: `packages/localization/manual_ko_overrides.json`
    (human-confirmed terms that win over the generated dictionary; `DESIGN.md`
    §8.4 step J).
  - Importer entrypoint/policy: `tools/poe2db-importer/` and
    `packages/localization/src/importer.ts`.

## Release artifacts

Releases must ship `LICENSE`, `NOTICE.md`, this file, and component version
manifests (`DESIGN.md` §17.2). Per `DESIGN.md` §15.3, every release artifact
includes this `DATA_SOURCES.md`, so the PoE2DB importer's mapping-only /
attribution / `do_not_bundle` policy above travels with each release.
