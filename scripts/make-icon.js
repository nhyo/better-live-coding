'use strict';
// Generates media/icon.png (128x128) without external dependencies.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const size = 128;
const pixels = Buffer.alloc(size * (size * 4 + 1));
function inside(x, y) {
  const cx = x - 64;
  const cy = y - 64;
  // Rounded square background
  const r = 24;
  const dx = Math.max(Math.abs(cx) - (64 - r), 0);
  const dy = Math.max(Math.abs(cy) - (64 - r), 0);
  return dx * dx + dy * dy <= r * r;
}
function bracket(x, y) {
  // "<" and ">" chevrons
  const e1 = Math.abs(Math.abs(y - 64) - (x - 18)) < 5 && x >= 18 && x <= 40;
  const e2 = Math.abs(Math.abs(y - 64) - (110 - x)) < 5 && x >= 88 && x <= 110;
  return e1 || e2;
}
function play(x, y) {
  // Triangle pointing right, centered
  return x >= 52 && x <= 80 && Math.abs(y - 64) <= (80 - x) * 0.62;
}
for (let y = 0; y < size; y += 1) {
  const row = y * (size * 4 + 1);
  pixels[row] = 0;
  for (let x = 0; x < size; x += 1) {
    const offset = row + 1 + x * 4;
    let rgba = [0, 0, 0, 0];
    if (inside(x, y)) rgba = [30, 30, 46, 255];
    if (inside(x, y) && bracket(x, y)) rgba = [137, 180, 250, 255];
    if (inside(x, y) && play(x, y)) rgba = [166, 227, 161, 255];
    pixels.set(rgba, offset);
  }
}
function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(body) >>> 0 : crc32(body));
  return Buffer.concat([length, body, crc]);
}
function crc32(buffer) {
  let c;
  let crc = 0xffffffff;
  for (const byte of buffer) {
    c = (crc ^ byte) & 0xff;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', header),
  chunk('IDAT', zlib.deflateSync(pixels)),
  chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(path.join(__dirname, '..', 'media', 'icon.png'), png);
console.log('media/icon.png written');
