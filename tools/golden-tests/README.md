# tools/golden-tests

Calculation golden tests — detect divergence between this fork and upstream
(`DESIGN.md` §7.4, §16).

- **Fixtures:** upstream sample builds, public share codes, and synthetic cases
  (unarmed, single skill, aura/reservation, minion, DoT, crit, ailment, item-set
  swap, passive delta, jewel/radius/conversion, party/support).
- **Compared stats:** average hit, rates, hit/crit chance, total + DoT DPS,
  life/mana/ES, reservation, armour/evasion/ES, max resists, effective hit pool.
- **Tolerance:** integers exact; floats `1e-6` or display precision; upstream-driven
  diffs auto-attached to the sync PR.

Scaffolded in **Phase 1+** (`DESIGN.md` §18, §21).
