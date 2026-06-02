# Production-wiring review (2026-06-02) — findings, fixes, remaining

A static code review (GitHub connector) found that several features verified at the
**component / mock-session level** are not wired in the shipped `App` composition.
Root cause: the pipeline's visual gate used **fixture-fed harnesses** and never
exercised the live, IPC-wired production `App` end-to-end. This corrects the
overstated "Phase 0–7 done" framing: the calc core, IPC bridge, and per-feature
components are real and tested, but **production UX wiring is partial**.

## Fixed (branch `feat/production-wiring`, with tests)

| #   | Item                                                             | Fix                                                                                                                                                |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0  | Share-code import/export threw in production                     | Real browser-safe sync zlib codec (`fflate`); cross-decodes Node/upstream codes. `share-code-codec.test.ts`                                        |
| P0  | Open Build unwired (`main.tsx` injected no resolver)             | `host-bridge.createOpenSourceResolver` (file picker → `{xml}`) injected in `main.tsx`                                                              |
| P0  | Save/Export discarded its result                                 | `App` consumes `session.save()` and delivers via `host-bridge.createSaveDeliverer` (XML → download, share code → clipboard). `App.wiring.test.tsx` |
| P1  | Config per-option edit unwired                                   | `App` passes `onChangeOption` → `session.setConfigOption` → recompute. `App.wiring.test.tsx`                                                       |
| P1  | `build.load` response schema overstated (validateResponse:false) | Schema aligned to the real `{buildId, summary}`; response validation re-enabled (verified vs the real runner)                                      |
| P2  | Empty passive tree → `Infinity`/`NaN` minimap bounds             | `treeResponseToGraph` returns a finite zero rect for an empty tree. `tree-bounds.test.ts`                                                          |
| —   | Systemic gap                                                     | `App.wiring.test.tsx` renders the **production App composition** and asserts the wiring exists, so these dead-ends fail CI if they regress         |

## Data-model P1 — now fixed (branch `feat/p1-data-model-wiring`, with tests)

- **Skills gem toggle ✅.** `SkillGroupCard` now carries an order-preserving `gems` list (both
  assemblers populate it from the ordered wire list); `App.toggleGem` rebuilds `GemInput[]` in
  ORIGINAL order with one `enabled` flipped → `setGemGroup` → recompute. `App.skills-toggle.test`
  guards order preservation; verified vs the real runner.
- **Items toolbar ✅.** `App` wires `onImportFromClipboard` to the paste flow; `ItemsPanel` renders
  each toolbar action ONLY when its callback is provided, so Craft/Trade (unimplemented) show no
  dead button (and no `createCustom` path).
- **Skills group-enable control ✅ (dead control removed).** `SkillGroupCard` renders the
  group-enable checkbox ONLY when `onToggleGroup` is wired — no dead checkbox. The backing
  `skills.setGroupEnabled` method is deferred (see below).

## Remaining (larger new features — tracked, not half-wired)

- **`skills.setGroupEnabled` (group enable/disable).** Needs a new runner method (set
  `socketGroup.enabled` + recalc) + schema + allowlist + client/session + App `onToggleGroup`.
  Mechanical (mirrors `skills.setGemGroup`) but a full new RPC; the dead control is hidden until then.
- **Skill inspector breakdown.** The §10.5 selected-skill damage/support/gem-delta breakdown needs
  per-skill calc data (a new explain-like method or richer `skills.getGroups`). Deferred.
- **Items library + selection.** `LibraryItem` is a search _summary_, not a full `InspectedItem`
  (no mod data), so a library-row click cannot resolve to the inspector. Needs a library item store
  carrying full detail (or an `onSelectLibraryItem` → host-fetch detail) + a live library/shared-item
  scope feeding `ItemsPanel`. Deferred (new feature).
- **`items.createCustom`.** IPC client method exists but the runner/allowlist reject it; it is **not
  reachable from any UI action** (Craft is hidden). Implement runner + schema + allowlist + UI
  together when built. Deferred.

## Phase-claim correction

Phases 2–5 are **component-complete + IPC-bridged + visually verified**, but their
production **mutation/Import-Export UX is partial** per the punch-list above. Treat
"done" as "core + components done; production wiring tracked here," not "shippable UX."

## Asset bundling gate (prerequisite)

Before the asset workstream bundles into a release, the `AssetRef` manifest must pass
`tools/dev-workflow/asset-gate.mjs` (schema · sha256 integrity · `licenseStatus: allowed`
only · attribution present · no `do_not_bundle` in a release manifest). Release artifacts
must include `LICENSE`, `NOTICE.md`, `DATA_SOURCES.md`.
