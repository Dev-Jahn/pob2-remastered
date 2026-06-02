# @pob2/desktop

Tauri + React 데스크톱 애플리케이션 (`DESIGN.md` §5, §10).

- **`src/`** — React/TypeScript 프론트엔드: 앱 셸, `Ctrl+K` 커맨드 팔레트, Overview / Items / Skills / Config / Calcs / Passive Tree 탭, build 세션, IPC 코어 클라이언트(`core-ipc-client.ts`), updater · release-channel · diagnostic-export · crash-report.
- **`src-tauri/`** — Rust 호스트: 허용목록 IPC(`core_request`), Lua 코어 러너 sidecar(`core_bridge.rs`), 파일 I/O, updater. Cargo 워크스페이스 크레이트 `pob2-desktop`.

## 실행

```bash
pnpm --filter @pob2/desktop dev    # 웹 프론트엔드 (Vite, :5173)
cargo tauri dev                    # 전체 Tauri 앱 (코어 IPC 연결, tauri-cli 필요)
pnpm --filter @pob2/desktop test   # vitest
```

코어 연결: `src-tauri/src/core_bridge.rs`가 `luajit overlays/lua/runner.lua`를 spawn해
stdio JSON-RPC(NDJSON)로 구동하고, WebView는 Tauri `invoke('core_request', …)`로 호출합니다 —
`@pob2/core-client`의 Node 경로와 **동일한 IPC 계약**(`@pob2/schema`)을 씁니다 (`DESIGN.md` §6, §14.1).
