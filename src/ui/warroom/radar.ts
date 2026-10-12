// The War Room radar: a canvas PPI scope with a rotating sweep and phosphor
// trail. Each job is a blip at a bearing hashed from its id; its range ring
// says where it is in the pipeline (outer = recon, mid = filling, inner = holding).
import { blipPolar, type DisplayPhase, phosphor, polarToXY, RING_RADIUS } from "./model";

export interface Blip {
  id: string;
  label: string;
  phase: DisplayPhase;
}

interface BlipState extends Blip {
  angle: number;
  r: number;
  target: number;
  changedAt: number;
  /** Removed from the feed: fading out since. */
  goneAt: number | null;
}

// Brand palette: the scope itself is off-white on near-black; signal colors mark status only.
const C = {
  scope: "241,237,228",
  bone: "241,237,228",
  grey: "161,157,148",
  ok: "134,192,149",
  warn: "220,174,94",
  alert: "236,95,72",
};
const FONT = '9px "Geist Mono AIM", "Geist Mono", ui-monospace, "SF Mono", Menlo, Consolas, monospace';

const SWEEP_MS = 4200;
const TRAIL = (Math.PI / 180) * 75;
const FADE_MS = 1500;
const DELIVERED_MS = 7000;

function colorOf(phase: DisplayPhase): string {
  switch (phase) {
    case "holding":
      return C.warn;
    case "releasing":
      return C.bone;
    case "lost":
      return C.alert;
    case "delivered":
      return C.ok;
    default:
      return C.bone;
  }
}

