/**
 * CoreError envelope — DESIGN.md §6.4.
 *
 * Every Core API failure is normalised into this shape so the host and UI never
 * see raw Lua tables or stack traces in an ad-hoc form.
 */

/**
 * Runtime list of the six DESIGN §6.4 error codes. This array is the single
 * source the {@link CoreErrorCode} type and the JSON Schema enum both derive
 * from, so the closed set cannot drift between type-land and schema-land.
 */
export const CORE_ERROR_CODES = [
  'CORE_INIT_FAILED',
  'BUILD_PARSE_FAILED',
  'UNKNOWN_MOD',
  'CALC_FAILED',
  'LOCALIZATION_MISSING',
  'UPSTREAM_INCOMPATIBLE',
] as const;

/** Closed set of Core API error codes (DESIGN §6.4). */
export type CoreErrorCode = (typeof CORE_ERROR_CODES)[number];

/** Normalised Core API error (DESIGN §6.4). */
export interface CoreError {
  code: CoreErrorCode;
  message: string;
  details?: unknown;
  /** Raw upstream Lua stack, surfaced only in dev/beta diagnostics. */
  upstreamStack?: string;
}
