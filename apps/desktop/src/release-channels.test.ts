/**
 * release-channels test (p7-release-channels) — the typed release-channel
 * descriptor table and selector that the DESIGN §13.1 update channels resolve
 * through (stable / beta / dev → update feed + capability flags).
 *
 * DESIGN §13.1 names three channels:
 *   - stable: 일반 사용자 / 검증된 release.
 *   - beta:   고급 사용자 / upstream 빠른 반영.
 *   - dev:    개발자 / nightly, debug 기능.
 *
 * DESIGN §14.1 constrains one of the flags: "devtools는 dev/beta에서만" — devtools
 * is enabled ONLY on dev and beta, never on stable.
 *
 * PURE / no-host (DESIGN §5.1, §13.1): this module is a static descriptor table
 * plus a pure selector. It performs no network and no I/O — the feed URL is data,
 * not a live fetch. The §2 dev-workflow gate is honoured by construction: feeds
 * are fixture URLs the host later wires to a real endpoint, not live network here.
 *
 * Coverage (the claims the task demands):
 *   1. each channel resolves to its expected feed + flags.
 *   2. dev enables devtools while stable does not (DESIGN §14.1).
 *   3. an unknown channel id is REJECTED — not silently coerced to stable
 *      (NO-FALLBACK: a bad channel id is an explicit error, never a default).
 *   4. the updater consumes its feed THROUGH this selector (the selector is the
 *      single source of the feed URL the updater downloads from).
 */
import { describe, it, expect } from 'vitest';
import {
  RELEASE_CHANNELS,
  resolveReleaseChannel,
  updateFeedForChannel,
  isReleaseChannelId,
  type ReleaseChannelId,
  type ReleaseChannelDescriptor,
} from './release-channels.js';

describe('resolveReleaseChannel — each channel resolves to its expected feed + flags (DESIGN §13.1)', () => {
  it('stable resolves to the verified-release feed with devtools DISABLED', () => {
    const stable = resolveReleaseChannel('stable');
    expect(stable.id).toBe('stable');
    expect(stable.feedUrl).toBe('https://releases.pob2.app/stable/latest.json');
    // DESIGN §14.1: stable is the 일반 사용자 channel — devtools is off.
    expect(stable.devtoolsEnabled).toBe(false);
    // Verified release stream is not a nightly/prerelease feed.
    expect(stable.prerelease).toBe(false);
  });

  it('beta resolves to the fast-upstream feed with devtools ENABLED', () => {
    const beta = resolveReleaseChannel('beta');
    expect(beta.id).toBe('beta');
    expect(beta.feedUrl).toBe('https://releases.pob2.app/beta/latest.json');
    // DESIGN §14.1: devtools는 dev/beta에서만 — beta gets devtools.
    expect(beta.devtoolsEnabled).toBe(true);
    expect(beta.prerelease).toBe(true);
  });

  it('dev resolves to the nightly feed with devtools ENABLED', () => {
    const dev = resolveReleaseChannel('dev');
    expect(dev.id).toBe('dev');
    expect(dev.feedUrl).toBe('https://releases.pob2.app/dev/latest.json');
    // DESIGN §13.1: dev is nightly + debug 기능; §14.1 grants it devtools.
    expect(dev.devtoolsEnabled).toBe(true);
    expect(dev.prerelease).toBe(true);
  });
});

describe('devtools flag — dev enables devtools while stable does not (DESIGN §14.1)', () => {
  it('the dev channel enables devtools but the stable channel does not', () => {
    expect(resolveReleaseChannel('dev').devtoolsEnabled).toBe(true);
    expect(resolveReleaseChannel('stable').devtoolsEnabled).toBe(false);
  });

  it('devtools is enabled on exactly the dev/beta channels, never on stable', () => {
    const enabled = (Object.keys(RELEASE_CHANNELS) as ReleaseChannelId[]).filter(
      (id) => resolveReleaseChannel(id).devtoolsEnabled,
    );
    // §14.1 "devtools는 dev/beta에서만" — the set is exactly {dev, beta}.
    expect(new Set(enabled)).toEqual(new Set<ReleaseChannelId>(['dev', 'beta']));
  });
});

describe('resolveReleaseChannel — unknown channel id is rejected, not coerced (NO-FALLBACK)', () => {
  it('throws on an unknown channel id rather than silently defaulting to stable', () => {
    // The whole point: a typo'd / hostile channel id must NOT be coerced to a
    // safe-looking stable descriptor. It is an explicit error.
    expect(() => resolveReleaseChannel('nightly' as ReleaseChannelId)).toThrow(/nightly/);
    expect(() => resolveReleaseChannel('' as ReleaseChannelId)).toThrow();
    expect(() => resolveReleaseChannel('STABLE' as ReleaseChannelId)).toThrow();
  });

  it('the rejection does NOT return the stable descriptor as a fallback', () => {
    let returned: ReleaseChannelDescriptor | undefined;
    try {
      returned = resolveReleaseChannel('release' as ReleaseChannelId);
    } catch {
      returned = undefined;
    }
    // NO-FALLBACK: an unknown id yields no descriptor at all — not stable's.
    expect(returned).toBeUndefined();
  });

  it('isReleaseChannelId is the type guard that gates an unknown id', () => {
    expect(isReleaseChannelId('stable')).toBe(true);
    expect(isReleaseChannelId('beta')).toBe(true);
    expect(isReleaseChannelId('dev')).toBe(true);
    expect(isReleaseChannelId('nightly')).toBe(false);
    expect(isReleaseChannelId('')).toBe(false);
    expect(isReleaseChannelId('STABLE')).toBe(false);
  });
});

describe('updateFeedForChannel — the updater reads its feed THROUGH this selector', () => {
  it('returns exactly the resolved channel feed URL the updater downloads from', () => {
    // The updater never hard-codes a feed; it asks the selector. This is the
    // single source of the §13.3 download URL per channel.
    expect(updateFeedForChannel('stable')).toBe(resolveReleaseChannel('stable').feedUrl);
    expect(updateFeedForChannel('beta')).toBe(resolveReleaseChannel('beta').feedUrl);
    expect(updateFeedForChannel('dev')).toBe(resolveReleaseChannel('dev').feedUrl);
  });

  it('rejects an unknown channel id the same way resolveReleaseChannel does', () => {
    expect(() => updateFeedForChannel('nightly' as ReleaseChannelId)).toThrow(/nightly/);
  });
});
