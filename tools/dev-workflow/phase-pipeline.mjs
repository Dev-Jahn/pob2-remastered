export const meta = {
  name: 'phase-pipeline',
  description: 'Implement one DESIGN.md phase of PoB2 Remastered: decompose → TDD → gate → review',
  phases: [{ title: 'Decompose' }, { title: 'Implement' }, { title: 'Gate' }, { title: 'Review' }],
};

// args may arrive as an object or as a JSON string depending on the caller — handle both.
const ARGS = typeof args === 'string' ? JSON.parse(args) : (args ?? {});
const PHASE = ARGS.phase;
if (PHASE === undefined) throw new Error('args.phase required');

const TASKS_SCHEMA = {
  type: 'object',
  required: ['tasks'],
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'deliverable', 'targetFiles', 'deps', 'verifyCmd'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          deliverable: { type: 'string' },
          targetFiles: { type: 'array', items: { type: 'string' } },
          deps: { type: 'array', items: { type: 'string' } },
          verifyCmd: { type: 'string' },
          humanGate: { type: 'string', enum: ['legal', 'network', 'secret', 'visual', 'gamedata'] },
        },
      },
    },
  },
};
const TASK_RESULT_SCHEMA = {
  type: 'object',
  required: ['id', 'status'],
  properties: {
    id: { type: 'string' },
    status: { enum: ['done', 'flagged', 'blocked'] },
    note: { type: 'string' },
    triedFixes: { type: 'number' },
  },
};
const REPORT_SCHEMA = {
  type: 'object',
  required: ['phase', 'pass'],
  properties: {
    phase: { type: 'number' },
    pass: { type: 'boolean' },
    gateJson: { type: 'string' },
    flags: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
    reviewSummary: { type: 'string' },
  },
};

phase('Decompose');
const { tasks } = await agent(
  `You decompose ONE phase of the PoB2 Remastered project into concrete, dependency-ordered implementation tasks.
Read: ./DESIGN.md, ./tools/dev-workflow/phases.mjs (PHASES[${PHASE}]), and the CURRENT repo tree (what already exists).
Produce tasks that build on existing code toward PHASES[${PHASE}].doneCriteria. For each task give id, title, deliverable,
exact targetFiles, deps (ids of prerequisite tasks), a runnable verifyCmd (test command), and humanGate if it needs
legal/network/secret/visual/gamedata. Keep tasks small and TDD-friendly. Do NOT modify vendor/.`,
  { label: `decompose:p${PHASE}`, phase: 'Decompose', schema: TASKS_SCHEMA },
);

// Topological order (Kahn). Sequential execution keeps the shared tree consistent.
function topo(ts) {
  const byId = Object.fromEntries(ts.map((t) => [t.id, t]));
  const done = new Set();
  const order = [];
  let guard = 0;
  while (order.length < ts.length && guard++ < ts.length * ts.length) {
    for (const t of ts) {
      if (done.has(t.id)) continue;
      if ((t.deps || []).every((d) => done.has(d) || !byId[d])) {
        order.push(t);
        done.add(t.id);
      }
    }
  }
  for (const t of ts) if (!done.has(t.id)) order.push(t); // cycle fallback
  return order;
}

phase('Implement');
const taskResults = [];
for (const t of topo(tasks)) {
  const r = await agent(
    `Implement this task for PoB2 Remastered using strict TDD (write a failing test FIRST, then minimal code, then make it pass).
Task: ${JSON.stringify(t)}
Rules: follow ./DESIGN.md and existing repo conventions; never edit vendor/; commit your work with a conventional-commit message.
If humanGate is set, do the SAFE best-effort per ./docs/superpowers/specs/2026-06-01-dev-workflow-design.md §2
(fixtures not live network, do_not_bundle assets, config-hook not real secrets) and return status 'flagged' with a note.
If you cannot make the verifyCmd pass after several honest attempts, return status 'blocked' with the error and triedFixes count.
Otherwise return status 'done'. verifyCmd: ${t.verifyCmd}`,
    { label: `impl:${t.id}`, phase: 'Implement', schema: TASK_RESULT_SCHEMA },
  );
  taskResults.push(r);
  if (r && r.status === 'blocked') break; // hard blocker — stop implementing further dependents
}

phase('Gate');
const gate = await agent(
  `Run the evidence-based gate for phase ${PHASE} of PoB2 Remastered and report the verdict.
Run: \`node tools/dev-workflow/run-gate.mjs ${PHASE}\` and capture its JSON.
For every gate of kind 'visual': run \`node tools/dev-workflow/visual-verify.mjs url <screen-url> <out.png>\` (Tier 1, REQUIRED),
THEN ALWAYS also attempt Tier 2 \`node tools/dev-workflow/visual-verify.mjs tauri <built-binary> <out2.png>\` (NOT required — flag if TIER2_UNAVAILABLE).
Analyze each screenshot with the gemini-vision skill (or read the PNG directly) and assert the DESIGN.md §10 layout for that screen.
If a REQUIRED gate has status 'fail' (real failure, not env-missing/visual-tier2), fix the underlying code (TDD) and re-run, up to 3 rounds.
Return: pass (true unless a required gate still fails), gateJson (the run-gate output), flags (env-missing + visual notes), blockers.`,
  { label: `gate:p${PHASE}`, phase: 'Gate', schema: REPORT_SCHEMA },
);

phase('Review');
const review = await agent(
  `Adversarially review the diff for phase ${PHASE} of PoB2 Remastered (git diff against the phase's base).
Check: correctness vs ./DESIGN.md and PHASES[${PHASE}].doneCriteria, NO-FALLBACK (no fake passes/stubs masquerading as done),
no vendor/ edits, test quality. Only report REAL issues. If you find blocking issues, fix them via TDD and commit. Then summarize.`,
  {
    label: `review:p${PHASE}`,
    phase: 'Review',
    schema: {
      type: 'object',
      required: ['summary', 'blocking'],
      properties: { summary: { type: 'string' }, blocking: { type: 'boolean' } },
    },
  },
);

return {
  phase: PHASE,
  pass:
    !!(gate && gate.pass) &&
    !(review && review.blocking) &&
    !taskResults.some((r) => r && r.status === 'blocked'),
  taskResults,
  gate,
  review,
};
