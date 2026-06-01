# tools/golden-tests

Calculation **golden tests** — detect divergence between this fork and upstream
(`DESIGN.md` §7.4, §16). A deterministic corpus of authored PoB2 builds is run
through the real vendored Lua core; the curated §7.4 core stats it produces are
recorded as committed JSON **baselines**, which become the parity anchor every
later change (and every upstream sync) is checked against.

## Layout

```
tools/golden-tests/
├─ fixtures/              # authored PoB2 XML builds (the §7.4 case matrix)
├─ baselines/            # recorded §7.4 core-stat JSON, one per fixture (the anchor)
├─ record-baselines.mjs  # records / re-checks baselines via the real core
├─ test/golden.test.mjs  # vitest corpus + parity suite
└─ README.md
```

## Recording & checking

`record-baselines.mjs` drives each fixture through the **real vendored core** —
`luajit overlays/lua/runner.lua` over newline-delimited JSON-RPC, the same
out-of-process provenance path `@pob2/core-client` uses and the same one
`fixtures/sample-build.xml` already exercises. It needs only `luajit` + the
in-repo `overlays/` and `vendor/` (no TypeScript build), so it runs from a clean
checkout.

```bash
# Record / refresh every baseline JSON from the current vendored core:
node tools/golden-tests/record-baselines.mjs

# Gate: re-record and FAIL on any divergence from the committed baselines:
node tools/golden-tests/record-baselines.mjs --check

# Same parity check + corpus invariants under vitest:
pnpm --filter @pob2/golden-tests test
```

**Tolerance** (`DESIGN.md` §7.4): integer stats compared exactly; float stats
within `1e-6`. A stat appearing/disappearing versus the baseline is itself a
divergence (the curated set changed).

## Compared stats — the §7.4 "핵심 stat" set

Each baseline records only the curated machine-readable mainOutput keys (mirrors
`overlays/lua/modern_api.lua` `CORE_STATS`), including only those a given build
actually produces (NO-FALLBACK — real numbers, never null placeholders):

`Life`, `Mana`, `EnergyShield`, `Ward`, `Spirit`, `TotalDPS`, `CombinedDPS`,
`FullDPS`, `AverageHit`, `AverageDamage`, `WithDotDPS`, `TotalDot`, `Armour`,
`Evasion`, `EvasionRating`, `TotalEHP`, `FireResist`, `ColdResist`,
`LightningResist`, `ChaosResist` — i.e. average hit / rates / hit-crit / total +
DoT DPS / life-mana-ES / reservation (Spirit) / armour-evasion-ES / max resists /
effective hit pool.

## Provenance & asset policy (humanGate: gamedata)

Per `DESIGN.md` §9/§15, `DATA_SOURCES.md`, and the dev-workflow autonomy policy
(`docs/superpowers/specs/2026-06-01-dev-workflow-design.md` §2), every fixture is:

- **authored from the upstream PoB2 save formats** (`Build:Save` /
  `SkillsTab:Save` / `ItemsTab:Save` / `TreeTab:Save`), the same method as
  `fixtures/sample-build.xml` — **NOT live-scraped**;
- built **only from gamedata IDs that already exist** in
  `vendor/PathOfBuilding-PoE2/src/Data` (gem `gameId`s, granted-effect skill ids,
  item base names, tree node ids), each documented in the fixture XML header and
  the table below;
- **free of bundled GGG assets** — no icons/images are committed; per `DESIGN.md`
  §9.3 those stay `do_not_bundle` / remote-ref.

This is a 🚩 **gamedata human-gate** task: the corpus is best-effort and
self-contained, and the one place the vendored core cannot round-trip a
self-contained build (a tree-socketed jewel bound by PoB item URL, not local id —
see `jewel-ranger.xml`) is documented in-fixture rather than faked.

### `sample-sharecode.txt` — the share-code adapter fixture (🚩 gamedata FLAG)

`fixtures/sample-sharecode.txt` is the real-format PoB **share code** for
`sample-build.xml`, consumed by `@pob2/core-client`'s `share-code` test to pin that
the host-side compression adapter (`packages/core-client/src/compression-adapter.ts`,
`DESIGN.md` §5.1) matches upstream's wire format. A PoB share code is
`base64url( zlib.deflate( buildXml ) )` — upstream's `Deflate` is the runtime's
lzip/zlib `compress` at best-compression, so a real code carries the `0x78 0xda`
zlib header (base64 prefix `eNp…`), **not** raw DEFLATE.

