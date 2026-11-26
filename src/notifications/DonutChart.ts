import * as zlib from 'zlib';

// A donut chart as a PNG, with no dependency (2026-11-25, email polish piece B): Gmail strips SVG and CSS charts, so the email embeds a PNG as an
// inline (CID) attachment. The smallest dependency that works on every runner and inside the Playwright container is none: `zlib` is part of Node,
// and a donut is a ring of arc segments, so the renderer rasterises it itself (3x3 supersampling for smooth, anti-aliased edges) and writes the PNG
// chunks by hand (about 100 lines, 0 bytes of install, about 100 ms per render, 4-8 KB per image; measured in scripts/check-donut.ts). The image has
// NO text: the figure ("99.7% first time") is HTML text next to it, so it stays readable, selectable and translatable, and the picture stays sharp at
// any size. It is drawn at 2x (340 px) and shown at 1x (170 px) for sharp screens. A native image library (sharp, canvas, @napi-rs/canvas) would add
// 10-50 MB of binaries per CI job for one 8 KB picture.

export interface DonutSegment {
  value: number;
  color: string; // #RRGGBB
}

const crcTable = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf: Buffer): number => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer): Buffer => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** Angle (degrees, clockwise from 12 o'clock) of each segment's end; a non-zero segment gets at least MIN_DEG so a 1-in-943 slice stays visible. */
function segmentEnds(segments: DonutSegment[]): number[] {
  const MIN_DEG = 4;
  const total = segments.reduce((n, s) => n + s.value, 0);
  const span = segments.map((s) => (s.value > 0 ? Math.max(MIN_DEG, (s.value / total) * 360) : 0));
  const over = span.reduce((n, d) => n + d, 0) - 360;
  if (over > 0) {
    const big = span.indexOf(Math.max(...span));
    span[big] -= over;
  }
  let acc = 0;
  return span.map((d) => (acc += d));
}

/** Renders the donut at `size` px square (default 340 = 2x of the 170 px it is shown at), no text, transparent background and centre. */
export function renderDonutPng(segments: DonutSegment[], size = 340): Buffer {
  const live = segments.filter((s) => s.value > 0);
  if (live.length === 0) throw new Error('renderDonutPng: no segment has a value');
  const ends = segmentEnds(live);
  const colors = live.map((s) => rgb(s.color));
  const c = size / 2;
  const outer = size * 0.47;
  const inner = size * 0.3;
  const SS = 3;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let cover = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let col: [number, number, number] | null = null;
          const dx = px - c;
          const dy = py - c;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d >= inner && d <= outer) {
            let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
            if (deg < 0) deg += 360;
            const i = ends.findIndex((e) => deg < e);
            col = colors[i < 0 ? colors.length - 1 : i];
          }
          if (col) {
            r += col[0];
            g += col[1];
            b += col[2];
            cover += 1;
          }
        }
      }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      if (cover > 0) {
        raw[o] = Math.round(r / cover);
        raw[o + 1] = Math.round(g / cover);
        raw[o + 2] = Math.round(b / cover);
        raw[o + 3] = Math.round((cover / (SS * SS)) * 255);
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
