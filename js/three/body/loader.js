// Body asset loader. The body mesh is baked offline (`npm run bake:body` → tools/body/bake.mjs) into
// webapp/assets/body/body-<quality>.bin (+ .gz); this module fetches it (relative to this file, so the site may live
// under any sub-path), validates it against the current rig / muscle list and decodes it into typed arrays that are
// shared by every explainer on the page. Pure JS: no three.js, no DOM (Node scripts and tests import it too).
//
// File = 16-byte prelude + JSON header + data blocks (all little-endian):
//   0  u32  magic 'GYMB'          4  u16  format version (BODY_FORMAT)     6  u16  reserved (0)
//   8  u32  JSON byte length H    12 u32  total file length                16 JSON (UTF-8), then the data area
// Header: { kind, format, quality, rig (rigSignature at bake time), bones[], muscles[], vertices, triangles, bounds,
//           attributes: [{ name, size, store, comps, codec, filter, out, normalized, scale, offset, at, bytes }],
//           index: { codec: 'fifo', count, at, bytes }, generator, stats }   — `at` is relative to the data area.
// The loader is driven by the header: a new attribute or another precision needs no change here (see LAYOUTS in
// tools/body/encode.js, the writer).
//
// Attribute block: PLANAR — for every stored component all N values in a row; a 16-bit component is a plane of low
// bytes followed by a plane of high bytes. filter 'delta' = zig-zag coded difference to the previous vertex (modulo
// 2^bits). Planes + deltas cost nothing in the raw file and roughly halve the gzip variant.
//   out 'f32'     value = stored · scale[c] + offset[c]; any other `out` hands the stored integers to the GPU
//                 (with the `normalized` flag the GPU divides by the type's maximum)
//   codec 'oct'   unit vector: 2 stored components (signed-normalised octahedral) → 3 floats; the most negative
//                 integer in the first component = the zero vector; components after the third are plain values
//   codec 'sum1'  components sum to the type's maximum (skin weights): the first one is not stored
// Index block ('fifo'): one byte per triangle in the common case. The decoder keeps the last 16 directed edges and the
// last 16 "fresh" vertices; vertices are numbered in order of first use (`next` = how many were seen so far).
//   byte = k·16 + w   k < 15: the triangle reuses edge k (0 = newest) reversed: (q, p, third vertex)
//                     w = 0: third vertex is new (= next) · 1..14: fresh-vertex list entry w − 1 · 15: varint (next − v)
//   byte = 0xF0       no shared edge: three varints (next − v, 0 = new vertex)
// Varints are LEB128.
import { SKIN_BONES, MUSCLE_IDS, rigSignature } from './rig.js';

export const BODY_MAGIC = 0x424d5947;   // 'GYMB'
export const BODY_FORMAT = 1;
export const PRELUDE = 16;
export const STORES = { u8: [Uint8Array, 1], i8: [Int8Array, 1], u16: [Uint16Array, 2], i16: [Int16Array, 2], f32: [Float32Array, 4] };
const SIGN = { u8: 0, i8: 24, u16: 0, i16: 16 };   // shift that sign-extends a stored bit pattern

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const fail = (msg) => { throw new Error('[body] ' + msg); };
const REBAKE = 'Run "npm run bake:body" and deploy the scripts together with webapp/assets/body/.';

/** Throws a descriptive error unless the asset header matches this build's rig, muscle list and format. */
export function validateHeader(h) {
  if (!h || h.kind !== 'gym-body') fail('not a body asset (unexpected header)');
  if (h.format !== BODY_FORMAT) fail(`asset format ${h.format} is not supported (this build reads format ${BODY_FORMAT}). ${REBAKE}`);
  const diff = (have, want, what) => {
    if (!Array.isArray(have)) fail(`asset header has no ${what} list`);
    const n = Math.max(have.length, want.length);
    for (let i = 0; i < n; i++) {
      if (have[i] !== want[i]) fail(`asset was baked for a different ${what} list (#${i} is "${have[i] ?? '—'}" in the asset, "${want[i] ?? '—'}" in the code). ${REBAKE}`);
    }
  };
  diff(h.bones, SKIN_BONES, 'bone');
  diff(h.muscles, MUSCLE_IDS, 'muscle');
  const sig = rigSignature();
  if (h.rig !== sig) fail(`asset was baked for another rig (asset ${h.rig}, code ${sig}): joint offsets, bind pose or DIM changed. ${REBAKE}`);
  for (const need of ['position', 'normal', 'skinIndex', 'skinWeight', 'muscle', 'fiber', 'shade']) {
    if (!h.attributes?.some((a) => a.name === need)) fail(`asset has no "${need}" attribute. ${REBAKE}`);
  }
}

