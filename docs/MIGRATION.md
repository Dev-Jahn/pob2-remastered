# Migrating an existing PoB2 build into this fork

This guide is for users coming from upstream
[Path of Building 2 (PathOfBuilding-PoE2)](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)
who want to bring an existing build into **PoB2 Remastered** (this fork). It
covers how to import your build, what happens to fork-specific metadata when you
export back to upstream (round-trip), which updater channel to pick, and where to
find the diagnostic export if you need to file an issue.

This fork **preserves the upstream Lua calculation core verbatim** — the same
inputs produce the same numbers. What is new is the desktop UI and the Korean
localization layer. Your build data, share codes, and XML stay compatible.

---

## Import: bringing your build in (share code or XML)

There are two upstream-compatible ways to load an existing build. Both live in the
**Import/Export tab** of the app (DESIGN §10.9), and both round-trip back out to
upstream (see the next section).

### From a share code

A PoB2 _share code_ is the long base64-ish string you paste into the upstream
client (or share on Discord / the forums). In this fork:

1. Open the **Import/Export tab**.
2. Paste the upstream **share code** into the import box.
3. The fork decodes it into modern internal state and opens the build.

Share-code decoding is sandboxed: only plain text is processed, a size limit is
applied, and a malformed code is rejected without crashing the calculation core
(DESIGN §14.2). The decode produces the same `BuildState` an XML import would
(DESIGN §12.1), so the two paths are interchangeable.

### From an XML file

Upstream PoB2 stores builds as `.xml` on disk. To migrate those directly:

1. Locate your upstream build `.xml` files (your upstream builds folder).
2. In the **Import/Export tab**, choose **XML import** and select the file.
3. The fork validates the extension and schema before loading (DESIGN §14.2).

Both the **share code** and **XML** formats are the upstream-compatible storage
formats this fork reads and writes (DESIGN §12.2). The modern JSON / SQLite stores
are internal-only; you never have to hand them to upstream.

> If a modifier or line is not yet understood by the fork, it is **preserved** and
> shown as `unsupported/unknown` rather than dropped (DESIGN §8.6, §14.3) — so an
> import never silently loses data.

---

## Round-trip: what is preserved vs. sidecar'd (DESIGN §12.3)

The core promise of migration is **round-trip safety**: converting
`upstream share code → modern state → upstream share code` minimises information
loss (DESIGN §12.3). You can move a build into the fork, edit it, and export it
back to upstream without your original data degrading.

The catch is **modern-only metadata** — fields this fork adds that upstream PoB2
does not know about. Per the round-trip principle (DESIGN §12.3):

- **Upstream-compatible data is preserved losslessly.** Items, skills, passive
  tree allocations, config — everything upstream understands round-trips
  unchanged.
- **Modern-only metadata is stored in its own namespace**, separate from the
  upstream fields, so it can never collide with or corrupt an upstream value.
  Examples of modern-only metadata include the fork's `metadata` block
  (`upstreamCommit`, `createdAt`, `updatedAt`, `locale`; DESIGN §12.1) and any
  fork-specific annotations.
- **On export to an upstream format, fields upstream cannot understand are either
  stripped or written to a sidecar** rather than jammed into the upstream payload
  (DESIGN §12.3). The upstream consumer sees a clean, valid build; your
  modern-only metadata is **preserved** alongside it (the sidecar), not lost.

In practice this means: export from the fork → import into vanilla upstream PoB2 →
it just works, with no foreign fields. Re-import that same export _back into the
fork_ and the sidecar restores your modern-only metadata. The
`build format 손실` risk is mitigated exactly this way — round-trip tests plus
sidecar metadata (DESIGN §19).

---

## Updater channels: stable, beta, dev (DESIGN §13.1)

This fork ships a self-updating desktop app (Tauri / Rust updater) that tracks
upstream compatibility. You choose one of three update **channels** (DESIGN §13.1):

| Channel  | Who it's for   | What you get                            |
| -------- | -------------- | --------------------------------------- |
| `stable` | most users     | verified releases only                  |
| `beta`   | advanced users | faster upstream changes, less soak time |
| `dev`    | developers     | nightly builds with debug features      |

If you are migrating from upstream and just want a working app, pick **`stable`**.
Choose **`beta`** if you want upstream calculation changes sooner and can tolerate
the occasional rough edge. **`dev`** is for contributors (nightly, debug tooling,
devtools enabled).

Updates are applied to a staging directory, verified by signature/hash, smoke
tested (core boot, sample build load, calc run), switched atomically, and **rolled
back on failure** (DESIGN §13.3) — so a bad update cannot leave you with a broken
install or a corrupted migrated build.

---

## Diagnostic export: where it lives and when to use it

If something looks wrong after migrating — a stat that does not match upstream, a
mod shown as unsupported, a localization miss — generate a **diagnostic export**
and attach it to your bug report.

The diagnostic export lives in the **Import/Export tab** (DESIGN §10.9), next to
the share-code / XML import controls. It bundles:

- the current **build state**,
- **localization misses** (untranslated strings the fork hit),
- **unsupported mods** (lines preserved but not yet mapped),
- the **core version**, and
- the **upstream commit hash** the calculation core was built from.

Because it captures the exact upstream commit and core version, a maintainer can
reproduce your numbers deterministically. This is distinct from the crash-report /
diagnostic _bundle_ the app assembles automatically on a crash (DESIGN §5.1, §13);
the diagnostic export is the one **you** trigger from the Import/Export tab to
share a build for debugging.

---

## Quick checklist

1. Pick an updater channel — **`stable`** unless you have a reason not to
   (DESIGN §13.1).
2. Import your build via **share code** or **XML** in the Import/Export tab
   (DESIGN §10.9, §12.2).
3. Edit freely; export back to upstream any time — upstream-compatible data
   round-trips losslessly, modern-only metadata is sidecar'd (DESIGN §12.3).
4. Hit a problem? Use the **diagnostic export** in the Import/Export tab and file
   an issue (DESIGN §10.9).
