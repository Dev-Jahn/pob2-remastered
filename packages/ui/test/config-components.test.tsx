// Config tab component test (DESIGN §10.8 Config tab; §10.1.6 수정 가능한 값 vs
// 계산 결과 구분; §8.1 ko/en alias; §6.4 NO-FALLBACK).
//
// These are the React components that render the §10.8 Config view-model
// (p4-config-vm):
//
//   - ConfigPanel     — the §10.8 2-region layout (scenario preset selector |
//     typed option list). Owns the selected-preset state: choosing a preset routes
//     its `{ optionId, value }[]` reduction up via `onApplyPreset` so the host can
//     send it through config.setOption.
//   - ConfigOptionRow — one §10.8 config option: its localized label, the typed
//     input control by kind (check → checkbox; count → number; list → text), the
//     immediate "변경 시 영향을 받는 계산 항목" list, and — per §10.1.6 — a clear
//     visual split between the editable control and the read-only calc results it
//     affects. An `unsupported` control type shows an icon AND a text label, never
//     a fabricated default (§6.4, §11.3).
//
// The fixtures mirror the §10.8 example: a check option (enemy shocked), a count
// option (power charges, real 0), a list option (enemy curse), plus a mystery
// option whose control type is unknown → its row must render `unsupported` with an
// icon + text label rather than a fabricated `check` default.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import type { ConfigOptionCard, ConfigGetOptionsResponse } from '@pob2/schema';
import { buildConfigModel, ConfigPanel, ConfigOptionRow, t } from '../src/index.js';
import type { ConfigOptionInput, ConfigViewModel, StatImpactMap } from '../src/index.js';

afterEach(cleanup);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SHOCKED: ConfigOptionCard = {
  optionId: 'conditionShockedEnemy',
  type: 'check',
  label: '적이 감전됨',
  value: false,
  dependentModifiers: ['EnemyModifier'],
};

const POWER_CHARGES: ConfigOptionCard = {
  optionId: 'usePowerCharges',
  type: 'count',
  label: '강화 충전 수',
  value: 0,
  dependentModifiers: ['PowerCharge'],
};

const ENEMY_CURSE: ConfigOptionCard = {
  optionId: 'conditionEnemyCursed',
  type: 'list',
  label: '적에게 걸린 저주',
  value: 'none',
  dependentModifiers: ['CurseEffect'],
};

// An option whose control `type` is not a known kind → an `unsupported` row.
const MYSTERY: ConfigOptionCard = {
  optionId: 'mysteryOption',
  type: 'colorpicker',
  label: '알 수 없는 옵션',
  value: '#fff',
  dependentModifiers: [],
};

const RESPONSE: ConfigGetOptionsResponse = {
  options: [SHOCKED, POWER_CHARGES, ENEMY_CURSE, MYSTERY],
};

const IMPACT: StatImpactMap = {
  conditionShockedEnemy: ['TotalDPS', 'AverageHit'],
  usePowerCharges: ['CritChance', 'TotalDPS'],
  conditionEnemyCursed: ['TotalDPS'],
  // 'mysteryOption' intentionally absent → no affected stats.
};

const MODEL: ConfigViewModel = buildConfigModel(RESPONSE, IMPACT);

const byId = (id: string): ConfigOptionInput => MODEL.inputs.find((i) => i.optionId === id)!;

const CHECK_INPUT = byId('conditionShockedEnemy');
const COUNT_INPUT = byId('usePowerCharges');
const LIST_INPUT = byId('conditionEnemyCursed');
const UNSUPPORTED_INPUT = byId('mysteryOption');

// ---------------------------------------------------------------------------
// ConfigOptionRow (DESIGN §10.8 typed option input + §10.1.6 value/result split)
// ---------------------------------------------------------------------------

