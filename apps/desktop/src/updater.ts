/**
 * updater — the pure updater state machine modelling the DESIGN §13.3 update
 * sequence:
 *
 *   check → download → hash/signature verify → stage → smoke test
 *         → atomic switch → rollback on failure.
 *
 * PURE / no-host (DESIGN §5.1, §13.1): this module owns the *decision logic* of
 * the update, not the side effects. Everything that touches the OS — fetching
 * bytes, verifying a signature/hash, writing a staging directory, running the
 * §13.3 smoke test (core boot / sample build load / calc run), and flipping the
 * active version — is delegated to an injected {@link UpdaterEnv}. The desktop /
 * Tauri host supplies a real env (network + filesystem + the out-of-process Lua
 * runner for the smoke test); tests supply an in-memory fake. The state machine
 * is deterministic and unit-testable with no network and no real binaries.
 *
 * The §2 dev-workflow secret/signature gate is honoured by construction: the
 * signature/hash check is an INJECTED hook ({@link UpdaterEnv.digest}), not a
 * bundled signing key. No real signature material lives here; the host wires the
 * real verifier in.
 *
 * NO-FALLBACK (DESIGN §13.3 step 10): a failed verify OR a failed smoke test
 * NEVER silently keeps the half-staged version. Either gate failing routes the
 * machine through {@link rollback}, which restores the prior active version and
 * discards the staged artifact. The active version only ever advances after the
 * smoke test passes and the atomic switch succeeds.
 */
import { updateFeedForChannel, type ReleaseChannelId } from './release-channels.js';

/**
 * §13.3 step 1 / §13.1 — the feed URL the updater checks for this run's channel.
 * The updater never hard-codes a feed: it resolves it THROUGH the release-channel
 * selector ({@link updateFeedForChannel}), so the channel descriptor table is the
 * single source of the download URL. An unknown channel id is rejected there (it
 * is never coerced to stable), so the updater cannot silently check a wrong feed.
 */
export function updateFeed(channel: ReleaseChannelId): string {
  return updateFeedForChannel(channel);
}

/** A candidate release surfaced by the §13.3 "check" step (steps 1–4). */
export interface UpdateCandidate {
  /** The version this candidate would switch the app to. */
  version: string;
  /** The downloaded artifact bytes (modelled as an opaque string in tests). */
  payload: string;
  /**
   * The expected signature/hash digest the §13.3 verify step (step 6) must match
   * the downloaded payload against. A mismatch rejects the update before staging.
   */
  expectedHash: string;
}

/**
 * The injected host abstraction the state machine drives. Each method is one
 * §13.3 side effect; the machine never performs the effect itself. Async methods
 * mirror the real host (network/filesystem/runner are async); `digest` is the
 * one pure, synchronous primitive (a hash of bytes).
 */
export interface UpdaterEnv {
  /** §13.3 step 5: download the candidate artifact, yielding its bytes. */
  download(candidate: UpdateCandidate): Promise<string>;
  /**
   * §13.3 step 6: the signature/hash primitive. The real env computes this with
   * the verifier wired by the host (a signing key reference, never bundled); the
   * machine compares its output to `candidate.expectedHash`.
   */
  digest(bytes: string): string;
  /** §13.3 step 7: install the verified artifact into the staging directory. */
  stage(candidate: UpdateCandidate): Promise<void>;
  /**
   * §13.3 step 8: run the smoke test against the staged version (core boot /
   * sample build load / calc run). Returns `true` only if all checks pass.
   */
  smokeTest(candidate: UpdateCandidate): Promise<boolean>;
  /** §13.3 step 9: atomic switch — make `version` the active version. */
  activate(version: string): Promise<void>;
  /**
   * §13.3 step 10 (rollback): discard the staged artifact. Called on any verify
   * or smoke-test failure so no half-staged version is left behind.
   */
  discardStaging(): Promise<void>;
}

/** The machine's observable state: which version is live and what is staged. */
export interface UpdaterState {
  /** The version the app is currently running (DESIGN §13.3 "prior version"). */
  activeVersion: string;
  /** The version sitting in the staging directory, or `null` if nothing staged. */
  stagedVersion: string | null;
}

/** The §13.3 steps the machine records as it runs, for an auditable trace. */
export enum UpdateStep {
  Download = 'download',
  Verify = 'verify',
  Stage = 'stage',
  SmokeTest = 'smoke-test',
  Activate = 'activate',
  Rollback = 'rollback',
}

