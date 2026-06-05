import type { Quantity } from "@condenser/core-model";

export interface PlannedCall {
  name: string;
  args: Record<string, unknown>;
}

export interface LocalPlan {
  plan: PlannedCall[];
  finalText: string;
}

// ── small natural-language parsers ────────────────────────────────────────────

function parseFrequency(text: string): Quantity | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(k|meg|m|g)?\s*hz\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]!);
  const p = (m[2] ?? "").toLowerCase();
  const unit = p === "k" ? "kHz" : p === "m" || p === "meg" ? "MHz" : p === "g" ? "GHz" : "Hz";
  return { value, unit };
}

function parseResistance(text: string): Quantity | null {
  // "10k", "4.7k", "220 ohm", "1kΩ", "1 megohm"
  const m = text.match(/(\d+(?:\.\d+)?)\s*(k|meg|m)?\s*(?:Ω|ohms?|r\b)/i) ??
    text.match(/(\d+(?:\.\d+)?)\s*(k|meg|m)\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]!);
  const p = (m[2] ?? "").toLowerCase();
  const unit = p === "k" ? "kΩ" : p === "m" || p === "meg" ? "MΩ" : "Ω";
  return { value, unit };
}

function parseCapacitance(text: string): Quantity | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(p|n|u|µ|m)?\s*f\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]!);
  const p = (m[2] ?? "").toLowerCase();
  const unit =
    p === "p" ? "pF" : p === "n" ? "nF" : p === "u" || p === "µ" ? "µF" : p === "m" ? "mF" : "F";
  return { value, unit };
}

function parseInductance(text: string): Quantity | null {
  const m = text.match(/(\d+(?:\.\d+)?)\s*(p|n|u|µ|m)?\s*h\b/i);
  if (!m) return null;
  const value = parseFloat(m[1]!);
  const p = (m[2] ?? "").toLowerCase();
  const unit =
    p === "p" ? "pH" : p === "n" ? "nH" : p === "u" || p === "µ" ? "µH" : p === "m" ? "mH" : "H";
  return { value, unit };
}

function parseESeries(text: string): "E12" | "E24" | "E96" | undefined {
  const m = text.match(/\bE(12|24|96)\b/i);
  if (!m) return undefined;
  return (`E${m[1]}`.toUpperCase() as "E12" | "E24" | "E96");
}

/**
 * Deterministic offline "agent": maps a handful of intents to concrete tool
 * calls so the prototype is fully usable with no API token. Anything it can't
 * handle returns guidance pointing at the procedures panel or a real provider.
 */
export function planLocalTurn(userText: string): LocalPlan {
  const text = userText.trim();
  const lower = text.toLowerCase();

  if (/\b(clear|reset|new circuit|start over|empty)\b/.test(lower)) {
    return { plan: [{ name: "new_circuit", args: {} }], finalText: "Cleared the schematic." };
  }

  if (/\b(voltage divider|divider)\b/.test(lower)) {
    return {
      plan: [{ name: "load_fixture", args: { name: "divider" } }],
      finalText:
        "Loaded the voltage-divider demo: a 5 V source feeding two 1 kΩ resistors (vmid ≈ 2.5 V).",
    };
  }

  if (/\b(low[- ]?pass|lpf|rc filter)\b/.test(lower)) {
    const fc = parseFrequency(text) ?? { value: 1, unit: "kHz" };
    const impedance = parseResistance(text);
    const eseries = parseESeries(text);
    const params: Record<string, unknown> = { fc };
    if (impedance) params.impedance = impedance;
    const args: Record<string, unknown> = { procedureId: "filter.rc_lpf", params };
    if (eseries) args.constraints = { eseries };
    return {
      plan: [{ name: "insert_module", args }],
      finalText: `Designing an RC low-pass filter at ${fc.value} ${fc.unit} via the deterministic procedure (values are E-series snapped — I never compute them myself).`,
    };
  }

  if (/\b(rc demo|rc low ?pass demo|filter demo)\b/.test(lower)) {
    return {
      plan: [{ name: "load_fixture", args: { name: "rc_lpf" } }],
      finalText: "Loaded the RC low-pass demo (~995 Hz).",
    };
  }

  // add a single component
  if (/\badd\b/.test(lower)) {
    if (/\bresistor\b|\bres\b/.test(lower)) {
      const r = parseResistance(text);
      return {
        plan: [
          {
            name: "add_component",
            args: {
              symbolId: "sym_resistor",
              level: r ? 2 : 0,
              ...(r ? { params: { R: r } } : {}),
            },
          },
        ],
        finalText: r ? `Added a ${r.value} ${r.unit} resistor.` : "Added a resistor.",
      };
    }
    if (/\bcapacitor\b|\bcap\b/.test(lower)) {
      const c = parseCapacitance(text);
      return {
        plan: [
          {
            name: "add_component",
            args: {
              symbolId: "sym_capacitor",
              level: c ? 2 : 0,
              ...(c ? { params: { C: c } } : {}),
            },
          },
        ],
        finalText: c ? `Added a ${c.value} ${c.unit} capacitor.` : "Added a capacitor.",
      };
    }
    if (/\binductor\b/.test(lower)) {
      const l = parseInductance(text);
      return {
        plan: [
          {
            name: "add_component",
            args: {
              symbolId: "sym_inductor",
              level: l ? 2 : 0,
              ...(l ? { params: { L: l } } : {}),
            },
          },
        ],
        finalText: l ? `Added a ${l.value} ${l.unit} inductor.` : "Added an inductor.",
      };
    }
    if (/\b(source|supply|battery|vsource)\b/.test(lower)) {
      return {
        plan: [
          {
            name: "add_component",
            args: {
              symbolId: "sym_vsource",
              level: 1,
              params: { V: { value: 5, unit: "V" } },
            },
          },
        ],
        finalText: "Added a 5 V source.",
      };
    }
  }

  return {
    plan: [],
    finalText:
      "Offline agent — I can: build an RC low-pass filter (\"low-pass filter at 1 kHz\"), load demos (\"voltage divider\"), add parts (\"add a 10k resistor\"), or clear the canvas. For free-form design, add an API token in Agent → Tokens and pick a provider.",
  };
}
