//! IPC allowlist regression guard (DESIGN §14.1 "허용된 command만 expose").
//!
//! CARRYOVER guard for the `p3-review/getequipped-allowlist` BLOCKING regression
//! (`tools/dev-workflow/PROGRESS.md`): `items.getEquipped` was routed by the
//! WebView IPC client and called after every Open, yet it was MISSING from the
//! Rust `core_bridge::ALLOWED_METHODS`. The shipped app's headline equipped-gear
//! grid was refused as `UPSTREAM_INCOMPATIBLE` and could never load — masked
//! because the desktop component tests inject a MOCK client and never exercise
//! the live Rust IPC route.
//!
//! This integration test (a separate crate that can only see the library's
//! PUBLIC surface, exactly like the real IPC gateway) pins the allowlist to the
//! canonical method set: the `@pob2/schema` registry / `MVP_METHODS` set, adapted
//! for the bridge wire (`+ core.version` handshake, `+ skills.setGemGroup` /
//! `config.setOption` write companions which the bridge routes but which are
//! request-only type stubs not yet in the schema registry, `- items.createCustom`
//! which is in the schema registry but NOT yet routed through the bridge). If a
//! Phase 4 method (`skills.getGroups`, `skills.setGemGroup`, `config.getOptions`,
//! `config.setOption`, `calc.explain`) is wired into the IPC client without being
//! added to `ALLOWED_METHODS`, this test FAILS at the test step instead of
//! silently reaching the shipped app — turning the previous runtime
//! `UPSTREAM_INCOMPATIBLE` regression into a compile/test gate.

use std::collections::BTreeSet;

use pob2_desktop_lib::core_bridge::ALLOWED_METHODS;

/// The canonical IPC method set the allowlist MUST equal, derived from the
/// `@pob2/schema` registry (`packages/schema/src/schemas/index.ts` `MVP_METHODS`
/// = the schemaRegistry keys) with the documented bridge-wire adaptations:
///
/// - `+ "core.version"` — the JSON-RPC ready handshake. It is NOT an MVP/registry
///   method, but the bridge MUST allow it to complete the §6.3 ready handshake.
/// - `+ "skills.setGemGroup"` / `+ "config.setOption"` — the Phase 4 WRITE
///   companions to the `skills.getGroups` / `config.getOptions` reads. The runner
///   routes them (modern_api handlers exist) and the IPC client calls them, but
///   they are request-only TYPE STUBS in `@pob2/core-api` (no response schema /
///   registry entry yet), so they are bridge-wire additions just like
///   `core.version` — allowlisted because the bridge actually routes them.
/// - `- "items.createCustom"` — present in the schema registry, but NOT yet
///   routed through the Rust bridge (no IPC client call), so it stays OUT of the
///   allowlist until a phase wires it. (If/when it is wired, add it here AND to
///   `ALLOWED_METHODS` together.)
///
/// Keep this literal in lockstep with the methods the bridge routes: a method the
/// IPC client calls must be added to BOTH this set and `ALLOWED_METHODS`. The
/// Phase 4 read methods (`skills.getGroups`, `config.getOptions`, `calc.explain`)
/// land via the registry; the write companions (`skills.setGemGroup`,
/// `config.setOption`) land as bridge-wire additions above.
const EXPECTED_ALLOWED_METHODS: [&str; 15] = [
    // ready handshake (bridge-wire only, not an MVP/registry method)
    "core.version",
    // schema-registry / MVP method set, minus the not-yet-routed items.createCustom
    "build.load",
    "build.save",
    "calc.run",
    "calc.explain",
    "items.parseClipboard",
    "items.getEquipped",
    "items.compare",
    "skills.getGroups",
    "config.getOptions",
    // Phase 5 Passive Tree query/allocate: full request+response schema-registry
    // methods (DESIGN §6.3 tree.getData/previewAllocate/applyAllocate, §10.6), routed
    // by the bridge and called by the IPC client after every Open.
    "tree.getData",
    "tree.previewAllocate",
    "tree.applyAllocate",
    // Phase 4 write companions: routed by the bridge, request-only type stubs (not
    // yet in the schema registry), so bridge-wire additions like core.version.
    "skills.setGemGroup",
    "config.setOption",
];

#[test]
fn allowlist_matches_the_schema_registry_method_set() {
    let allowed: BTreeSet<&str> = ALLOWED_METHODS.iter().copied().collect();
    let expected: BTreeSet<&str> = EXPECTED_ALLOWED_METHODS.iter().copied().collect();

    // Set-equality catches BOTH failure modes of the getequipped-allowlist class:
    //   missing   — a registry/IPC-routed method absent from the allowlist (the
    //               original regression: `items.getEquipped` would be in `expected`
    //               but not `allowed` -> the shipped app refuses it at runtime).
    //   stray     — an allowlist entry with no schema/registry backing (a method
    //               exposed to the frontend with no validated contract).
    let missing: Vec<&&str> = expected.difference(&allowed).collect();
    let stray: Vec<&&str> = allowed.difference(&expected).collect();
    assert!(
        missing.is_empty(),
        "ALLOWED_METHODS is MISSING schema-registry methods {missing:?} — the IPC \
         client can route them but the bridge will refuse them as \
         UPSTREAM_INCOMPATIBLE (getequipped-allowlist regression). Add them to \
         core_bridge::ALLOWED_METHODS."
    );
    assert!(
        stray.is_empty(),
        "ALLOWED_METHODS has STRAY methods {stray:?} with no schema-registry \
         backing — either add their schema + EXPECTED_ALLOWED_METHODS entry, or \
         remove them from core_bridge::ALLOWED_METHODS."
    );

    assert_eq!(
        allowed, expected,
        "ALLOWED_METHODS diverged from the schema registry method set"
    );
}

/// Pin the exact count so a method added to `ALLOWED_METHODS` without a matching
/// `EXPECTED_ALLOWED_METHODS` update (or vice-versa) is caught even if a future
/// edit accidentally makes the two sets coincidentally overlap. Phase 4 wired the
/// skills/config/calc.explain methods (7 → 12); Phase 5 wired the tree
/// query/allocate methods (12 → 15).
#[test]
fn allowlist_has_exactly_fifteen_methods_after_phase_5() {
    assert_eq!(
        ALLOWED_METHODS.len(),
        15,
        "ALLOWED_METHODS count changed: when a method is wired into / out of the IPC \
         client, update BOTH core_bridge::ALLOWED_METHODS and EXPECTED_ALLOWED_METHODS \
         in this guard together."
    );
}
