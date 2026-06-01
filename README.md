# PoB2 Remastered

[Path of Building 2](https://github.com/PathOfBuildingCommunity/PathOfBuilding-PoE2)의 **검증된 Lua 계산 엔진은 그대로 보존**하면서, 현대적인 데스크톱 UI · 한국어 로컬라이제이션 · upstream 추적 자동화를 더한 fork입니다.

> 상태: **Phase 0 (환경 구성)**. 전체 설계는 [`DESIGN.md`](./DESIGN.md)를 참고하세요.

## 아키텍처 요약

```
React/TypeScript UI  ──IPC──▶  Rust Desktop Host (Tauri)  ──▶  PoB Lua Core Runner  ──▶  vendor/ (upstream)
```

- **계산 코어:** upstream Lua를 out-of-process headless runner로 보존 (재작성하지 않음)
- **호스트:** Tauri + Rust (IPC/파일/업데이트/SQLite FTS)
- **UI:** React + TypeScript (TanStack Query/Table, Zustand, Canvas/WebGL 패시브 트리)

자세한 내용은 `DESIGN.md` §5~§6 참조.

## 저장소 구조

```
pob2-remastered/
├─ vendor/PathOfBuilding-PoE2/   # upstream fork (git submodule, branch: dev)
├─ overlays/lua/                 # 비침습적 Lua 오버레이 (bootstrap/api/shim)
├─ apps/desktop/                 # Tauri + React 데스크톱 앱
├─ packages/                     # ui · schema · localization · core-client
├─ tools/                        # upstream-sync · poe2db-importer · golden-tests
└─ DESIGN.md                     # 설계 문서
```

**원칙:** `vendor/`(upstream)는 수정하지 않습니다. 필요한 변경은 `overlays/lua/`에 두고, Lua `package.path`를 `overlays/lua` → `vendor/.../src` 순으로 둡니다 (`DESIGN.md` §7.1).

## 사전 요구사항

| 도구             | 버전               | 비고                                                                                       |
| ---------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| Node.js          | ≥ 20 (LTS 22 권장) | `.nvmrc`                                                                                   |
| pnpm             | ≥ 9                | corepack로 활성화                                                                          |
| Rust             | stable             | `rust-toolchain.toml`                                                                      |
| Lua              | 5.1 / LuaJIT 2.1   | 코어 러너                                                                                  |
| Tauri Linux deps | —                  | `libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libayatana-appindicator3-dev`, `librsvg2-dev` 등 |

## 시작하기

```bash
# 1) 서브모듈 포함 클론
git clone --recurse-submodules https://github.com/Dev-Jahn/pob2-remastered.git
cd pob2-remastered

# 이미 클론했다면
git submodule update --init --recursive

# 2) JS 의존성 설치
corepack enable
pnpm install

# 3) 검증
pnpm format:check
pnpm typecheck
```

## Upstream 동기화

`vendor/PathOfBuilding-PoE2`는 fork(`origin`)를 가리키며, 그 안에 community 저장소가 `upstream`으로 등록되어 있습니다.

```bash
cd vendor/PathOfBuilding-PoE2
git fetch upstream
git merge upstream/dev      # 또는 rebase (DESIGN.md §7.1)
cd ../..
git add vendor/PathOfBuilding-PoE2
git commit -m "chore: bump vendored upstream"
```

## 라이선스

MIT — [`LICENSE`](./LICENSE) 참조. 데이터/자산 출처와 정책은 [`DATA_SOURCES.md`](./DATA_SOURCES.md), 고지는 [`NOTICE.md`](./NOTICE.md)를 확인하세요.
