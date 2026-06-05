import type { Component } from "@condenser/core-model";

export type SymbolKind =
  | "resistor"
  | "capacitor"
  | "inductor"
  | "vsource"
  | "isource"
  | "diode"
  | "transistor"
  | "ic"
  | "generic";

/** Map a symbolId string onto a drawable symbol kind. */
export function kindForSymbolId(symbolId: string): SymbolKind {
  const s = symbolId.toLowerCase();
  if (s.includes("resistor") || s === "sym_r") return "resistor";
  if (s.includes("capacitor") || s === "sym_c") return "capacitor";
  if (s.includes("inductor") || s === "sym_l") return "inductor";
  if (s.includes("vsource") || s.includes("vsrc") || s.includes("battery"))
    return "vsource";
  if (s.includes("isource") || s.includes("isrc")) return "isource";
  if (s.includes("diode") || s.includes("led")) return "diode";
  if (s.includes("transistor") || s.includes("bjt") || s.includes("mos"))
    return "transistor";
  if (s.includes("ic") || s.includes("chip") || s.includes("mcu")) return "ic";
  return "generic";
}

/** Reference-designator family letter for a symbol kind (R, C, L, …). */
export function refLetterForKind(kind: SymbolKind): string {
  switch (kind) {
    case "resistor":
      return "R";
    case "capacitor":
      return "C";
    case "inductor":
      return "L";
    case "vsource":
      return "V";
    case "isource":
      return "I";
    case "diode":
      return "D";
    case "transistor":
      return "Q";
    case "ic":
      return "U";
    default:
      return "X";
  }
}

export type Facing = "left" | "right" | "up" | "down";

export interface PortLayout {
  id: string;
  /** offset from the component center, in world units */
  dx: number;
  dy: number;
  facing: Facing;
}

export interface SymbolGeometry {
  kind: SymbolKind;
  /** body half-width / half-height from the center */
  halfW: number;
  halfH: number;
  ports: PortLayout[];
}

const STUB = 26; // length of the pin stub poking out of the body

/**
 * Compute the body size + port anchor offsets for a component, based on its
 * symbol kind and the number / identity of its semantic ports. Two-terminal
 * passives lay out horizontally (a→left, b→right); sources lay out vertically;
 * multi-pin parts (ICs/generics) split their ports across left and right edges.
 */
export function geometryFor(component: Component): SymbolGeometry {
  const kind = kindForSymbolId(component.symbolId);
  const ports = component.semanticPorts;

  // Vertical two-terminal: voltage/current sources (pos/top, neg/bottom).
  if ((kind === "vsource" || kind === "isource") && ports.length <= 2) {
    const halfH = 30;
    const out: PortLayout[] = ports.map((p, i) => ({
      id: p.id,
      dx: 0,
      dy: i === 0 ? -(halfH + STUB) : halfH + STUB,
      facing: i === 0 ? "up" : "down",
    }));
    return { kind, halfW: 30, halfH, ports: out };
  }

  // Horizontal two-terminal passives.
  if (ports.length <= 2 && kind !== "ic") {
    const halfW = 42;
    const out: PortLayout[] = ports.map((p, i) => ({
      id: p.id,
      dx: i === 0 ? -(halfW + STUB) : halfW + STUB,
      dy: 0,
      facing: i === 0 ? "left" : "right",
    }));
    return { kind, halfW, halfH: 18, ports: out };
  }

  // Multi-pin: split ports left / right down the two edges.
  const leftCount = Math.ceil(ports.length / 2);
  const rightCount = ports.length - leftCount;
  const rows = Math.max(leftCount, rightCount, 1);
  const halfH = Math.max(34, rows * 16);
  const halfW = 46;
  const out: PortLayout[] = ports.map((p, i) => {
    const onLeft = i < leftCount;
    const idxInCol = onLeft ? i : i - leftCount;
    const colCount = onLeft ? leftCount : rightCount;
    const span = halfH * 2 - 24;
    const step = colCount > 1 ? span / (colCount - 1) : 0;
    const y = colCount > 1 ? -span / 2 + idxInCol * step : 0;
    return {
      id: p.id,
      dx: onLeft ? -(halfW + STUB) : halfW + STUB,
      dy: y,
      facing: onLeft ? "left" : "right",
    };
  });
  return { kind: kind === "generic" ? "ic" : kind, halfW, halfH, ports: out };
}
