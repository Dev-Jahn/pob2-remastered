# PoB2 Remastered — 개발 자동화 파이프라인 설계 (spec)

**작성일:** 2026-06-01
**상태:** 승인 대기 → 구현 예정
**관련 문서:** [`DESIGN.md`](../../../DESIGN.md) (§16 테스트, §17 CI/CD, §18 Phase, §20 Definition of Done)

---

## 1. 목표 / 비목표

### 목표

1. **재사용 가능한 per-Phase 오케스트레이션 Workflow**(`phase-pipeline`)를 구축한다. 입력은 Phase 1개, 동작은 `분해 → TDD 구현 → 검증 게이트 → 적대적 리뷰 → 리포트`.
2. 이 엔진을 **메인 에이전트 드라이버**가 Phase 루프로 돌려 **현재 상태에서 Phase 7까지 자율 진행**한다(완전 무인).
3. DESIGN.md의 각 Phase **완료기준(완료 조건)** 을 **실행 가능한 검증 커맨드**로 매핑하고, 증거(실제 커맨드 출력) 기반으로만 Phase를 통과시킨다.
4. **GUI 화면을 Xvfb/WSLg + Playwright로 캡처해 vision으로 시각 검증**한다(사람 게이트로 미루지 않는다).

### 비목표

- DESIGN.md가 정의하지 않은 기능을 추가하지 않는다(YAGNI).
- 계산 엔진을 재작성하지 않는다(DESIGN §2.2). 파이프라인은 upstream Lua를 **보존**하는 전제 위에서 동작한다.
- 사람-게이트(법적/자산, 라이브 스크래핑, 시크릿/서명)를 **위조하거나 가짜로 통과**시키지 않는다. 안전 기본값으로 best-effort 구현 + 명시적 플래그.

---

## 2. 자율성 정책 — 완전 무인

| 항목 | 정책 |
|---|---|
| **정지 조건 (유일)** | 자가수정 불가능한 **기술 블로커**(컴파일/테스트가 자가수정 루프 후에도 반복 실패). 이때만 사용자에게 증거와 함께 보고하고 멈춘다. |
| **사람-게이트** | 멈추지 않고 **best-effort + 🚩FLAG**(PROGRESS.md 기록)로 처리하고 진행. **크게 문제 없는 수준의 판단은 사용자에게 묻지 않고 자율 결정**하고 FLAG로만 남긴다. |
| 외부 네트워크 | 라이브 호출 금지 → **고정 fixture/캐시 HTML** 사용 (DESIGN §14.3) |
| 자산/아이콘 | 번들 금지 → `do_not_bundle` 유지 · remote-ref 설계 (DESIGN §9, §15) |
| 시크릿/서명 | 위조 금지 → config 훅 + env 참조 stub (DESIGN §13, §17.2) |
| git 원격 | Phase별 squash-merge **후 `origin` push** (사용자 승인). PR 자동 생성은 Phase 7 sync-bot 한정 |
| 공식 한국어 용어 | 자동 매핑 + confidence 표기, 최종 용어 확정은 FLAG (DESIGN §8.1) |

근거: NO-FALLBACK 원칙은 "가짜로 통과시키지 말라"는 뜻이며, 위 정책은 **미완을 미완으로 명시**하므로 위반이 아니다. 동시에 DESIGN.md가 이미 정한 안전 기본값과 정확히 일치한다.

---

## 3. 아키텍처 (Approach A)

```
┌─ 메인 에이전트 드라이버 (자율 루프) ─────────────────────────┐
│  state ← PROGRESS.md (compaction/세션 교체에도 복구)          │
│  for phase in [첫 미완 Phase .. 7]:                          │
│     ① 브랜치 생성                                            │
│     ② report ← Workflow('phase-pipeline.mjs', {phase})  ◀──┐ │
│     ③ 게이트 커맨드 직접 재실행 (증거 기반)                 │ │
│     ④ 하드 블로커? → 정지·보고   (유일한 정지)              │ │
│        아니면 → rebase→squash-merge→PROGRESS.md 갱신·커밋   │ │
│     ⑤ ScheduleWakeup로 self-pace + resume                  │ │
└────────────────────────────────────────────────────────────┘ │
                                                                │
   ┌─ phase-pipeline.mjs (재사용 엔진, Workflow 스크립트) ─────┘
   │  1. decompose   : repo상태+DESIGN+phases.mjs → 작업 DAG
   │  2. TDD pipeline: 작업별 실패테스트→구현→검증 자가수정
   │  3. gate        : gates.mjs[phase] 실제 커맨드 실행
   │  4. review      : code-review 에이전트 적대적 검증→수정
   │  5. report      : {완료작업, 게이트결과, 플래그, 블로커}
   └──────────────────────────────────────────────────────────
```

**왜 A인가:** "재사용 엔진"이라는 요구를 만족하면서, Phase 경계마다 (a) 내가 직접 증거 기반 검증, (b) 실제 git 커밋, (c) 중단/재개 지점, (d) 플래그 가시화가 생긴다. 단일 거대 Workflow(Approach B)는 가시성·복구가 약하고 1000-에이전트 cap에 근접해 기각.

