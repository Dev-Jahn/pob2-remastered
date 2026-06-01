-- Luacheck config for PoB2 Remastered's own Lua (overlays/, tools/).
-- The vendored upstream (vendor/) is excluded; it is linted by upstream's tooling.
std = "luajit"
max_line_length = 120

exclude_files = {
  "vendor/",
}

-- PoB-style globals are introduced by the headless bootstrap; declare them here
-- as the overlay/core API surface stabilizes (see overlays/lua/).
globals = {}
