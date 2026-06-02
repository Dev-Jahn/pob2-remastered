/**
 * Bilingual (ko/en) search index over the generated dictionary (DESIGN §8.1, §11.2).
 *
 * §8.1 demands that a user crossing between an English build guide and the Korean
 * client never loses a term: the English alias is never dropped, and a lookup must
 * resolve from EITHER language. The worked example — '회피', 'evasion', 'ev', '회피도'
 * all hit the same Evasion doc — is exactly what {@link search} guarantees here.
 *
 * The production §11.2 recommendation is Rust-host SQLite FTS5 with only query results
 * crossing to the frontend; this module is the in-process index the dictionary build
 * and tests resolve against. It projects each §8.3 `LocalizedTerm` onto the §11.2
 * {@link SearchDocument} shape, then folds every searchable token (Korean title,
 * English title, and ALL aliases of both languages) into a token → documents map so a
 * lookup is an O(1) normalized-key hit — well inside the §16.3 search budget.
 *
 * NO-FALLBACK (DESIGN §8.1, golden rule 3): an unknown query returns EMPTY. The index
 * never fabricates a "closest" hit — a term the dictionary does not carry is simply not
 * found, exactly as the §8.1 gate requires.
 */
import type { Dictionary } from './dictionary.js';
import type { LocalizedTerm } from './term.js';

/**
 * One search index document (DESIGN §11.2). A flattened, search-oriented projection of a
 * §8.3 LocalizedTerm: the canonical bilingual titles plus every alias the term is
 * reachable by, and the domain carried through as both a field and a search tag.
 * `payloadRef` points back to the dictionary id so a resolved hit can load its full term.
 */
export interface SearchDocument {
  /** Stable term id (matches the dictionary key). */
  id: string;
  /** Localization domain (keyword / item / skill / passive / …). */
  domain: string;
  /** Korean canonical title (DESIGN §8.1: 인게임 한국어 우선). */
  titleKo: string;
  /** English canonical title — the §8.1 secondary label / search token, never dropped. */
  titleEn: string;
  /** Korean search aliases. */
  aliasesKo: string[];
  /** English search aliases. */
  aliasesEn: string[];
  /** Search tags (currently the domain), for faceting/filtering. */
  tags: string[];
  /** Back-reference to the dictionary entry this doc was built from (DESIGN §11.2). */
  payloadRef: string;
}

/**
 * A built bilingual search index: the §11.2 documents plus a normalized token → document
 * lookup. `byToken` is the resolution path {@link search} reads; `documents` is the
 * materialized §11.2 projection (one per dictionary entry), exposed for inspection.
 */
export interface SearchIndex {
  /** Every §11.2 SearchDocument, one per dictionary entry. */
  documents: SearchDocument[];
  /** Normalized search token → the documents reachable by it (a token may be shared). */
  byToken: Map<string, SearchDocument[]>;
}

/**
 * Normalize a title/alias/query into a comparison token: trim, collapse internal
 * whitespace, and lowercase. Korean has no case, so lowercasing is a no-op there; the
 * trim/collapse keeps the ko and en paths uniform so 'EVASION', ' Evasion ', and
 * 'evasion' all resolve to the same key (DESIGN §8.1 ko/en parallel search). An empty
 * or whitespace-only value yields '' — never a token, so a blank query never matches.
 */
function normToken(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Project one §8.3 LocalizedTerm onto its §11.2 SearchDocument. */
function toDocument(term: LocalizedTerm): SearchDocument {
  return {
    id: term.id,
    domain: term.domain,
    titleKo: term.ko,
    titleEn: term.canonicalEn,
    aliasesKo: [...term.aliasesKo],
    aliasesEn: [...term.aliasesEn],
    tags: [term.domain],
    payloadRef: term.id,
  };
}

/**
 * Build a bilingual search index over the generated dictionary (DESIGN §11.2).
 *
 * Projects each term to a §11.2 SearchDocument, then indexes every searchable token —
 * Korean title, English title, and ALL aliases of both languages — under its normalized
 * key so {@link search} resolves a term from either language or any alias. A token shared
 * by several terms maps to all of them (deduplicated per token). Pure over `dict`.
 */
export function buildSearchIndex(dict: Dictionary): SearchIndex {
  const documents: SearchDocument[] = [];
  const byToken = new Map<string, SearchDocument[]>();

  const add = (token: string, doc: SearchDocument): void => {
    const key = normToken(token);
    if (key === '') return;
    let bucket = byToken.get(key);
    if (bucket === undefined) {
      bucket = [];
      byToken.set(key, bucket);
    }
    if (!bucket.includes(doc)) bucket.push(doc);
  };

  for (const term of Object.values(dict)) {
    const doc = toDocument(term);
    documents.push(doc);
    for (const token of [doc.titleKo, doc.titleEn, ...doc.aliasesKo, ...doc.aliasesEn]) {
      add(token, doc);
    }
  }

  return { documents, byToken };
}

/**
 * Resolve a query against the index (DESIGN §8.1 ko/en bilingual lookup).
 *
 * The query is normalized the same way the indexed tokens were, then matched as a whole
 * token, so a Korean term, its English equivalent, an abbreviation alias, or a Korean
 * alias all resolve to the same canonical document(s). NO-FALLBACK: an unknown or blank
 * query returns an EMPTY array — the index never invents a nearest hit (§8.1).
 */
export function search(index: SearchIndex, query: string): SearchDocument[] {
  const key = normToken(query);
  if (key === '') return [];
  return index.byToken.get(key) ?? [];
}
