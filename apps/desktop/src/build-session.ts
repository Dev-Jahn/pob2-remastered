/**
 * build-session — the thin async data layer that connects the read-only Overview
 * viewer to @pob2/core-client (DESIGN §18 Phase 2 doneCriteria "기존 build 파일을
 * 열어 Overview 표시", §6.3 load/save/loadShareCode/saveShareCode, §12.3 round-trip).
 *
 * Given build XML or a share code, it drives `CoreClient.load`/`loadShareCode`
 * followed by `calcRun`, and returns `{ summary, stats }` already shaped for the
 * Overview view-model: `summary` is the runner's plain BuildSummary and `stats`
 * is the `CalcRunResponse` — exactly what @pob2/ui's `buildOverviewModel(stats,
 * summary)` consumes. `save()` round-trips the open build back out as PoB XML or a
 * share code.
 *
 * INJECTABLE CLIENT (DESIGN §5.1: the host layer owns the out-of-process Lua
 * runner; the UI/data layer is pure). The real {@link CoreClient} spawns a Lua
 * subprocess (overlays/lua/runner.lua) that jsdom cannot host, so this layer takes
 * the client as a dependency rather than constructing one. The dependency surface
 * is the minimal {@link BuildClient} subset of the Core API this layer calls; the
 * concrete `CoreClient` satisfies it structurally, and a test can inject a mock.
 * @pob2/core-client internals are NOT touched.
 *
 * NO-FALLBACK (DESIGN §6.4): this layer only routes and re-shapes. It does not
 * fabricate a summary or stats; a load/calc failure propagates the client's
 * CoreClientError unchanged. `save()` before any `open()` throws rather than
 * inventing a build id to round-trip.
 */
import type { BuildSaveResponse, CalcRunResponse } from '@pob2/schema';
import type { BuildSummary } from '@pob2/ui';

/**
 * The slice of the @pob2/core-client `CoreClient` Core API this data layer needs,
 * declared structurally so the concrete client satisfies it and a test can inject
 * a mock without spawning the Lua runner (DESIGN §5.1). Mirrors the relevant
 * `CoreClient` method signatures exactly.
 */
export interface BuildClient {
  /** build.load — load from upstream PoB XML, returning the build id + summary. */
  load(xml: string): Promise<{ buildId: string; summary: BuildSummary }>;
  /** build.loadShareCode — decode a PoB share code to XML and load it. */
  loadShareCode(code: string): Promise<{ buildId: string; summary: BuildSummary }>;
  /** calc.run — run the calc pass and return the curated numeric stats. */
  calcRun(buildId: string): Promise<CalcRunResponse>;
  /** build.save — export the open build as PoB XML. */
  save(buildId: string): Promise<BuildSaveResponse>;
  /** build.exportShareCode — export the open build as a PoB share code. */
  saveShareCode(buildId: string): Promise<{ format: 'shareCode'; data: string }>;
}

/** What `open()` accepts: build XML or a PoB share code (DESIGN §12.2, §10.9). */
export type OpenSource = { xml: string } | { shareCode: string };

/** The Overview data `open()` yields: a BuildSummary header + a CalcRunResponse. */
export interface OpenResult {
  summary: BuildSummary;
  stats: CalcRunResponse;
}

/** Export format for `save()` (DESIGN §12.2 PoB XML / share code). */
export type SaveFormat = 'xml' | 'shareCode';

/** A loaded build session: open a source, save the open build (DESIGN §10.9). */
export interface BuildSession {
  /**
   * Load a build from XML or a share code and run the calc pass, returning the
   * `{ summary, stats }` the Overview view-model consumes. Records the resulting
   * build id so a later `save()` can round-trip it.
   */
  open(source: OpenSource): Promise<OpenResult>;
  /**
   * Export the open build back out (DESIGN §12.3 round-trip). Throws if no build
   * has been opened — there is no build id to round-trip (NO-FALLBACK).
   */
  save(options: { format: SaveFormat }): Promise<BuildSaveResponse>;
}

/**
 * Create a build session over an injected {@link BuildClient} (DESIGN §5.1). The
 * client owns the Lua runner; this session just routes load/calc/save through it
 * and shapes the result for the Overview view-model.
 */
export function createBuildSession(client: BuildClient): BuildSession {
  // The id of the build currently open; null until the first successful open().
  let buildId: string | null = null;

  return {
    async open(source) {
      const loaded =
        'xml' in source
          ? await client.load(source.xml)
          : await client.loadShareCode(source.shareCode);
      buildId = loaded.buildId;
      const stats = await client.calcRun(loaded.buildId);
      return { summary: loaded.summary, stats };
    },

    async save({ format }) {
      if (buildId === null) {
        throw new Error('build-session: save() called before a build was opened');
      }
      return format === 'shareCode' ? client.saveShareCode(buildId) : client.save(buildId);
    },
  };
}
