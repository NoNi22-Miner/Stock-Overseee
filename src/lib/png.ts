// Pure helpers for the logo: PNG decoding and picking brand colors from pixels (no native code).
import { unzlibSync } from 'fflate';
import { rgbToHsl, toHex } from './theme';

/**
 * Groups the logo's colored pixels by hue and returns the average color of the biggest groups.
 * Transparent, white, black and grey pixels are left out (they are background or outline).
 */
export function pickColors(rgba: Uint8Array): string[] {
  const buckets = new Map<number, { w: number; r: number; g: number; b: number }>();
  const greys: { w: number; r: number; g: number; b: number } = { w: 0, r: 0, g: 0, b: 0 };
  for (let i = 0; i + 3 < rgba.length; i += 4) {
    const [r, g, b, a] = [rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3]];
    if (a < 160) continue;
    const [h, s, l] = rgbToHsl([r, g, b]);
    if (l > 0.93) continue; // white background
    if (s < 0.22 || l < 0.08) {
      if (l < 0.75) {
        greys.w += 1;
        greys.r += r;
        greys.g += g;
        greys.b += b;
      }
      continue;
    }
    const key = Math.round(h / 20) % 18;
    const w = s * (1 - Math.abs(l - 0.5));
    const cur = buckets.get(key) ?? { w: 0, r: 0, g: 0, b: 0 };
    cur.w += w;
    cur.r += r * w;
    cur.g += g * w;
    cur.b += b * w;
    buckets.set(key, cur);
  }
  const total = [...buckets.values()].reduce((n, x) => n + x.w, 0);
  const colors = [...buckets.values()]
    .filter((x) => x.w >= total * 0.04)
    .sort((a, b) => b.w - a.w)
    .slice(0, 5)
    .map((x) => toHex([x.r / x.w, x.g / x.w, x.b / x.w]));
  // A logo in black / grey only: offer its dark color.
  if (!colors.length && greys.w) colors.push(toHex([greys.r / greys.w, greys.g / greys.w, greys.b / greys.w]));
  return colors;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (B64.indexOf(clean[i]) << 18) |
      (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
      (B64.indexOf(clean[i + 3] ?? 'A') & 63);
    out[o++] = (n >> 16) & 255;
    if (i + 2 < clean.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < clean.length) out[o++] = n & 255;
  }
  return out.slice(0, o);
}

/** A small PNG decoder (8-bit, not interlaced): returns RGBA pixels. */
export function decodePng(bytes: Uint8Array): { width: number; height: number; pixels: Uint8Array } | null {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (sig.some((v, i) => bytes[i] !== v)) return null;
  const u32 = (i: number) => ((bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3]) >>> 0;
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let alpha: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = u32(pos);
    const name = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (name === 'IHDR') {
      width = u32(pos + 8);
      height = u32(pos + 12);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (name === 'PLTE') palette = data;
    else if (name === 'tRNS') alpha = data;
    else if (name === 'IDAT') idat.push(data);
    else if (name === 'IEND') break;
    pos += 12 + len;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[type];
  if (depth !== 8 || interlace !== 0 || !channels || !width || !height) return null;
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of idat) {
    joined.set(c, off);
    off += c.length;
  }
  const raw = unzlibSync(joined);
  const stride = width * channels;
  const img = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = img.subarray(y * stride, (y + 1) * stride);
    const prev = y ? img.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? row[x - channels] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[x] = v & 255;
    }
  }
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const s = i * channels;
    let r: number, g: number, b: number, a: number;
    if (type === 6) [r, g, b, a] = [img[s], img[s + 1], img[s + 2], img[s + 3]];
    else if (type === 2) [r, g, b, a] = [img[s], img[s + 1], img[s + 2], 255];
    else if (type === 4) [r, g, b, a] = [img[s], img[s], img[s], img[s + 1]];
    else if (type === 0) [r, g, b, a] = [img[s], img[s], img[s], 255];
    else {
      const p = img[s] * 3;
      [r, g, b] = palette ? [palette[p], palette[p + 1], palette[p + 2]] : [0, 0, 0];
      a = alpha && img[s] < alpha.length ? alpha[img[s]] : 255;
    }
    pixels.set([r, g, b, a], i * 4);
  }
  return { width, height, pixels };
}
