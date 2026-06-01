// phases.mjs — DESIGN.md §18 (phases) + §20 (Definition of Done), machine-readable.
export const PHASES = {
  0: {
    goal: '기존 PoB2 실행 구조와 Lua core 분리 가능성 확인',
    tasks: [
      'upstream submodule/mirror 구성 (이미 vendor/ 존재 — 검증)',
      'Lua runner boot prototype (overlays/lua/headless_bootstrap.lua)',
      'HeadlessWrapper.lua / Launch.lua 분석',
      'sample build load/calc proof of concept',
      'PoB XML/share code 입출력 경로 확인',
      'legal/data source policy 문서화 (DATA_SOURCES.md 검증)',
    ],
    doneCriteria: [
      'CLI에서 sample build 로드 후 주요 stat을 JSON으로 출력',
      'vendor/ 무수정, overlays/lua 만으로 동작',
    ],
  },
  1: {
    goal: 'UI가 사용할 안정적 IPC API 확보 (Core bridge MVP)',
    tasks: [
      'JSON-RPC protocol 구현 (out-of-process runner)',
      'build.load / build.save / calc.run / items.parseClipboard',
      'response schema validation (packages/schema)',
      'runner crash isolation (malformed input)',
      'golden fixture 10~20개',
    ],
    doneCriteria: [
      '기존 PoB와 주요 stat 일치 (golden diff, 허용오차 DESIGN §7.4)',
      'malformed input에서도 runner/UI process 유지',
    ],
  },
  2: {
    goal: '새 UI 기본 shell + read-only build viewer (Desktop shell & Overview)',
    tasks: [
      'Tauri app skeleton (apps/desktop)',
      'React layout (3-pane shell, DESIGN §10.2)',
      'command palette (Ctrl+K)',
      'build open/save',
      'overview stat cards (DESIGN §10.3)',
      'warning panel',
      'Korean UI string baseline (ko/en)',
    ],
    doneCriteria: [
      '기존 build 파일을 열어 Overview 표시',
      '한국어/영어 UI toggle 가능',
    ],
  },
  3: {
    goal: 'Items tab 재설계 (DESIGN §10.4)',
    tasks: [
      'item set selector', 'equipped gear grid', 'item library search',
      'item inspector', 'clipboard import (ko MVP)', 'item equip delta',
      'custom item creation', 'shared item scope', 'unsupported mod display',
    ],
    doneCriteria: [
      '기존 Items tab 주요 기능 parity',
      '한국어 아이템 붙여넣기 MVP 지원',
    ],
  },
  4: {
    goal: '계산 조작 + 설명 UI (Skills, Config, Calcs)',
    tasks: [
      'skill group editor', 'support gem toggle', 'aura/buff/minion controls',
      'config presets (DESIGN §10.8)', 'Calcs breakdown explorer (§10.7)',
      'formula trace mapping',
    ],
    doneCriteria: [
      '주요 빌드 수정 flow가 기존 PoB 없이 가능',
      'Calcs tab에서 결과 추적(formula trace) 가능',
    ],
  },
  5: {
    goal: '고성능 Passive Tree (DESIGN §10.6)',
    tasks: [
      'TreeData transform', 'canvas/WebGL renderer', 'pan/zoom/minimap',
      'node search', 'path preview', 'allocation delta', 'jewel/radius support',
    ],
    doneCriteria: [
      '기존 트리 기능 parity',
      '대규모 zoom/pan 성능 기준 충족 (DESIGN §16.3)',
    ],
  },
  6: {
    goal: '실사용 가능한 한국어 PoB2 (DESIGN §8)',
    tasks: [
      'PoE2DB importer (고정 fixture/캐시 HTML)', 'keyword/item/skill/passive dictionary',
      'bilingual search index', 'Korean stat/mod parser expansion',
      'coverage dashboard', 'manual review UI',
    ],
    doneCriteria: [
      'UI 문자열 100%',
      '주요 데이터 영역 coverage MVP 임계 (DESIGN §8.7)',
      '한국어 클립보드 item parse 성공률 측정',
    ],
  },
  7: {
    goal: '유지 가능한 fork로 전환 (Upstream automation & release)',
    tasks: [
      'upstream sync bot', 'diff classifier (DESIGN §7.3)', 'release channel',
      'updater (rollback)', 'diagnostic export', 'crash reporting', 'user migration guide',
    ],
    doneCriteria: [
      'upstream update PR 자동 생성 (dry-run)',
      'release artifact reproducible (dry-run)',
      'rollback 가능한 updater (unit)',
    ],
  },
};