/** One stored plane → out[o + i·stride] as floats (stored · mul + add). Undoes the byte planes and the delta filter. */
function planeToFloat(u8, at, n, a, out, o, stride, mul, add) {
  const wide = STORES[a.store][1] === 2, delta = a.filter === 'delta', mask = wide ? 0xffff : 0xff, sh = SIGN[a.store], hi = at + n;
  let prev = 0;
  for (let i = 0; i < n; i++, o += stride) {
    let v = wide ? u8[at + i] | (u8[hi + i] << 8) : u8[at + i];
    if (delta) { prev = (prev + ((v >>> 1) ^ -(v & 1))) & mask; v = prev; }
    out[o] = ((v << sh) >> sh) * mul + add;
  }
}
/** One stored plane → out[o + i·stride] as integers (a signed typed array wraps the bit pattern). */
function planeToInt(u8, at, n, a, out, o, stride) {
  const wide = STORES[a.store][1] === 2, delta = a.filter === 'delta', mask = wide ? 0xffff : 0xff, hi = at + n;
  let prev = 0;
  for (let i = 0; i < n; i++, o += stride) {
    let v = wide ? u8[at + i] | (u8[hi + i] << 8) : u8[at + i];
    if (delta) { prev = (prev + ((v >>> 1) ^ -(v & 1))) & mask; v = prev; }
    out[o] = v;
  }
}

function decodeAttribute(u8, base, a, n) {
  const store = STORES[a.store];
  if (!store) fail(`unknown store type "${a.store}" for attribute "${a.name}"`);
  const size = a.size, comps = a.comps ?? size, width = store[1], at = base + a.at, step = n * width;
  if (at + a.bytes > u8.length || a.bytes !== comps * step) fail(`attribute "${a.name}" block is out of range`);
  if (a.store === 'f32') {   // lossless reference bake: interleaved little-endian floats
    return { array: new Float32Array(u8.buffer.slice(u8.byteOffset + at, u8.byteOffset + at + a.bytes)), itemSize: size, normalized: false };
  }
  if (a.codec === 'oct') {
    const out = new Float32Array(n * size), X = new store[0](n), Y = new store[0](n);
    const max = width === 2 ? 32767 : 127, k = 1 / max;
    planeToInt(u8, at, n, a, X, 0, 1);
    planeToInt(u8, at + step, n, a, Y, 0, 1);
    for (let i = 0, o = 0; i < n; i++, o += size) {
      if (X[i] < -max) continue;   // reserved code: the zero vector
      let x = X[i] * k, y = Y[i] * k;
      const z = 1 - Math.abs(x) - Math.abs(y), t = z < 0 ? -z : 0;
      x += x >= 0 ? -t : t; y += y >= 0 ? -t : t;
      const l = 1 / Math.sqrt(x * x + y * y + z * z);
      out[o] = x * l; out[o + 1] = y * l; out[o + 2] = z * l;
    }
    for (let c = 3; c < size; c++) planeToFloat(u8, at + (c - 1) * step, n, a, out, c, size, a.scale ? a.scale[c] : 1, a.offset ? a.offset[c] : 0);
    return { array: out, itemSize: size, normalized: false };
  }
  if (a.out === 'f32') {
    const out = new Float32Array(n * size);
    for (let c = 0; c < size; c++) planeToFloat(u8, at + c * step, n, a, out, c, size, a.scale ? a.scale[c] : 1, a.offset ? a.offset[c] : 0);
    return { array: out, itemSize: size, normalized: false };
  }
  if (a.out !== a.store) fail(`attribute "${a.name}": cannot output "${a.out}" from store "${a.store}"`);
  const out = new store[0](n * size);
  if (a.codec === 'sum1') {
    const max = width === 2 ? 65535 : 255;
    for (let c = 1; c < size; c++) planeToInt(u8, at + (c - 1) * step, n, a, out, c, size);
    for (let i = 0, o = 0; i < n; i++, o += size) { let sum = 0; for (let c = 1; c < size; c++) sum += out[o + c]; out[o] = max - sum; }
  } else {
    for (let c = 0; c < size; c++) planeToInt(u8, at + c * step, n, a, out, c, size);
  }
  return { array: out, itemSize: size, normalized: !!a.normalized };
}