export class Radar {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly blips = new Map<string, BlipState>();
  private readonly t0 = performance.now();
  private raf = 0;
  private size = 0;
  private dpr = 1;
  private readonly reduced: boolean;
  private ringLabels: [string, string, string] = ["", "", ""];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wrap = canvas.parentElement ?? canvas;
    const fit = () => {
      const w = wrap.clientWidth;
      const h = wrap.clientHeight || w;
      const size = Math.max(160, Math.floor(Math.min(w, h)));
      if (size === this.size && this.dpr === (window.devicePixelRatio || 1)) return;
      this.size = size;
      this.dpr = window.devicePixelRatio || 1;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.width = Math.round(size * this.dpr);
      canvas.height = Math.round(size * this.dpr);
      this.draw(performance.now());
    };
    if (typeof ResizeObserver === "function") new ResizeObserver(fit).observe(wrap);
    fit();
  }

  setRingLabels(outer: string, mid: string, inner: string): void {
    this.ringLabels = [outer, mid, inner];
    if (this.reduced) this.draw(performance.now());
  }

  setBlips(list: Blip[]): void {
    const now = performance.now();
    const ids = new Set(list.map((b) => b.id));
    for (const b of list) {
      const { angle, r } = blipPolar(b.id, b.phase);
      const cur = this.blips.get(b.id);
      if (!cur) {
        // New contacts drop in from the rim.
        this.blips.set(b.id, { ...b, angle, r: this.reduced ? r : 1, target: r, changedAt: now, goneAt: null });
        continue;
      }
      if (cur.phase !== b.phase) cur.changedAt = now;
      cur.phase = b.phase;
      cur.label = b.label;
      cur.target = r;
      cur.goneAt = null;
    }
    for (const [id, b] of this.blips) {
      if (ids.has(id)) continue;
      if (this.reduced) this.blips.delete(id);
      else b.goneAt ??= now;
    }
    if (this.reduced) this.draw(now);
  }

  start(): void {
    if (this.reduced) {
      this.draw(performance.now());
      return;
    }
    const loop = (t: number) => {
      this.draw(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  // -------------------------------------------------------------------------

  private draw(now: number): void {
    const { ctx, size, dpr } = this;
    if (!size) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const c = size / 2;
    const R = c - 16;
    const sweep = this.reduced ? (Math.PI * 7) / 4 : (((now - this.t0) % SWEEP_MS) / SWEEP_MS) * Math.PI * 2;

    this.drawScope(c, R);
    this.drawSweep(c, R, sweep);
    this.drawBlips(c, R, sweep, now);

    // Center pip.
    ctx.strokeStyle = `rgba(${C.bone},.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(c, c, 3, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawScope(c: number, R: number): void {
    const { ctx } = this;
    const bg = ctx.createRadialGradient(c, c, 0, c, c, R);
    bg.addColorStop(0, "rgba(24,23,21,.95)");
    bg.addColorStop(1, "rgba(12,12,11,.95)");
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.fill();

    // Range rings.
    ctx.lineWidth = 1;
    const rings: [number, string][] = [
      [RING_RADIUS.outer, this.ringLabels[0]],
      [RING_RADIUS.mid, this.ringLabels[1]],
      [RING_RADIUS.inner, this.ringLabels[2]],
    ];
    ctx.setLineDash([2, 4]);
    ctx.strokeStyle = `rgba(${C.scope},.22)`;
    for (const [r] of rings) {
      ctx.beginPath();
      ctx.arc(c, c, r * R, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Crosshairs + diagonals.
    ctx.strokeStyle = `rgba(${C.scope},.12)`;
    ctx.beginPath();
    ctx.moveTo(c - R, c);
    ctx.lineTo(c + R, c);
    ctx.moveTo(c, c - R);
    ctx.lineTo(c, c + R);
    ctx.stroke();
    ctx.strokeStyle = `rgba(${C.scope},.06)`;
    ctx.beginPath();
    const d = R * Math.SQRT1_2;
    ctx.moveTo(c - d, c - d);
    ctx.lineTo(c + d, c + d);
    ctx.moveTo(c + d, c - d);
    ctx.lineTo(c - d, c + d);
    ctx.stroke();

    // Rim + ticks.
    ctx.strokeStyle = `rgba(${C.bone},.35)`;
    ctx.beginPath();
    ctx.arc(c, c, R, 0, Math.PI * 2);
    ctx.stroke();
    for (let deg = 0; deg < 360; deg += 5) {
      const a = (deg * Math.PI) / 180;
      const long = deg % 30 === 0;
      const p1 = polarToXY(a, 1, c, c, R);
      const p2 = polarToXY(a, 1, c, c, R + (long ? 7 : 3.5));
      ctx.strokeStyle = `rgba(${C.bone},${long ? 0.5 : 0.22})`;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Bearings and ring labels.
    ctx.font = FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = `rgba(${C.grey},.7)`;
    for (const deg of [0, 90, 180, 270]) {
      const p = polarToXY((deg * Math.PI) / 180, 1, c, c, R - 10);
      ctx.fillText(String(deg).padStart(3, "0"), p.x, p.y);
    }
    ctx.textAlign = "left";
    ctx.fillStyle = `rgba(${C.scope},.45)`;
    for (const [r, label] of rings) {
      if (!label) continue;
      const p = polarToXY((Math.PI / 180) * 22, r, c, c, R);
      ctx.fillText(label, p.x + 3, p.y - 6);
    }
  }

  private drawSweep(c: number, R: number, sweep: number): void {
    const { ctx } = this;
    const end = sweep - Math.PI / 2; // canvas angles start at east
    const start = end - TRAIL;
    const g = ctx as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient };
    if (typeof g.createConicGradient === "function") {
      const grad = g.createConicGradient(start, c, c);
      grad.addColorStop(0, `rgba(${C.scope},0)`);
      grad.addColorStop(TRAIL / (Math.PI * 2), `rgba(${C.scope},.18)`);
      grad.addColorStop(Math.min(1, TRAIL / (Math.PI * 2) + 0.0001), `rgba(${C.scope},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(c, c);
      ctx.arc(c, c, R, start, end);
      ctx.closePath();
      ctx.fill();
    } else {
      const steps = 24;
      for (let i = 0; i < steps; i++) {
        const a0 = start + (TRAIL * i) / steps;
        ctx.fillStyle = `rgba(${C.scope},${(0.18 * (i + 1)) / steps})`;
        ctx.beginPath();
        ctx.moveTo(c, c);
        ctx.arc(c, c, R, a0, a0 + TRAIL / steps + 0.01);
        ctx.closePath();
        ctx.fill();
      }
    }
    const tip = polarToXY(sweep, 1, c, c, R);
    ctx.save();
    ctx.strokeStyle = `rgba(${C.scope},.9)`;
    ctx.shadowColor = `rgba(${C.scope},.4)`;
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawBlips(c: number, R: number, sweep: number, now: number): void {
    const { ctx } = this;
    for (const [id, b] of this.blips) {
      if (!this.reduced) b.r += (b.target - b.r) * 0.06;
      let fade = 1;
      if (b.goneAt != null) {
        fade = 1 - (now - b.goneAt) / FADE_MS;
        if (fade <= 0) {
          this.blips.delete(id);
          continue;
        }
      }
      const since = now - b.changedAt;
      if (b.phase === "delivered") fade *= Math.max(0, 1 - since / DELIVERED_MS);
      if (b.phase === "lost") fade *= Math.max(0.15, 1 - since / DELIVERED_MS);
      if (fade <= 0) continue;

      const { x, y } = polarToXY(b.angle, b.r, c, c, R);
      const glow = this.reduced ? 1 : phosphor(sweep, b.angle);
      const alpha = Math.min(1, glow * fade);
      const col = colorOf(b.phase);

      ctx.save();
      ctx.shadowColor = `rgba(${col},${alpha})`;
      ctx.shadowBlur = 10 * glow;
      ctx.fillStyle = `rgba(${col},${alpha})`;
      if (b.phase === "queued") {
        ctx.strokeStyle = `rgba(${col},${alpha * 0.8})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 2.5, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.phase === "lost") {
        ctx.strokeStyle = `rgba(${col},${alpha})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x - 4, y - 4);
        ctx.lineTo(x + 4, y + 4);
        ctx.moveTo(x + 4, y - 4);
        ctx.lineTo(x - 4, y + 4);
        ctx.stroke();
      } else if (b.phase === "releasing") {
        ctx.beginPath();
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x + 5, y);
        ctx.lineTo(x, y + 5);
        ctx.lineTo(x - 5, y);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, b.phase === "holding" ? 4 : 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Holding: pulsing caution ring. Delivered: expanding flash.
      if (b.phase === "holding" && !this.reduced) {
        const p = (since % 1400) / 1400;
        ctx.strokeStyle = `rgba(${C.warn},${(1 - p) * 0.8 * fade})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, 5 + p * 10, 0, Math.PI * 2);
        ctx.stroke();
      } else if (b.phase === "holding") {
        ctx.strokeStyle = `rgba(${C.warn},.6)`;
        ctx.beginPath();
        ctx.arc(x, y, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (b.phase === "delivered" && !this.reduced && since < 2400) {
        for (const k of [0, 400]) {
          const p = Math.max(0, since - k) / 2000;
          if (p <= 0 || p >= 1) continue;
          ctx.strokeStyle = `rgba(${C.scope},${(1 - p) * 0.9})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, 4 + p * 26, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      if (b.label) {
        // Labels sit radially outward from the blip, so a cluster near the center fans out.
        const ox = Math.sin(b.angle);
        const oy = -Math.cos(b.angle);
        ctx.font = FONT;
        ctx.textAlign = ox >= 0 ? "left" : "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = `rgba(${C.bone},${Math.max(0.35, alpha) * 0.85 * fade})`;
        ctx.fillText(b.label, x + ox * 9 + (ox >= 0 ? 2 : -2), y + oy * 9);
      }
    }
  }
}
