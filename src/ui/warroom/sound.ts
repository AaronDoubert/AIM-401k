// War Room audio: synthesized with WebAudio, no files. Off unless settings.ui.sound.
// Browsers only start audio after a user gesture, so the context is created
// lazily and resumed on the first click/keypress.

let ctx: AudioContext | null = null;
let enabled = false;

function context(): AudioContext | null {
  if (!enabled) return null;
  try {
    ctx ??= new AudioContext();
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (on) context();
}

/** Call from a user gesture so later alerts are allowed to play. */
export function unlockAudio(): void {
  if (enabled) context();
}

function tone(ac: AudioContext, freq: number, start: number, dur: number, type: OscillatorType, peak: number): void {
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.012);
  gain.gain.setValueAtTime(peak, start + dur - 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(gain).connect(ac.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Master Caution: a two-tone hi/lo chime, twice. Plays when a new prompt arrives. */
export function masterCaution(): void {
  const ac = context();
  if (!ac) return;
  const t = ac.currentTime + 0.02;
  for (let i = 0; i < 2; i++) {
    tone(ac, 1046, t + i * 0.46, 0.18, "square", 0.035);
    tone(ac, 784, t + i * 0.46 + 0.2, 0.2, "square", 0.035);
  }
}

/** Soft confirmation click for a delivered application. */
export function deliveredClick(): void {
  const ac = context();
  if (!ac) return;
  const t = ac.currentTime + 0.01;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(1800, t);
  osc.frequency.exponentialRampToValueAtTime(700, t + 0.06);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(gain).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}
