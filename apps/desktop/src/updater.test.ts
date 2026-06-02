/**
 * updater test (p7-updater-rollback) — the pure updater state machine that models
 * the DESIGN §13.3 update sequence (check → download → hash/signature verify →
 * stage → smoke test → atomic switch → rollback on failure) over an INJECTED
 * staging/filesystem + smoke-test abstraction.
 *
 * PURE / no-host (DESIGN §5.1, §13.1): the module spawns nothing, hits no
 * network, touches no real binary. Everything the real updater would do against
 * the OS — download bytes, verify a signature/hash, write a staging directory,
 * run the §13.3 smoke test (core boot / sample build load / calc run), flip the
 * active version — is expressed through an injected {@link UpdaterEnv} the test
 * supplies as an in-memory fake. The driver/Tauri side later supplies a real env;
 * the state machine itself is deterministic and testable in isolation.
 *
 * The §2 dev-workflow secret/signature gate is honoured by construction: this
 * test injects a FAKE verify hook (a config-hook stub, not a real signing key) —
 * no real signature material is fabricated or bundled.
 *
 * Coverage (the three claims the task demands):
 *   1. clean path — a valid release verifies, stages, passes its smoke test, and
 *      ATOMICALLY switches: the active version becomes the new one.
 *   2. failed smoke test — rolls back to the prior version; the active version is
 *      UNCHANGED and the staged artifact is discarded (NO-FALLBACK: a failed
 *      verify/smoke never silently keeps the half-staged version).
 *   3. hash/signature mismatch — same rollback guarantee, and the smoke test is
 *      never even reached (verify gates staging).
 *   4. rollback is idempotent — applying it again is a no-op on the active state.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  runUpdate,
  rollback,
  UpdateStep,
  UpdateOutcome,
  type UpdaterEnv,
  type UpdateCandidate,
  type UpdaterState,
} from './updater.js';

/** The version the machine starts on (DESIGN §13.3 "prior version"). */
const PRIOR_VERSION = '0.5.2';

/** A well-formed candidate release the remote "check" surfaced (DESIGN §13.3 step 1–6). */
const GOOD_CANDIDATE: UpdateCandidate = {
  version: '0.5.3',
  // The bytes the "download" step yields and the digest "verify" must match.
  payload: 'core-bundle-0.5.3-bytes',
  expectedHash: 'hash:core-bundle-0.5.3-bytes',
};

/**
 * Build an in-memory {@link UpdaterEnv} fake. Defaults model a healthy host:
 * download echoes the candidate payload, the digest is `hash:<payload>`, the
 * signature/hash verify passes, staging + switch succeed, the smoke test passes.
 * Each behaviour is overridable so a test can fail exactly one §13.3 step.
 */
function makeEnv(overrides: Partial<UpdaterEnv> = {}): UpdaterEnv {
  return {
    download: vi.fn(async (candidate: UpdateCandidate) => candidate.payload),
    // A deterministic stand-in for the real signature/hash check. The real env
    // verifies against a signing key; here it is a pure digest comparison.
    digest: vi.fn((bytes: string) => `hash:${bytes}`),
    stage: vi.fn(async () => {}),
    smokeTest: vi.fn(async () => true),
    activate: vi.fn(async () => {}),
    discardStaging: vi.fn(async () => {}),
    ...overrides,
  };
}

/** The starting state: active on the prior version, nothing staged. */
function initialState(): UpdaterState {
  return { activeVersion: PRIOR_VERSION, stagedVersion: null };
}

describe('runUpdate — clean update path (DESIGN §13.3 steps 1–9)', () => {
  it('atomically switches to the new version when verify + smoke test pass', async () => {
    const env = makeEnv();
    const state = initialState();

    const result = await runUpdate(state, GOOD_CANDIDATE, env);

    expect(result.outcome).toBe(UpdateOutcome.Switched);
    // Atomic switch: the ACTIVE version is now the candidate, nothing left staged.
    expect(result.state.activeVersion).toBe('0.5.3');
    expect(result.state.stagedVersion).toBeNull();
  });

  it('walks the §13.3 sequence in order: download → verify → stage → smoke → activate', async () => {
    const env = makeEnv();
    const result = await runUpdate(initialState(), GOOD_CANDIDATE, env);

    // The recorded step trace is the §13.3 happy path, in order.
    expect(result.steps).toEqual([
      UpdateStep.Download,
      UpdateStep.Verify,
      UpdateStep.Stage,
      UpdateStep.SmokeTest,
      UpdateStep.Activate,
    ]);
    expect(env.download).toHaveBeenCalledOnce();
    expect(env.stage).toHaveBeenCalledOnce();
    expect(env.smokeTest).toHaveBeenCalledOnce();
    expect(env.activate).toHaveBeenCalledWith('0.5.3');
    // A clean switch discards nothing — there is no rollback.
    expect(env.discardStaging).not.toHaveBeenCalled();
  });
});

