import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const PUBLIC_DIR = path.resolve(process.cwd(), 'public');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const combined = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodeOpaquePng(size) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    const ny = y / size;
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      let r = Math.round(7 + ny * 8);
      let g = Math.round(13 + ny * 12);
      let b = Math.round(27 + ny * 19);

      const dist = Math.hypot(nx - 0.5, ny - 0.48);
      if (dist < 0.36) {
        const k = 1 - dist / 0.36;
        r = Math.min(255, Math.round(r + k * 24));
        g = Math.min(255, Math.round(g + k * 82));
        b = Math.min(255, Math.round(b + k * 145));
      }

      if (nx >= 0.30 && nx <= 0.70 && ny >= 0.22 && ny <= 0.78) {
        const inFold = nx > 0.58 && ny < 0.34 && nx - 0.58 > ny - 0.22;
        if (!inFold) {
          r = 226;
          g = 240;
          b = 255;
          if (
            nx >= 0.36 &&
            nx <= 0.62 &&
            ((ny >= 0.38 && ny <= 0.42) ||
              (ny >= 0.48 && ny <= 0.52) ||
              (ny >= 0.58 && ny <= 0.62 && nx <= 0.53))
          ) {
            r = 56;
            g = 189;
            b = 248;
          }
        }
      }

      const p = y * stride + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // opaque RGB for clean iOS home-screen corners
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.mkdirSync(PUBLIC_DIR, { recursive: true });
fs.writeFileSync(path.join(PUBLIC_DIR, 'apple-touch-icon.png'), encodeOpaquePng(180));
fs.writeFileSync(path.join(PUBLIC_DIR, 'pwa-192.png'), encodeOpaquePng(192));
fs.writeFileSync(path.join(PUBLIC_DIR, 'pwa-512.png'), encodeOpaquePng(512));
console.log('Generated apple-touch-icon.png (180x180), pwa-192.png, and pwa-512.png');
