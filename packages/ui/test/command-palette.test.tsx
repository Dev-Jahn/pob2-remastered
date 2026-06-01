// Command palette component test (DESIGN §11.1 Global command palette, §11.2
// Search index bilingual match, §10.1 "검색이 첫 번째 navigation" + "회피/evasion/ev"
// parity).
//
// Asserts the four behaviours the palette guarantees:
//   1. `Ctrl+K` opens the palette (a search input appears).
//   2. Typing an English query narrows the list to the matching command.
//   3. Typing that command's Korean alias narrows the list to the SAME command
//      (bilingual parity — the search index matches titleKo/titleEn/aliases).
//   4. `Enter` fires the highlighted command's handler.
//
// Commands are supplied as props (no app coupling, per the task): the suite owns a
// small set of build commands and spies on one handler.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { CommandPalette } from '../src/index.js';
import type { Command } from '../src/index.js';

afterEach(cleanup);

/** Open the palette by dispatching Ctrl+K on the document (global shortcut). */
function pressCtrlK() {
  fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
}

function makeCommands(exportRun: () => void): Command[] {
  return [
    {
      id: 'open-build',
      titleKo: '빌드 열기',
      titleEn: 'Open Build',
      aliases: ['open', '열기', 'load'],
      run: () => {},
    },
    {
      id: 'save-build',
      titleKo: '빌드 저장',
      titleEn: 'Save Build',
      aliases: ['save', '저장'],
      run: () => {},
    },
    {
      id: 'export-share-code',
      titleKo: '공유 코드 내보내기',
      titleEn: 'Export Share Code',
      // §10.1 parity: distinct Korean + abbreviated English aliases all map here.
      aliases: ['export', '내보내기', 'share', '공유'],
      run: exportRun,
    },
    {
      id: 'toggle-language',
      titleKo: '언어 전환',
      titleEn: 'Toggle Language',
      aliases: ['language', '언어', 'locale'],
      run: () => {},
    },
  ];
}

describe('CommandPalette (DESIGN §11.1 / §11.2)', () => {
  it('is closed until Ctrl+K, then opens a search box', () => {
    render(<CommandPalette commands={makeCommands(() => {})} />);

    expect(screen.queryByRole('combobox')).toBeNull();

    pressCtrlK();

    expect(screen.getByRole('combobox')).toBeTruthy();
  });

  it('filters to the matching command when an English query is typed', () => {
    render(<CommandPalette commands={makeCommands(() => {})} />);
    pressCtrlK();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'export' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].getAttribute('data-command-id')).toBe('export-share-code');
  });

  it('filters to the SAME command when its Korean alias is typed (bilingual parity)', () => {
    render(<CommandPalette commands={makeCommands(() => {})} />);
    pressCtrlK();

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '내보내기' } });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0].getAttribute('data-command-id')).toBe('export-share-code');
  });

  it('fires the highlighted command handler on Enter', () => {
    const exportRun = vi.fn();
    render(<CommandPalette commands={makeCommands(exportRun)} />);
    pressCtrlK();

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'export' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(exportRun).toHaveBeenCalledTimes(1);
  });
});
