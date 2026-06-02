// Skills tab component test (DESIGN §10.5 Skills tab; §11.3 unsupported gem
// accessibility; §8.1 ko/en alias; §6.4 NO-FALLBACK).
//
// These are the React components that render the §10.5 Skills view-models:
//
//   - SkillsPanel    — the §10.5 2-region layout (skill-group card list | main-skill
//     inspector). Owns the selected main-skill state: selecting a card routes its
//     active skill into the inspector (damage breakdown / support gem contribution /
//     gem level·quality delta).
//   - SkillGroupCard — one §10.5 card: the group `enabled` toggle, the immediate
//     spirit / reservation values, and the classified gem chips (active / support /
//     buff / aura / minion). A support gem carries its own enabled toggle. An
//     `unsupported` chip shows an icon AND a text label, never color-only (§11.3).
//   - GemRow         — one classified gem chip: its category chip (data attribute,
//     never color-only) + level/quality + enabled toggle.
//
// The fixtures mirror the §10.5 example: a Fireball group (active gem + a support
// gem) and a Determination aura group reserving spirit, plus a mystery active gem
// absent from the category metadata, so its chip must render `unsupported` with
// the icon + text label (§11.3) rather than a fabricated `active` default (§6.4).
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import type { SkillGroupCard as SkillGroupCardRef, SkillsGetGroupsResponse } from '@pob2/schema';
import { buildSkillGroupsModel, SkillsPanel, SkillGroupCard, GemRow, t } from '../src/index.js';
import type {
  GemCategoryMeta,
  SkillGroupCardModel,
  SkillGemChip,
  SkillInspectorModel,
} from '../src/index.js';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MAIN_GROUP: SkillGroupCardRef = {
  groupId: 'group-1',
  label: 'Fireball',
  enabled: true,
  spirit: 0,
  reservation: 0,
  activeGems: [{ gemId: 'gem-fireball', name: 'Fireball', level: 20, quality: 23, enabled: true }],
  supportGems: [
    { gemId: 'gem-added-fire', name: 'Added Fire Damage', level: 20, quality: 0, enabled: true },
  ],
};

const AURA_GROUP: SkillGroupCardRef = {
  groupId: 'group-2',
  label: 'Determination',
  enabled: false,
  spirit: 50,
  reservation: 0,
  activeGems: [
    { gemId: 'gem-determination', name: 'Determination', level: 10, quality: 0, enabled: false },
  ],
  supportGems: [],
};

// A group whose active gem is absent from the metadata → unsupported chip (§6.4).
const MYSTERY_GROUP: SkillGroupCardRef = {
  groupId: 'group-3',
  label: 'Mystery',
  enabled: true,
  spirit: 0,
  reservation: 0,
  activeGems: [
    { gemId: 'gem-mystery', name: 'Mystery Skill', level: 1, quality: 0, enabled: true },
  ],
  supportGems: [],
};

const GEM_META: GemCategoryMeta = {
  'gem-fireball': 'active',
  'gem-determination': 'aura',
  // 'gem-mystery' intentionally absent → unsupported.
};

const RESPONSE: SkillsGetGroupsResponse = {
  groups: [MAIN_GROUP, AURA_GROUP, MYSTERY_GROUP],
};

const MODEL = buildSkillGroupsModel(RESPONSE, GEM_META);
const MAIN_CARD: SkillGroupCardModel = MODEL.cards[0];
const AURA_CARD: SkillGroupCardModel = MODEL.cards[1];
const MYSTERY_CARD: SkillGroupCardModel = MODEL.cards[2];

// A §10.5 main-skill inspector model: damage breakdown + support gem contribution
// + gem level/quality delta. Supplied by the host (no app/IO coupling), like the
// items inspector.
const INSPECTOR: SkillInspectorModel = {
  groupId: 'group-1',
  skillName: 'Fireball',
  damageBreakdown: [
    { label: 'Total DPS', value: '124,500' },
    { label: 'Hit Damage', value: '8,300' },
  ],
  supportContributions: [
    { gemId: 'gem-added-fire', name: 'Added Fire Damage', contribution: '+18.4% DPS' },
  ],
  gemDeltas: [
    {
      gemId: 'gem-fireball',
      name: 'Fireball',
      level: 20,
      quality: 23,
      levelDelta: 1,
      qualityDelta: 3,
    },
  ],
};

// ---------------------------------------------------------------------------
// GemRow (DESIGN §10.5 gem chip)
// ---------------------------------------------------------------------------

