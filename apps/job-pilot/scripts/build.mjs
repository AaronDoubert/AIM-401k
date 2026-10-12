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

const options = {
  entryPoints: {
    background: join(root, "src/background/index.ts"),
    content: join(root, "src/content/index.ts"),
    popup: join(root, "src/ui/popup.ts"),
    options: join(root, "src/ui/options.ts"),
    tracker: join(root, "src/ui/tracker.ts"),
  },
  outdir: out,
  bundle: true,
  format: "iife",
  target: ["firefox128", "chrome120"],
  sourcemap: watch ? "inline" : false,
  minify: false,
  legalComments: "none",
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
  console.log("watching…");
} else {
  await build(options);
}
