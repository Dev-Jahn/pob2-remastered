/**
 * main.tsx — the @pob2/desktop React entry (DESIGN §4.2, §5.1 UI layer).
 *
 * Mounts the App root into the #root element from index.html. StrictMode is on
 * to surface unsafe lifecycles early in development.
 *
 * Pulls in the @pob2/ui app-shell stylesheet so the §10.2 3-pane frame and the
 * §10.3 Overview cards render as a laid-out desktop UI rather than a flat
 * unstyled stack; Vite bundles it into dist/ as an asset.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@pob2/ui/styles.css';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) {
  throw new Error('#root element not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
