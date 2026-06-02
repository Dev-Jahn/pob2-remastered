/**
 * crash-report test (p7-crash-reporting) — the pure crash-report / diagnostic
 * bundle assembler that turns a caught CoreError (or generic runner failure) plus
 * the §10.9 diagnostic export into a REDACTED diagnostic bundle a bug report can
 * carry (DESIGN §5.1 "crash report와 diagnostic bundle 생성", §13 crash reporting).
 *
 * The assembler is PURE and ASSEMBLY-ONLY (DESIGN §5.1): it spawns nothing and
 * SENDS nothing — telemetry transport is network/secret-gated and lives in the
 * host. These tests drive it with a plain error + a plain DiagnosticExport.
 *
 * Coverage:
 *   - the bundle is WELL-FORMED: it names the core (coreVersion), the upstream
 *     commit it was built against (upstreamCommit), and carries the upstream Lua
 *     stack (upstreamStack) the §6.4 CoreError surfaced.
 *   - it includes the ERROR ENVELOPE — the §6.4 { code, message } pair — so the
 *     report says WHAT failed.
 *   - it carries a SANITIZED build summary: structural facts only (class, level,
 *     ascendancy, set counts) — NOT the full build, NOT free-text `notes`.
 *   - it is REDACTED: a planted sensitive token (a clipboard string / file path
 *     hidden in the build's free-text `notes`) does NOT appear anywhere in the
 *     serialized bundle. No clipboard text / file paths leak (the task's claim).
 *   - a generic (non-CoreError) runner failure still assembles a well-formed
 *     envelope (code falls to the generic runner-failure code, message kept).
 */
import { describe, it, expect } from 'vitest';
import type { BuildState, CoreError, DiagnosticExport } from '@pob2/schema';
import { assembleCrashReport, type CrashReport } from './crash-report.js';

/** A planted secret — a clipboard paste / absolute file path the user pasted into
 * the build's free-text notes. It must NEVER reach the redacted bundle. */
const SENSITIVE_TOKEN = '/home/secret-user/Documents/my-pob-build-SECRET-TOKEN-9f3a.xml';

/** The open build the crash is about. Its free-text `notes` carries the planted
 * secret (the exact field a careless assembler would leak). */
const SAMPLE_BUILD: BuildState = {
  schemaVersion: 1,
  id: 'build-1',
  name: 'Crashy Build',
  classId: 'Witch',
  ascendancyId: 'Infernalist',
  level: 92,
  itemSets: [
    { id: 'is-1', name: 'Default', slots: {} },
    { id: 'is-2', name: 'Swap', slots: {} },
  ],
  skillSets: [{ id: 'ss-1', name: 'Main', groups: [] }],
  passiveSpecs: [{ id: 'ps-1', name: 'Tree', treeVersion: '0_5', allocatedNodeIds: [] }],
  configSets: [{ id: 'cs-1', name: 'Default', options: {} }],
  activeItemSetId: 'is-1',
  activeSkillSetId: 'ss-1',
  activePassiveSpecId: 'ps-1',
  activeConfigSetId: 'cs-1',
  // The planted secret lives in free-text notes — clipboard paste / file path.
  notes: `pasted from clipboard: ${SENSITIVE_TOKEN}`,
  metadata: {
    upstreamCommit: 'a1b2c3d4',
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    locale: 'ko-KR',
  },
};

/** The §10.9 diagnostic export the host already built for this session. */
const SAMPLE_DIAGNOSTIC: DiagnosticExport = {
  schemaVersion: 1,
  build: SAMPLE_BUILD,
  localizationMisses: [{ key: 'stat.fire_damage', locale: 'ko-KR' }],
  unsupportedMods: ['Grants Level 20 Some Unknown Skill'],
  coreVersion: '0.5.3',
  upstreamCommit: 'a1b2c3d4',
};

/** A caught §6.4 CoreError — the runner failure the report is about. */
const SAMPLE_ERROR: CoreError = {
  code: 'CALC_FAILED',
  message: 'attempt to index a nil value (calc.run)',
  upstreamStack: 'stack traceback:\n\t[C]: in function ...\n\tModules/CalcPerform.lua:42',
};