/** The terminal result of an update attempt. */
export enum UpdateOutcome {
  /** Verify + smoke passed; the atomic switch adopted the new version. */
  Switched = 'switched',
  /** A verify or smoke failure routed the machine through rollback. */
  RolledBack = 'rolled-back',
}

/** What {@link runUpdate} reports back to the host. */
export interface UpdateResult {
  /** Whether the machine switched to the candidate or rolled back. */
  outcome: UpdateOutcome;
  /** The state after the attempt (the active version is authoritative). */
  state: UpdaterState;
  /** The ordered §13.3 steps actually taken — an auditable trace. */
  steps: UpdateStep[];
  /** On rollback, the explicit failure reason (NO-FALLBACK: never silent). */
  reason?: string;
}

/**
 * §13.3 step 10 — roll back to the prior version. Pure over the injected env and
 * IDEMPOTENT: if nothing is staged the call is inert (the active version is left
 * exactly as-is and no discard side effect runs), so re-applying rollback never
 * double-discards and never reverts a version the user already adopted.
 *
 * Rollback does not move `activeVersion` — the active version is only advanced by
 * a successful atomic switch, so "rolling back" simply means abandoning the
 * staged candidate and keeping whatever is already active.
 */
export async function rollback(state: UpdaterState, env: UpdaterEnv): Promise<UpdaterState> {
  if (state.stagedVersion === null) {
    // Nothing staged → nothing to discard. Idempotent no-op: return the state
    // unchanged (same shape) so a second rollback is a true no-op.
    return { activeVersion: state.activeVersion, stagedVersion: null };
  }
  await env.discardStaging();
  return { activeVersion: state.activeVersion, stagedVersion: null };
}

/**
 * Run the DESIGN §13.3 update sequence for one candidate over the injected env.
 *
 * Sequence (each step delegated to `env`, recorded in `result.steps`):
 *   1. download the artifact.
 *   2. verify its signature/hash against `candidate.expectedHash`. A mismatch
 *      rolls back BEFORE anything is staged.
 *   3. stage the verified artifact (now `stagedVersion === candidate.version`).
 *   4. smoke test the staged version. A failure rolls back and discards staging.
 *   5. atomic switch — adopt the candidate as the active version.
 *
 * NO-FALLBACK: either gate (verify / smoke) failing routes through
 * {@link rollback}; the active version never advances past a failure, and the
 * half-staged artifact is always discarded.
 */
export async function runUpdate(
  state: UpdaterState,
  candidate: UpdateCandidate,
  env: UpdaterEnv,
): Promise<UpdateResult> {
  const steps: UpdateStep[] = [];

  // §13.3 step 5 — download.
  steps.push(UpdateStep.Download);
  const bytes = await env.download(candidate);

  // §13.3 step 6 — signature/hash verify. Gates staging: a mismatch is caught
  // before any artifact is written, so nothing needs discarding here.
  steps.push(UpdateStep.Verify);
  if (env.digest(bytes) !== candidate.expectedHash) {
    steps.push(UpdateStep.Rollback);
    const rolledBack = await rollback(state, env);
    return {
      outcome: UpdateOutcome.RolledBack,
      state: rolledBack,
      steps,
      reason: `verify failed: hash/signature mismatch for ${candidate.version}`,
    };
  }

  // §13.3 step 7 — stage. The candidate now occupies the staging slot.
  steps.push(UpdateStep.Stage);
  await env.stage(candidate);
  const staged: UpdaterState = {
    activeVersion: state.activeVersion,
    stagedVersion: candidate.version,
  };

  // §13.3 step 8 — smoke test (core boot / sample build load / calc run).
  steps.push(UpdateStep.SmokeTest);
  const smokePassed = await env.smokeTest(candidate);
  if (!smokePassed) {
    // §13.3 step 10 — a failed smoke test rolls back and discards the staged
    // artifact. NO-FALLBACK: the active version is left untouched.
    steps.push(UpdateStep.Rollback);
    const rolledBack = await rollback(staged, env);
    return {
      outcome: UpdateOutcome.RolledBack,
      state: rolledBack,
      steps,
      reason: `smoke test failed for ${candidate.version}`,
    };
  }

  // §13.3 step 9 — atomic switch. The active version advances; staging clears.
  steps.push(UpdateStep.Activate);
  await env.activate(candidate.version);
  return {
    outcome: UpdateOutcome.Switched,
    state: { activeVersion: candidate.version, stagedVersion: null },
    steps,
  };
}
