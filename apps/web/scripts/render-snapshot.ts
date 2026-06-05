/**
 * Headless schematic snapshot renderer.
 *
 * Reuses the app's real layout engine (buildSchematic + symbol geometry) to
 * emit a standalone SVG for a circuit — handy for previews/CI artifacts in
 * environments without a browser. Run with:
 *
 *   pnpm --filter @condenser/web exec vite-node scripts/render-snapshot.ts
 */
import { writeFileSync } from "node:fs";
import type { CircuitState } from "@condenser/core-model";
import { buildSchematic, ensurePositions } from "../src/lib/layout";
import type { SymbolKind } from "../src/lib/symbols";
import { dividerFixture, rcLpfFixture } from "../src/lib/fixtures";

function bodySVG(kind: SymbolKind, halfW: number, halfH: number): string {
  switch (kind) {
    case "resistor":
      return `<rect class="sym-body" x="-32" y="-11" width="64" height="22" rx="2"/>`;
    case "capacitor":
      return `<g class="sym-stroke"><line x1="-6" y1="-16" x2="-6" y2="16"/><line x1="6" y1="-16" x2="6" y2="16"/></g>`;
    case "inductor":
      return `<path class="sym-stroke sym-nofill" d="M -30 0 A 7.5 7.5 0 0 1 -15 0 A 7.5 7.5 0 0 1 0 0 A 7.5 7.5 0 0 1 15 0 A 7.5 7.5 0 0 1 30 0"/>`;
    case "vsource":
      return `<g class="sym-stroke"><circle class="sym-body" cx="0" cy="0" r="22"/><line x1="-6" y1="-9" x2="6" y2="-9"/><line x1="0" y1="-15" x2="0" y2="-3"/><line x1="-6" y1="11" x2="6" y2="11"/></g>`;
    case "diode":
      return `<g class="sym-stroke"><path class="sym-fill" d="M -10 -12 L -10 12 L 12 0 Z"/><line x1="12" y1="-12" x2="12" y2="12"/></g>`;
    default:
      return `<rect class="sym-body" x="${-halfW}" y="${-halfH}" width="${halfW * 2}" height="${halfH * 2}" rx="4"/>`;
  }
}

const STYLE = `
  .bg { fill: #0c0f14; }
  .grid-dot { fill: #1d2530; }
  .lead { stroke: #aeb9c7; stroke-width: 1.6; }
  .sym-body { fill: #1b212b; stroke: #c3ccd8; stroke-width: 1.8; }
  .sym-stroke line, .sym-stroke circle, .sym-stroke path { stroke: #c3ccd8; stroke-width: 1.8; fill: none; }
  .sym-stroke .sym-body { fill: #1b212b; }
  .sym-fill { fill: #c3ccd8; stroke: #c3ccd8; }
  .sym-nofill { fill: none; }
  .port-dot { fill: #0c0f14; stroke: #aeb9c7; stroke-width: 1.4; }
  .node-label { fill: #d9e0e8; font: 600 11px ui-monospace, monospace; }
  .node-params { fill: #4ea1ff; font: 10px ui-monospace, monospace; }
  .lvl0 { fill: #6b7686; } .lvl1 { fill: #4ea1ff; } .lvl2 { fill: #3fb950; } .lvl3 { fill: #c678f0; }
  .lvl-text { fill: #07121f; font: 700 8px ui-monospace, monospace; }
  .wire { fill: none; stroke: #4ea1ff; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .net-power .wire { stroke: #f0883e; } .net-ground .wire { stroke: #8a95a3; }
  .junction { fill: #4ea1ff; } .net-power .junction { fill: #f0883e; } .net-ground .junction { fill: #8a95a3; }
  .net-label { fill: #8a95a3; font: 10px ui-monospace, monospace; }
  .title { fill: #d9e0e8; font: 600 16px system-ui, sans-serif; }
  .sub { fill: #5b6675; font: 12px system-ui, sans-serif; }
`;