describe('assembleCrashReport (DESIGN §5.1 crash report, §13)', () => {
  it('assembles a WELL-FORMED bundle naming the core + upstream it ran against', () => {
    const report = assembleCrashReport(SAMPLE_ERROR, SAMPLE_DIAGNOSTIC);
    expect(report.coreVersion).toBe('0.5.3');
    expect(report.upstreamCommit).toBe('a1b2c3d4');
    expect(report.coreVersion.length).toBeGreaterThan(0);
    expect(report.upstreamCommit.length).toBeGreaterThan(0);
  });

  it('carries the upstream Lua stack the §6.4 CoreError surfaced', () => {
    const report = assembleCrashReport(SAMPLE_ERROR, SAMPLE_DIAGNOSTIC);
    expect(report.upstreamStack).toBe(SAMPLE_ERROR.upstreamStack);
  });

  it('includes the ERROR ENVELOPE — the { code, message } pair (DESIGN §6.4)', () => {
    const report = assembleCrashReport(SAMPLE_ERROR, SAMPLE_DIAGNOSTIC);
    expect(report.error).toEqual<CrashReport['error']>({
      code: 'CALC_FAILED',
      message: 'attempt to index a nil value (calc.run)',
    });
  });

  it('carries a SANITIZED build summary — structural facts only, no full build', () => {
    const report = assembleCrashReport(SAMPLE_ERROR, SAMPLE_DIAGNOSTIC);
    expect(report.buildSummary).toEqual<CrashReport['buildSummary']>({
      classId: 'Witch',
      ascendancyId: 'Infernalist',
      level: 92,
      itemSetCount: 2,
      skillSetCount: 1,
      passiveSpecCount: 1,
      configSetCount: 1,
    });
    // The full BuildState is NOT embedded — only the derived summary.
    expect((report.buildSummary as unknown as Record<string, unknown>).notes).toBeUndefined();
    expect((report as unknown as Record<string, unknown>).build).toBeUndefined();
  });

  it('is REDACTED: a planted sensitive token does not appear anywhere in the bundle', () => {
    const report = assembleCrashReport(SAMPLE_ERROR, SAMPLE_DIAGNOSTIC);
    // Sanity: the secret really is present in the source build's notes.
    expect(SAMPLE_BUILD.notes).toContain(SENSITIVE_TOKEN);
    // The whole serialized bundle must not leak it — no clipboard text / file paths.
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(SENSITIVE_TOKEN);
    expect(serialized).not.toContain('SECRET-TOKEN');
    expect(serialized).not.toContain('/home/');
  });

  it('redacts even when the planted token is hidden in the error message / stack', () => {
    const leakyError: CoreError = {
      code: 'BUILD_PARSE_FAILED',
      message: `failed to read ${SENSITIVE_TOKEN}`,
      upstreamStack: `traceback referencing ${SENSITIVE_TOKEN}`,
    };
    const report = assembleCrashReport(leakyError, SAMPLE_DIAGNOSTIC);
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(SENSITIVE_TOKEN);
    expect(serialized).not.toContain('/home/');
  });

  it('assembles a well-formed envelope from a GENERIC (non-CoreError) runner failure', () => {
    const failure = new Error('runner process exited with code 139 (SIGSEGV)');
    const report = assembleCrashReport(failure, SAMPLE_DIAGNOSTIC);
    expect(report.error.code).toBe('RUNNER_FAILED');
    expect(report.error.message).toBe('runner process exited with code 139 (SIGSEGV)');
    // No upstream stack on a plain runner failure — the field is simply absent.
    expect(report.upstreamStack).toBeUndefined();
    // Still names the core/upstream and carries the sanitized summary.
    expect(report.coreVersion).toBe('0.5.3');
    expect(report.buildSummary.classId).toBe('Witch');
  });

  it('does NOT embed the diagnostic export wholesale (no localizationMisses / mods leak)', () => {
    const report = assembleCrashReport(SAMPLE_ERROR, SAMPLE_DIAGNOSTIC);
    const flat = report as unknown as Record<string, unknown>;
    expect(flat.localizationMisses).toBeUndefined();
    expect(flat.unsupportedMods).toBeUndefined();
  });
});
