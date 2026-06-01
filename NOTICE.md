# NOTICE

PoB2 Remastered is licensed under the MIT License (see `LICENSE`).

## Vendored upstream — Path of Building 2

This project vendors [PathOfBuilding-PoE2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)
as a git submodule under `vendor/PathOfBuilding-PoE2`. That project is distributed
under the MIT License; its own `LICENSE` and third-party notices apply and are
retained within the submodule. PoB2 Remastered does **not** relicense or modify
the vendored sources in place — local changes live in `overlays/`.

## Game content (Path of Exile 2 / GGG)

Path of Exile and Path of Exile 2 — including names, graphics, icons, and other
in-game content — are property of Grinding Gear Games (GGG). This repository does
**not** bundle GGG-owned image or art assets. See `DATA_SOURCES.md` for the data
and asset policy.

## Third-party components

Runtime and tooling dependencies are listed in `package.json`, `Cargo.toml`
(per crate), and the vendored submodule. Their respective licenses apply.