---

## 4. 산출물

```
tools/dev-workflow/
├─ phases.mjs        # DESIGN §18·§20·§16 → {phase: {목표, 작업[], 완료기준[]}}
├─ gates.mjs         # {phase: [{name, cmd, kind: 'shell'|'visual'|'golden', required}]}
├─ phase-pipeline.mjs# ★ 재사용 엔진 (Workflow 스크립트)
├─ visual-verify.mjs # Xvfb/WSLg + Playwright 캡처 + vision 분석 헬퍼
├─ PROGRESS.md       # 진행 ledger (Phase/작업 상태·플래그·블로커)
└─ README.md         # 사용법 + DESIGN 매핑
.claude/commands/pob-dev.md   # /pob-dev <phase|auto> 얇은 진입점
```

---

## 5. 엔진 상세 (`phase-pipeline.mjs`)

입력: `{ phase: number }`. 단계:

### 5.1 decompose
에이전트가 `현재 repo 트리 + DESIGN.md + phases.mjs[phase]`를 읽고 구조화 출력:
```ts
Task = {
  id: string; title: string; deliverable: string;
  targetFiles: string[]; deps: string[];          // 작업 간 의존
  verifyCmd: string;                              // 이 작업 단위 검증
  humanGate?: 'legal'|'network'|'secret'|'visual'|'gamedata';
}
```

### 5.2 TDD 구현 (pipeline)
- 작업을 **의존성 위상순서**로 실행. 서로 독립 + `targetFiles` 비교차인 작업만 worktree 격리 병렬.
- 각 작업: **실패 테스트 작성 → 구현 → `verifyCmd` 통과까지 자가수정 루프**(상한 N회). superpowers `test-driven-development` 원칙 준수.
- `humanGate` 표시 작업: 안전 기본값으로 best-effort 구현 + 🚩FLAG 반환.

### 5.3 게이트
`gates.mjs[phase]`의 `required` 커맨드를 실제 실행. `kind`:
- `shell`: `pnpm format:check|lint|typecheck`, `cargo check`, Vitest 등
- `golden`: 코어 러너 출력 vs upstream golden diff (허용오차 DESIGN §7.4)
- `visual`: §6 참조

### 5.4 적대적 리뷰
`code-review` 에이전트가 Phase diff를 DESIGN.md 정합성·정확성·NO-FALLBACK 기준으로 검증. 실제 결함만 수정 루프로 환원(거짓양성 배제).

### 5.5 리포트
```ts
PhaseReport = {
  phase: number; doneTasks: string[];
  gate: { name: string; pass: boolean; evidence: string }[];
  flags: { task: string; gate: string; reason: string }[];
  blockers: { task: string; error: string; triedFixes: number }[];
}
```

---

## 6. GUI 시각 검증 (사용자 추가 요구)

환경 프로브 결과 **실현 가능**: WSLg(`DISPLAY=:0`, `wayland-0`) + Xvfb 존재, pnpm/npx 존재.

### 6.1 메커니즘 (`visual-verify.mjs`)
- **Tier 1 — 웹 UI 레이아웃 (주 경로, CI에서도 재현):** Playwright(chromium)로 React dev 서버를 띄워 핵심 화면을 **1366×768 / 4K**로 스크린샷. 네이티브 의존 없음.
- **Tier 2 — 실제 Tauri 창 (항상 시도):** `xvfb-run`(또는 WSLg 직접) + 빌드된 앱 실행 → `scrot`/imagemagick `import`로 창 캡처. 스크린샷 도구·cargo는 드라이버가 best-effort 설치. **필수 게이트는 아니지만 매 UI Phase에서 반드시 캡처를 시도**하고, 성공 시 추가 증거로 첨부, 환경상 불가 시 🚩FLAG.
- **분석:** 스크린샷을 vision으로 검증 — `gemini-vision` 스킬(정밀 레이아웃·텍스트) 우선, 가용 불가 시 직접 이미지 판독. DESIGN.md 목업 대비 **구체 단언** 검사:
  - 앱 셸: 좌측 네비(Overview/Skills/Items/…) + 중앙 워크스페이스 + 우측 Inspector 3분할 (DESIGN §10.2)
  - Overview: 공격/방어/리소스/경고 stat 카드 + 변경 delta 표시 (§10.3)
  - Items: 장착 그리드 / 라이브러리 검색 / Inspector 3영역, 카드에 `+DPS/-EHP` (§10.4)
  - Passive Tree: 노드 그래프 렌더 + minimap (§10.6)
  - 한국어 라벨 노출 + 영문 병기 (§8.1)

### 6.2 게이트 등급
`visual` 게이트는 **required** (UI Phase 2~5). Tier 1이 통과해야 Phase 통과. Tier 2(실제 Tauri 창)는 **매 UI Phase에서 항상 캡처를 시도**하되 필수는 아님 — 성공 시 추가 증거, 불가 시 FLAG(정지 아님).

