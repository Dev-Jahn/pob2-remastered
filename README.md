# PoB2 Remastered

[Path of Building 2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)의 **검증된 Lua 계산 엔진을 그대로 보존**하면서, 현대적인 데스크톱 UI · 한국어 로컬라이제이션 · upstream 추적 자동화를 더한 fork입니다.

> **상태: MVP 완성** — `DESIGN.md` Phase 0~7 전부 구현 완료 (코어 브리지 · 데스크톱 셸 · Items · Skills/Config/Calcs · Passive Tree · 한국어화 · 릴리스 자동화). 전체 게임 용어 사전 + 아이콘 **수집·번들은 진행 중** (`DATA_SOURCES.md` 참조).

## 무엇인가

- **계산 코어는 재작성하지 않습니다.** upstream PoB2의 Lua 엔진을 **out-of-process headless runner**로 보존하고 (`vendor/` 무수정), UI만 새로 만듭니다.
- React/TypeScript UI ↔ Tauri/Rust 호스트 ↔ Lua 코어를 **JSON-RPC**로 연결합니다.
- 한국어 UI 100% + 한/영 병렬 검색 + 한국어 아이템 붙여넣기.
- golden test로 upstream과 계산 일치를 지속 검증하고, upstream 동기화를 자동화합니다.

## 아키텍처

```
React/TS UI  ──Tauri IPC──▶  Rust Host  ──stdio JSON-RPC──▶  Lua Core Runner  ──▶  vendor/ (upstream PoB2, MIT)
 (@pob2/ui)                 (src-tauri)    (overlays/lua)      (luajit)
```

- **UI** (`@pob2/ui` · `apps/desktop`): 3-pane 셸, Overview / Items / Skills / Config / Calcs / Passive Tree 탭, `Ctrl+K` 커맨드 팔레트, ko/en 토글.
- **Host** (`apps/desktop/src-tauri`): 허용목록 IPC(`core_request`), 코어 러너 생명주기, 파일 I/O, updater(+rollback), 릴리스 채널, diagnostic export.
- **Core runner** (`overlays/lua/runner.lua`): upstream `HeadlessWrapper` 위에 `modern_api`(`build.load/save`, `calc.run`, `items.*`, `skills.*`, `config.*`, `calc.explain`, `tree.*`)를 stdio JSON-RPC로 노출. **`vendor/`는 절대 수정하지 않습니다.**

## 저장소 구조

```
pob2-remastered/
├─ vendor/PathOfBuilding-PoE2/   # upstream (git submodule, 무수정)
├─ overlays/lua/                 # 비침습 Lua 오버레이 (bootstrap · shim · modern_api · runner)
├─ apps/desktop/                 # Tauri + React 앱 (src/ 프론트엔드, src-tauri/ Rust 호스트)
├─ packages/
│  ├─ schema/                    # IPC 계약 + BuildState (Draft 2020-12 JSON Schema + AJV)
│  ├─ core-client/               # Node 코어 클라이언트 (러너 구동·스키마 검증, golden diff, share-code)
│  ├─ ui/                        # React 컴포넌트 + 순수 view-model + i18n
│  └─ localization/              # PoE2DB importer · 사전 · 한/영 검색 · coverage
├─ tools/
│  ├─ dev-workflow/              # DESIGN 기반 자동화 파이프라인 (phases · gates · run-gate · visual-verify · 엔진)
│  ├─ golden-tests/              # 계산 golden 베이스라인 + parity 게이트
│  └─ upstream-sync/             # diff classifier + sync dry-run
└─ DESIGN.md                     # 설계 문서 (§1~§22)
```

**원칙:** `vendor/`(upstream)는 수정하지 않습니다. 필요한 변경은 `overlays/lua/`에 두고, Lua `package.path`를 `overlays/lua` → `vendor/.../src` 순으로 둡니다 (`DESIGN.md` §7.1).

## 구현 현황 (Phase 0~7 완료)

| Phase | 내용                        | 핵심 산출물                                                             |
| ----- | --------------------------- | ----------------------------------------------------------------------- |
| 0     | 헤드리스 Lua 코어 부팅      | `overlays/lua/headless_bootstrap.lua` → 샘플 빌드 stat JSON             |
| 1     | 코어 브리지 (JSON-RPC)      | `runner.lua` · `@pob2/schema` · `@pob2/core-client`, golden parity      |
| 2     | 데스크톱 셸 + Overview      | `@pob2/ui` 3-pane 셸, 커맨드 팔레트, ko/en                              |
| 3     | Items 탭 + Tauri IPC 브리지 | `core_bridge.rs`(러너 sidecar), 장착 그리드, 한글 붙여넣기, equip delta |
| 4     | Skills / Config / Calcs     | mutate→recalc, `calc.explain` 수식 추적(§10.7)                          |
| 5     | Passive Tree                | canvas 렌더러(4863 노드, culling), allocate-over-IPC                    |
| 6     | 한국어 로컬라이제이션       | importer · 사전 · 한/영 검색, UI 문자열 100%                            |
| 7     | upstream 자동화 + 릴리스    | sync bot · 재현가능 패키징 · updater(+rollback) · diagnostic            |