function decodeIndex(u8, base, ix, nv) {
  const count = ix.count, out = nv > 65535 ? new Uint32Array(count) : new Uint16Array(count);
  let p = base + ix.at;
  const end = p + ix.bytes;
  if (end > u8.length) fail('index block is out of range');
  if (ix.codec !== 'fifo') fail(`unknown index codec "${ix.codec}"`);
  const E0 = new Int32Array(16), E1 = new Int32Array(16), V = new Int32Array(16);
  let eh = 0, vh = 0, next = 0, o = 0, bad = 0;
  while (o < count && p < end) {
    const code = u8[p++], k = code >> 4;
    let a, b, w;
    if (k < 15) {
      const e = (eh - 1 - k) & 15, wc = code & 15;
      a = E1[e]; b = E0[e];
      if (wc === 0) { w = next++; V[vh++ & 15] = w; }
      else if (wc < 15) w = V[(vh - wc) & 15];
      else {
        let x = u8[p++], d = x & 127, sh = 7;
        while (x & 128) { x = u8[p++]; d |= (x & 127) << sh; sh += 7; }
        w = next - d; V[vh++ & 15] = w;
        bad |= d - 1;   // an explicit vertex is never the new one
      }
    } else {
      a = 0; b = 0; w = 0;
      for (let j = 0; j < 3; j++) {
        let x = u8[p++], d = x & 127, sh = 7;
        while (x & 128) { x = u8[p++]; d |= (x & 127) << sh; sh += 7; }
        const v = next - d;
        if (d === 0) next++;
        V[vh++ & 15] = v;
        if (j === 0) a = v; else if (j === 1) b = v; else w = v;
      }
      bad |= a | b;   // a negative index = corrupt data
      E0[eh & 15] = a; E1[eh++ & 15] = b;
    }
    bad |= w;
    E0[eh & 15] = b; E1[eh++ & 15] = w; E0[eh & 15] = w; E1[eh++ & 15] = a;
    out[o++] = a; out[o++] = b; out[o++] = w;
  }
  if (o !== count || p !== end || bad < 0 || next !== nv) fail('index block is corrupt');
  return out;
}

/**
 * Decode a body file.
 * @param {ArrayBuffer|Uint8Array} bytes
 * @param {{validate?: boolean}} [opt]  validate = false skips the rig / muscle check (tools only)
 * @returns {{ header: object, attributes: Record<string, {array: ArrayBufferView, itemSize: number, normalized: boolean}>, index: Uint16Array|Uint32Array }}
 */
export function decodeBody(bytes, { validate = true } = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < PRELUDE) fail('asset is empty or truncated');
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== BODY_MAGIC) fail('not a body asset (bad magic) — the server probably returned an error page');
  const version = dv.getUint16(4, true);
  if (version !== BODY_FORMAT) fail(`asset format ${version} is not supported (this build reads format ${BODY_FORMAT}). ${REBAKE}`);
  const hLen = dv.getUint32(8, true), total = dv.getUint32(12, true);
  if (total !== u8.length) fail(`asset is truncated (${u8.length} of ${total} bytes)`);
  let header;
  try { header = JSON.parse(new TextDecoder().decode(u8.subarray(PRELUDE, PRELUDE + hLen))); } catch { fail('asset header is not valid JSON'); }
  if (validate) validateHeader(header);
  const base = PRELUDE + hLen, n = header.vertices;
  const attributes = {};
  for (const a of header.attributes) attributes[a.name] = decodeAttribute(u8, base, a, n);
  const index = decodeIndex(u8, base, header.index, n);
  if (index.length !== header.triangles * 3) fail('index count does not match the triangle count');
  return { header, attributes, index };
}

