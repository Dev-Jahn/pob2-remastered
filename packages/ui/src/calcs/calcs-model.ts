/**
 * Calcs breakdown view-model — DESIGN §10.7 Calcs tab.
 *
 * A pure, framework-free transform that turns a `calc.run` result (final values)
 * plus a set of `calc.explain` traces (per-stat formula trace, contribution
 * sources, upstream raw stat id) into the §10.7 breakdown tree:
 *
 *   Calcs
 *     ├─ Summary
 *     ├─ Offence  { Hit / Crit / Ailments / DoT }
 *     ├─ Defence  { Life·ES·Mana / Resistances / Armour·Evasion / EHP }
 *     ├─ Resource
 *     └─ Raw trace
 *
 * The Calcs tab's core value is the *breakdown* — "결과가 어떻게 계산됐는지". So each
 * leaf breakdown stat exposes (DESIGN §10.7):
 *   - 최종값 (`finalValue`, from `calc.run`),
 *   - 변경 전후 delta (`delta`, before/after vs. an optional prior run),
 *   - 기여 source list classified item/passive/skillGem/supportGem/config/buff,
 *   - formula trace string,
 *   - upstream raw stat id,
 *   - 한국어/영어 label.
 *
 * The Raw-trace section is a flat passthrough of every `calc.explain` supplied —
 * the unprocessed traces the breakdown was built from.
 *
 * NO-FALLBACK (DESIGN §6.4, §10.7): a stat the core never emitted in `calc.run`
 * is an explicit `present:false` missing marker — never `0` (a real `0`, e.g.
 * EnergyShield 0, stays present). A stat WITH a value but NO `calc.explain` trace
 * carries an explicit `{ explained:false, reason:'noTrace' }` "trace 없음" marker;
 * its sources/formula are never fabricated. A delta with no prior value is
 * `undefined`, never `0`. The transform only re-shapes what the core gave it — it
 * does not compute, default, or invent any value.
 */
import type { CalcRunResponse, CalcExplainResponse, StatResult, ExplainSource } from '@pob2/schema';

// ---------------------------------------------------------------------------
// Public model types (DESIGN §10.7)
// ---------------------------------------------------------------------------

/** Id of a top-level §10.7 breakdown section, in display order. */
export type CalcsSectionId = 'summary' | 'offence' | 'defence' | 'resource' | 'rawTrace';

/** Id of a §10.7 breakdown sub-group (Offence Hit/Crit/Ailments/DoT, …). */
export type CalcsGroupId =
  | 'summary'
  | 'hit'
  | 'crit'
  | 'ailments'
  | 'dot'
  | 'skillSpecific'
  | 'pools'
  | 'resistances'
  | 'mitigation'
  | 'ehp'
  | 'resource'
  | 'rawTrace';

/**
 * The before/after change of one breakdown stat vs. a prior `calc.run`
 * (DESIGN §10.7 "변경 전후 delta"). `delta === after - before`. A real `0` delta
 * (stat unchanged) is a value, not absence.
 */
export interface BreakdownDelta {
  before: number;
  after: number;
  delta: number;
}

/**
 * The formula trace of one breakdown stat (DESIGN §10.7). Discriminated on
 * `explained`: a stat backed by a `calc.explain` response carries its sources,
 * formula string, and upstream raw stat id; a stat with NO trace carries the
 * explicit `{ explained:false, reason:'noTrace' }` "trace 없음" marker — sources
 * and formula are never fabricated (NO-FALLBACK, §6.4).
 */
export type BreakdownTrace =
  | {
      explained: true;
      /** Per-source contributions, classified by origin (DESIGN §10.7 source list). */
      sources: ExplainSource[];
      /** Human-readable formula trace string (DESIGN §10.7 formula trace). */
      formula: string;
      /** Upstream raw stat id this value derives from (DESIGN §10.7). */
      upstreamStatId: string;
    }
  | { explained: false; reason: 'noTrace' };

