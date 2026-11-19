// A small PNG encoder (RGBA, 8 bits) for the raster layer. It writes zlib "stored" blocks (no compression) and its
// own base64, so Node and the browser make the same bytes and the same SVG.

// width × height pixels, rgba: Uint8Array of width × height × 4 bytes, rows from the top. Returns a data URI.
export function pngDataURI(width, height, rgba) {
  const row = width * 4;
  const raw = new Uint8Array(height * (row + 1)); // each row starts with filter type 0 (none)
  for (let y = 0; y < height; y++) raw.set(rgba.subarray(y * row, (y + 1) * row), y * (row + 1) + 1);
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits, RGBA, deflate, no filter method, no interlace
  const png = concat([
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
  return `data:image/png;base64,${base64(png)}`;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// zlib stream of stored (uncompressed) deflate blocks of at most 65 535 bytes, with the Adler-32 checksum.
function zlibStored(data) {
  const blocks = Math.max(1, Math.ceil(data.length / 65535));
  const out = new Uint8Array(2 + data.length + blocks * 5 + 4);
  out.set([0x78, 0x01]);
  let at = 2;
  for (let b = 0; b < blocks; b++) {
    const part = data.subarray(b * 65535, Math.min(data.length, (b + 1) * 65535));
    out[at] = b === blocks - 1 ? 1 : 0;
    out[at + 1] = part.length & 0xff;
    out[at + 2] = part.length >> 8;
    out[at + 3] = ~part.length & 0xff;
    out[at + 4] = (~part.length >> 8) & 0xff;
    out.set(part, at + 5);
    at += 5 + part.length;
  }
  let a = 1;
  let c = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    c = (c + a) % 65521;
  }
  new DataView(out.buffer).setUint32(at, ((c << 16) | a) >>> 0);
  return out;
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let c = 0xffffffff;
  for (const v of bytes) c = CRC[(c ^ v) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    s += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return s;
}