describe('GemRow (DESIGN §10.5 gem chip)', () => {
  const fireballChip: SkillGemChip = MAIN_CARD.chips.find((c) => c.gemId === 'gem-fireball')!;
  const supportChip: SkillGemChip = MAIN_CARD.chips.find((c) => c.gemId === 'gem-added-fire')!;
  const mysteryChip: SkillGemChip = MYSTERY_CARD.chips[0];

  it('renders the gem name and its category as a data attribute (never color-only)', () => {
    const { container } = render(<GemRow locale="ko-KR" chip={fireballChip} />);
    expect(screen.getByText('Fireball')).toBeTruthy();
    expect(container.querySelector('[data-category="active"]')).toBeTruthy();
  });

  it('shows the gem level and quality verbatim (NO-FALLBACK: real values)', () => {
    const { container } = render(<GemRow locale="ko-KR" chip={fireballChip} />);
    const row = container.querySelector('[data-gem-row]') as HTMLElement;
    expect(row.textContent).toContain('20');
    expect(row.textContent).toContain('23');
  });

  it('renders the localized category-chip label for a support gem', () => {
    render(<GemRow locale="ko-KR" chip={supportChip} />);
    expect(screen.getByText(t('ko-KR', 'skills.category.support'))).toBeTruthy();
  });

  it('marks an unsupported gem with an icon AND a text label — never color-only (§11.3)', () => {
    const { container } = render(<GemRow locale="ko-KR" chip={mysteryChip} />);
    const row = container.querySelector('[data-category="unsupported"]') as HTMLElement;
    expect(row).toBeTruthy();
    const icon = row.querySelector('[data-category-icon]');
    expect(icon).toBeTruthy();
    expect((icon as HTMLElement).textContent?.trim().length).toBeGreaterThan(0);
    expect(within(row).getByText(t('ko-KR', 'skills.category.unsupported'))).toBeTruthy();
  });

  it('fires onToggleGem with the gem id when its enabled toggle is pressed', () => {
    const onToggleGem = vi.fn();
    const { container } = render(
      <GemRow locale="ko-KR" chip={supportChip} onToggleGem={onToggleGem} />,
    );
    fireEvent.click(container.querySelector('[data-gem-toggle]') as HTMLElement);
    expect(onToggleGem).toHaveBeenCalledWith('gem-added-fire');
  });

  it('reflects the gem enabled state on the toggle control', () => {
    const disabled: SkillGemChip = { ...supportChip, enabled: false };
    const { container } = render(<GemRow locale="ko-KR" chip={disabled} />);
    const toggle = container.querySelector('[data-gem-toggle]') as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// SkillGroupCard (DESIGN §10.5 skill group card)
// ---------------------------------------------------------------------------

describe('SkillGroupCard (DESIGN §10.5 skill group card)', () => {
  it('renders the group-enable toggle only when wired — reflecting state and firing onToggleGroup', () => {
    const onToggleGroup = vi.fn();
    const { container, rerender } = render(
      <SkillGroupCard locale="ko-KR" card={MAIN_CARD} onToggleGroup={onToggleGroup} />,
    );
    // The group label rides the selectable head control (the active gem of the same
    // name renders separately as a gem chip).
    const select = container.querySelector('[data-skill-group-select]') as HTMLElement;
    expect(select.textContent).toBe('Fireball');
    const groupToggle = container.querySelector('[data-group-toggle]') as HTMLInputElement;
    expect(groupToggle.checked).toBe(true); // reflects card.enabled
    fireEvent.click(groupToggle);
    expect(onToggleGroup).toHaveBeenCalledTimes(1);
    // Without a handler, the dead group-enable toggle is not rendered (review follow-up).
    rerender(<SkillGroupCard locale="ko-KR" card={MAIN_CARD} />);
    expect(container.querySelector('[data-group-toggle]')).toBeNull();
  });

  it('shows the reservation and spirit cost immediately (DESIGN §10.5)', () => {
    const { container } = render(<SkillGroupCard locale="ko-KR" card={AURA_CARD} />);
    const card = container.querySelector('[data-skill-group]') as HTMLElement;
    // Spirit 50 is surfaced with its localized label.
    expect(within(card).getByText(t('ko-KR', 'skills.spirit'))).toBeTruthy();
    expect(card.textContent).toContain('50');
    expect(within(card).getByText(t('ko-KR', 'skills.reservation'))).toBeTruthy();
  });

  it('renders one gem chip per gem, active before support, with their categories', () => {
    const { container } = render(<SkillGroupCard locale="ko-KR" card={MAIN_CARD} />);
    const rows = container.querySelectorAll('[data-gem-row]');
    expect(rows).toHaveLength(2);
    const cats = Array.from(rows).map((r) => r.getAttribute('data-category'));
    expect(cats).toEqual(['active', 'support']);
  });

  it('fires onToggleGroup with the group id when the group toggle is pressed', () => {
    const onToggleGroup = vi.fn();
    const { container } = render(
      <SkillGroupCard locale="ko-KR" card={MAIN_CARD} onToggleGroup={onToggleGroup} />,
    );
    fireEvent.click(container.querySelector('[data-group-toggle]') as HTMLElement);
    expect(onToggleGroup).toHaveBeenCalledWith('group-1');
  });

  it('routes a support gem toggle up through onToggleGem with the gem id', () => {
    const onToggleGem = vi.fn();
    const { container } = render(
      <SkillGroupCard locale="ko-KR" card={MAIN_CARD} onToggleGem={onToggleGem} />,
    );
    const supportRow = container.querySelector('[data-category="support"]') as HTMLElement;
    fireEvent.click(supportRow.querySelector('[data-gem-toggle]') as HTMLElement);
    expect(onToggleGem).toHaveBeenCalledWith('group-1', 'gem-added-fire');
  });

  it('fires onSelectGroup with the group id when the card is selected', () => {
    const onSelectGroup = vi.fn();
    const { container } = render(
      <SkillGroupCard locale="ko-KR" card={MAIN_CARD} onSelectGroup={onSelectGroup} />,
    );
    fireEvent.click(container.querySelector('[data-skill-group-select]') as HTMLElement);
    expect(onSelectGroup).toHaveBeenCalledWith('group-1');
  });

  it('marks the card selected when it is the active main skill', () => {
    const { container } = render(<SkillGroupCard locale="ko-KR" card={MAIN_CARD} selected />);
    const card = container.querySelector('[data-skill-group]') as HTMLElement;
    expect(card.getAttribute('data-selected')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// SkillsPanel (DESIGN §10.5 2-region layout)
// ---------------------------------------------------------------------------

describe('SkillsPanel (DESIGN §10.5 2-region layout)', () => {
  const props = {
    locale: 'ko-KR' as const,
    model: MODEL,
    gemMeta: GEM_META,
  };

  it('renders both regions: the skill-group list and the inspector', () => {
    const { container } = render(<SkillsPanel {...props} />);
    expect(container.querySelector('[data-region="groups"]')).toBeTruthy();
    expect(container.querySelector('[data-region="inspector"]')).toBeTruthy();
  });

  it('renders the localized region headings (§8.1)', () => {
    render(<SkillsPanel {...props} />);
    expect(screen.getByText(t('ko-KR', 'skills.groups'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'skills.inspector'))).toBeTruthy();
  });

  it('renders one skill-group card per group in model order', () => {
    const { container } = render(<SkillsPanel {...props} />);
    const groups = container.querySelector('[data-region="groups"]') as HTMLElement;
    const cards = groups.querySelectorAll('[data-skill-group]');
    expect(cards).toHaveLength(3);
  });

  it('shows the inspector empty state until a main skill is selected', () => {
    const { container } = render(<SkillsPanel {...props} />);
    const inspector = container.querySelector('[data-region="inspector"]') as HTMLElement;
    expect(inspector.querySelector('[data-inspector-empty]')).toBeTruthy();
  });

  it('selecting a card shows its damage breakdown in the inspector (§10.5)', () => {
    const onSelectGroup = vi.fn();
    const { container } = render(
      <SkillsPanel {...props} inspector={INSPECTOR} onSelectGroup={onSelectGroup} />,
    );
    const groups = container.querySelector('[data-region="groups"]') as HTMLElement;
    fireEvent.click(groups.querySelector('[data-skill-group-select]') as HTMLElement);
    expect(onSelectGroup).toHaveBeenCalledWith('group-1');

    const inspector = container.querySelector('[data-region="inspector"]') as HTMLElement;
    // Damage breakdown rows.
    expect(within(inspector).getByText('Total DPS')).toBeTruthy();
    expect(within(inspector).getByText('124,500')).toBeTruthy();
  });

  it('shows support gem contribution and gem level·quality delta in the inspector (§10.5)', () => {
    const { container } = render(<SkillsPanel {...props} inspector={INSPECTOR} />);
    const inspector = container.querySelector('[data-region="inspector"]') as HTMLElement;
    // Support gem contribution.
    expect(
      within(inspector).getByText(t('ko-KR', 'skills.inspector.supportContribution')),
    ).toBeTruthy();
    expect(within(inspector).getByText('+18.4% DPS')).toBeTruthy();
    // Gem level/quality delta.
    expect(within(inspector).getByText(t('ko-KR', 'skills.inspector.gemDelta'))).toBeTruthy();
    const deltaRow = inspector.querySelector('[data-gem-delta="gem-fireball"]') as HTMLElement;
    expect(deltaRow).toBeTruthy();
    expect(deltaRow.textContent).toContain('20');
    expect(deltaRow.textContent).toContain('23');
  });
});