> 각 Phase는 `run-gate.mjs`로 증거 기반 검증되었고, UI Phase는 스크린샷으로 시각 검증되었습니다. 상세 증거: `tools/dev-workflow/PROGRESS.md`.

## 사전 요구사항

| 도구             | 버전               | 비고                                                                       |
| ---------------- | ------------------ | -------------------------------------------------------------------------- |
| Node.js          | 22 (`.nvmrc`)      | corepack로 pnpm 활성화                                                     |
| pnpm             | ≥ 9                |                                                                            |
| Rust             | stable             | `rust-toolchain.toml` (Tauri 호스트 빌드)                                  |
| Lua / LuaJIT     | 5.1 / 2.1          | 코어 러너 (`luajit` 권장 — vendor 코어가 Lua 5.2 문법 사용)                |
| lua-utf8         | luarocks `--local` | 부팅 의존 (`tools/dev-workflow/ensure-lua-deps.sh`)                        |
| Tauri Linux deps | —                  | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev` 등 |

## 시작하기

```bash
# 서브모듈 포함 클론
git clone --recurse-submodules https://github.com/Dev-Jahn/pob2-remastered.git
cd pob2-remastered
# (이미 클론했다면) git submodule update --init --recursive

corepack enable
pnpm install

# Lua 네이티브 부팅 의존성(lua-utf8) 확인 + 설치 안내
bash tools/dev-workflow/ensure-lua-deps.sh
```

## 실행

```bash
# (1) 웹 프론트엔드만 — 브라우저 :5173, 코어 미연결 UI 확인용
pnpm --filter @pob2/desktop dev

# (2) 전체 데스크톱 앱 — Tauri 창 + 실제 코어 IPC 연결
#     tauri-cli 필요: cargo install tauri-cli   (또는 @tauri-apps/cli)
cargo tauri dev
```

## 검증 / 테스트

```bash
pnpm format:check && pnpm lint && pnpm typecheck      # 공통 게이트
pnpm -r test                                          # 전 패키지 vitest
node tools/golden-tests/record-baselines.mjs --check  # 계산 parity (upstream 일치)
node tools/dev-workflow/run-gate.mjs <0..7>           # Phase별 증거 기반 게이트
```

## 개발 워크플로우

이 fork는 `DESIGN.md`를 자동으로 구현하는 **재사용 파이프라인**으로 빌드됐습니다 (`tools/dev-workflow/`):

- `phases.mjs`(Phase 명세) · `gates.mjs`(검증 게이트 + `VISUAL` 화면) · `run-gate.mjs`(pass/fail/env-missing 분류) · `visual-verify.mjs`(Playwright/Xvfb 스크린샷) · `phase-pipeline.mjs`(분해 → TDD 구현 → 게이트 → 적대적 리뷰 엔진).
- `/pob-dev <phase|auto>`로 구동, 진행 상황·증거·플래그는 `tools/dev-workflow/PROGRESS.md`.
- 설계/계획 문서: `docs/superpowers/specs/`, `docs/superpowers/plans/`.

## Upstream 동기화

`vendor/PathOfBuilding-PoE2`는 fork(`origin`)를 가리키며, 그 안에 community 저장소가 `upstream`으로 등록됩니다. `tools/upstream-sync`의 diff classifier가 변경 유형별로 검증을 라우팅합니다 (`DESIGN.md` §7).

```bash
cd vendor/PathOfBuilding-PoE2
git fetch upstream && git merge upstream/dev   # 또는 rebase
cd ../.. && git add vendor/PathOfBuilding-PoE2 && git commit -m "chore: bump vendored upstream"
node tools/upstream-sync/src/dry-run.mjs        # 분류 + 합성 PR 리포트 (오프라인 dry-run)
```

## 한국어 로컬라이제이션

- UI 문자열 **100% 한글** (영문 alias 병기, 한/영 동시 검색).
- `@pob2/localization`의 PoE2DB importer가 키워드/아이템/젬/패시브 용어 사전을 생성하고, 수동 override(`manual_ko_overrides.json`)를 지원합니다.
- **현황:** 사전·검색·coverage **기계는 완성**. 전체 게임 용어 데이터 + 아이콘 **수집·번들은 진행 중** — 정책·출처는 `DATA_SOURCES.md`.

## 알려진 제약 (deferred)

정직하게 기록합니다. 전체 목록·근거는 `tools/dev-workflow/PROGRESS.md`의 🚩 플래그 참조:

- 릴리스 **서명키**: updater 검증은 주입 훅(실제 서명 자료 미연결).
- WebView **share-code 코덱**, `items.createCustom`, Skills 탭 **인앱 토글 배선** 등 일부 기능 deferred.
- 전체 한글 용어 **데이터/아이콘 수집·번들** 진행 중.

## 라이선스 / 데이터

MIT — [`LICENSE`](./LICENSE). 데이터·자산 출처와 정책은 [`DATA_SOURCES.md`](./DATA_SOURCES.md), 고지는 [`NOTICE.md`](./NOTICE.md), 기존 빌드 가져오기는 [`docs/MIGRATION.md`](./docs/MIGRATION.md)를 참고하세요.