**Provenance (FLAG):** the per-§2 autonomy policy forbids live network/scraping, so
this code is **generated from `sample-build.xml` in that exact upstream zlib format**
rather than captured from a live PoB instance. The format (zlib `0x78 0xda`) is
verified byte-identical to real PoB output; only the XML payload's _source_ is our
own fixture. Regenerate it (and the round-trip test stays green) with:

```bash
node -e 'const z=require("node:zlib"),f=require("node:fs"); \
  const xml=f.readFileSync("tools/golden-tests/fixtures/sample-build.xml","utf8"); \
  const c=z.deflateSync(Buffer.from(xml),{level:z.constants.Z_BEST_COMPRESSION}) \
    .toString("base64").replace(/\+/g,"-").replace(/\//g,"_"); \
  f.writeFileSync("tools/golden-tests/fixtures/sample-sharecode.txt",c+"\n")'
```

The file holds only the code (the test trims it). Confirming format compatibility
against a code captured from a live PoB build is deferred to the gamedata gate.

## The corpus — DESIGN §7.4 case matrix

12 deterministic fixtures (within the 10–20 band) covering all self-generated
§7.4 cases. Every fixture is a level-1 build with fixed gem level 20 and NORMAL /
literal-mod items, so it loads identically across runs and machines.

| Fixture                    | §7.4 case(s)                | Intent / headline gamedata IDs                                                                                              |
| -------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `unarmed-monk`             | unarmed                     | Monk (classId 10), no weapon, no skill — pure defensive/resource baseline.                                                  |
| `single-skill-mace`        | single skill                | Warrior (classId 6) + Akoyan Club + `SkillGemMaceStrike` (`MeleeMaceMacePlayer`) — minimal attack DPS.                      |
| `single-spell-spark`       | single skill, crit          | Sorceress (classId 7) + Attuned Wand + `SkillGemSpark` (`SparkPlayer`) — single spell, real base crit.                      |
| `spell-support-arc`        | single skill, party/support | Sorceress + Attuned Wand + `SkillGemArc` (`ArcPlayer`) **+ support** `SupportGemElementalFocus` — support-gem linking path. |
| `aura-discipline`          | aura / reservation          | Sorceress + `SkillGemDiscipline` (`DisciplinePlayer`) — spirit reservation + ES aura (EnergyShield 328).                    |
| `herald-of-ice`            | aura / reservation          | Ranger (classId 2) + `SkillGemHeraldOfIce` (`HeraldOfIcePlayer`) — persistent reserved herald.                              |
| `minion-skeletal-arsonist` | minion                      | Witch (classId 1) + `SkillGemSkeletalArsonist` (`SummonSkeletalArsonistsPlayer`) — minion calc path.                        |
| `dot-essence-drain`        | DoT, ailment                | Witch + Attuned Wand + `SkillGemEssenceDrain` (`EssenceDrainPlayer`) — chaos damage-over-time.                              |
| `dot-contagion`            | DoT, ailment                | Witch + Attuned Wand + `SkillGemContagion` (`ContagionPlayer`) — chaos area damage-over-time.                               |
| `armoured-mace`            | single skill, item-set swap | Warrior + Akoyan Club + Bearskin Mantle (Armour 207 / ES 60), TWO item sets (`Armoured` active vs `Stripped`).              |
| `passive-delta-life`       | passive allocation delta    | Warrior + allocated tree path `4665,47175,1913,38646,61534` (Armour/Melee/Attribute/Life-Regen cluster).                    |
| `jewel-ranger`             | jewel / radius / conversion | Ranger + allocated path to Jewel Socket node `60735` + Diamond jewel base — jewel/radius anchor.                            |

Class ids are the PoB2 spec `classId`/`classInternalId` (Witch 1, Ranger 2,
Warrior 6, Sorceress 7, Monk 10), **not** the raw tree-array indices.

## When a baseline legitimately changes

A vendored-core update (upstream sync, `DESIGN.md` §7.2) can legitimately move
these numbers. In that case re-run `record-baselines.mjs` (no `--check`), review
the diff, and commit the new baselines **as part of the sync PR** with the
upstream-driven diff attached (`DESIGN.md` §7.4). Never edit a baseline by hand to
silence a failing `--check`.