// ── fetching ──────────────────────────────────────────────────────────────────────────────────────────────────
const DEFAULT_BASE = new URL('../../../assets/body/', import.meta.url);
let assetBase = DEFAULT_BASE;
const memo = new Map();

/** Dev/tooling: load the body from another directory (URL, or path relative to the page); null = the shipped one. */
export function setBodyAssetBase(url) {
  assetBase = url ? new URL(String(url).replace(/\/?$/, '/'), typeof location !== 'undefined' ? location.href : import.meta.url) : DEFAULT_BASE;
}
export const bodyAssetUrl = (quality, gz = false) => new URL(`body-${quality === 'low' ? 'low' : 'high'}.bin${gz ? '.gz' : ''}`, assetBase);

async function fetchBytes(url) {
  if (url.protocol === 'file:') {   // Node (tests, tools): fetch() does not read files
    const { readFile } = await import('node:fs/promises');
    const b = await readFile(url);
    return new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  }
  // no-cache = always revalidate: after a deploy the scripts never meet a stale body (it costs one conditional request).
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.pathname}`);
  return new Uint8Array(await res.arrayBuffer());
}
const isGzip = (u8) => u8.length > 2 && u8[0] === 0x1f && u8[1] === 0x8b;
const isBody = (u8) => u8.length > 4 && u8[0] === 0x47 && u8[1] === 0x59 && u8[2] === 0x4d && u8[3] === 0x42;   // 'GYMB'
async function gunzip(u8) {
  return new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}

async function loadBody(quality) {
  const t0 = now();
  const canInflate = typeof DecompressionStream === 'function';
  let bytes = null, transfer = 0, gz = false, url = null;
  if (canInflate) {
    try {
      url = bodyAssetUrl(quality, true);
      const packed = await fetchBytes(url);
      transfer = packed.length;
      // A server may already have undone the gzip (Content-Encoding) — then these are the raw bytes.
      bytes = isGzip(packed) ? await gunzip(packed) : packed;
      // …or it answered 200 with its own "not found" page: not ours either way → try the raw file
      if (!isBody(bytes)) bytes = null; else gz = true;
    } catch { bytes = null; }   // no .gz on the server or a broken download → take the raw file
  }
  if (!bytes) {
    url = bodyAssetUrl(quality, false);
    try { bytes = await fetchBytes(url); } catch (e) { fail(`cannot load the body asset (${e.message}). Is webapp/assets/body/ deployed? ${REBAKE}`); }
    transfer = bytes.length;
    if (isGzip(bytes) && canInflate) bytes = await gunzip(bytes);
  }
  const t1 = now();
  const data = decodeBody(bytes);
  const t2 = now();
  const h = data.header;
  data.stats = {
    quality: h.quality, vertices: h.vertices, triangles: h.triangles, gz, transferBytes: transfer, rawBytes: bytes.length, url: String(url),
    ms: { fetch: t1 - t0, decode: t2 - t1, total: t2 - t0 }, bake: h.stats || null,
  };
  try { performance.measure('body:fetch', { start: t0, end: t1 }); performance.measure('body:decode', { start: t1, end: t2 }); } catch { /* no User Timing */ }
  return data;
}

/**
 * Promise of the decoded body for a quality ('high' | 'low'): { header, attributes, index, stats }.
 * Memoised per quality (and asset directory); a failed load is forgotten so a later call can retry.
 * Calling it early (before the renderer exists) simply starts the download.
 */
export function getBodyData(quality = 'high') {
  const q = quality === 'low' ? 'low' : 'high', key = assetBase.href + q;
  if (!memo.has(key)) memo.set(key, loadBody(q).catch((e) => { memo.delete(key); throw e; }));
  return memo.get(key);
}
