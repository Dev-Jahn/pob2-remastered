/**
 * App-shell stylesheet gate (DESIGN §10.2 App shell, §20 "주요 화면이 1366×768에서도
 * 사용 가능" / "레이아웃 붕괴 없음").
 *
 * The §10.2 shell is a 3-pane frame: a left nav rail, a center workspace, and a
 * right inspector. The components emit the BEM class names for those panes, but a
 * frame is only a frame if a stylesheet actually lays the three regions out as
 * side-by-side columns — without it the served Overview route collapses to a flat
 * unstyled stack and the §10 visual gate (3-pane shell) cannot pass.
 *
 * This suite is the machine-checkable half of that visual gate: it asserts the
 * package ships `styles/shell.css` and that the stylesheet establishes the
 * three-column layout (the shell body is a grid/flex laying out the nav /
 * workspace / inspector selectors) and gives the §10.3 stat/warning cards a
 * visible boxed treatment. The full pixel verdict is the screenshot + vision pass
 * (visual-verify.mjs); this guards the CSS contract those pixels depend on.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// vitest runs with cwd = the @pob2/ui package root, so resolve from there. Avoids
// import.meta.url, which jsdom rewrites to a non-file scheme.
const css = readFileSync(resolve(process.cwd(), 'src/styles/shell.css'), 'utf8');

describe('app-shell stylesheet (DESIGN §10.2 3-pane shell)', () => {
  it('lays the shell body out as a multi-column track (nav | workspace | inspector)', () => {
    // The body must be a grid/flex container, not a default block stack.
    const body = css.match(/\.pob-shell__body\s*\{([^}]*)\}/);
    expect(body, 'a .pob-shell__body rule must exist').not.toBeNull();
    const decl = body![1];
    expect(decl).toMatch(/display\s*:\s*(grid|flex)/);
    // A grid lays the three panes via columns; a flex lays them in a row.
    expect(decl).toMatch(/grid-template-columns|flex-direction\s*:\s*row/);
  });

  it('styles each of the three panes (nav, workspace, inspector)', () => {
    for (const pane of ['pob-shell__nav', 'pob-shell__workspace', 'pob-shell__inspector']) {
      expect(css, `must style .${pane}`).toMatch(new RegExp(`\\.${pane}\\s*\\{`));
    }
  });

  it('gives the §10.3 stat and warning cards a visible boxed treatment', () => {
    // The rule whose selector list includes .pob-stat-card (it may be grouped
    // with other selectors). A "card" is visually boxed: border or background.
    const card = css.match(/\.pob-stat-card[^{}]*\{([^}]*)\}/);
    expect(card, 'a rule selecting .pob-stat-card must exist').not.toBeNull();
    expect(card![1]).toMatch(/border|background/);
    expect(css, 'warning card must be styled').toMatch(/\.pob-warning-panel[^{}]*\{/);
  });
});
