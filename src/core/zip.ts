// Minimal ZIP reader/writer for the Office formats we touch (.docx resumes,
// .xlsx spreadsheets). Reading inflates with the platform DecompressionStream;
// writing produces an uncompressed ("stored") archive, which every spreadsheet
// app opens. No dependencies, no ZIP64, no encryption.

export interface ZipEntry {
  name: string;
  method: number;
  size: number;
  local: number;
}

const toBytes = (buf: ArrayBuffer | Uint8Array): Uint8Array => (buf instanceof Uint8Array ? buf : new Uint8Array(buf));

export async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Entries from the central directory, or null when this isn't a readable ZIP. */
export function zipEntries(input: ArrayBuffer | Uint8Array): ZipEntry[] | null {
  const bytes = toBytes(input);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = bytes.byteLength;
  let eocd = -1;
  for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (p + 46 > len || v.getUint32(p, true) !== 0x02014b50) return out.length ? out : null;
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    out.push({
      name: dec.decode(bytes.subarray(p + 46, p + 46 + nameLen)),
      method: v.getUint16(p + 10, true),
      size: v.getUint32(p + 20, true),
      local: v.getUint32(p + 42, true),
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/** Read one entry's bytes. Names match exactly, then case-insensitively. */
export async function unzipEntry(input: ArrayBuffer | Uint8Array, wanted: string, entries = zipEntries(input)): Promise<Uint8Array | null> {
  if (!entries) return null;
  const e = entries.find((x) => x.name === wanted) ?? entries.find((x) => x.name.toLowerCase() === wanted.toLowerCase());
  if (!e) return null;
  const bytes = toBytes(input);
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (e.local + 30 > bytes.byteLength) return null;
  const start = e.local + 30 + v.getUint16(e.local + 26, true) + v.getUint16(e.local + 28, true);
  const data = bytes.subarray(start, start + e.size);
  if (e.method === 0) return data;
  if (e.method === 8) return inflateRaw(data);
  return null;
}

// --- writer ------------------------------------------------------------------

let CRC_TABLE: Uint32Array | null = null;

export function crc32(data: Uint8Array): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** Build a ZIP with every entry stored (no compression). */
export function zipStore(files: { name: string; data: Uint8Array | string }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Fixed DOS timestamp (1980-01-01): keeps output deterministic.
  const time = 0;
  const date = (0 << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);

    parts.push(local, data);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
  let p = 0;
  for (const a of all) {
    out.set(a, p);
    p += a.length;
  }
  return out;
}
