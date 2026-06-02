import { describe, it, expect, vi } from 'vitest';
import { createOpenSourceResolver, createSaveDeliverer } from './host-bridge.js';

describe('createOpenSourceResolver', () => {
  it('returns { xml } from the picked file text', async () => {
    const resolve = createOpenSourceResolver(async () => ({
      name: 'build.xml',
      text: '<PathOfBuilding/>',
    }));
    expect(await resolve()).toEqual({ xml: '<PathOfBuilding/>' });
  });

  it('returns null when the user cancels the picker (NO-FALLBACK — no empty build)', async () => {
    const resolve = createOpenSourceResolver(async () => null);
    expect(await resolve()).toBeNull();
  });
});

describe('createSaveDeliverer', () => {
  it('downloads an XML export as a file (never discards it)', async () => {
    const download = vi.fn();
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    await createSaveDeliverer({ download, writeClipboard })({ format: 'xml', data: '<x/>' });
    expect(download).toHaveBeenCalledWith('build.xml', '<x/>');
    expect(writeClipboard).not.toHaveBeenCalled();
  });

  it('copies a share-code export to the clipboard', async () => {
    const download = vi.fn();
    const writeClipboard = vi.fn().mockResolvedValue(undefined);
    await createSaveDeliverer({ download, writeClipboard })({ format: 'shareCode', data: 'eNpA' });
    expect(writeClipboard).toHaveBeenCalledWith('eNpA');
    expect(download).not.toHaveBeenCalled();
  });
});
