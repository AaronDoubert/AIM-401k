// Builds the extension and zips dist/ into release/aim-401k-<version>.zip.
// Firefox loads the .zip (or the same file renamed .xpi) as a temporary
// add-on, and `web-ext sign` / AMO accept it for signing.
//
//   pnpm package               # build + zip
//   pnpm package --no-build    # zip the existing dist/
//
// No dependencies: a small ZIP writer on top of node:zlib (deflate) + CRC-32.
import { execFileSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = join(root, "dist");
const releaseDir = join(root, "release");

if (!process.argv.includes("--no-build")) execFileSync(process.execPath, [join(root, "scripts/build.mjs")], { stdio: "inherit" });

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));
const version = manifest.version;
if (!/^\d+(\.\d+){0,3}$/.test(version)) throw new Error(`manifest version "${version}" isn't a valid Firefox version`);

// --- CRC-32 (IEEE 802.3) -------------------------------------------------------
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// --- ZIP writer -------------------------------------------------------------------
// One fixed timestamp keeps the archive reproducible for the same dist/.
const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01

/** @param {{ name: string, data: Buffer }[]} files */
export function zip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const deflated = deflateRawSync(f.data, { level: 9 });
    const store = deflated.length >= f.data.length; // incompressible (e.g. PNG): store as-is
    const body = store ? f.data : deflated;
    const method = store ? 0 : 8;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header signature
    local.writeUInt16LE(20, 4); // version needed (2.0)
    local.writeUInt16LE(0x0800, 6); // flags: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central directory header signature
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); // end of central directory signature
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  if (files.length > 0xffff || offset > 0xffffffff) throw new Error("archive too large for a plain ZIP");
  return Buffer.concat([...locals, cd, end]);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const skip = /(^|\/)(\.DS_Store|Thumbs\.db)$|\.map$/;
const files = walk(dist)
  .map((full) => ({ name: relative(dist, full).split(sep).join("/"), full }))
  .filter((f) => !skip.test(f.name))
  // manifest.json first: handy for tools that peek at the first entry.
  .sort((a, b) => (a.name === "manifest.json" ? -1 : b.name === "manifest.json" ? 1 : a.name.localeCompare(b.name)))
  .map((f) => ({ name: f.name, data: readFileSync(f.full) }));

const out = join(releaseDir, `aim-401k-${version}.zip`);
mkdirSync(releaseDir, { recursive: true });
const archive = zip(files);
writeFileSync(out, archive);
const raw = files.reduce((n, f) => n + f.data.length, 0);
console.log(`packaged ${files.length} files (${(raw / 1024).toFixed(0)} KB → ${(archive.length / 1024).toFixed(0)} KB) into ${relative(process.cwd(), out) || out}`);
