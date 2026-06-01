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
};
