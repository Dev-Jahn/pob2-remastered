/**
 * @pob2/desktop App test (desktop-scaffold task).
 *
 * Asserts the desktop entry component:
 *   - mounts the @pob2/ui AppShell (header build/skill labels render),
 *   - shows Overview as the default route (the active nav tab is "Overview" and
 *     the Overview offence card is rendered in the workspace),
 *   - holds locale state defaulting to ko-KR, with the LocaleToggle wired so
 *     clicking the en option re-renders the chrome in English.
 *
 * Runs under jsdom (vitest.config.ts), driving @pob2/ui through its built dist
 * exports exactly as the app does.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import { stringsKo, stringsEn } from '@pob2/ui';
import { App } from '../src/App.js';

afterEach(cleanup);

describe('@pob2/desktop App', () => {
  it('mounts the AppShell with localized header chrome (default ko-KR)', () => {
    render(<App />);
    // Korean is the default locale (DESIGN §8.1): the shell's build label is the
    // Korean string, not the English one.
    expect(screen.getByText(stringsKo['shell.buildLabel'])).toBeTruthy();
  });

  it('shows Overview as the default route', () => {
    render(<App />);
    // The Overview nav entry is the active tab (marked via aria-current="page",
    // matching @pob2/ui Navigation conventions).
    const nav = screen.getByRole('navigation');
    const active = within(nav).getByRole('button', { current: 'page' });
    expect(active.textContent).toBe(stringsKo['nav.overview']);
    // The Overview workspace renders its offence stat card.
    expect(screen.getByText(stringsKo['overview.card.offence'])).toBeTruthy();
  });

  it('wires the LocaleToggle to switch the chrome to English', () => {
    render(<App />);
    // The LocaleToggle is the role="group" inside the shell header.
    const toggle = document.querySelector('.pob-locale-toggle') as HTMLElement;
    const enOption = within(toggle).getByText(stringsKo['locale.en']);
    fireEvent.click(enOption);
    // After switching, the build label is now the English string.
    expect(screen.getByText(stringsEn['shell.buildLabel'])).toBeTruthy();
  });
});