/**
 * One leaf breakdown stat (DESIGN §10.7). Discriminated on `present`: a stat the
 * core emitted in `calc.run` carries its real `finalValue`; one it did not is an
 * explicit `present:false` missing marker (`finalValue` undefined) — never `0`.
 * `labelKo`/`labelEn` are the §10.7 한국어/영어 labels; `trace` is the formula
 * trace (or "trace 없음" marker); `delta` is the optional before/after change.
 */
export type BreakdownStat =
  | {
      statId: string;
      labelKo: string;
      labelEn: string;
      present: true;
      finalValue: number;
      trace: BreakdownTrace;
      delta?: BreakdownDelta;
    }
  | {
      statId: string;
      labelKo: string;
      labelEn: string;
      present: false;
      finalValue?: undefined;
      trace: BreakdownTrace;
      delta?: undefined;
    };

/** One §10.7 breakdown sub-group: an id, its ko/en label, and its leaf stats. */
export interface CalcsGroup {
  id: CalcsGroupId;
  labelKo: string;
  labelEn: string;
  stats: BreakdownStat[];
}

/** One top-level §10.7 breakdown section: an id, its ko/en label, and its groups. */
export interface CalcsSection {
  id: CalcsSectionId;
  labelKo: string;
  labelEn: string;
  groups: CalcsGroup[];
}

/** The full §10.7 Calcs breakdown view-model: the ordered sections. */
export interface CalcsViewModel {
  sections: CalcsSection[];
}

// ---------------------------------------------------------------------------
// Breakdown spec (DESIGN §10.7 tree) — which stats live in which section/group
// ---------------------------------------------------------------------------

/** One stat slot in the spec: its stat id and its ko/en labels (DESIGN §10.7). */
export interface CalcsStatSpec {
  statId: string;
  labelKo: string;
  labelEn: string;
}

/** One sub-group in the spec (DESIGN §10.7): an id, ko/en label, and stat slots. */
export interface CalcsGroupSpec {
  id: CalcsGroupId;
  labelKo: string;
  labelEn: string;
  stats: CalcsStatSpec[];
}

/** One section in the spec (DESIGN §10.7): an id, ko/en label, and groups. */
export interface CalcsSectionSpec {
  id: CalcsSectionId;
  labelKo: string;
  labelEn: string;
  groups: CalcsGroupSpec[];
}

/** The §10.7 breakdown spec: the static section/group/stat tree. */
export interface CalcsBreakdownSpec {
  sections: CalcsSectionSpec[];
}

/**
 * The §10.7 Calcs breakdown spec — the static tree of which upstream stat ids
 * live under Summary / Offence{Hit/Crit/Ailments/DoT} / Defence{pools/resistances/
 * mitigation/ehp} / Resource, with their 한국어/영어 labels. Stat ids are the
 * upstream PoB `Output.*` keys (the same the Overview view-model surfaces). The
 * `rawTrace` section carries no spec stats — it is filled flat from the supplied
 * `calc.explain` list at build time.
 */