describe('runUpdate — failed smoke test rolls back (DESIGN §13.3 step 10, NO-FALLBACK)', () => {
  it('rolls back to the prior version; the active version is UNCHANGED', async () => {
    const env = makeEnv({ smokeTest: vi.fn(async () => false) });
    const state = initialState();

    const result = await runUpdate(state, GOOD_CANDIDATE, env);

    expect(result.outcome).toBe(UpdateOutcome.RolledBack);
    // The whole point of §13.3 step 10: the active version did NOT move.
    expect(result.state.activeVersion).toBe(PRIOR_VERSION);
    expect(result.state.stagedVersion).toBeNull();
  });

  it('NEVER activates the candidate and DISCARDS the half-staged artifact', async () => {
    const env = makeEnv({ smokeTest: vi.fn(async () => false) });

    const result = await runUpdate(initialState(), GOOD_CANDIDATE, env);

    // It reached staging + smoke, then rolled back — it never flipped active.
    expect(result.steps).toEqual([
      UpdateStep.Download,
      UpdateStep.Verify,
      UpdateStep.Stage,
      UpdateStep.SmokeTest,
      UpdateStep.Rollback,
    ]);
    expect(env.activate).not.toHaveBeenCalled();
    // NO-FALLBACK: a failed smoke test does not silently keep the staged version.
    expect(env.discardStaging).toHaveBeenCalledOnce();
  });
});

describe('runUpdate — hash/signature mismatch rolls back before staging (DESIGN §13.3 step 6)', () => {
  it('a tampered payload fails verify, never stages, and the active version is unchanged', async () => {
    // The candidate's expectedHash no longer matches the downloaded payload's
    // digest — the §13.3 signature/hash check must reject it.
    const tampered: UpdateCandidate = {
      version: '0.5.3',
      payload: 'tampered-bytes',
      expectedHash: 'hash:core-bundle-0.5.3-bytes',
    };
    const env = makeEnv();

    const result = await runUpdate(initialState(), tampered, env);

    expect(result.outcome).toBe(UpdateOutcome.RolledBack);
    expect(result.state.activeVersion).toBe(PRIOR_VERSION);
    expect(result.state.stagedVersion).toBeNull();
    // Verify gates staging: a mismatch is caught BEFORE anything is written.
    expect(env.stage).not.toHaveBeenCalled();
    expect(env.smokeTest).not.toHaveBeenCalled();
    expect(env.activate).not.toHaveBeenCalled();
    expect(result.steps).toEqual([UpdateStep.Download, UpdateStep.Verify, UpdateStep.Rollback]);
  });

  it('surfaces the verify failure reason (NO-FALLBACK: the failure is explicit)', async () => {
    const tampered: UpdateCandidate = {
      version: '0.5.3',
      payload: 'tampered-bytes',
      expectedHash: 'hash:core-bundle-0.5.3-bytes',
    };
    const result = await runUpdate(initialState(), tampered, makeEnv());
    expect(result.reason).toMatch(/hash|signature|verif/i);
  });
});

describe('rollback — idempotent (DESIGN §13.3 step 10)', () => {
  it('returns to the prior version and applying it again is a no-op', async () => {
    const env = makeEnv({ smokeTest: vi.fn(async () => false) });
    const failed = await runUpdate(initialState(), GOOD_CANDIDATE, env);
    expect(failed.state.activeVersion).toBe(PRIOR_VERSION);

    // Re-running rollback on the already-rolled-back state changes nothing and
    // does not re-discard (idempotent: the staging slot is already empty).
    const discardCalls = (env.discardStaging as ReturnType<typeof vi.fn>).mock.calls.length;
    const again = await rollback(failed.state, env);

    expect(again.activeVersion).toBe(PRIOR_VERSION);
    expect(again.stagedVersion).toBeNull();
    expect(again).toEqual(failed.state);
    expect((env.discardStaging as ReturnType<typeof vi.fn>).mock.calls.length).toBe(discardCalls);
  });

  it('a clean post-switch state rolls back to a no-op (nothing staged to discard)', async () => {
    const env = makeEnv();
    const switched = await runUpdate(initialState(), GOOD_CANDIDATE, env);
    expect(switched.state.activeVersion).toBe('0.5.3');

    // After a successful switch there is no staged artifact, so rollback is inert
    // — it must NOT revert the active version the user just adopted.
    const after = await rollback(switched.state, env);
    expect(after.activeVersion).toBe('0.5.3');
    expect(after.stagedVersion).toBeNull();
  });
});
