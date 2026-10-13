// Renders promo/teaser/teaser.html to MP4, frame by frame, with a synthesized soundtrack.
//
//   node promo/teaser/render.mjs                 all formats → promo/teaser/renders/
//   node promo/teaser/render.mjs --only 916      one format (916 | 11 | 169)
//   node promo/teaser/render.mjs --fps 30        default 60
//   node promo/teaser/render.mjs --stills        key frames as PNG only, no video
//   node promo/teaser/render.mjs --stills --at 0.5,1.2   stills at these times instead
//   node promo/teaser/render.mjs --serve         preview server; open the printed URL
//
// Needs pnpm install (fonts come from node_modules), ffmpeg on PATH and Playwright
// (global install, like scripts/e2e.mjs). Never runs `playwright install`.
//
// The page draws every frame from TEASER.seek(t), so the output is deterministic. The audio
// reuses the extension's own cues (src/ui/warroom/sound.ts: master caution, delivered click)
// plus dry ticks, placed from the page's TEASER.timeline().
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const out = join(here, "renders");
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : dflt;
};
const FPS = Number(opt("--fps", 60));
const ONLY = opt("--only", null);
const FORMATS = { 916: "9x16", 11: "1x1", 169: "16x9" };

// ---------------------------------------------------------------- static server (repo root)
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".css": "text/css" };
function serve(port = 0) {
  const server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    const file = join(root, path);
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  });
  return new Promise((ok) => server.listen(port, "127.0.0.1", () => ok(server)));
}

if (argv.includes("--serve")) {
  const server = await serve(Number(opt("--port", 4173)));
  console.log(`Preview: http://127.0.0.1:${server.address().port}/promo/teaser/teaser.html?fmt=916  (fmt=916 | 11 | 169)`);
} else {
  await render();
}

// ---------------------------------------------------------------- audio
function synth(timeline, sampleRate = 48000) {
  const len = Math.ceil((timeline.duration + 0.4) * sampleRate);
  const buf = new Float32Array(len);
  const add = (t0, dur, fn) => {
    const s0 = Math.round(t0 * sampleRate);
    const n = Math.round(dur * sampleRate);
    for (let i = 0; i < n && s0 + i < len; i++) if (s0 + i >= 0) buf[s0 + i] += fn(i / sampleRate);
  };
  // Band-limited square, like an OscillatorType "square" without the aliasing.
  const square = (f, x) => {
    let v = 0;
    for (let h = 1; h * f < 9000; h += 2) v += Math.sin(2 * Math.PI * f * h * x) / h;
    return (4 / Math.PI) * v;
  };
  // Envelope from sound.ts tone(): 12 ms attack, hold, 30 ms release.
  const toneEnv = (x, dur) => (x < 0.012 ? x / 0.012 : x > dur - 0.03 ? Math.max(0, (dur - x) / 0.03) : 1);
  const tone = (t0, freq, dur, peak) => add(t0, dur, (x) => peak * toneEnv(x, dur) * square(freq, x));
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  for (const e of timeline.events) {
    switch (e.kind) {
      case "lock": {
        // Lock-on tick: pitch climbs as the fill accelerates.
        const f = 1900 + 1500 * (e.i / e.n);
        add(e.t, 0.03, (x) => 0.32 * Math.exp(-x / 0.006) * Math.sin(2 * Math.PI * f * x) + 0.08 * Math.exp(-x / 0.002) * noise());
        break;
      }
      case "page":
        add(e.t, 0.07, (x) => 0.45 * Math.exp(-x / 0.018) * Math.sin(2 * Math.PI * (160 - 400 * x) * x));
        break;
      case "need":
        add(e.t, 0.05, (x) => 0.4 * Math.exp(-x / 0.012) * Math.sin(2 * Math.PI * 520 * x));
        break;
      case "caution":
        // masterCaution(): 1046 Hz then 784 Hz, twice, 0.46 s apart.
        for (let i = 0; i < 2; i++) {
          tone(e.t + i * 0.46, 1046, 0.18, 0.13);
          tone(e.t + i * 0.46 + 0.2, 784, 0.2, 0.13);
        }
        break;
      case "arrive":
        add(e.t, 0.02, (x) => 0.12 * Math.exp(-x / 0.004) * Math.sin(2 * Math.PI * 1300 * x));
        break;
      case "cut":
        add(e.t, 0.35, (x) => 0.5 * Math.exp(-x / 0.08) * Math.sin(2 * Math.PI * 55 * x));
        break;
      case "ring":
        add(e.t, 0.03, (x) => 0.25 * Math.exp(-x / 0.005) * Math.sin(2 * Math.PI * 2600 * x));
        break;
      case "lockon": {
        // deliveredClick(): sine sweeping 1800 → 700 Hz over 60 ms, gone by 90 ms.
        let ph = 0;
        add(e.t, 0.1, (x) => {
          const f = 1800 * Math.pow(700 / 1800, Math.min(1, x / 0.06));
          ph += (2 * Math.PI * f) / sampleRate;
          const env = x < 0.005 ? x / 0.005 : Math.exp(-(x - 0.005) / 0.02);
          return 0.55 * env * Math.sin(ph);
        });
        break;
      }
      case "type":
        add(e.t, 0.012, (x) => 0.06 * Math.exp(-x / 0.0025) * (Math.sin(2 * Math.PI * 4200 * x) + 0.5 * noise()));
        break;
    }
  }
  let peak = 0;
  for (const v of buf) peak = Math.max(peak, Math.abs(v));
  const gain = peak > 0 ? 0.89 / peak : 1;
  const pcm = Buffer.alloc(44 + len * 2);
  pcm.write("RIFF", 0);
  pcm.writeUInt32LE(36 + len * 2, 4);
  pcm.write("WAVEfmt ", 8);
  pcm.writeUInt32LE(16, 16);
  pcm.writeUInt16LE(1, 20);
  pcm.writeUInt16LE(1, 22);
  pcm.writeUInt32LE(sampleRate, 24);
  pcm.writeUInt32LE(sampleRate * 2, 28);
  pcm.writeUInt16LE(2, 32);
  pcm.writeUInt16LE(16, 34);
  pcm.write("data", 36);
  pcm.writeUInt32LE(len * 2, 40);
  for (let i = 0; i < len; i++) pcm.writeInt16LE(Math.round(Math.max(-1, Math.min(1, buf[i] * gain)) * 32767), 44 + i * 2);
  return pcm;
}

