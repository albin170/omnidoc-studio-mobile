import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = path.resolve(process.cwd());
const RES_DIR = path.join(ROOT, 'android', 'app', 'src', 'main', 'res');

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  const combined = Buffer.concat([typeBuf, data]);
  crcBuf.writeUInt32BE(crc32(combined), 0);
  return Buffer.concat([len, combined, crcBuf]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0;
    rgba.copy(raw, y * stride + 1, y * width * 4, (y + 1) * width * 4);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawOmniDocIcon(size, round = false, transparentBg = false) {
  const buf = Buffer.alloc(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.48;
  const cornerR = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = Math.abs(x + 0.5 - cx);
      const dy = Math.abs(y + 0.5 - cy);

      let insideShape = true;
      if (round) {
        insideShape = Math.hypot(dx, dy) <= radius;
      } else if (!transparentBg) {
        const inner = size / 2 - cornerR;
        if (dx > inner && dy > inner) {
          insideShape = Math.hypot(dx - inner, dy - inner) <= cornerR;
        }
      }

      if (!insideShape && !transparentBg) {
        buf[idx] = 0;
        buf[idx + 1] = 0;
        buf[idx + 2] = 0;
        buf[idx + 3] = 0;
        continue;
      }

      // Indigo (#4F46E5) -> Cyan (#06B6D4) diagonal gradient
      const t = (x + y) / (2 * size);
      let r = Math.round(79 * (1 - t) + 6 * t);
      let g = Math.round(70 * (1 - t) + 182 * t);
      let b = Math.round(229 * (1 - t) + 212 * t);
      let a = transparentBg ? 0 : 255;

      // White document glyph centered
      const nx = x / size;
      const ny = y / size;
      const inDoc = nx >= 0.29 && nx <= 0.71 && ny >= 0.22 && ny <= 0.78;
      const inFoldCut = nx > 0.58 && ny < 0.35 && nx - 0.58 + (0.35 - ny) > 0.13;
      const isLine1 = nx >= 0.36 && nx <= 0.62 && ny >= 0.42 && ny <= 0.46;
      const isLine2 = nx >= 0.36 && nx <= 0.64 && ny >= 0.52 && ny <= 0.56;
      const isLine3 = nx >= 0.36 && nx <= 0.55 && ny >= 0.62 && ny <= 0.66;

      if (inDoc && !inFoldCut) {
        if (isLine1 || isLine2 || isLine3) {
          r = 79;
          g = 70;
          b = 229;
          a = 255;
        } else {
          r = 248;
          g = 250;
          b = 252;
          a = 255;
        }
      }

      buf[idx] = r;
      buf[idx + 1] = g;
      buf[idx + 2] = b;
      buf[idx + 3] = a;
    }
  }
  return encodePng(size, size, buf);
}

function drawSplash(width, height) {
  const buf = Buffer.alloc(width * height * 4);
  const emblemSize = Math.round(Math.min(width, height) * 0.28);
  const startX = Math.floor((width - emblemSize) / 2);
  const startY = Math.floor((height - emblemSize) / 2);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Deep slate background #0B1120
      buf[idx] = 11;
      buf[idx + 1] = 17;
      buf[idx + 2] = 32;
      buf[idx + 3] = 255;

      if (x >= startX && x < startX + emblemSize && y >= startY && y < startY + emblemSize) {
        const lx = (x - startX) / emblemSize;
        const ly = (y - startY) / emblemSize;
        const dx = Math.abs(lx - 0.5);
        const dy = Math.abs(ly - 0.5);
        const corner = 0.22;
        const inner = 0.5 - corner;
        let inside = true;
        if (dx > inner && dy > inner) {
          inside = Math.hypot(dx - inner, dy - inner) <= corner;
        }
        if (inside) {
          const t = (lx + ly) / 2;
          let r = Math.round(79 * (1 - t) + 6 * t);
          let g = Math.round(70 * (1 - t) + 182 * t);
          let b = Math.round(229 * (1 - t) + 212 * t);

          const inDoc = lx >= 0.29 && lx <= 0.71 && ly >= 0.22 && ly <= 0.78;
          const inFoldCut = lx > 0.58 && ly < 0.35 && lx - 0.58 + (0.35 - ly) > 0.13;
          const isLine =
            (lx >= 0.36 && lx <= 0.62 && ly >= 0.42 && ly <= 0.46) ||
            (lx >= 0.36 && lx <= 0.64 && ly >= 0.52 && ly <= 0.56) ||
            (lx >= 0.36 && lx <= 0.55 && ly >= 0.62 && ly <= 0.66);

          if (inDoc && !inFoldCut) {
            if (isLine) {
              r = 79;
              g = 70;
              b = 229;
            } else {
              r = 248;
              g = 250;
              b = 252;
            }
          }
          buf[idx] = r;
          buf[idx + 1] = g;
          buf[idx + 2] = b;
        }
      }
    }
  }
  return encodePng(width, height, buf);
}

if (!fs.existsSync(RES_DIR)) {
  console.error('Android res directory not found. Run "npx cap add android" first.');
  process.exit(1);
}

const densities = [
  { name: 'mipmap-mdpi', icon: 48, fg: 108 },
  { name: 'mipmap-hdpi', icon: 72, fg: 162 },
  { name: 'mipmap-xhdpi', icon: 96, fg: 216 },
  { name: 'mipmap-xxhdpi', icon: 144, fg: 324 },
  { name: 'mipmap-xxxhdpi', icon: 192, fg: 432 },
];

for (const d of densities) {
  const dir = path.join(RES_DIR, d.name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'ic_launcher.png'), drawOmniDocIcon(d.icon, false, false));
  fs.writeFileSync(path.join(dir, 'ic_launcher_round.png'), drawOmniDocIcon(d.icon, true, false));
  fs.writeFileSync(path.join(dir, 'ic_launcher_foreground.png'), drawOmniDocIcon(d.fg, false, true));
}

const valuesDir = path.join(RES_DIR, 'values');
fs.mkdirSync(valuesDir, { recursive: true });
fs.writeFileSync(
  path.join(valuesDir, 'ic_launcher_background.xml'),
  `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0B1120</color>\n</resources>\n`
);

const splashTargets = [
  { dir: 'drawable', w: 480, h: 800 },
  { dir: 'drawable-port-mdpi', w: 320, h: 480 },
  { dir: 'drawable-port-hdpi', w: 480, h: 800 },
  { dir: 'drawable-port-xhdpi', w: 720, h: 1280 },
  { dir: 'drawable-land-mdpi', w: 480, h: 320 },
  { dir: 'drawable-land-hdpi', w: 800, h: 480 },
  { dir: 'drawable-land-xhdpi', w: 1280, h: 720 },
];

for (const s of splashTargets) {
  const dir = path.join(RES_DIR, s.dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'splash.png'), drawSplash(s.w, s.h));
}

console.log('Generated OmniDoc Studio Android icons and splash screens.');
