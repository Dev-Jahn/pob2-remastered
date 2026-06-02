import { describe, it, expect } from 'vitest';
// The live collector is a Node script; its pure parser/pairing functions are unit-tested here
// against the real PoE2DB card structure (verified against live kr/us Keywords pages).
import {
  parsePoe2dbCards,
  parseFigureCards,
  parseUniqueCards,
  pairCards,
} from '../scripts/collect-live.mjs';

const card = (slug: string, name: string, desc: string, icon = '') =>
  `<div class="d-flex border-top rounded"><div class="flex-shrink-0">${icon}</div>` +
  `<div class="flex-grow-1 ms-2"><a href="${slug}" class="strong fontinSmallCaps">${name}</a>` +
  `<div class="fontinRegular">${desc}</div></div></div>`;

describe('parsePoe2dbCards', () => {
  it('extracts slug/name/desc and resolves the icon URL from real-structure cards', () => {
    const html =
      card(
        'Evasion',
        '회피',
        '회피는 <a href="x">명중</a>을 회피합니다.',
        '<img loading="lazy" src="/image/keyword/Evasion.webp">',
      ) + card('Physical_Damage', '물리 피해', '물리 피해는 다섯 가지 피해 유형 중 하나입니다.');
    const cards = parsePoe2dbCards(html);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ slug: 'Evasion', name: '회피' });
    expect(cards[0].desc).toContain('명중'); // inner <a> stripped, text kept
    expect(cards[0].desc).not.toContain('<a'); // tags removed
    expect(cards[0].iconUrl).toBe('https://cdn.poe2db.tw/image/keyword/Evasion.webp');
    expect(cards[1].iconUrl).toBeUndefined(); // no <img> → no icon
  });

  it('returns [] for HTML without keyword cards (so the collector can fail loud on 0)', () => {
    expect(parsePoe2dbCards('<html><body>no cards here</body></html>')).toEqual([]);
  });

  it('dedupes by slug, keeping the first occurrence (the Keywords page repeats some entries)', () => {
    // The real /us/Keywords page lists a few keywords twice (e.g. Enraged) in different sections;
    // without dedup these become duplicate `keyword.<slug>` ids whose merge order is arbitrary.
    const html =
      card('Enraged', '격앙', 'primary section text') +
      card('Enraged', '격앙됨', 'cross-reference section text');
    const cards = parsePoe2dbCards(html);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ slug: 'Enraged', name: '격앙' }); // first kept
  });
});

describe('parseFigureCards (gem grid)', () => {
  const fig = (slug: string, name: string, icon: string) =>
    `<figure class="text-center mb-0"><a href="${slug}">` +
    `<img class="size64" loading="lazy" src="${icon}"></a>` +
    `<figcaption><a class="gem_blue" href="/us/${slug}">${name}</a></figcaption></figure>`;

  it('extracts slug/name/icon from gem figures, deduped by slug, resolving relative icon URLs', () => {
    const html =
      fig('Enfeeble', '쇠약', 'https://cdn.poe2db.tw/image/Art/2DArt/SkillIcons/4K/enfeeble.webp') +
      fig('Enfeeble', '쇠약', 'https://cdn.poe2db.tw/dup.webp') + // duplicate slug
      fig('Despair', '절망', '/image/x.webp'); // relative
    const cards = parseFigureCards(html);
    expect(cards).toHaveLength(2); // deduped by slug
    expect(cards[0]).toMatchObject({
      slug: 'Enfeeble',
      name: '쇠약',
      iconUrl: 'https://cdn.poe2db.tw/image/Art/2DArt/SkillIcons/4K/enfeeble.webp',
    });
    expect(cards[1].iconUrl).toBe('https://cdn.poe2db.tw/image/x.webp'); // relative → absolute
  });
});

describe('parseUniqueCards (unique-item list)', () => {
  // Real PoE2DB /us/Unique_item card: an image-anchor (slug + icon) followed by a name-anchor
  // carrying <span class="uniqueName"> and <span class="uniqueTypeLine"> (the base type).
  const uniq = (slug: string, name: string, typeLine: string, icon: string) =>
    `<div class="flex-shrink-0"><a class="UniqueItems UniqueItem" data-hover="h" href="${slug}">` +
    `<img loading="lazy" src="${icon}" alt="x" class="w2" /></a></div>` +
    `<div class="flex-grow-1 ms-2"><div><a class="UniqueItem" data-hover="h" href="/us/${slug}">` +
    `<span class="uniqueName">${name}</span> <span class="uniqueTypeLine">${typeLine}</span></a></div></div>`;

  it('extracts slug/name/base-typeLine and resolves the icon URL from real unique cards', () => {
    const html =
      uniq(
        'Brynhands_Mark',
        "Brynhand's Mark",
        'Wooden Club',
        'https://cdn.poe2db.tw/image/Art/2DItems/Weapons/OneHandWeapons/OneHandMaces/Uniques/BrynhandsMark.webp',
      ) + uniq('Frostbreath', 'Frostbreath', 'Crackling Mace', '/image/x.webp');
    const cards = parseUniqueCards(html);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({
      slug: 'Brynhands_Mark',
      name: "Brynhand's Mark",
      desc: 'Wooden Club', // base type line carried as the description
    });
    expect(cards[0].iconUrl).toBe(
      'https://cdn.poe2db.tw/image/Art/2DItems/Weapons/OneHandWeapons/OneHandMaces/Uniques/BrynhandsMark.webp',
    );
    expect(cards[1].iconUrl).toBe('https://cdn.poe2db.tw/image/x.webp'); // relative → absolute
  });

  it('returns [] for HTML without unique cards (so the collector can fail loud on 0)', () => {
    expect(parseUniqueCards('<div>no uniques here</div>')).toEqual([]);
  });
});

describe('pairCards', () => {
  it('pairs kr+us by slug into LocalizedTerms and drops unpaired kr entries', () => {
    const kr = [
      { slug: 'Evasion', name: '회피', desc: '회피 설명' },
      { slug: 'OnlyKr', name: '한글전용', desc: '' },
    ];
    const us = [{ slug: 'Evasion', name: 'Evasion', desc: 'Evasion description' }];
    const { terms, unpaired } = pairCards(kr, us, 'keyword', '2026-06-02T00:00:00.000Z');

    expect(terms).toHaveLength(1);
    expect(terms[0]).toMatchObject({
      id: 'keyword.Evasion',
      domain: 'keyword',
      ko: '회피',
      canonicalEn: 'Evasion',
      slug: 'Evasion',
      source: 'poe2db',
      confidence: 'slug',
    });
    // English alias never dropped (DESIGN §8.1); ko alias + descriptions retained for search.
    expect(terms[0].aliasesEn).toContain('Evasion');
    expect(terms[0].aliasesKo).toContain('회피');
    expect(unpaired).toEqual(['OnlyKr']);
  });
});
