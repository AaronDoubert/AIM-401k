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
    popup: join(root, "src/ui/popup.ts"),
    tracker: join(root, "src/ui/tracker.ts"),
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
