/**
 * crash-report — the pure crash-report / diagnostic bundle assembler behind the
 * DESIGN §5.1 host responsibility "crash report와 diagnostic bundle 생성" (§13
 * crash reporting).
 *
 * Given a CAUGHT failure (a §6.4 {@link CoreError} envelope or a generic runner
 * `Error`) plus the §10.9 {@link DiagnosticExport} the session already holds, it
 * assembles a REDACTED {@link CrashReport} bundle a bug report can carry:
 *
 *   - `coreVersion` / `upstreamCommit` — the Lua core bundle + upstream PoB commit
 *     the crash ran against (lifted from the diagnostic export, §13.2 / §12.1).
 *   - `error`        — the §6.4 error envelope `{ code, message }`: WHAT failed.
 *   - `upstreamStack`— the raw upstream Lua traceback the CoreError surfaced
 *     (dev/beta diagnostic data, §6.4), present only when the failure carried one.
 *   - `buildSummary` — a SANITIZED structural summary of the build (class,
 *     ascendancy, level, set counts) — NOT the full BuildState.
 *
 * ASSEMBLY-ONLY (DESIGN §5.1): this is a pure function. It spawns nothing, reads
 * no files, and SENDS nothing — telemetry transport is network/secret-gated and
 * lives in the host, not here. The bundle is data the host later decides to ship.
 *
 * REDACTION (the task's core claim): NO clipboard text and NO file paths leak.
 *   - The build summary is derived from STRUCTURAL fields only; the build's
 *     free-text `notes` (where a user may have pasted a clipboard string or an
 *     absolute file path) is never read. The full BuildState is never embedded.
 *   - The only free-text that does flow through — the error `message` and the
 *     `upstreamStack` — is scrubbed of filesystem-path-like substrings, so a path
 *     that leaked into a Lua traceback or an error string cannot ride along.
 *   - The diagnostic export's `localizationMisses` / `unsupportedMods` (which can
 *     echo user mod text) are NOT copied wholesale; only the environment
 *     fingerprint (core/upstream) is lifted.
 */
import type { BuildState, CoreError, CoreErrorCode, DiagnosticExport } from '@pob2/schema';

/**
 * Error code used when the caught failure is NOT a normalised §6.4 CoreError —
 * e.g. the out-of-process runner died (segfault / non-zero exit) before it could
 * produce a CoreError envelope (DESIGN §6.2 "Lua panic/crash … 격리"). It is a
 * crash-report-only code, distinct from the closed §6.4 {@link CoreErrorCode} set.
 */
export const RUNNER_FAILED = 'RUNNER_FAILED' as const;

/** The error envelope embedded in a crash report — the §6.4 `{ code, message }`
 * pair, with the code widened to include the {@link RUNNER_FAILED} runner case. */
export interface CrashReportError {
  code: CoreErrorCode | typeof RUNNER_FAILED;
  message: string;
}

/**
 * A sanitized, structural-only summary of the crashed build (DESIGN §5.1 redacted
 * bundle). Carries the facts that make a crash actionable — class / ascendancy /
 * level and how many sets the build held — and NONE of the free-text or item
 * payload a user could have hidden a clipboard string or file path inside.
 */
export interface CrashBuildSummary {
  classId: string;
  ascendancyId?: string;
  level: number;
  itemSetCount: number;
  skillSetCount: number;
  passiveSpecCount: number;
  configSetCount: number;
}

/**
 * The redacted crash-report bundle (DESIGN §5.1, §13). Well-formed iff it names
 * the core + upstream it ran against, carries the error envelope, and carries the
 * sanitized build summary. `upstreamStack` is present only when the failure was a
 * CoreError that surfaced one.
 */
export interface CrashReport {
  /** Lua core bundle version the crash ran against (DESIGN §13.2). */
  coreVersion: string;
  /** Upstream PoB commit the core was built from (DESIGN §12.1, §10.9). */
  upstreamCommit: string;
  /** The §6.4 error envelope: what failed. */
  error: CrashReportError;
  /** Raw upstream Lua traceback, scrubbed of file paths; absent if none surfaced. */
  upstreamStack?: string;
  /** Structural-only, redacted build summary. */
  buildSummary: CrashBuildSummary;
}

/**
 * Filesystem-path-like substrings: a POSIX absolute path (`/home/...`,
 * `/Users/...`), a Windows path (`C:\Users\...`), or a `file://` URL. These are
 * the shapes a leaked clipboard paste / file path takes when it rides inside an
 * otherwise-legitimate free-text field (an error message or a Lua traceback).
 * Matched substrings are replaced with a redaction marker — the surrounding
 * diagnostic text (e.g. "attempt to index a nil value") is preserved.
 */
const PATH_LIKE = /(?:file:\/\/)?(?:[A-Za-z]:[\\/]|\/)[^\s"'`]*[\\/][^\s"'`]*/g;
const REDACTED = '[redacted-path]';

/**
 * Scrub filesystem-path-like substrings out of a free-text diagnostic string so a
 * leaked clipboard paste / file path cannot ride along inside it. Returns the text
 * with every path-like run replaced by {@link REDACTED}; non-path text is kept so
 * the message/stack stays useful.
 */
function redactPaths(text: string): string {
  return text.replace(PATH_LIKE, REDACTED);
}

/** Type guard: is the caught value a normalised §6.4 CoreError envelope? */
function isCoreError(value: unknown): value is CoreError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { code?: unknown }).code === 'string' &&
    typeof (value as { message?: unknown }).message === 'string'
  );
}

/**
 * Derive the redacted, structural-only build summary (DESIGN §5.1). Reads only
 * structural fields — never `notes` or item/skill payloads — so no free-text the
 * user could have pasted a secret into is carried.
 */
function summarizeBuild(build: BuildState): CrashBuildSummary {
  return {
    classId: build.classId,
    ascendancyId: build.ascendancyId,
    level: build.level,
    itemSetCount: build.itemSets.length,
    skillSetCount: build.skillSets.length,
    passiveSpecCount: build.passiveSpecs.length,
    configSetCount: build.configSets.length,
  };
}

/**
 * Assemble a redacted crash-report bundle from a caught failure and the §10.9
 * diagnostic export (DESIGN §5.1, §13). Pure and assembly-only — it does not
 * send the bundle (telemetry transport is network/secret-gated in the host).
 *
 * @param caught     The caught failure: a §6.4 {@link CoreError} envelope or a
 *                   generic runner `Error` (the runner died before it could
 *                   produce a CoreError — coded {@link RUNNER_FAILED}).
 * @param diagnostic The diagnostic export the session already built (§10.9).
 */
export function assembleCrashReport(
  caught: CoreError | Error | unknown,
  diagnostic: DiagnosticExport,
): CrashReport {
  const report: CrashReport = {
    coreVersion: diagnostic.coreVersion,
    upstreamCommit: diagnostic.upstreamCommit,
    error: isCoreError(caught)
      ? { code: caught.code, message: redactPaths(caught.message) }
      : {
          code: RUNNER_FAILED,
          message: redactPaths(caught instanceof Error ? caught.message : String(caught)),
        },
    buildSummary: summarizeBuild(diagnostic.build),
  };

  // The raw Lua traceback rides along only when the §6.4 CoreError surfaced one,
  // scrubbed of any file path that leaked into it (DESIGN §6.4 dev/beta surface).
  if (isCoreError(caught) && typeof caught.upstreamStack === 'string') {
    report.upstreamStack = redactPaths(caught.upstreamStack);
  }

  return report;
}