---

## 7. Phase → 검증 게이트 매핑 (DESIGN §18·§20 기반)

> 드라이버는 시작 시 **상태 평가**로 "지금 실제로 통과하는 Phase"를 판정하고 **첫 미완 Phase부터** 진행한다. (현재 repo는 환경 scaffold만 완료 — Phase 0 기능 PoC는 미검증으로 간주.)

| Phase | 핵심 완료기준 (DESIGN) | 자동 게이트 (gates.mjs) | 무인 FLAG |
|---|---|---|---|
| **0** Audit/PoC | CLI에서 sample build 로드 → 주요 stat JSON; overlay만으로 동작, vendor 무수정 | 코어 러너 부팅→fixture 실행→stat 키 존재 단언; `git diff --quiet vendor/` | — |
| **1** Core bridge | 주요 stat이 upstream과 **일치**; malformed 입력에도 UI proc 유지 | golden diff(10~20 fixture, 허용오차), JSON-RPC schema validation, runner crash-isolation 테스트 | — |
| **2** Shell+Overview | build 열어 Overview 표시; ko/en 토글 | Vitest, `cargo check`, web build, Playwright smoke + **visual(3-pane shell)**, i18n 토글 테스트 | Tier 2 창 캡처 |
| **3** Items | Items 기능 parity; 한글 붙여넣기 MVP | parser fixture(en+ko), Vitest, Playwright items flow + **visual(3분할·delta 카드)** | 실제 한글 클라 다양성 |
| **4** Skills/Config/Calcs | 빌드 수정 flow; Calcs 결과 추적 | calc-mutation 테스트, Vitest, Playwright + **visual(Calcs breakdown)** | — |
| **5** Passive Tree | 트리 기능 parity; 대규모 zoom/pan 성능 | tree-data transform 테스트, 성능 측정(가능 시), Playwright + **visual(노드 그래프·minimap)** | 성능 FPS 정밀측정 |
| **6** 한국어 | UI 100%; coverage 기준; 한글 paste 성공률 | importer **캐시 fixture** dry-run, coverage 리포트≥MVP 임계, bilingual search 테스트 | 라이브 스크래핑·공식 용어 |
| **7** Release/자동화 | upstream sync PR 자동; updater rollback; reproducible artifact | CI 스켈레톤 실체화, upstream-sync dry-run, packaging dry-run, updater rollback unit, diagnostic export schema | 서명키·원격 PR·네이티브 서명 |

(각 셀의 정확한 커맨드는 `gates.mjs`에 구현. 임계치는 DESIGN §8.7 coverage / §16.3 perf budget 사용.)

---

## 8. 드라이버 상태 & git 전략

- **상태 영속:** `tools/dev-workflow/PROGRESS.md` — Phase/작업 체크리스트, 🚩FLAG 목록, 블로커, 마지막 커밋. 매 Phase 후 갱신·커밋 → compaction/세션 교체 후에도 재개.
- **git (CLAUDE.md 기본):** Phase별 `feat/phase-N-*` 브랜치 → 완료 시 `main`을 브랜치에 rebase → `main`에 **squash-merge** → **`origin`에 push**(사용자 승인). push 실패(인증/권한)는 하드 블로커가 아닌 🚩FLAG로 기록하고 로컬 진행 유지.
- **페이싱:** 긴 구간은 `ScheduleWakeup`로 self-pace, 같은 드라이버 프롬프트로 재진입해 다음 Phase 진행.

---

## 9. 환경 전제 (프로브 결과)

| 도구 | 상태 | 대응 |
|---|---|---|
| Lua 5.1 / LuaJIT | ✅ | 코어 러너 가동 |
| pnpm / node / npx | ✅ | JS 빌드·Playwright |
| Xvfb + WSLg | ✅ | 시각 게이트 |
| luarocks | ✅ / luacheck ❌ | `luarocks install luacheck` |
| cargo / rustc | ❌ | rustup best-effort 설치, 불가 시 Rust 게이트 FLAG |
| scrot / imagemagick | ❌ | Tier 2 캡처용 best-effort 설치, 불가 시 Tier 1만 |

---

## 10. 이 파이프라인 자체의 Definition of Done

- `phase-pipeline.mjs`가 Phase 1개를 받아 분해→TDD→게이트→리뷰→리포트를 끝까지 수행하고 구조화 리포트를 반환한다.
- 드라이버가 **첫 미완 Phase부터 자율 진행**하며, 통과는 **실제 게이트 커맨드 증거**로만 이뤄진다.
- 사람-게이트는 멈춤 없이 best-effort + 🚩FLAG로 기록된다.
- UI Phase에서 **스크린샷 + vision 시각 검증**이 실제로 동작한다(또는 환경 한계가 FLAG로 명시된다).
- 정지는 자가수정 불가 기술 블로커일 때만 발생하고, 증거와 함께 보고된다.
