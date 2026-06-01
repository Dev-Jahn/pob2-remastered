import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, statSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureUrl } from '../visual-verify.mjs';

const dir = mkdtempSync(join(tmpdir(), 'vv-'));
const html = join(dir, 'page.html');
const out = join(dir, 'shot.png');
writeFileSync(html, '<html><body><h1 style="font-size:80px">POB2 SHELL</h1></body></html>');

describe('captureUrl (Tier 1, Playwright)', () => {
  it('produces a non-empty PNG from a file:// page', async () => {
    await captureUrl(`file://${html}`, out, { width: 800, height: 600 });
    expect(existsSync(out)).toBe(true);
    expect(statSync(out).size).toBeGreaterThan(1000);
  }, 60000);
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
});
