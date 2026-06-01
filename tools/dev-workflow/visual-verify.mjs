// visual-verify.mjs
import { chromium } from 'playwright';
import { spawnSync } from 'node:child_process';

export async function captureUrl(url, out, { width = 1366, height = 768 } = {}) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width, height } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.screenshot({ path: out, fullPage: false });
  } finally {
    await browser.close();
  }
  return out;
}

function firstAvailable(cands) {
  for (const c of cands) if (spawnSync('bash', ['-lc', `command -v ${c}`]).status === 0) return c;
  return null;
}

export function captureTauri(bin, out) {
  const shooter = firstAvailable(['import', 'scrot', 'gnome-screenshot']);
  if (!shooter) return { ok: false, reason: 'no screenshot tool (import/scrot/gnome-screenshot)' };
  const hasXvfb = spawnSync('bash', ['-lc', 'command -v xvfb-run']).status === 0;
  const shotCmd =
    shooter === 'import'
      ? `import -window root ${out}`
      : shooter === 'scrot'
        ? `scrot ${out}`
        : `gnome-screenshot -f ${out}`;
  const inner = `("${bin}" & APP=$!; sleep 6; ${shotCmd}; kill $APP 2>/dev/null)`;
  const cmd = hasXvfb
    ? `xvfb-run -a --server-args="-screen 0 1366x768x24" bash -lc '${inner}'`
    : `bash -lc '${inner}'`; // fall back to live $DISPLAY/WSLg
  const p = spawnSync('bash', ['-lc', cmd], { encoding: 'utf8', timeout: 120000 });
  if (p.status !== 0)
    return { ok: false, reason: `capture failed exit=${p.status} ${p.stderr || ''}`.trim() };
  return { ok: true, out };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, a, b, dim] = process.argv.slice(2);
  if (mode === 'url') {
    const [w, h] = (dim || '1366x768').split('x').map(Number);
    await captureUrl(a, b, { width: w, height: h });
    console.log(`OK ${b}`);
  } else if (mode === 'tauri') {
    const r = captureTauri(a, b);
    if (!r.ok) {
      console.log(`TIER2_UNAVAILABLE: ${r.reason}`);
      process.exit(3);
    }
    console.log(`OK ${b}`);
  } else {
    console.error('usage: visual-verify.mjs url <url> <out.png> [WxH] | tauri <bin> <out.png>');
    process.exit(2);
  }
}
