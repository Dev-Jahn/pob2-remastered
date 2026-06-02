/**
 * DiagnosticExport — the diagnostic bundle the Import/Export tab produces
 * (DESIGN §10.9 "diagnostic export"), backed by the §12 state/metadata model.
 *
 * A diagnostic export is a STANDALONE document (not a Core API request/response
 * pair), so it lives outside `schemaRegistry` and is registered on the sibling
 * `documentSchemaRegistry` in `./schemas`. It carries everything a bug report
 * needs to be reproducible:
 *
 *   - `build`          — the build-state reference the report is about (§12.1).
 *   - `localizationMisses` — localization keys with no entry for a locale
 *                        (mirrors the §6.4 `LOCALIZATION_MISSING` surface).
 *   - `unsupportedMods` — item/skill mod lines the parser could not recognise
 *                        (the §8.6 / §6.4 `UNKNOWN_MOD` surface).
 *   - `coreVersion`    — the Lua core bundle version (§13.2 "Lua core bundle").
 *   - `upstreamCommit` — the upstream PoB commit the core was built from
 *                        (§10.9 "upstream commit hash", §12.1 metadata).
 *
 * NO-FALLBACK (DESIGN §10.9): `coreVersion` and `upstreamCommit` are REQUIRED
 * and never defaulted. A report that cannot name the core/upstream it was
 * produced against is not actionable, so it is rejected at the schema boundary.
 */
import type { BuildState, Locale } from './build-state.js';
import type { JSONSchema } from './schemas/index.js';

/** One localization key that had no entry for a given locale (DESIGN §6.4). */
export interface LocalizationMiss {
  /** The localization key that resolved to nothing (e.g. "stat.fire_damage"). */
  key: string;
  /** The locale the lookup was attempted in. */
  locale: Locale;
}

/**
 * The diagnostic export document (DESIGN §10.9). `schemaVersion` is pinned to
 * `1` for the MVP; bumping it triggers a migration like every other §12 doc.
 */
export interface DiagnosticExport {
  schemaVersion: 1;
  /** The build the diagnostic is about (DESIGN §10.9 "build state"). */
  build: BuildState;
  /** Localization keys with no entry, per locale (DESIGN §10.9). */
  localizationMisses: LocalizationMiss[];
  /** Mod lines the parser could not recognise (DESIGN §10.9). */
  unsupportedMods: string[];
  /** Lua core bundle version (DESIGN §10.9 "core version", §13.2). */
  coreVersion: string;
  /** Upstream PoB commit hash the core was built from (DESIGN §10.9, §12.1). */
  upstreamCommit: string;
}

const DRAFT = 'https://json-schema.org/draft/2020-12/schema';

const localeSchema = { type: 'string', enum: ['ko-KR', 'en-US'] } as const satisfies JSONSchema;

const localizationMissSchema = {
  type: 'object',
  required: ['key', 'locale'],
  properties: {
    key: { type: 'string' },
    locale: localeSchema,
  },
  additionalProperties: false,
} as const satisfies JSONSchema;

/**
 * JSON Schema for {@link DiagnosticExport} (DESIGN §10.9). Hand-authored Draft
 * 2020-12 to mirror the TS type, matching the repo convention (no codegen,
 * plain data the host validator and contract tests both consume).
 *
 * `build` references the BuildState shape loosely (`type: 'object'`) — the
 * canonical BuildState schema lives next to the Core API methods in
 * `./schemas`, and a diagnostic only needs the reference to be present and an
 * object; the full BuildState contract is validated where the build is loaded.
 *
 * NO-FALLBACK: `coreVersion` and `upstreamCommit` are in `required`, so a
 * payload missing either fails validation rather than receiving a default.
 */
export const diagnosticExportSchema = {
  $schema: DRAFT,
  $id: 'pob2:diagnostic.export',
  title: 'DiagnosticExport',
  description: 'Diagnostic export bundle (DESIGN §10.9).',
  type: 'object',
  required: [
    'schemaVersion',
    'build',
    'localizationMisses',
    'unsupportedMods',
    'coreVersion',
    'upstreamCommit',
  ],
  properties: {
    schemaVersion: { type: 'integer', const: 1 },
    build: { type: 'object' },
    localizationMisses: { type: 'array', items: localizationMissSchema },
    unsupportedMods: { type: 'array', items: { type: 'string' } },
    coreVersion: { type: 'string' },
    upstreamCommit: { type: 'string' },
  },
  additionalProperties: false,
} as const satisfies JSONSchema;
