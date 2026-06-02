import { describe, it, expect } from 'vitest';
import { deflateSync } from 'node:zlib';
import { defaultShareCodeCodec, CoreClientError } from './core-ipc-client.js';

const toBase64Url = (b: Buffer) =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

describe('defaultShareCodeCodec (browser-safe fflate zlib)', () => {
  it('round-trips build XML through encode → decode', () => {
    const xml = '<PathOfBuilding><Build level="92" className="Ranger"/></PathOfBuilding>';
    const code = defaultShareCodeCodec.encode(xml);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/); // base64url, no padding
    expect(defaultShareCodeCodec.decode(code)).toBe(xml);
  });

  it('decodes a code produced by Node zlib (upstream / @pob2/core-client wire format)', () => {
    const xml = '<PathOfBuilding/>';
    const nodeCode = toBase64Url(deflateSync(Buffer.from(xml, 'utf8')));
    // The format is base64url(zlib(xml)); decoding a Node-zlib code must yield the XML.
    expect(defaultShareCodeCodec.decode(nodeCode)).toBe(xml);
  });

  it('encodes to the zlib 0x78 header format Node can inflate (cross-decode)', () => {
    const xml = '<PathOfBuilding test="✓ 한글"/>'; // non-ASCII must survive UTF-8
    const code = defaultShareCodeCodec.encode(xml);
    const bytes = Buffer.from(code.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    expect(bytes[0]).toBe(0x78); // zlib header
    expect(defaultShareCodeCodec.decode(code)).toBe(xml);
  });

  it('throws a BUILD_PARSE_FAILED CoreError on a malformed code (NO-FALLBACK)', () => {
    try {
      defaultShareCodeCodec.decode('@@@ not a valid share code @@@');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CoreClientError);
      expect((err as CoreClientError).code).toBe('BUILD_PARSE_FAILED');
    }
  });
});
