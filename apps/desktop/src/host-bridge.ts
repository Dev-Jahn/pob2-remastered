/**
 * host-bridge — production wiring of the App's injected host hooks to real WebView
 * APIs (DESIGN §10.9 Import/Export). The App is kept pure and injectable so jsdom
 * tests drive it with mocks; this module supplies the concrete browser/WebView
 * implementations that `main.tsx` injects:
 *
 *  - Open  → pick a build file (`<input type=file>`) and read it as XML.
 *  - Save  → XML to a file download, share code to the system clipboard.
 *
 * These use DOM/Web APIs available inside the Tauri WebView (no `node:*`), and every
 * side-effecting primitive is injectable so the resolver/deliverer LOGIC is unit
 * tested. (Native OS file dialogs via the host's path-validated `open_build_file` /
 * `save_build_file` Rust commands are a UX-polish follow-on.)
 */
import type { BuildSaveResponse } from '@pob2/schema';
import type { OpenSource } from './build-session.js';

/** Pick one build file and read its text, or null if the user cancels. */
export type FilePicker = () => Promise<{ name: string; text: string } | null>;

/** A DOM `<input type=file>` build-file picker (runs in the WebView). */
export function domFilePicker(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xml,.json,.txt';
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      void file.text().then((text) => resolve({ name: file.name, text }));
    });
    input.click();
  });
}

/**
 * The App's `resolveOpenSource`: pick a build file and return it as an
 * {@link OpenSource}. A `.xml`/`.json` file is loaded as build XML; cancelling the
 * picker returns null so the Open command aborts (NO-FALLBACK — no empty build).
 */
export function createOpenSourceResolver(pick: FilePicker = domFilePicker) {
  return async (): Promise<OpenSource | null> => {
    const picked = await pick();
    if (!picked) return null;
    return { xml: picked.text };
  };
}

/** Side-effecting primitives the save deliverer needs (injectable for tests). */
export interface SaveDeliveryDeps {
  /** Trigger a file download of `contents` named `filename`. */
  download: (filename: string, contents: string) => void;
  /** Copy `text` to the system clipboard. */
  writeClipboard: (text: string) => Promise<void>;
}

/** A DOM Blob+anchor file download (runs in the WebView). */
export function domDownload(filename: string, contents: string): void {
  const blob = new Blob([contents], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * The App's `deliverSaveResult`: send the exported build somewhere real — XML to a
 * file download, a share code to the clipboard (DESIGN §10.9). Without this the App
 * would discard the export, so `main.tsx` always injects it.
 */
export function createSaveDeliverer(
  deps: SaveDeliveryDeps = {
    download: domDownload,
    writeClipboard: (text) => navigator.clipboard.writeText(text),
  },
) {
  return async (result: BuildSaveResponse): Promise<void> => {
    if (result.format === 'shareCode') {
      await deps.writeClipboard(result.data);
    } else {
      deps.download('build.xml', result.data);
    }
  };
}
