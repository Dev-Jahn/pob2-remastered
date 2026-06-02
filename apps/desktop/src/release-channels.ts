/**
 * release-channels — the typed release-channel descriptor table and selector for
 * the DESIGN §13.1 update channels (stable / beta / dev). Each channel maps to an
 * update feed URL plus capability flags; the §13.3 updater reads its download feed
 * THROUGH this selector rather than hard-coding a URL, so the channel is the one
 * place the feed + flags are defined.
 *
 * DESIGN §13.1 채널:
 *   - stable: 일반 사용자 / 검증된 release.
 *   - beta:   고급 사용자 / upstream 빠른 반영.
 *   - dev:    개발자 / nightly, debug 기능.
 *
 * DESIGN §14.1 flag constraint: "devtools는 dev/beta에서만" — devtools is enabled
 * ONLY on the dev and beta channels, never on stable.
 *
 * PURE / no-host (DESIGN §5.1, §13.1): this module is static data plus a pure
 * selector. It performs no network and no I/O — `feedUrl` is a descriptor value
 * the host later points at a real endpoint. The §2 dev-workflow gate is honoured
 * by construction: these are fixture feed URLs, not live network calls.
 *
 * NO-FALLBACK (the task's third claim): an unknown channel id is REJECTED with an
 * explicit error. It is never silently coerced to `stable`, so a typo'd or hostile
 * channel id can never quietly downgrade the user onto a different feed/flag set.
 */

/** The three DESIGN §13.1 channel ids. Closed set — there is no "other". */
export type ReleaseChannelId = 'stable' | 'beta' | 'dev';

/** A typed release channel: its update feed plus its capability flags. */
export interface ReleaseChannelDescriptor {
  /** The channel id this descriptor describes (DESIGN §13.1). */
  id: ReleaseChannelId;
  /**
   * The §13.3 update feed URL the updater downloads its candidate manifest from.
   * A descriptor value, not a live fetch — the host points it at a real endpoint.
   */
  feedUrl: string;
  /**
   * DESIGN §14.1 flag: whether devtools is permitted on this channel. True only
   * for dev/beta; false for stable.
   */
  devtoolsEnabled: boolean;
  /**
   * Whether this channel's feed serves prerelease builds (beta fast-upstream and
   * dev nightlies do; the verified stable release stream does not).
   */
  prerelease: boolean;
}

/**
 * The descriptor table — the single source of feed + flags per DESIGN §13.1
 * channel. `devtoolsEnabled` encodes §14.1 ("devtools는 dev/beta에서만"): true on
 * dev/beta, false on stable.
 */
export const RELEASE_CHANNELS: Readonly<Record<ReleaseChannelId, ReleaseChannelDescriptor>> = {
  stable: {
    id: 'stable',
    feedUrl: 'https://releases.pob2.app/stable/latest.json',
    devtoolsEnabled: false,
    prerelease: false,
  },
  beta: {
    id: 'beta',
    feedUrl: 'https://releases.pob2.app/beta/latest.json',
    devtoolsEnabled: true,
    prerelease: true,
  },
  dev: {
    id: 'dev',
    feedUrl: 'https://releases.pob2.app/dev/latest.json',
    devtoolsEnabled: true,
    prerelease: true,
  },
};

/**
 * Type guard: is `id` one of the three DESIGN §13.1 channel ids? Used to gate an
 * untrusted/string channel id before resolving it. Case-sensitive and exact —
 * "STABLE" or "nightly" are not channels.
 */
export function isReleaseChannelId(id: string): id is ReleaseChannelId {
  return Object.prototype.hasOwnProperty.call(RELEASE_CHANNELS, id);
}

/**
 * Resolve a channel id to its descriptor (feed + flags).
 *
 * NO-FALLBACK: an unknown id throws an explicit error naming the bad id. It is
 * never coerced to `stable` — a bad channel id is a configuration fault, not a
 * cue to silently downgrade onto a different feed.
 */
export function resolveReleaseChannel(id: ReleaseChannelId): ReleaseChannelDescriptor {
  if (!isReleaseChannelId(id)) {
    throw new Error(
      `unknown release channel "${id}": expected one of stable, beta, dev (DESIGN §13.1)`,
    );
  }
  return RELEASE_CHANNELS[id];
}

/**
 * The §13.3 update feed URL for a channel — the single accessor the updater uses
 * to learn where to download from. Delegates to {@link resolveReleaseChannel}, so
 * an unknown channel id is rejected here too (never coerced to stable's feed).
 */
export function updateFeedForChannel(id: ReleaseChannelId): string {
  return resolveReleaseChannel(id).feedUrl;
}
