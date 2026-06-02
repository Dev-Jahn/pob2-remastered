/**
 * main.tsx — the @pob2/desktop React entry (DESIGN §4.2, §5.1 UI layer).
 *
 * Mounts the App root into the #root element from index.html. StrictMode is on
 * to surface unsafe lifecycles early in development.
 *
 * Pulls in the @pob2/ui app-shell stylesheet so the §10.2 3-pane frame and the
 * §10.3 Overview cards render as a laid-out desktop UI rather than a flat
 * unstyled stack; Vite bundles it into dist/ as an asset.
 *
 * LIVE CORE SESSION (resolves PROGRESS.md "CARRYOVER→Phase 3 — core bridge over
 * Tauri IPC"): the App is mounted with a real {@link BuildSession} over the
 * IPC-backed {@link createIpcCoreClient}, so the desktop app drives Overview from
 * live stats by routing build.load / calc.run / build.save through the Rust host's
 * allowlisted `core_request` command (DESIGN §5.1, §6.2, §14.1) instead of the
 * Node `node:child_process` CoreClient (which cannot run inside the WebView).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@pob2/ui/styles.css';
import { App } from './App.js';
import { createBuildSession } from './build-session.js';
import { createIpcCoreClient } from './core-ipc-client.js';
import { createOpenSourceResolver, createSaveDeliverer } from './host-bridge.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found in index.html');
}

// The live build data layer: IPC CoreClient -> Rust host -> out-of-process Lua
// runner. `invoke` defaults to @tauri-apps/api so the session is wired to the real
// host (DESIGN §5.1 the host owns the runner).
const session = createBuildSession(createIpcCoreClient());

// Wire the host hooks so Open and Save/Export actually work in the shipped app
// (DESIGN §10.9): Open picks + reads a build file, Save writes XML to a download and
// copies a share code to the clipboard. Without these the commands would be no-ops.
createRoot(container).render(
  <StrictMode>
    <App
      session={session}
      resolveOpenSource={createOpenSourceResolver()}
      deliverSaveResult={createSaveDeliverer()}
    />
  </StrictMode>,
);
