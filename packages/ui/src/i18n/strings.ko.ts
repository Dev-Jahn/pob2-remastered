/**
 * Korean (ko-KR) UI string baseline (DESIGN §8.1, §2.1 "UI 문자열 100%").
 *
 * Typed as `Record<StringKey, string>` against the English source of truth
 * (./strings.en.ts), so a missing or stray key fails typecheck — that is the
 * mechanism that holds the two locales to an identical key set.
 *
 * Every entry follows the §8.1 "한국어 (English)" alias convention: the official
 * in-game Korean term first, with the English source kept verbatim in
 * parentheses as the search/guide alias that §8.1 forbids ever dropping.
 */
import type { StringKey } from './index.js';

export const stringsKo: Record<StringKey, string> = {
  // App shell chrome (DESIGN §10.2 App shell): header labels, status bar, and the
  // ko/en locale toggle option labels.
  'shell.buildLabel': '빌드 (Build)',
  'shell.activeSkillLabel': '주력 스킬 (Active Skill)',
  'shell.statusReady': '준비됨 (Ready)',
  'locale.ko': '한국어 (Korean)',
  'locale.en': '영어 (English)',

  // Navigation rail (DESIGN §10.2 App shell).
  'nav.overview': '개요 (Overview)',
  'nav.skills': '스킬 (Skills)',
  'nav.passiveTree': '패시브 트리 (Passive Tree)',
  'nav.items': '아이템 (Items)',
  'nav.calcs': '계산 (Calcs)',
  'nav.config': '설정 (Config)',
  'nav.importExport': '가져오기/내보내기 (Import/Export)',
  'nav.party': '파티 (Party)',
  'nav.compare': '비교 (Compare)',
  'nav.notes': '메모 (Notes)',

  // Overview tab card titles (DESIGN §10.3).
  'overview.card.offence': '공격 (Offence)',
  'overview.card.defence': '방어 (Defence)',
  'overview.card.resources': '자원 (Resources)',
  'overview.card.warnings': '경고 (Warnings)',
  'overview.card.recentChanges': '최근 변경 (Recent Changes)',

  // Accessible label for a stat the core did not emit — rendered as a distinct
  // marker, never "0" (DESIGN §10.1 "수정값과 계산 결과 구분", NO-FALLBACK).
  'overview.missing': '값 없음 (Not available)',

  // Overview warning card labels (DESIGN §10.3 warning card).
  'warning.requirementsNotMet': '요구 능력치 부족 (Requirements Not Met)',
  'warning.resistanceLow': '저항 부족 (Resistance Below Cap)',
  'warning.unsupportedModifier': '미지원 수정자 (Unsupported Modifier)',
  'warning.itemParseFailed': '아이템 분석 실패 (Item Parse Failed)',

  // Items tab redesign (DESIGN §10.4). Header toolbar: item-set selector,
  // clipboard import, and the craft/trade entry points.
  'items.title': '아이템 (Items)',
  'items.set.label': '아이템 세트 (Item Set)',
  'items.set.default': '기본 (Default)',
  'items.importFromClipboard': '클립보드에서 가져오기 (Import from Clipboard)',
  'items.craft': '제작 (Craft)',
  'items.trade': '거래 (Trade)',

  // Equipped Gear column and its slot labels (DESIGN §10.4 layout).
  'items.equippedGear': '장착 장비 (Equipped Gear)',
  'items.slot.weapon1': '무기 1 (Weapon 1)',
  'items.slot.weapon2': '무기 2 (Weapon 2)',
  'items.slot.helmet': '투구 (Helmet)',
  'items.slot.body': '갑옷 (Body Armour)',
  'items.slot.gloves': '장갑 (Gloves)',
  'items.slot.boots': '장화 (Boots)',
  'items.slot.ring1': '반지 1 (Ring 1)',
  'items.slot.ring2': '반지 2 (Ring 2)',
  'items.slot.amulet': '목걸이 (Amulet)',
  'items.slot.belt': '허리띠 (Belt)',
  'items.slot.charm': '부적 (Charm)',
  'items.slot.flask': '플라스크 (Flask)',

  // Item Library column: search box, filters, and the build/shared scope toggle
  // (DESIGN §10.4 "공유 보관함" shared item scope).
  'items.library': '아이템 라이브러리 (Item Library)',
  'items.search.placeholder': '아이템 검색 (Search items)',
  'items.filter.slot': '슬롯 (Slot)',
  'items.filter.type': '유형 (Type)',
  'items.filter.requirements': '요구 능력치 (Requirements)',
  'items.scope.build': '현재 빌드 (This Build)',
  'items.scope.shared': '공유 보관함 (Shared Stash)',

  // Inspector column: text sections, the roll-range editor, the empty state, and
  // the action group (DESIGN §10.4 item inspector: 원문/한국어 텍스트, roll range editor).
  'items.inspector': '인스펙터 (Inspector)',
  'items.inspector.sourceText': '원문 (Original Text)',
  'items.inspector.translatedText': '한국어 (Korean Text)',
  'items.inspector.parsedMods': '분석된 수정값 (Parsed Modifiers)',
  'items.inspector.unsupportedMods': '미지원 수정값 (Unsupported Modifiers)',
  'items.inspector.rollRange': '수치 범위 (Roll Range)',
  'items.inspector.empty': '검토할 아이템을 선택하세요 (Select an item to inspect)',
  'items.action.duplicate': '복제 (Duplicate)',
  'items.action.delete': '삭제 (Delete)',
  'items.action.share': '라이브러리에 공유 (Share to Library)',
  'items.action.changeSlot': '슬롯 변경 (Change Slot)',
  'items.action.compare': '비교 (Compare)',
  'items.action.craftFromBase': '기본 아이템으로 제작 (Craft from Base)',

  // Affix line parsed/unsupported badges (DESIGN §10.4 affix badge).
  'items.badge.parsed': '분석됨 (Parsed)',
  'items.badge.unsupported': '미지원 (Unsupported)',

  // Requirement-chip labels on an item card (DESIGN §10.4 requirement chip).
  'items.req.level': '레벨 (Level)',
  'items.req.str': '힘 (Str)',
  'items.req.dex': '민첩 (Dex)',
  'items.req.int': '지능 (Int)',

  // Clipboard import (DESIGN §10.4 Import from Clipboard, §8.6 ko/en auto-detect).
  'items.clipboard.pasteLabel': '아이템 텍스트 붙여넣기 (Paste item text)',

  // Custom item creation (DESIGN §10.4 custom item: base + mods).
  'items.custom.title': '커스텀 아이템 생성 (Create Custom Item)',
  'items.custom.base': '기본 아이템 (Base Item)',
  'items.custom.mods': '수정값, 한 줄에 하나씩 (Modifiers, one per line)',
  'items.custom.create': '생성 (Create)',

  // Skills tab redesign (DESIGN §10.5). The 2-region layout headings: the
  // skill-group card list and the main-skill inspector.
  'skills.title': '스킬 (Skills)',
  'skills.groups': '스킬 그룹 (Skill Groups)',
  'skills.inspector': '인스펙터 (Inspector)',

  // Skill-group card: the group enabled toggle and the immediate reservation /
  // spirit cost (DESIGN §10.5 "reservation과 spirit cost를 즉시 표시").
  'skills.group.enabled': '활성화 (Enabled)',
  'skills.reservation': '예약 (Reservation)',
  'skills.spirit': '정신력 (Spirit)',
  'skills.gem.enabled': '젬 활성화 (Gem Enabled)',
  'skills.gem.level': '레벨 (Level)',
  'skills.gem.quality': '퀄리티 (Quality)',

  // Gem category chips (DESIGN §10.5 "active/support/buff/aura/minion 구분 chip").
  // An active gem with no category metadata reads `unsupported` (§6.4, §11.3).
  'skills.category.active': '액티브 (Active)',
  'skills.category.support': '보조 (Support)',
  'skills.category.buff': '버프 (Buff)',
  'skills.category.aura': '오라 (Aura)',
  'skills.category.minion': '소환수 (Minion)',
  'skills.category.unsupported': '미지원 (Unsupported)',

  // Main-skill inspector sections (DESIGN §10.5 inspector: damage breakdown,
  // support gem contribution, gem level/quality delta).
  'skills.inspector.empty': '검토할 스킬 그룹을 선택하세요 (Select a skill group to inspect)',
  'skills.inspector.damageBreakdown': '피해 분석 (Damage Breakdown)',
  'skills.inspector.supportContribution': '보조 젬 기여도 (Support Gem Contribution)',
  'skills.inspector.gemDelta': '젬 레벨 / 퀄리티 변화 (Gem Level / Quality Delta)',

  // Config tab redesign (DESIGN §10.8). The 2-region layout headings: the
  // scenario-preset selector and the typed option list.
  'config.title': '설정 (Config)',
  'config.presets': '시나리오 프리셋 (Scenario Presets)',
  'config.options': '옵션 (Options)',

  // The §10.8 scenario presets (general mapping / bossing / full charges /
  // shocked enemy / cursed enemy / low life / custom scenario).
  'config.preset.generalMapping': '일반 맵핑 (General Mapping)',
  'config.preset.bossing': '보스전 (Bossing)',
  'config.preset.fullCharges': '최대 충전 (Full Charges)',
  'config.preset.shockedEnemy': '감전된 적 (Shocked Enemy)',
  'config.preset.cursedEnemy': '저주받은 적 (Cursed Enemy)',
  'config.preset.lowLife': '저생명 (Low Life)',
  'config.preset.custom': '사용자 지정 (Custom Scenario)',

  // Config option row: the affected-calc-items label (DESIGN §10.8 "변경 시 영향을
  // 받는 계산 항목"), and the unsupported-control marker (§6.4, §11.3).
  'config.affects': '영향 (Affects)',
  'config.unsupported': '미지원 (Unsupported)',

  // Calcs tab breakdown explorer (DESIGN §10.7). The panel title, the per-stat
  // delta / final-value chrome, and the formula-trace labels (source list /
  // formula / upstream raw stat id), plus the "trace 없음" + missing markers.
  'calcs.title': '계산 (Calcs)',
  'calcs.finalValue': '최종값 (Final Value)',
  'calcs.delta': '변화 (Delta)',
  'calcs.missing': '값 없음 (Not computed)',
  'calcs.noTrace': 'trace 없음 (No trace)',
  'calcs.sources': '기여도 (Contributions)',
  'calcs.formula': '공식 (Formula)',
  'calcs.upstreamStatId': '원본 스탯 ID (Upstream Stat Id)',

  // Top-level breakdown section names (DESIGN §10.7 tree: Summary / Offence /
  // Defence / Resource / Raw trace). The labels of the §10.7 breakdown spec.
  'calcs.section.summary': '요약 (Summary)',
  'calcs.section.offence': '공격 (Offence)',
  'calcs.section.defence': '방어 (Defence)',
  'calcs.section.resource': '자원 (Resource)',
  'calcs.section.rawTrace': '원시 trace (Raw Trace)',

  // Contribution source-kind labels (DESIGN §10.7 "기여 source list" classified by
  // origin — the ExplainSource.kind union: item/passive/skillGem/supportGem/
  // config/buff). The trace renders these next to each source's label and value.
  'calcs.source.item': '아이템 (Item)',
  'calcs.source.passive': '패시브 (Passive)',
  'calcs.source.skillGem': '스킬 젬 (Skill Gem)',
  'calcs.source.supportGem': '보조 젬 (Support Gem)',
  'calcs.source.config': '설정 (Config)',
  'calcs.source.buff': '버프 (Buff)',

  // Passive Tree tab (DESIGN §10.6). The §10.6 layout chrome: the central tree
  // canvas, the minimap, the bilingual (한/영) node search box + its empty-results
  // hint, the hovered-node tooltip ("이 노드를 찍으면 증가하는 stat") + the
  // allocation-delta panel headings and the missing-stat marker (§6.4 NO-FALLBACK).
  'tree.canvas': '트리 (Tree)',
  'tree.minimap': '미니맵 (Minimap)',
  'tree.search.placeholder': '노드 검색 한/영 (Search nodes)',
  'tree.tooltip.title': '이 노드를 찍으면 증가하는 stat (Allocating this node increases)',
  'tree.delta.title': '할당 변화 (Allocation Delta)',
  'tree.delta.missing': '값 없음 (Not computed)',
};