function render(circuit: CircuitState, title: string, subtitle: string): string {
  const positions = ensurePositions(circuit, {});
  const model = buildSchematic(circuit, positions);
  const W = 920;
  const H = 560;
  const aspect = W / H;
  const { minX, minY, maxX, maxY } = model.bounds;
  const pad = 50;
  const bw = maxX - minX + pad * 2;
  const bh = maxY - minY + pad * 2;
  const vw = Math.max(bw, bh * aspect);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const vx = cx - vw / 2;
  const vy = cy - vw / aspect / 2;
  const vh = vw / aspect;

  const nets = model.routes
    .map((r) => {
      const polys = r.paths
        .map((p) => `<polyline class="wire" points="${p.map((pt) => `${pt.x},${pt.y}`).join(" ")}"/>`)
        .join("");
      const dot = r.net.members.length > 2 ? `<circle class="junction" cx="${r.centroid.x}" cy="${r.centroid.y}" r="3.5"/>` : "";
      const label = r.net.name ? `<text class="net-label" x="${r.centroid.x + 6}" y="${r.centroid.y - 6}">${r.net.name}</text>` : "";
      return `<g class="net net-${r.kind}">${polys}${dot}${label}</g>`;
    })
    .join("");

  const nodes = model.placed
    .map((pc) => {
      const { component: c, center, geometry: g } = pc;
      const leads = g.ports
        .map((p) => {
          const edge =
            p.facing === "left" ? { x: -g.halfW, y: p.dy }
            : p.facing === "right" ? { x: g.halfW, y: p.dy }
            : p.facing === "up" ? { x: 0, y: -g.halfH }
            : { x: 0, y: g.halfH };
          return `<line class="lead" x1="${p.dx}" y1="${p.dy}" x2="${edge.x}" y2="${edge.y}"/>`;
        })
        .join("");
      const dots = g.ports.map((p) => `<circle class="port-dot" cx="${p.dx}" cy="${p.dy}" r="3"/>`).join("");
      const params = Object.entries(c.params ?? {})
        .map(([k, v]) => `${k}=${v.value} ${v.unit}`)
        .join("  ");
      const label = c.symbolId.replace(/^sym_/, "");
      const badge = `<g transform="translate(${-g.halfW - 2},${-g.halfH - 14})"><rect class="lvl${c.level}" x="0" y="-10" width="20" height="14" rx="3"/><text class="lvl-text" x="10" y="1" text-anchor="middle">L${c.level}</text></g>`;
      const params_t = params ? `<text class="node-params" x="0" y="${g.halfH + 32}" text-anchor="middle">${params}</text>` : "";
      return `<g transform="translate(${center.x},${center.y})">${leads}${bodySVG(g.kind, g.halfW, g.halfH)}${dots}${badge}<text class="node-label" x="0" y="${g.halfH + 18}" text-anchor="middle">${label}</text>${params_t}</g>`;
    })
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <style>${STYLE}</style>
  <defs><pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" class="grid-dot"/></pattern></defs>
  <rect class="bg" x="0" y="0" width="${W}" height="${H}"/>
  <rect x="0" y="0" width="${W}" height="${H}" fill="url(#grid)"/>
  <text class="title" x="24" y="34">${title}</text>
  <text class="sub" x="24" y="52">${subtitle}</text>
  <svg x="0" y="64" width="${W}" height="${H - 64}" viewBox="${vx} ${vy} ${vw} ${vh}" preserveAspectRatio="xMidYMid meet">
    ${nets}
    ${nodes}
  </svg>
</svg>`;
}

const targets: Array<[CircuitState, string, string, string]> = [
  [dividerFixture, "Condenser — Voltage Divider", "5 V source · two 1 kΩ resistors · vmid ≈ 2.5 V (VDD/GND rails styled)", "/tmp/condenser-divider.svg"],
  [rcLpfFixture, "Condenser — RC Low-Pass Filter", "R = 1.6 kΩ · C = 100 nF · fc ≈ 995 Hz (E24 snapped)", "/tmp/condenser-rc-lpf.svg"],
];

for (const [circuit, title, sub, out] of targets) {
  writeFileSync(out, render(circuit, title, sub));
  console.log(`wrote ${out}`);
}