describe('ConfigOptionRow (DESIGN §10.8 typed option input)', () => {
  it('renders the option label and the option id as a data attribute', () => {
    const { container } = render(<ConfigOptionRow locale="ko-KR" input={CHECK_INPUT} />);
    expect(screen.getByText('적이 감전됨')).toBeTruthy();
    expect(container.querySelector('[data-option-id="conditionShockedEnemy"]')).toBeTruthy();
  });

  it('renders a check option as a checkbox reflecting its boolean value', () => {
    const { container } = render(<ConfigOptionRow locale="ko-KR" input={CHECK_INPUT} />);
    const row = container.querySelector('[data-option-row]') as HTMLElement;
    expect(row.getAttribute('data-kind')).toBe('check');
    const control = row.querySelector('[data-option-control]') as HTMLInputElement;
    expect(control.type).toBe('checkbox');
    expect(control.checked).toBe(false);
  });

  it('renders a count option as a number input preserving a real 0 (NO-FALLBACK)', () => {
    const { container } = render(<ConfigOptionRow locale="ko-KR" input={COUNT_INPUT} />);
    const row = container.querySelector('[data-option-row]') as HTMLElement;
    expect(row.getAttribute('data-kind')).toBe('count');
    const control = row.querySelector('[data-option-control]') as HTMLInputElement;
    expect(control.type).toBe('number');
    expect(control.value).toBe('0');
  });

  it('renders a list option as a control bound to its string value', () => {
    const { container } = render(<ConfigOptionRow locale="ko-KR" input={LIST_INPUT} />);
    const row = container.querySelector('[data-option-row]') as HTMLElement;
    expect(row.getAttribute('data-kind')).toBe('list');
    const control = row.querySelector('[data-option-control]') as HTMLInputElement;
    expect(control.value).toBe('none');
  });

  it('marks an unsupported control with an icon AND a text label — never color-only (§11.3)', () => {
    const { container } = render(<ConfigOptionRow locale="ko-KR" input={UNSUPPORTED_INPUT} />);
    const row = container.querySelector('[data-option-row]') as HTMLElement;
    expect(row.getAttribute('data-kind')).toBe('unsupported');
    const icon = row.querySelector('[data-unsupported-icon]') as HTMLElement;
    expect(icon).toBeTruthy();
    expect(icon.textContent?.trim().length).toBeGreaterThan(0);
    expect(within(row).getByText(t('ko-KR', 'config.unsupported'))).toBeTruthy();
  });

  it('shows the calc items affected by the change immediately (§10.8)', () => {
    const { container } = render(<ConfigOptionRow locale="ko-KR" input={CHECK_INPUT} />);
    const affected = container.querySelector('[data-affected-stats]') as HTMLElement;
    expect(affected).toBeTruthy();
    expect(affected.textContent).toContain('TotalDPS');
    expect(affected.textContent).toContain('AverageHit');
  });

  it('renders no affected-stats list when the option affects nothing (NO-FALLBACK)', () => {
    const { container } = render(<ConfigOptionRow locale="ko-KR" input={UNSUPPORTED_INPUT} />);
    expect(container.querySelector('[data-affected-stats]')).toBeFalsy();
  });

  it('separates the editable control from the read-only affected results (§10.1.6)', () => {
    const { container } = render(<ConfigOptionRow locale="ko-KR" input={CHECK_INPUT} />);
    // The editable region carries the control; the result region carries the
    // affected calc stats — the two are distinct, machine-checkable regions.
    const editable = container.querySelector('[data-editable]') as HTMLElement;
    const results = container.querySelector('[data-affected-stats]') as HTMLElement;
    expect(editable).toBeTruthy();
    expect(results).toBeTruthy();
    expect(editable.querySelector('[data-option-control]')).toBeTruthy();
    // The control is NOT inside the read-only results region.
    expect(results.querySelector('[data-option-control]')).toBeFalsy();
  });

  it('fires onChangeOption with the option id and the new boolean for a check toggle', () => {
    const onChangeOption = vi.fn();
    const { container } = render(
      <ConfigOptionRow locale="ko-KR" input={CHECK_INPUT} onChangeOption={onChangeOption} />,
    );
    fireEvent.click(container.querySelector('[data-option-control]') as HTMLElement);
    expect(onChangeOption).toHaveBeenCalledWith('conditionShockedEnemy', true);
  });

  it('fires onChangeOption with the option id and the parsed number for a count input', () => {
    const onChangeOption = vi.fn();
    const { container } = render(
      <ConfigOptionRow locale="ko-KR" input={COUNT_INPUT} onChangeOption={onChangeOption} />,
    );
    fireEvent.change(container.querySelector('[data-option-control]') as HTMLElement, {
      target: { value: '3' },
    });
    expect(onChangeOption).toHaveBeenCalledWith('usePowerCharges', 3);
  });

  it('fires onChangeOption with the option id and the new string for a list input', () => {
    const onChangeOption = vi.fn();
    const { container } = render(
      <ConfigOptionRow locale="ko-KR" input={LIST_INPUT} onChangeOption={onChangeOption} />,
    );
    fireEvent.change(container.querySelector('[data-option-control]') as HTMLElement, {
      target: { value: 'temporalChains' },
    });
    expect(onChangeOption).toHaveBeenCalledWith('conditionEnemyCursed', 'temporalChains');
  });

  it('does not fire onChangeOption for an unsupported row (no editable control)', () => {
    const onChangeOption = vi.fn();
    const { container } = render(
      <ConfigOptionRow locale="ko-KR" input={UNSUPPORTED_INPUT} onChangeOption={onChangeOption} />,
    );
    expect(container.querySelector('[data-option-control]')).toBeFalsy();
    expect(onChangeOption).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// ConfigPanel (DESIGN §10.8 2-region layout: presets | options)
// ---------------------------------------------------------------------------

describe('ConfigPanel (DESIGN §10.8 2-region layout)', () => {
  const props = {
    locale: 'ko-KR' as const,
    model: MODEL,
  };

  it('renders both regions: the scenario-preset selector and the option list', () => {
    const { container } = render(<ConfigPanel {...props} />);
    expect(container.querySelector('[data-region="presets"]')).toBeTruthy();
    expect(container.querySelector('[data-region="options"]')).toBeTruthy();
  });

  it('renders the localized region headings (§8.1)', () => {
    render(<ConfigPanel {...props} />);
    expect(screen.getByText(t('ko-KR', 'config.presets'))).toBeTruthy();
    expect(screen.getByText(t('ko-KR', 'config.options'))).toBeTruthy();
  });

  it('renders one scenario-preset control per §10.8 preset in canonical order', () => {
    const { container } = render(<ConfigPanel {...props} />);
    const presets = container.querySelector('[data-region="presets"]') as HTMLElement;
    const buttons = presets.querySelectorAll('[data-preset-id]');
    expect(Array.from(buttons).map((b) => b.getAttribute('data-preset-id'))).toEqual([
      'generalMapping',
      'bossing',
      'fullCharges',
      'shockedEnemy',
      'cursedEnemy',
      'lowLife',
      'custom',
    ]);
  });

  it('renders one option row per option in model order', () => {
    const { container } = render(<ConfigPanel {...props} />);
    const options = container.querySelector('[data-region="options"]') as HTMLElement;
    const rows = options.querySelectorAll('[data-option-row]');
    expect(Array.from(rows).map((r) => r.getAttribute('data-option-id'))).toEqual([
      'conditionShockedEnemy',
      'usePowerCharges',
      'conditionEnemyCursed',
      'mysteryOption',
    ]);
  });

  it('applies a preset: fires onApplyPreset with its reduced { optionId, value }[] payload (§10.8)', () => {
    const onApplyPreset = vi.fn();
    const { container } = render(<ConfigPanel {...props} onApplyPreset={onApplyPreset} />);
    const bossing = container.querySelector('[data-preset-id="bossing"]') as HTMLElement;
    fireEvent.click(bossing);
    expect(onApplyPreset).toHaveBeenCalledWith('bossing', [
      { optionId: 'enemyIsBoss', value: true },
    ]);
  });

  it('marks the chosen preset selected after it is applied', () => {
    const { container } = render(<ConfigPanel {...props} />);
    const bossing = container.querySelector('[data-preset-id="bossing"]') as HTMLElement;
    fireEvent.click(bossing);
    expect(bossing.getAttribute('data-selected')).toBe('true');
  });

  it('routes an option change up through onChangeOption with the option id and value', () => {
    const onChangeOption = vi.fn();
    const { container } = render(<ConfigPanel {...props} onChangeOption={onChangeOption} />);
    const options = container.querySelector('[data-region="options"]') as HTMLElement;
    const shockedRow = options.querySelector(
      '[data-option-id="conditionShockedEnemy"]',
    ) as HTMLElement;
    fireEvent.click(shockedRow.querySelector('[data-option-control]') as HTMLElement);
    expect(onChangeOption).toHaveBeenCalledWith('conditionShockedEnemy', true);
  });

  it('shows the affected calc items for each option immediately (§10.8)', () => {
    const { container } = render(<ConfigPanel {...props} />);
    const options = container.querySelector('[data-region="options"]') as HTMLElement;
    const countRow = options.querySelector('[data-option-id="usePowerCharges"]') as HTMLElement;
    const affected = countRow.querySelector('[data-affected-stats]') as HTMLElement;
    expect(affected.textContent).toContain('CritChance');
    expect(affected.textContent).toContain('TotalDPS');
  });
});
