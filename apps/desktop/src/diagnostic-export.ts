/**
 * diagnostic-export — the pure builder behind the §10.9 Import/Export
 * "diagnostic export" action (DESIGN §10.9, backed by the §12 state/metadata
 * model).
 *
 * It assembles the standalone {@link DiagnosticExport} bundle a bug report needs
 * to be reproducible — the open build state, the localization misses and
 * unsupported mods collected while the session ran, the Lua core bundle version,
 * and the upstream PoB commit the core was built from — and VALIDATES it against
 * @pob2/schema's `diagnosticExportSchema` before returning it.
 *
 * PURE (DESIGN §5.1: the host layer owns the out-of-process Lua runner; the
 * UI/data layer is pure). The builder spawns nothing: it takes a
 * {@link DiagnosticSource} snapshot the live build session already holds and
 * routes each field through. The desktop Import/Export `diagnostic export` action
 * collects that snapshot from the session and calls this builder.
 *
 * NO-FALLBACK (DESIGN §10.9): `coreVersion` and `upstreamCommit` are REQUIRED and
 * never defaulted. A report that cannot name the core/upstream it was produced
 * against is not actionable, so an assembled bundle missing either — or any other
 * schema violation — is REJECTED at the builder boundary (a thrown error), not
 * silently shipped. The builder never fabricates a value to make validation pass.
 */
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { diagnosticExportSchema } from '@pob2/schema';
import type { BuildState, DiagnosticExport, LocalizationMiss } from '@pob2/schema';

/**
 * The live-session snapshot the builder assembles a {@link DiagnosticExport}
 * from. It carries exactly the §10.9 payload — the build the diagnostic is about
 * plus the environment fingerprint the report needs — with no `schemaVersion`
 * (the builder pins that itself).
 */
export interface DiagnosticSource {
  /** The build the diagnostic is about (DESIGN §10.9 "build state"). */
  build: BuildState;
  /** Localization keys with no entry, per locale (DESIGN §10.9, §6.4). */
  localizationMisses: LocalizationMiss[];
  /** Mod lines the parser could not recognise (DESIGN §10.9, §8.6 / §6.4). */
  unsupportedMods: string[];
  /** The Lua core bundle version (DESIGN §10.9 "core version", §13.2). */
  coreVersion: string;
  /** The upstream PoB commit the core was built from (DESIGN §10.9, §12.1). */
  upstreamCommit: string;
}

// strict:false matches the schema contract test + runner-client validator (it
// allows the unconstrained `{}` build-state ref subschema). Compiled once at
// module load — the schema is immutable, so one validator serves every build.
const ajv = new Ajv2020({ allErrors: true, strict: false });
const validate: ValidateFunction = ajv.compile(diagnosticExportSchema as object);

/**
 * Assemble the §10.9 diagnostic export bundle from a live-session snapshot and
 * validate it against `diagnosticExportSchema` before returning it.
 *
 * Each field is routed through verbatim (the build state is the session's own
 * snapshot reference, not a fabricated BuildState) and `schemaVersion` is pinned
 * to `1`. The assembled bundle is then validated; a schema violation — most
 * importantly an empty/missing `coreVersion` or `upstreamCommit` — throws rather
 * than returning an unactionable report (NO-FALLBACK, DESIGN §10.9).
 */
export function buildDiagnosticExport(source: DiagnosticSource): DiagnosticExport {
  const diagnostic: DiagnosticExport = {
    schemaVersion: 1,
    build: source.build,
    localizationMisses: source.localizationMisses,
    unsupportedMods: source.unsupportedMods,
    coreVersion: source.coreVersion,
    upstreamCommit: source.upstreamCommit,
  };

  // NO-FALLBACK (DESIGN §10.9): an empty coreVersion/upstreamCommit is a valid
  // string under the schema's `type: 'string'`, but it names nothing — a report
  // that cannot identify its core/upstream is useless. Reject it at the builder
  // boundary rather than letting the schema's loose string check pass it through.
  if (diagnostic.coreVersion.length === 0) {
    throw new Error(
      'diagnostic-export: coreVersion is empty — the core bundle version is required',
    );
  }
  if (diagnostic.upstreamCommit.length === 0) {
    throw new Error(
      'diagnostic-export: upstreamCommit is empty — the upstream PoB commit hash is required',
    );
  }

  if (!validate(diagnostic)) {
    const error = new Error('diagnostic-export: assembled bundle failed schema validation');
    (error as Error & { details?: unknown }).details = validate.errors;
    throw error;
  }

  return diagnostic;
}