// ---------------------------------------------------------------- render
async function render() {
  const require = createRequire(import.meta.url);
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch {
    ({ chromium } = require(join(process.execPath, "../../lib/node_modules/playwright")));
  }
  mkdirSync(out, { recursive: true });
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  const wav = join(tmpdir(), `aim401k-teaser-${process.pid}.wav`);
  try {
    for (const fmt of Object.keys(FORMATS)) {
      if (ONLY && ONLY !== fmt) continue;
      const page = await browser.newPage({ viewport: { width: 100, height: 100 }, deviceScaleFactor: 1 });
      await page.goto(`${base}/promo/teaser/teaser.html?render=1&fmt=${fmt}`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 30_000 });
      const [w, h] = await page.evaluate(() => window.TEASER.size);
      await page.setViewportSize({ width: w, height: h });
      const tl = await page.evaluate(() => window.TEASER.timeline());
      const name = `aim401k-teaser-${FORMATS[fmt]}`;

      // Key frames: the fill at full speed, the hold, and the end card.
      const at = opt("--at", null);
      const stills = at
        ? Object.fromEntries(at.split(",").map((t) => [`t${Number(t).toFixed(2)}`, Number(t)]))
        : { fill: tl.T.hold - 0.5, hold: tl.T.end - 0.15, end: tl.duration - 0.05 };
      for (const [label, t] of Object.entries(stills)) {
        await page.evaluate((t) => window.TEASER.seek(t), t);
        await page.screenshot({ path: join(out, `${name}-${label}.png`) });
      }
      if (argv.includes("--stills")) {
        await page.close();
        console.log(`ok   ${name} stills`, JSON.stringify(tl.T));
        continue;
      }

      writeFileSync(wav, synth(tl));
      const file = join(out, `${name}.mp4`);
      const ff = spawn("ffmpeg", [
        "-y", "-loglevel", "error",
        "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "png", "-i", "-",
        "-i", wav,
        "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-r", String(FPS),
        "-c:a", "aac", "-b:a", "192k", "-shortest", "-movflags", "+faststart",
        file,
      ], { stdio: ["pipe", "inherit", "inherit"] });
      const done = new Promise((ok, fail) => ff.on("close", (c) => (c === 0 ? ok() : fail(new Error(`ffmpeg exited ${c}`)))));
      const frames = Math.round(tl.duration * FPS);
      const t0 = Date.now();
      for (let f = 0; f <= frames; f++) {
        await page.evaluate((t) => window.TEASER.seek(t), f / FPS);
        const png = await page.screenshot({ type: "png" });
        if (!ff.stdin.write(png)) await new Promise((ok) => ff.stdin.once("drain", ok));
        if (f % 60 === 0) process.stdout.write(`\r     ${name} ${f}/${frames}`);
      }
      ff.stdin.end();
      await done;
      await page.close();
      console.log(`\rok   ${name}.mp4  ${tl.duration.toFixed(2)} s @ ${FPS} fps, rendered in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  } finally {
    await browser.close();
    server.close();
    rmSync(wav, { force: true });
  }
}
