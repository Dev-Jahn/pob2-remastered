/**
 * compression-adapter — the PoB build share-code codec.
 *
 * A PoB share code is `base64url( zlib.deflate( buildXml ) )` (DESIGN §6.3
 * build.loadShareCode / build.exportShareCode, §12.2 "Existing PoB XML/share
 * code"): the build XML is zlib-deflated and the bytes are base64-encoded with the
 * URL-safe alphabet (`+`->`-`, `/`->`_`). This mirrors the upstream Lua path,
 * `common.base64.encode(Deflate(SaveDB('code')))` with the `+`/`/` substitution
 * (Modules/Build.lua share path), which the HEADLESS core cannot perform because
 * `HeadlessWrapper.lua` stubs Deflate/Inflate to "" (see spec/build_io_spec.lua).
 * Node's zlib supplies the real DEFLATE here, so the client owns the codec and the
 * round-trip works end to end without any vendor edit.
 *
 * FORMAT: PoB's `Deflate` is the runtime's lzip binding over zlib's `compress`
 * (rundown.md: "lzip (DEFLATE)") — i.e. the ZLIB wrapper (RFC 1950: 2-byte header +
 * Adler-32 trailer), NOT raw DEFLATE. Real PoB share codes therefore carry the
 * `0x78 0xda` zlib header (base64 prefix `eNp…`), which is best-compression
 * (`Z_BEST_COMPRESSION`). We encode with that exact level so a code emitted here is
 * BYTE-IDENTICAL to one emitted by upstream PoB (and vice-versa), and decode with
 * the matching zlib inflate — `inflateRaw` would reject these streams.
 *
 * This is the `compression-adapter` the share-code client wrappers delegate to.
 */
import { constants, deflateSync, inflateSync } from 'node:zlib';

/** Decode a URL-safe base64 share-code alphabet back to standard base64. */
function fromBase64Url(code: string): string {
  return code.replace(/-/g, '+').replace(/_/g, '/');
}

/** Encode standard base64 to the URL-safe share-code alphabet. */
function toBase64Url(b64: string): string {
  return b64.replace(/\+/g, '-').replace(/\//g, '_');
}

/** Encode build XML to a PoB share code: base64url(deflate(xml)). */
export function encodeShareCode(xml: string): string {
  // Z_BEST_COMPRESSION (level 9) to match upstream PoB's lzip Deflate byte-for-byte
  // (zlib `0x78 0xda` header); see the module FORMAT note.
  const deflated = deflateSync(Buffer.from(xml, 'utf8'), {
    level: constants.Z_BEST_COMPRESSION,
  });
  return toBase64Url(deflated.toString('base64'));
}

/** Decode a PoB share code back to build XML: inflate(base64(code)). */
export function decodeShareCode(code: string): string {
  const deflated = Buffer.from(fromBase64Url(code), 'base64');
  return inflateSync(deflated).toString('utf8');
}
