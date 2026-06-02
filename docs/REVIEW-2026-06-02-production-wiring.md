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

## Remaining (honest punch-list — needs data-model work, not just prop-passing)

These are **deliberately deferred** rather than half-wired (a reordered gem list or a
fabricated library item would be a worse "broken middle state"). Each needs a real
data-model change:

- **Skills gem toggle (P1).** `onToggleGem` cannot be wired cleanly today: `skills.getGroups`
  splits gems into `activeGems`/`supportGems` and **loses the original gem order** that
  `skills.setGemGroup` needs — reconstructing would reorder gems (a real calc bug). Fix:
  carry the original combined gem order (or per-gem index) in the `SkillGroupCard` model so
  `App` can rebuild the `GemInput[]` with the toggled gem flipped, then `setGemGroup` →
  recompute. Same for the skill **inspector breakdown** (needs per-skill damage data).
- **Skills group enable toggle (P1).** `onToggleGroup` needs a `skills.setGroupEnabled`
  runner method (no current Core API method maps to a group-level enable). Add method +
  schema + allowlist + UI wiring, or hide the group-enable control until then.
- **Items library + selection (P1).** `LibraryItem` is a search _summary_, not a full
  `InspectedItem` (no mod data), so a library-row click cannot resolve to the inspector.
  Fix: a library item store carrying full item detail (or an `onSelectLibraryItem` →
  host-fetch detail), plus a live `library`/shared-item scope feeding `ItemsPanel`.
- **Items toolbar buttons (P1).** Paste works via the Ctrl+K "아이템 붙여넣기" command, but the
  toolbar Import button is inert and Craft/Trade render with no handler. Fix: wire
  `onImportFromClipboard` to the paste flow and **hide** Craft/Trade until implemented
  (render toolbar buttons only when their callback is provided).
- **`items.createCustom` (P1).** The IPC client method exists but the runner / Rust allowlist
  reject it — it is **not reachable from any UI action** today. Keep it deferred (do not wire
  a Craft entry to it); implement runner + schema + allowlist + UI together when built.

## Phase-claim correction

Phases 2–5 are **component-complete + IPC-bridged + visually verified**, but their
production **mutation/Import-Export UX is partial** per the punch-list above. Treat
"done" as "core + components done; production wiring tracked here," not "shippable UX."

## Asset bundling gate (prerequisite)

Before the asset workstream bundles into a release, the `AssetRef` manifest must pass
`tools/dev-workflow/asset-gate.mjs` (schema · sha256 integrity · `licenseStatus: allowed`
only · attribution present · no `do_not_bundle` in a release manifest). Release artifacts
must include `LICENSE`, `NOTICE.md`, `DATA_SOURCES.md`.
