// App shell component test (DESIGN §10.2 App shell). Asserts the three-pane shell
// renders, that navigation uses the i18n resolver for the active locale's labels,
// and that the controlled LocaleToggle reports the *other* locale on click.
//
// All visible chrome text is sourced from `t(locale, key)` (DESIGN §8.1, §2.1
// "UI 문자열 100%"), so the assertions resolve their expected strings through the
// same resolver the components use rather than hard-coding literals.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AppShell, LocaleToggle, t } from '../src/index.js';
import type { Locale } from '../src/index.js';

afterEach(cleanup);

const baseProps = {
  buildName: 'Martial Artist / Monk',
  activeSkill: 'Whirling Assault',
  workspace: <div data-testid="ws-content">workspace canvas</div>,
  inspector: <div data-testid="insp-content">inspector panel</div>,
  onLocaleChange: () => {},
} as const;

describe('AppShell (DESIGN §10.2)', () => {
  it('renders the left navigation, center workspace, and right inspector panes', () => {
    render(<AppShell {...baseProps} locale="en-US" />);

    expect(screen.getByRole('navigation')).toBeTruthy();
    expect(screen.getByTestId('ws-content')).toBeTruthy();
    expect(screen.getByTestId('insp-content')).toBeTruthy();
  });

  it('shows the build name and active skill in the header', () => {
    render(<AppShell {...baseProps} locale="en-US" />);

    expect(screen.getByText(baseProps.buildName)).toBeTruthy();
    expect(screen.getByText(baseProps.activeSkill)).toBeTruthy();
  });

  it('renders the localized nav labels for the active locale (en-US)', () => {
    render(<AppShell {...baseProps} locale="en-US" />);

    const nav = screen.getByRole('navigation');
    const items = nav.querySelectorAll('[role="listitem"]');
    const text = Array.from(items, (el) => el.textContent);

    for (const key of [
      'nav.overview',
      'nav.skills',
      'nav.passiveTree',
      'nav.items',
      'nav.calcs',
      'nav.config',
      'nav.importExport',
    ] as const) {
      expect(text).toContain(t('en-US', key));
    }
  });

  it('renders the localized nav labels for the active locale (ko-KR)', () => {
    render(<AppShell {...baseProps} locale="ko-KR" />);

    const nav = screen.getByRole('navigation');
    const text = Array.from(nav.querySelectorAll('[role="listitem"]'), (el) => el.textContent);

    // Korean labels differ from the English baseline, proving the active locale
    // drives the resolver rather than a hard-coded English list.
    expect(text).toContain(t('ko-KR', 'nav.overview'));
    expect(text).toContain(t('ko-KR', 'nav.passiveTree'));
    expect(text).not.toContain(t('en-US', 'nav.overview'));
  });
});

describe('LocaleToggle (controlled, DESIGN §10.2)', () => {
  it('renders both locale options with localized labels', () => {
    render(<LocaleToggle locale="ko-KR" onChange={() => {}} />);

    expect(screen.getByText(t('ko-KR', 'locale.ko')).textContent).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'locale.en')).textContent).toBeTruthy();
  });

  it('calls onChange with the other locale when toggled from ko-KR', () => {
    const onChange = vi.fn<(next: Locale) => void>();
    render(<LocaleToggle locale="ko-KR" onChange={onChange} />);

    fireEvent.click(screen.getByText(t('ko-KR', 'locale.en')));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('en-US');
  });

  it('calls onChange with the other locale when toggled from en-US', () => {
    const onChange = vi.fn<(next: Locale) => void>();
    render(<LocaleToggle locale="en-US" onChange={onChange} />);

    fireEvent.click(screen.getByText(t('en-US', 'locale.ko')));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith('ko-KR');
  });

  it('does not fire onChange when the already-active locale is clicked', () => {
    const onChange = vi.fn<(next: Locale) => void>();
    render(<LocaleToggle locale="en-US" onChange={onChange} />);

    fireEvent.click(screen.getByText(t('en-US', 'locale.en')));

    expect(onChange).not.toHaveBeenCalled();
  });
});
