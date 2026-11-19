// A small PNG encoder for the raster layer: indexed color (a palette, with transparency) when the image has 256
// colors or fewer, else RGBA; deflate with LZ77 matches and the fixed Huffman codes; its own base64. It is plain
// JavaScript, so Node and the browser write the same bytes and the same SVG.

// width × height pixels, rgba: Uint8Array of width × height × 4 bytes, rows from the top. Returns a data URI.
export function pngDataURI(width, height, rgba) {
  const indexed = palette(rgba);
  const depth = indexed ? 1 : 4; // bytes per pixel
  const raw = new Uint8Array(height * (width * depth + 1)); // each row starts with filter type 0 (none)
  for (let y = 0; y < height; y++) {
    const at = y * (width * depth + 1) + 1;
    if (indexed) raw.set(indexed.pixels.subarray(y * width, (y + 1) * width), at);
    else raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), at);
  }
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, indexed ? 3 : 6, 0, 0, 0], 8); // 8 bits; palette or RGBA; deflate; no filter method; no interlace
  const chunks = [chunk("IHDR", header)];
  if (indexed) chunks.push(chunk("PLTE", indexed.plte), chunk("tRNS", indexed.trns));
  chunks.push(chunk("IDAT", zlib(raw)), chunk("IEND", new Uint8Array(0)));
  return `data:image/png;base64,${base64(concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), ...chunks]))}`;
}

// The palette of an image with 256 colors or fewer: { pixels (one index per pixel), plte (RGB), trns (alpha) }.
function palette(rgba) {
  const index = new Map();
  const pixels = new Uint8Array(rgba.length / 4);
  const view = new DataView(rgba.buffer, rgba.byteOffset, rgba.byteLength);
  for (let p = 0; p < pixels.length; p++) {
    const key = view.getUint32(p * 4);
    let k = index.get(key);
    if (k === undefined) {
      if (index.size === 256) return null;
      index.set(key, (k = index.size));
    }
    pixels[p] = k;
  }
  const plte = new Uint8Array(index.size * 3);
  const trns = new Uint8Array(index.size);
  for (const [key, k] of index) {
    plte.set([key >>> 24, (key >>> 16) & 255, (key >>> 8) & 255], k * 3);
    trns[k] = key & 255;
  }
  return { pixels, plte, trns };
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

// --- deflate (RFC 1951) in a zlib stream (RFC 1950): one block with the fixed Huffman codes ---------------------

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const WINDOW = 32768;
const MAX_MATCH = 258;
const HASH = 1 << 16;

export function zlib(data) {
  const bits = bitWriter(Math.ceil(data.length * 1.15) + 64);
  bits.write(1, 1); // the last block
  bits.write(1, 2); // fixed Huffman codes
  // Greedy LZ77: at each byte, the most recent earlier place with the same 3 bytes (one candidate per hash, so the
  // runs of a raster, at distance 1 or 4, and the repeated rows are found), extended up to 258 bytes.
  const head = new Int32Array(HASH).fill(-1);
  const hash = (i) => ((data[i] << 10) ^ (data[i + 1] << 5) ^ data[i + 2]) & (HASH - 1);
  let i = 0;
  while (i < data.length) {
    let length = 0;
    let distance = 0;
    if (i + 2 < data.length) {
      const h = hash(i);
      const j = head[h];
      head[h] = i;
      if (j >= 0 && i - j <= WINDOW) {
        const max = Math.min(MAX_MATCH, data.length - i);
        while (length < max && data[j + length] === data[i + length]) length++;
        distance = i - j;
      }
    }
    if (length >= 3) {
      lengthCode(bits, length);
      distanceCode(bits, distance);
      for (let k = i + 1; k < i + length && k + 2 < data.length; k++) head[hash(k)] = k;
      i += length;
    } else {
      literal(bits, data[i]);
      i++;
    }
  }
  literal(bits, 256); // the end of the block
  const body = bits.bytes();
  const out = new Uint8Array(2 + body.length + 4);
  out.set([0x78, 0x01]);
  out.set(body, 2);
  new DataView(out.buffer).setUint32(2 + body.length, adler32(data));
  return out;
}

// Fixed Huffman code of a literal/length symbol (RFC 1951, 3.2.6): codes are sent most significant bit first.
function literal(bits, symbol) {
  if (symbol < 144) bits.code(0x30 + symbol, 8);
  else if (symbol < 256) bits.code(0x190 + symbol - 144, 9);
  else if (symbol < 280) bits.code(symbol - 256, 7);
  else bits.code(0xc0 + symbol - 280, 8);
}

function lengthCode(bits, length) {
  let k = LENGTH_BASE.length - 1;
  while (LENGTH_BASE[k] > length) k--;
  literal(bits, 257 + k);
  bits.write(length - LENGTH_BASE[k], LENGTH_EXTRA[k]);
}

function distanceCode(bits, distance) {
  let k = DIST_BASE.length - 1;
  while (DIST_BASE[k] > distance) k--;
  bits.code(k, 5);
  bits.write(distance - DIST_BASE[k], DIST_EXTRA[k]);
}

// Bits, least significant first (extra bits and headers); Huffman codes are written with their bits reversed.
function bitWriter(size) {
  let buffer = new Uint8Array(size);
  let at = 0;
  let acc = 0;
  let n = 0;
  const push = (byte) => {
    if (at === buffer.length) {
      const bigger = new Uint8Array(buffer.length * 2);
      bigger.set(buffer);
      buffer = bigger;
    }
    buffer[at++] = byte;
  };
  const write = (value, count) => {
    for (let k = 0; k < count; k++) {
      acc |= ((value >>> k) & 1) << n;
      if (++n === 8) {
        push(acc);
        acc = 0;
        n = 0;
      }
    }
  };
  return {
    write,
    code: (value, count) => {
      let reversed = 0;
      for (let k = 0; k < count; k++) reversed |= ((value >>> k) & 1) << (count - 1 - k);
      write(reversed, count);
    },
    bytes: () => {
      if (n) push(acc);
      return buffer.subarray(0, at);
    },
  };
}

function adler32(data) {
  let a = 1;
  let c = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % 65521;
    c = (c + a) % 65521;
  }
  return ((c << 16) | a) >>> 0;
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
  const parts = [];
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    parts.push(B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "="));
  }
  return parts.join("");
}
