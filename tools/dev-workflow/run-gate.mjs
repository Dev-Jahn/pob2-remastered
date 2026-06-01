// run-gate.mjs
import { spawnSync } from 'node:child_process';
import { GATES } from './gates.mjs';

const NOT_FOUND = /command not found|No such file or directory|not recognized|cannot find/i;

export function classify(code, stdout, stderr) {
  if (code === 0) return 'pass';
  if (code === 127 || NOT_FOUND.test(stderr)) return 'env-missing';
  return 'fail';
}

export async function runGate(gates) {
  const results = gates.map((g) => {
    const p = spawnSync('bash', ['-lc', g.cmd], { encoding: 'utf8', timeout: 600000 });
    const code = p.status ?? (p.error ? 127 : 1);
    const stdout = p.stdout || '';
    const stderr = (p.stderr || '') + (p.error ? String(p.error) : '');
    const status = classify(code, stdout, stderr);
    const tail = (s) => s.split('\n').slice(-12).join('\n');
    return { name: g.name, cmd: g.cmd, kind: g.kind, required: g.required, status,
             evidence: `exit=${code}\n${tail(stdout)}\n${tail(stderr)}`.trim() };
  });
  const pass = !results.some((r) => r.required && r.status === 'fail');
  return { pass, results };
}

// CLI: node run-gate.mjs <phase>
if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = process.argv[2];
  if (phase === '--selfcheck') { console.log('run-gate ok'); process.exit(0); }
  const gates = GATES[phase];
  if (!gates) { console.error(`no gates for phase ${phase}`); process.exit(2); }
  const r = await runGate(gates);
  console.log(JSON.stringify({ phase: Number(phase), ...r }, null, 2));
  process.exit(r.pass ? 0 : 1);
}
