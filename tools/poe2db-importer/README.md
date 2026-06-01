# tools/poe2db-importer

PoE2DB → Korean localization dictionary importer (`DESIGN.md` §8.4–§8.5, §14.3).

- Parses PoE2DB kr/us pages → extract slug/name/icon/stat text.
- Normalizes names and matches against upstream `src/Data` ids
  (exact → fuzzy/manual-review queue).
- Emits a generated `ko-KR` dictionary + search index with source attribution.

**Constraints:** rate-limited, cached, robots/ToU-aware. HTML parser failures
must fail CI rather than silently degrade. No unbounded scraping at app runtime.

Scaffolded in **Phase 6** (`DESIGN.md` §18).
