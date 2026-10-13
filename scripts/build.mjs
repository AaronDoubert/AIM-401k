// Bundles the extension into dist/ (load dist/manifest.json in about:debugging).
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist");
const watch = process.argv.includes("--watch");

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "static"), out, { recursive: true });

// pdf.js runs in a worker loaded from the extension package.
cpSync(join(root, "node_modules/pdfjs-dist/build/pdf.worker.min.mjs"), join(out, "pdf.worker.min.mjs"));

// Fonts are bundled locally (no CDN): Geist and Geist Mono (variable weight) and
// Barlow Condensed (500/600, the DIN-style face for headers and buttons), all OFL.
const fonts = {
  "@fontsource/barlow-condensed": ["barlow-condensed-latin-500-normal.woff2", "barlow-condensed-latin-600-normal.woff2"],
  "@fontsource-variable/geist": ["geist-latin-wght-normal.woff2", "geist-latin-ext-wght-normal.woff2"],
  "@fontsource-variable/geist-mono": ["geist-mono-latin-wght-normal.woff2", "geist-mono-latin-ext-wght-normal.woff2"],
};
mkdirSync(join(out, "fonts"), { recursive: true });
for (const [pkg, files] of Object.entries(fonts)) {
  for (const f of files) cpSync(join(root, "node_modules", pkg, "files", f), join(out, "fonts", f));
  cpSync(join(root, "node_modules", pkg, "LICENSE"), join(out, "fonts", `LICENSE-${pkg.split("/")[1]}.txt`));
}

// Logo artwork comes straight from the brand kit in brand/ (the logo is never typed out).
const brand = ["aim401k-wordmark-offwhite.svg", "aim401k-mark-offwhite-transparent.svg"];
mkdirSync(join(out, "brand"), { recursive: true });
for (const f of brand) cpSync(join(root, "brand", f), join(out, "brand", f));

const common = {
  outdir: out,
  bundle: true,
  target: ["firefox128", "chrome120"],
  sourcemap: watch ? "inline" : false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
};

// Background + content scripts: classic scripts (content scripts can't be modules).
const scripts = {
  ...common,
  entryPoints: {
    background: join(root, "src/background/index.ts"),
    content: join(root, "src/content/index.ts"),
    mail: join(root, "src/content/mail.ts"),
    popup: join(root, "src/ui/popup.ts"),
  },
  format: "iife",
};

// Pages that read resumes use pdf.js, which is an ES module: build them as
// modules and share the pdf.js chunk.
const pages = {
  ...common,
  entryPoints: {
    options: join(root, "src/ui/options.ts"),
    onboarding: join(root, "src/ui/onboarding.ts"),
    warroom: join(root, "src/ui/warroom.ts"),
    tracker: join(root, "src/ui/tracker.ts"),
  },
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
};

if (watch) {
  for (const o of [scripts, pages]) await (await context(o)).watch();
  console.log("watching…");
} else {
  await Promise.all([build(scripts), build(pages)]);
}