export const CALCS_BREAKDOWN_SPEC: CalcsBreakdownSpec = {
  sections: [
    {
      id: 'summary',
      labelKo: '요약',
      labelEn: 'Summary',
      groups: [
        {
          id: 'summary',
          labelKo: '요약',
          labelEn: 'Summary',
          stats: [
            { statId: 'TotalDPS', labelKo: '전체 DPS', labelEn: 'Total DPS' },
            { statId: 'TotalEHP', labelKo: '유효 생명력 풀', labelEn: 'Effective Hit Pool' },
          ],
        },
      ],
    },
    {
      id: 'offence',
      labelKo: '공격',
      labelEn: 'Offence',
      groups: [
        {
          id: 'hit',
          labelKo: '타격 피해',
          labelEn: 'Hit Damage',
          stats: [
            { statId: 'TotalDPS', labelKo: '전체 DPS', labelEn: 'Total DPS' },
            { statId: 'AverageDamage', labelKo: '평균 피해', labelEn: 'Average Damage' },
          ],
        },
        {
          id: 'crit',
          labelKo: '치명타',
          labelEn: 'Crit',
          stats: [
            { statId: 'CritChance', labelKo: '치명타 확률', labelEn: 'Critical Hit Chance' },
            { statId: 'CritMultiplier', labelKo: '치명타 피해', labelEn: 'Critical Damage Bonus' },
          ],
        },
        {
          id: 'ailments',
          labelKo: '상태이상',
          labelEn: 'Ailments',
          stats: [{ statId: 'IgniteDPS', labelKo: '점화 DPS', labelEn: 'Ignite DPS' }],
        },
        {
          id: 'dot',
          labelKo: '지속 피해',
          labelEn: 'DoT',
          stats: [
            { statId: 'TotalDotDPS', labelKo: '전체 지속 피해 DPS', labelEn: 'Total DoT DPS' },
          ],
        },
      ],
    },
    {
      id: 'defence',
      labelKo: '방어',
      labelEn: 'Defence',
      groups: [
        {
          id: 'pools',
          labelKo: '생명력 · 보호막 · 마나',
          labelEn: 'Life / ES / Mana',
          stats: [
            { statId: 'Life', labelKo: '생명력', labelEn: 'Life' },
            { statId: 'EnergyShield', labelKo: '에너지 보호막', labelEn: 'Energy Shield' },
            { statId: 'Mana', labelKo: '마나', labelEn: 'Mana' },
          ],
        },
        {
          id: 'resistances',
          labelKo: '저항',
          labelEn: 'Resistances',
          stats: [
            { statId: 'FireResist', labelKo: '화염 저항', labelEn: 'Fire Resistance' },
            { statId: 'ColdResist', labelKo: '냉기 저항', labelEn: 'Cold Resistance' },
            { statId: 'LightningResist', labelKo: '번개 저항', labelEn: 'Lightning Resistance' },
            { statId: 'ChaosResist', labelKo: '카오스 저항', labelEn: 'Chaos Resistance' },
          ],
        },
        {
          id: 'mitigation',
          labelKo: '방어도 · 회피',
          labelEn: 'Armour / Evasion',
          stats: [
            { statId: 'Armour', labelKo: '방어도', labelEn: 'Armour' },
            { statId: 'Evasion', labelKo: '회피', labelEn: 'Evasion' },
          ],
        },
        {
          id: 'ehp',
          labelKo: '유효 생명력 풀',
          labelEn: 'Effective Hit Pool',
          stats: [{ statId: 'TotalEHP', labelKo: '유효 생명력 풀', labelEn: 'Effective Hit Pool' }],
        },
      ],
    },
    {
      id: 'resource',
      labelKo: '자원',
      labelEn: 'Resource',
      groups: [
        {
          id: 'resource',
          labelKo: '자원',
          labelEn: 'Resource',
          stats: [
            { statId: 'Spirit', labelKo: '정신력', labelEn: 'Spirit' },
            { statId: 'SpiritReserved', labelKo: '정신력 예약', labelEn: 'Spirit Reserved' },
            { statId: 'ManaReserved', labelKo: '마나 예약', labelEn: 'Mana Reserved' },
            { statId: 'ManaUnreserved', labelKo: '미예약 마나', labelEn: 'Unreserved Mana' },
          ],
        },
      ],
    },
  ],
};

/** The §10.7 Raw-trace section labels (its stats come from the explain list). */
const RAW_TRACE_LABEL = { labelKo: '원시 trace', labelEn: 'Raw trace' } as const;

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

/** A "trace 없음" marker for a present stat with no `calc.explain` response. */
const NO_TRACE: BreakdownTrace = { explained: false, reason: 'noTrace' };

/** Build the formula trace for a stat from its `calc.explain` response, if any. */
function traceFor(explain: CalcExplainResponse | undefined): BreakdownTrace {
  if (explain === undefined) return NO_TRACE;
  return {
    explained: true,
    sources: explain.sources.map((s) => ({ ...s })),
    formula: explain.formula,
    upstreamStatId: explain.upstreamStatId,
  };
}

