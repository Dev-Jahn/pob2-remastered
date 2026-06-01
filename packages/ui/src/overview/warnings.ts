/**
 * Warning view-model — DESIGN §10.3 warning card (저항 부족 / unsupported modifier /
 * parse-failed line), §8.6 step 4 (unknown line 보존), §10.4 (unsupported badge).
 *
 * A pure, framework-free transform that derives the Overview warning-card list
 * from a `calc.run` result and the `unsupported[]` lines `items.parseClipboard`
 * returns. No React, no I/O — data in, data out — so the warning list can be
 * unit-tested and rendered by any UI.
 *
 * Each warning carries a STABLE `code` (so a renderer can key/dedupe it), a
 * `severity`, and an i18n `i18nKey` — a `StringKey`, never a pre-rendered string.
 * The label is resolved at render time through the package `t` resolver, so the
 * model never embeds hardcoded Korean (DESIGN §8.1).
 *
 * NO-FALLBACK (DESIGN §6.4, §10.3): a resistance the core never emitted produces
 * NO warning — we do not invent the game's −60 starting resist to "fill in" a
 * deficit. Likewise the resist cap defaults to the game max (75) but honours a
 * build's real raised max when one is supplied, rather than fabricating one.
 */
import type { CalcRunResponse } from '@pob2/schema';
import type { StringKey } from '../i18n/index.js';

/** Severity tiers for a warning card row (DESIGN §10.3 warning card). */
export type WarningSeverity = 'info' | 'warning' | 'error';

/**
 * One warning-card row. `code` is a stable, machine-readable identifier;
 * `i18nKey` resolves the human label via the i18n resolver. Resist warnings
 * additionally carry the offending `statId`, its real `value`, and the `cap` it
 * fell short of; passthrough warnings carry the verbatim source line in `detail`.
 */
export interface Warning {
  /** Stable identifier, e.g. `resist-below-cap:FireResist`, `unsupported-line:0`. */
  code: string;
  severity: WarningSeverity;
  /** i18n key for the warning label, resolved via `t` (never hardcoded text). */
  i18nKey: StringKey;
  /** Offending stat id, for a resist-below-cap warning. */
  statId?: string;
  /** The real resistance value the core emitted (a resist warning). */
  value?: number;
  /** The max resistance cap the value fell short of (a resist warning). */
  cap?: number;
  /** The verbatim source line, for an unsupported / parse-failed passthrough. */
  detail?: string;
}

/** The warning model: the ordered §10.3 warning-card rows. */
export interface WarningModel {
  warnings: Warning[];
}

/**
 * Input to {@link buildWarningModel}: the `calc.run` result whose resistance
 * stats are checked against the cap, the `unsupported[]` lines from
 * `items.parseClipboard`, and an optional per-element max-resistance override.
 */
export interface WarningModelInput {
  calc: CalcRunResponse;
  /** Lines `items.parseClipboard` could not parse (DESIGN §8.6 step 4). */
  unsupported: string[];
  /**
   * Per-element max resistance, when the build raised it above the game default.
   * Keyed by the resist stat id (e.g. `{ FireResist: 78 }`). Missing entries
   * fall back to the game max (75).
   */
  maxResists?: Partial<Record<ResistStatId, number>>;
}

/** The three elemental resistances §10.3 warns on, in display order. */
const RESIST_STATS = ['FireResist', 'ColdResist', 'LightningResist'] as const;
type ResistStatId = (typeof RESIST_STATS)[number];

/** Game default maximum resistance (DESIGN §6.2 "max resistances"). */
const DEFAULT_MAX_RESIST = 75;

/**
 * Build the §10.3 warning-card list from a `calc.run` result and the
 * `items.parseClipboard` unsupported lines. The list is deterministic: the
 * resistance-below-cap block (in Fire/Cold/Lightning order) precedes the
 * unsupported-line passthrough block (in source order).
 */
export function buildWarningModel(input: WarningModelInput): WarningModel {
  const { calc, unsupported, maxResists } = input;
  const byId = new Map(calc.stats.map((s) => [s.statId, s]));
  const warnings: Warning[] = [];

  // Resistance-below-cap (§10.3 저항 부족). Only stats the core actually emitted
  // are checked — a missing resist is never treated as a fabricated deficit.
  for (const statId of RESIST_STATS) {
    const stat = byId.get(statId);
    if (stat === undefined) continue;
    const cap = maxResists?.[statId] ?? DEFAULT_MAX_RESIST;
    if (stat.value < cap) {
      warnings.push({
        code: `resist-below-cap:${statId}`,
        severity: 'warning',
        i18nKey: 'warning.resistanceLow',
        statId,
        value: stat.value,
        cap,
      });
    }
  }

  // Unsupported / parse-failed passthrough (§8.6 step 4, §10.4 badge). Each line
  // is echoed verbatim, with a stable index-scoped code.
  unsupported.forEach((line, index) => {
    warnings.push({
      code: `unsupported-line:${index}`,
      severity: 'info',
      i18nKey: 'warning.unsupportedModifier',
      detail: line,
    });
  });

  return { warnings };
}
