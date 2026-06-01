/**
 * CommandPalette — the `Ctrl+K` global command palette (DESIGN §11.1, §10.1
 * "검색이 첫 번째 navigation이다").
 *
 * Opens on `Ctrl+K` (a document-level shortcut), shows a search `combobox` over the
 * build commands passed in via `commands`, and filters them bilingually through
 * {@link filterCommands} so a Korean alias and its English form resolve to the same
 * command (§11.2, §10.1 parity). Arrow keys move the highlight, `Enter` runs the
 * highlighted command's handler, and `Escape` closes the palette.
 *
 * Commands are pure props with their own `run` handler — the palette has no
 * application coupling (it never imports build/app state). Open state is owned
 * internally so a host only needs to render the component once and supply commands.
 */
import { useEffect, useMemo, useState } from 'react';
import { filterCommands } from './search.js';
import type { Command } from './search.js';

export interface CommandPaletteProps {
  /** Build commands to list and search (DESIGN §11.1 빌드 명령). */
  commands: Command[];
}

export function CommandPalette({ commands }: CommandPaletteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);

  // Global Ctrl+K opens the palette (DESIGN §11.1). Bound for the component's
  // lifetime; reset query + highlight on each open so it starts clean.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setQuery('');
        setHighlight(0);
        setOpen(true);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const results = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Keep the highlight inside the (shrinking/growing) result list.
  const activeIndex = results.length === 0 ? -1 : Math.min(highlight, results.length - 1);

  if (!open) return null;

  function close() {
    setOpen(false);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      const command = results[activeIndex];
      if (command) {
        command.run();
        close();
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((h) => (results.length === 0 ? 0 : (h + 1) % results.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((h) => (results.length === 0 ? 0 : (h - 1 + results.length) % results.length));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  }

  return (
    <div className="pob-command-palette" role="dialog" aria-modal="true">
      <input
        className="pob-command-palette__input"
        role="combobox"
        aria-expanded="true"
        aria-controls="pob-command-palette-list"
        aria-autocomplete="list"
        autoFocus
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlight(0);
        }}
        onKeyDown={onInputKeyDown}
      />
      <ul className="pob-command-palette__list" id="pob-command-palette-list" role="listbox">
        {results.map((command, index) => (
          <li
            key={command.id}
            className="pob-command-palette__option"
            role="option"
            data-command-id={command.id}
            aria-selected={index === activeIndex}
            onClick={() => {
              command.run();
              close();
            }}
          >
            {command.titleKo} {command.titleEn}
          </li>
        ))}
      </ul>
    </div>
  );
}
