/**
 * Command-palette search (DESIGN §11.1 Global command palette, §11.2 Search index,
 * §10.1 "회피/evasion/ev" parity).
 *
 * Pure, framework-free matching logic for the `Ctrl+K` palette. A {@link Command}
 * mirrors the searchable surface of the §11.2 `SearchDocument`: a Korean title, an
 * English title, and a flat list of bilingual `aliases`. A query matches a command
 * when, after case-folding, it appears as a substring of *any* of those tokens —
 * so the §10.1 parity case ("회피", "evasion", "ev" all resolve to one entry) holds
 * as long as those forms live in the command's title/alias set.
 *
 * The handler is invoked by the component, not here; this module only decides
 * which commands a query keeps and in what (input) order.
 */

/** A build command surfaced in the palette (DESIGN §11.1, §11.2 SearchDocument). */
export interface Command {
  /** Stable id, surfaced on the rendered option for selection/testing. */
  id: string;
  /** Korean display title (§11.2 titleKo). */
  titleKo: string;
  /** English display title (§11.2 titleEn). */
  titleEn: string;
  /**
   * Extra bilingual search tokens (§11.2 aliasesKo + aliasesEn, flattened):
   * Korean synonyms and short English forms that should resolve to this command.
   */
  aliases: string[];
  /** Handler fired when this command is chosen (DESIGN §11.1 빌드 명령). */
  run: () => void;
}

/** Case-fold for substring comparison. Korean is unaffected by `toLowerCase`. */
function fold(s: string): string {
  return s.toLowerCase();
}

/** Every searchable token for a command: both titles plus every alias. */
export function commandTokens(command: Command): string[] {
  return [command.titleKo, command.titleEn, ...command.aliases];
}

/**
 * True when `query` matches `command` — i.e. the folded query is a substring of
 * any folded token. An empty/whitespace query matches everything (the palette
 * shows the full command list before the user types).
 */
export function matchCommand(command: Command, query: string): boolean {
  const q = fold(query.trim());
  if (q === '') return true;
  return commandTokens(command).some((token) => fold(token).includes(q));
}

/** Keep the commands that match `query`, preserving their input order. */
export function filterCommands(commands: Command[], query: string): Command[] {
  return commands.filter((command) => matchCommand(command, query));
}