/** Compute the before/after delta for a stat, or `undefined` if no prior value. */
function deltaFor(
  spec: CalcsStatSpec,
  current: StatResult | undefined,
  prevById: ReadonlyMap<string, StatResult> | undefined,
): BreakdownDelta | undefined {
  if (prevById === undefined || current === undefined) return undefined;
  const prev = prevById.get(spec.statId);
  if (prev === undefined) return undefined;
  return { before: prev.value, after: current.value, delta: current.value - prev.value };
}

/** Resolve one spec stat into a breakdown leaf, applying NO-FALLBACK rules. */
function toBreakdownStat(
  spec: CalcsStatSpec,
  runById: ReadonlyMap<string, StatResult>,
  explainById: ReadonlyMap<string, CalcExplainResponse>,
  prevById: ReadonlyMap<string, StatResult> | undefined,
): BreakdownStat {
  const stat = runById.get(spec.statId);
  const trace = traceFor(explainById.get(spec.statId));
  if (stat === undefined) {
    return {
      statId: spec.statId,
      labelKo: spec.labelKo,
      labelEn: spec.labelEn,
      present: false,
      trace,
    };
  }
  return {
    statId: spec.statId,
    labelKo: spec.labelKo,
    labelEn: spec.labelEn,
    present: true,
    finalValue: stat.value,
    trace,
    delta: deltaFor(spec, stat, prevById),
  };
}

/** Build one §10.7 spec section's groups from the run/explain/prev lookups. */
function toSection(
  spec: CalcsSectionSpec,
  runById: ReadonlyMap<string, StatResult>,
  explainById: ReadonlyMap<string, CalcExplainResponse>,
  prevById: ReadonlyMap<string, StatResult> | undefined,
): CalcsSection {
  return {
    id: spec.id,
    labelKo: spec.labelKo,
    labelEn: spec.labelEn,
    groups: spec.groups.map((g) => ({
      id: g.id,
      labelKo: g.labelKo,
      labelEn: g.labelEn,
      stats: g.stats.map((s) => toBreakdownStat(s, runById, explainById, prevById)),
    })),
  };
}

/**
 * Build the §10.7 Raw-trace section: a flat passthrough of every supplied
 * `calc.explain`, in input order — the unprocessed traces, with no spec labels
 * and no fabricated rows (empty when no explains are given).
 */
function rawTraceSection(explains: CalcExplainResponse[]): CalcsSection {
  return {
    id: 'rawTrace',
    labelKo: RAW_TRACE_LABEL.labelKo,
    labelEn: RAW_TRACE_LABEL.labelEn,
    groups: [
      {
        id: 'rawTrace',
        labelKo: RAW_TRACE_LABEL.labelKo,
        labelEn: RAW_TRACE_LABEL.labelEn,
        stats: explains.map((e) => ({
          statId: e.statId,
          labelKo: e.label,
          labelEn: e.label,
          present: true,
          finalValue: e.finalValue,
          trace: traceFor(e),
        })),
      },
    ],
  };
}

/**
 * Build the §10.7 Calcs breakdown view-model from a `calc.run` result, its
 * `calc.explain` traces, and an optional prior `calc.run` for before/after delta.
 *
 * Pure: every leaf stat traces to a value the core emitted (or an explicit
 * `present:false` missing marker), a formula trace (or an explicit "trace 없음"
 * marker), and — when a prior run is given and the stat had a prior value — a
 * before/after delta (`undefined` otherwise, never a fabricated `0`). The
 * Raw-trace section flat-lists every explain as supplied. Inputs are not mutated.
 */
export function buildCalcsModel(
  run: CalcRunResponse,
  explains: CalcExplainResponse[],
  prevRun?: CalcRunResponse,
): CalcsViewModel {
  const runById = new Map<string, StatResult>(run.stats.map((s) => [s.statId, s]));
  const explainById = new Map<string, CalcExplainResponse>(explains.map((e) => [e.statId, e]));
  const prevById = prevRun
    ? new Map<string, StatResult>(prevRun.stats.map((s) => [s.statId, s]))
    : undefined;

  const sections = CALCS_BREAKDOWN_SPEC.sections.map((spec) =>
    toSection(spec, runById, explainById, prevById),
  );
  sections.push(rawTraceSection(explains));
  return { sections };
}
