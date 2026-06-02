// User migration-guide docs-presence gate (Phase 7, task p7-migration-guide).
//
// This is a pure verification test — it touches nothing under vendor/ and runs no
// production code. It extends the legal-docs.test.mjs pattern: a docs-presence
// guard so the user migration guide required by DESIGN.md §18 Phase 7 ("user
// migration guide") cannot silently regress into an empty stub.
//
// docs/MIGRATION.md must keep explaining, for a user migrating an existing
// upstream PoB2 build into this fork, every section the deliverable promises:
//   1. Import path                — share code / XML import (DESIGN §10.9, §12.2)
//   2. Round-trip preservation    — modern-only metadata preserved vs sidecar'd
//                                   (DESIGN §12.3 round-trip 원칙)
//   3. Updater channels           — stable / beta / dev (DESIGN §13.1)
//   4. Diagnostic export location — where it lives in the app (DESIGN §10.9)
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO_ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

const MIGRATION_REL = 'docs/MIGRATION.md';

function readDoc(rel) {
  return readFileSync(join(REPO_ROOT, rel), 'utf8');
}

// Isolate a section (by its heading) so a required term is checked against THAT
// section's body, not against an incidental mention elsewhere in the guide.
function section(doc, headingRe) {
  const startMatch = doc.match(headingRe);
  assert.ok(startMatch, `MIGRATION.md must contain a section heading matching ${headingRe}`);
  const start = startMatch.index;
  const rest = doc.slice(start + startMatch[0].length);
  const nextHeading = rest.match(/^#{1,3} /m);
  const end = nextHeading ? start + startMatch[0].length + nextHeading.index : doc.length;
  return doc.slice(start, end);
}

// (1) The guide exists as a real, non-trivial file (not an empty stub).
test('docs/MIGRATION.md exists and is non-empty', () => {
  const abs = join(REPO_ROOT, MIGRATION_REL);
  assert.ok(
    existsSync(abs) && statSync(abs).isFile(),
    'missing required user migration guide: docs/MIGRATION.md',
  );
  // Guard against an empty stub: a real guide is substantially longer than a
  // placeholder heading.
  assert.ok(statSync(abs).size > 800, 'docs/MIGRATION.md must not be an empty stub');
});

// (2) The import-path section explains both the share-code AND XML entry points
//     (DESIGN §10.9 Import/Export tab, §12.2 저장 형식).
test('MIGRATION.md documents the share-code / XML import path', () => {
  const doc = readDoc(MIGRATION_REL);
  const importSection = section(doc, /^#{1,3} .*\bimport\b.*$/im);

  assert.match(
    importSection,
    /share[\s-]*code/i,
    'the import section must explain the upstream share-code import path',
  );
  assert.match(
    importSection,
    /\bXML\b/,
    'the import section must explain the upstream XML import path',
  );
  // It is a *migration* guide: it must name what is being migrated FROM.
  assert.match(doc, /upstream/i, 'must frame this as migrating from an upstream PoB2 build');
});

// (3) The round-trip section reflects DESIGN §12.3: modern-only metadata is
//     preserved in its own namespace and sidecar'd on export, not silently lost.
test('MIGRATION.md explains round-trip preservation (§12.3 sidecar metadata)', () => {
  const doc = readDoc(MIGRATION_REL);
  const rtSection = section(doc, /^#{1,3} .*round[\s-]*trip.*$/im);

  assert.match(rtSection, /12\.3/, 'the round-trip section must cite DESIGN §12.3');
  assert.match(
    rtSection,
    /modern[\s-]*only/i,
    'must describe modern-only metadata (the fork-specific fields)',
  );
  assert.match(
    rtSection,
    /sidecar/i,
    'must explain that modern-only metadata is sidecar’d on export (not lost)',
  );
  assert.match(
    rtSection,
    /preserv|손실|보존/i,
    'must state that information loss is minimised / metadata is preserved',
  );
});

// (4) The updater-channels section lists the three DESIGN §13.1 channels.
test('MIGRATION.md documents the updater channels (§13.1 stable/beta/dev)', () => {
  const doc = readDoc(MIGRATION_REL);
  const updSection = section(doc, /^#{1,3} .*updat.*$/im);

  assert.match(updSection, /13\.1/, 'the updater section must cite DESIGN §13.1');
  for (const channel of ['stable', 'beta', 'dev']) {
    assert.match(
      updSection,
      new RegExp(`\\b${channel}\\b`, 'i'),
      `the updater section must name the \`${channel}\` channel`,
    );
  }
});

// (5) The guide tells the user where the diagnostic export lives (DESIGN §10.9
//     Import/Export tab).
test('MIGRATION.md says where the diagnostic export lives', () => {
  const doc = readDoc(MIGRATION_REL);
  const diagSection = section(doc, /^#{1,3} .*diagnostic.*$/im);

  assert.match(
    diagSection,
    /import\s*\/?\s*export/i,
    'must locate the diagnostic export in the Import/Export tab (DESIGN §10.9)',
  );
  assert.match(diagSection, /10\.9/, 'the diagnostic-export section must cite DESIGN §10.9');
});
