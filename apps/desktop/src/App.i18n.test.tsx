/**
 * @pob2/desktop ko/en UI toggle integration test (desktop-i18n-test task).
 *
 * This is the i18n GATE the DESIGN Phase 2 doneCriteria "한국어/영어 UI toggle 가능"
 * (DESIGN §18 Phase 2, §8.1 locale baseline) is verified against. It renders the
 * real desktop `App` (not an isolated component) and proves the full toggle
 * round-trip plus the §8.1 bilingual-search guarantee:
 *
 *   1. Default locale is Korean (DESIGN §8.1): the nav rail and Overview cards
 *      render their Korean labels, and the English baseline strings are absent.
 *   2. Clicking the LocaleToggle's English option flips EVERY visible chrome
 *      label (nav rail + Overview card titles) to English; clicking Korean flips
 *      them all back. Nothing is left in the stale locale either direction.
 *   3. An English-origin term stays searchable after the switch. DESIGN §8.1 /
 *      §10.1 forbid ever dropping the English alias so a user can move between an
 *      English build guide and the Korean client. The App's Ctrl+K command
 *      palette (§10.2 "[Ctrl+K Search]", §11.1/§11.2 bilingual search) must
 *      therefore resolve an English query to the same command in BOTH locales.
 *
 * The filename carries `i18n` so `pnpm --filter @pob2/desktop test i18n` selects
 * exactly this suite. It runs under jsdom (vitest.config.ts) and drives @pob2/ui
 * through the App's real composition, the same path the shipped app takes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import { stringsKo, stringsEn } from '@pob2/ui';
import { App } from '../src/App.js';

afterEach(cleanup);

/** Every nav-rail + Overview-card label key the toggle must localize. */
const CHROME_KEYS = [
  'nav.overview',
  'nav.skills',
  'nav.passiveTree',
  'nav.items',
  'nav.calcs',
  'nav.config',
  'nav.importExport',
  'overview.card.offence',
  'overview.card.defence',
  'overview.card.resources',
] as const;

/** Read the localized labels actually rendered into the nav rail. */
function navLabels(): string[] {
  const nav = screen.getByRole('navigation');
  return Array.from(nav.querySelectorAll('[role="listitem"]'), (el) => el.textContent ?? '');
}

/** Open the Ctrl+K palette and read the data-command-id of each visible option. */
function searchCommandIds(query: string): string[] {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
  const input = screen.getByRole('combobox');
  fireEvent.change(input, { target: { value: query } });
  const ids = screen.getAllByRole('option').map((el) => el.getAttribute('data-command-id') ?? '');
  // Close the palette so the next open starts clean (Ctrl+K resets the query).
  fireEvent.keyDown(input, { key: 'Escape' });
  return ids;
}

describe('@pob2/desktop ko/en UI toggle (i18n gate — DESIGN §18 Phase 2)', () => {
  it('defaults to Korean: nav rail + Overview cards render Korean labels', () => {
    render(<App />);

    const labels = navLabels();
    expect(labels).toContain(stringsKo['nav.overview']);
    expect(labels).toContain(stringsKo['nav.passiveTree']);
    // The Overview workspace shows its Korean card titles.
    expect(screen.getByText(stringsKo['overview.card.offence'])).toBeTruthy();
    expect(screen.getByText(stringsKo['overview.card.defence'])).toBeTruthy();
    // ...and none of the English baseline strings are on screen yet.
    expect(screen.queryByText(stringsEn['nav.overview'])).toBeNull();
    expect(screen.queryByText(stringsEn['overview.card.offence'])).toBeNull();
  });

  it('switches every visible label to English when the toggle is set to en (and back)', () => {
    render(<App />);

    // Sanity: start Korean.
    expect(screen.getByText(stringsKo['nav.overview'])).toBeTruthy();

    // Flip to English via the header LocaleToggle.
    const toggle = document.querySelector('.pob-locale-toggle') as HTMLElement;
    fireEvent.click(within(toggle).getByText(stringsKo['locale.en']));

    // Every chrome label is now its English string, and the Korean one is gone.
    for (const key of CHROME_KEYS) {
      expect(screen.getByText(stringsEn[key])).toBeTruthy();
      expect(screen.queryByText(stringsKo[key])).toBeNull();
    }

    // Flip back to Korean via the (now English-labelled) toggle.
    const toggleEn = document.querySelector('.pob-locale-toggle') as HTMLElement;
    fireEvent.click(within(toggleEn).getByText(stringsEn['locale.ko']));

    for (const key of CHROME_KEYS) {
      expect(screen.getByText(stringsKo[key])).toBeTruthy();
      expect(screen.queryByText(stringsEn[key])).toBeNull();
    }
  });

  it('keeps an English-origin term searchable after switching to Korean (§8.1 alias never dropped)', () => {
    render(<App />);

    // Flip to English, then back to Korean — the round-trip must not strip the
    // English alias the §11 search resolves against.
    const toggle = document.querySelector('.pob-locale-toggle') as HTMLElement;
    fireEvent.click(within(toggle).getByText(stringsKo['locale.en']));
    const toggleEn = document.querySelector('.pob-locale-toggle') as HTMLElement;
    fireEvent.click(within(toggleEn).getByText(stringsEn['locale.ko']));

    // In the (default again) Korean UI, the English-origin query "Overview" still
    // resolves to the Overview command — the bilingual search index keeps the
    // English term reachable from the Korean client (DESIGN §8.1, §10.1, §11.2).
    expect(searchCommandIds('Overview')).toContain('nav-overview');
    // And its Korean form resolves to the same command (parity, §10.1).
    expect(searchCommandIds('개요')).toContain('nav-overview');
  });
});
