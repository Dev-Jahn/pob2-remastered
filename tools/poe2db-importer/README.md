# tools/poe2db-importer

PoE2DB → 한국어 로컬라이제이션 사전 importer 정책 (`DESIGN.md` §8.4–§8.5, §14.3).

> **구현 위치:** 실제 importer · 매칭 · 사전 코드는 [`packages/localization`](../../packages/localization)에
> 있습니다 (`src/importer.ts`, `src/match.ts`, `src/dictionary.ts`, `scripts/`). 이 디렉터리는
> 정책 · 진입점 문서를 보관합니다.

- PoE2DB kr/us 페이지 → slug / name / icon / stat text 추출.
- 이름 정규화 + upstream `src/Data` id 매칭 (exact → fuzzy / 수동 리뷰 큐, NO-FALLBACK).
- 출처 attribution 포함 `ko-KR` 사전 + 한/영 검색 인덱스 생성.

**제약 (`DESIGN.md` §14.3):** rate-limit · 캐시 · robots/ToU 인지. HTML 파서 실패는 silent
degrade 대신 CI 실패(`FixtureParseError`). 앱 런타임 무제한 스크래핑 금지.

**현황:** importer 기계 + 오프라인 fixture 경로는 **완성**(Phase 6, `pnpm --filter @pob2/localization test`).
전체 PoE2DB **라이브 수집 + 아이콘 다운로드/번들은 진행 중** — `DATA_SOURCES.md`의 2026-06-02 정책
업데이트(legal cleared, 비영리, 번들 허용) 참조.
