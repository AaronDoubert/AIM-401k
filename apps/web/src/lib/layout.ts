import type { CircuitState, Component, Net } from "@condenser/core-model";
import type { Point } from "@condenser/commands";
import { geometryFor, type SymbolGeometry } from "./symbols";

export interface PlacedComponent {
  component: Component;
  center: Point;
  geometry: SymbolGeometry;
  /** absolute world position of each port, keyed by portId */
  portPoints: Record<string, Point>;
}

export interface NetRoute {
  net: Net;
  /** polyline segments, one per member, meeting at the centroid */
  paths: Point[][];
  centroid: Point;
  /** classification used for styling */
  kind: "power" | "ground" | "signal";
}

export interface SchematicModel {
  placed: PlacedComponent[];
  routes: NetRoute[];
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const GRID_X = 220;
const GRID_Y = 170;
const MARGIN_X = 140;
const MARGIN_Y = 120;
const PER_ROW = 4;

/** Assign default grid centers to any components missing a saved position. */
export function ensurePositions(
  circuit: CircuitState,
  positions: Record<string, Point>
): Record<string, Point> {
  const next = { ...positions };
  let slot = Object.keys(next).length;
  for (const c of circuit.components) {
    if (!next[c.id]) {
      const col = slot % PER_ROW;
      const row = Math.floor(slot / PER_ROW);
      next[c.id] = { x: MARGIN_X + col * GRID_X, y: MARGIN_Y + row * GRID_Y };
      slot++;
    }
  }
  return next;
}

function classifyNet(net: Net): NetRoute["kind"] {
  const name = (net.name ?? "").toUpperCase();
  if (/(^|[^A-Z])(GND|VSS|AGND|DGND|0V)([^A-Z]|$)/.test(name)) return "ground";
  if (/(VCC|VDD|VBAT|VIN|VOUT|V\+|VPLUS|\+\d|RAIL)/.test(name)) return "power";
  return "signal";
}

/** Build the full positioned schematic model from circuit state + positions. */
export function buildSchematic(
  circuit: CircuitState,
  positions: Record<string, Point>
): SchematicModel {
  const byId = new Map<string, PlacedComponent>();
  const placed: PlacedComponent[] = circuit.components.map((component) => {
    const center = positions[component.id] ?? { x: MARGIN_X, y: MARGIN_Y };
    const geometry = geometryFor(component);
    const portPoints: Record<string, Point> = {};
    for (const p of geometry.ports) {
      portPoints[p.id] = { x: center.x + p.dx, y: center.y + p.dy };
    }
    const pc: PlacedComponent = { component, center, geometry, portPoints };
    byId.set(component.id, pc);
    return pc;
  });

  const routes: NetRoute[] = [];
  for (const net of circuit.nets) {
    const anchors: Point[] = [];
    for (const m of net.members) {
      const pc = byId.get(m.componentId);
      const pt = pc?.portPoints[m.portId];
      if (pt) anchors.push(pt);
    }
    if (anchors.length === 0) continue;
    const centroid = {
      x: anchors.reduce((s, p) => s + p.x, 0) / anchors.length,
      y: anchors.reduce((s, p) => s + p.y, 0) / anchors.length,
    };
    const paths = anchors.map((a) => {
      // Manhattan elbow: out from the port, across to the centroid column,
      // then down/up to the centroid.
      return [
        a,
        { x: centroid.x, y: a.y },
        centroid,
      ];
    });
    routes.push({ net, paths, centroid, kind: classifyNet(net) });
  }

  // Bounds across all components (+ a margin) for fit-to-view.
  let minX = 0;
  let minY = 0;
  let maxX = 600;
  let maxY = 400;
  if (placed.length > 0) {
    minX = Infinity;
    minY = Infinity;
    maxX = -Infinity;
    maxY = -Infinity;
    for (const pc of placed) {
      const { center, geometry } = pc;
      const ext = Math.max(geometry.halfW, geometry.halfH) + 70;
      minX = Math.min(minX, center.x - ext);
      minY = Math.min(minY, center.y - ext);
      maxX = Math.max(maxX, center.x + ext);
      maxY = Math.max(maxY, center.y + ext);
    }
  }
  return { placed, routes, bounds: { minX, minY, maxX, maxY } };
}
