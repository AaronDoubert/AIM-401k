import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Point } from "@condenser/commands";
import { useController, useSnapshot } from "../state/engineContext";
import {
  buildSchematic,
  type NetRoute,
  type PlacedComponent,
  type SchematicModel,
} from "../lib/layout";
import { fmtQ, levelLabel } from "../lib/format";
import type { SymbolKind } from "../lib/symbols";

interface ViewBox {
  x: number;
  y: number;
  w: number;
}

function pointsAttr(pts: Point[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Symbol body drawn centered at the component origin. */
function SymbolBody({ kind, halfW, halfH }: { kind: SymbolKind; halfW: number; halfH: number }) {
  switch (kind) {
    case "resistor":
      return <rect className="sym-body" x={-32} y={-11} width={64} height={22} rx={2} />;
    case "capacitor":
      return (
        <g className="sym-stroke">
          <line x1={-6} y1={-16} x2={-6} y2={16} />
          <line x1={6} y1={-16} x2={6} y2={16} />
        </g>
      );
    case "inductor":
      return (
        <path
          className="sym-stroke sym-nofill"
          d="M -30 0 A 7.5 7.5 0 0 1 -15 0 A 7.5 7.5 0 0 1 0 0 A 7.5 7.5 0 0 1 15 0 A 7.5 7.5 0 0 1 30 0"
        />
      );
    case "vsource":
      return (
        <g className="sym-stroke">
          <circle className="sym-body" cx={0} cy={0} r={22} />
          <line x1={-6} y1={-9} x2={6} y2={-9} />
          <line x1={0} y1={-15} x2={0} y2={-3} />
          <line x1={-6} y1={11} x2={6} y2={11} />
        </g>
      );
    case "isource":
      return (
        <g className="sym-stroke">
          <circle className="sym-body" cx={0} cy={0} r={22} />
          <line x1={0} y1={12} x2={0} y2={-12} />
          <path className="sym-fill" d="M -4 -6 L 4 -6 L 0 -14 Z" />
        </g>
      );
    case "diode":
      return (
        <g className="sym-stroke">
          <path className="sym-fill" d="M -10 -12 L -10 12 L 12 0 Z" />
          <line x1={12} y1={-12} x2={12} y2={12} />
        </g>
      );
    case "transistor":
      return (
        <g className="sym-stroke">
          <circle className="sym-body" cx={0} cy={0} r={20} />
          <line x1={-6} y1={-12} x2={-6} y2={12} />
          <line x1={-6} y1={-5} x2={10} y2={-14} />
          <line x1={-6} y1={5} x2={10} y2={14} />
        </g>
      );
    case "ic":
    default:
      return <rect className="sym-body" x={-halfW} y={-halfH} width={halfW * 2} height={halfH * 2} rx={4} />;
  }
}

function ComponentNode({
  placed,
  selected,
  onPointerDown,
}: {
  placed: PlacedComponent;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}) {
  const { component, center, geometry } = placed;
  const params = component.params ?? {};
  const paramText = Object.entries(params)
    .map(([k, v]) => `${k}=${fmtQ(v)}`)
    .join("  ");
  const designator = component.symbolId.replace(/^sym_/, "");
  const isIc = geometry.kind === "ic";

  return (
    <g
      className={`node level-${component.level}${selected ? " selected" : ""}`}
      transform={`translate(${center.x},${center.y})`}
      onPointerDown={(e) => onPointerDown(e, component.id)}
    >
      {/* leads from each port to the body edge */}
      {geometry.ports.map((p) => {
        const edge =
          p.facing === "left"
            ? { x: -geometry.halfW, y: p.dy }
            : p.facing === "right"
              ? { x: geometry.halfW, y: p.dy }
              : p.facing === "up"
                ? { x: 0, y: -geometry.halfH }
                : { x: 0, y: geometry.halfH };
        return (
          <line key={`lead-${p.id}`} className="lead" x1={p.dx} y1={p.dy} x2={edge.x} y2={edge.y} />
        );
      })}

      {selected && (
        <rect
          className="select-halo"
          x={-geometry.halfW - 8}
          y={-geometry.halfH - 8}
          width={geometry.halfW * 2 + 16}
          height={geometry.halfH * 2 + 16}
          rx={6}
        />
      )}

      <SymbolBody kind={geometry.kind} halfW={geometry.halfW} halfH={geometry.halfH} />

      {/* pin dots + (for ICs) pin labels */}
      {geometry.ports.map((p) => (
        <g key={`port-${p.id}`}>
          <circle className="port-dot" cx={p.dx} cy={p.dy} r={3} />
          {isIc && (
            <text
              className="pin-label"
              x={p.facing === "left" ? -geometry.halfW + 6 : geometry.halfW - 6}
              y={p.dy + 3}
              textAnchor={p.facing === "left" ? "start" : "end"}
            >
              {p.id}
            </text>
          )}
        </g>
      ))}

      {/* level badge */}
      <g transform={`translate(${-geometry.halfW - 2},${-geometry.halfH - 14})`}>
        <rect className="lvl-badge" x={0} y={-10} width={20} height={14} rx={3} />
        <text className="lvl-text" x={10} y={1} textAnchor="middle">
          {levelLabel(component.level)}
        </text>
      </g>

      {/* designator + id */}
      <text className="node-label" x={0} y={geometry.halfH + 18} textAnchor="middle">
        {designator}
      </text>
      {paramText && (
        <text className="node-params" x={0} y={geometry.halfH + 32} textAnchor="middle">
          {paramText}
        </text>
      )}
      {component.part?.mpn && (
        <text className="node-mpn" x={0} y={geometry.halfH + 46} textAnchor="middle">
          {component.part.mpn}
        </text>
      )}
    </g>
  );
}

function NetWires({ route }: { route: NetRoute }) {
  return (
    <g className={`net net-${route.kind}`}>
      {route.paths.map((path, i) => (
        <polyline key={i} className="wire" points={pointsAttr(path)} />
      ))}
      {route.net.members.length > 2 && (
        <circle className="junction" cx={route.centroid.x} cy={route.centroid.y} r={3.5} />
      )}
      {route.net.name && (
        <text className="net-label" x={route.centroid.x + 6} y={route.centroid.y - 6}>
          {route.net.name}
        </text>
      )}
    </g>
  );
}

function fitToBounds(model: SchematicModel, aspect: number): ViewBox {
  const { minX, minY, maxX, maxY } = model.bounds;
  const pad = 40;
  const bw = Math.max(maxX - minX + pad * 2, 200);
  const bh = Math.max(maxY - minY + pad * 2, 150);
  // choose world width so both dimensions fit at the container aspect (w/h)
  const w = Math.max(bw, bh * aspect);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  return { x: cx - w / 2, y: cy - w / aspect / 2, w };
}

function idSignature(model: SchematicModel): string {
  return model.placed
    .map((p) => p.component.id)
    .sort()
    .join(",");
}

export function SchematicView() {
  const ctrl = useController();
  const snap = useSnapshot();
  const model = useMemo(
    () => buildSchematic(snap.circuit, snap.positions),
    [snap.circuit, snap.positions]
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [vb, setVb] = useState<ViewBox>({ x: 0, y: 0, w: 900 });

  // track container size for exact screen↔world mapping
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) setSize({ w: r.width, h: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = size.w / size.h;
  const vbHeight = vb.w / aspect;

  // auto-fit on first paint and whenever the circuit is replaced (no id overlap)
  const lastSig = useRef<string>("");
  useEffect(() => {
    const sig = idSignature(model);
    const prev = lastSig.current;
    const prevIds = new Set(prev.split(",").filter(Boolean));
    const curIds = sig.split(",").filter(Boolean);
    const overlap = curIds.some((id) => prevIds.has(id));
    if (curIds.length > 0 && (!overlap || prev === "")) {
      setVb(fitToBounds(model, aspect));
    }
    lastSig.current = sig;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idSignature(model)]);

  // ── pointer interaction ─────────────────────────────────────────────────────
  const drag = useRef<
    | { kind: "pan"; startX: number; startY: number; vb: ViewBox }
    | { kind: "move"; id: string; offset: Point }
    | null
  >(null);

  const screenToWorld = (clientX: number, clientY: number): Point => {
    const el = containerRef.current;
    const r = el?.getBoundingClientRect() ?? { left: 0, top: 0, width: size.w, height: size.h };
    return {
      x: vb.x + ((clientX - r.left) / r.width) * vb.w,
      y: vb.y + ((clientY - r.top) / r.height) * vbHeight,
    };
  };

  const onNodePointerDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    ctrl.select(id);
    const world = screenToWorld(e.clientX, e.clientY);
    const center = snap.positions[id] ?? world;
    drag.current = { kind: "move", id, offset: { x: world.x - center.x, y: world.y - center.y } };
  };

  const onBgPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    ctrl.select(null);
    drag.current = { kind: "pan", startX: e.clientX, startY: e.clientY, vb: { ...vb } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === "move") {
      const world = screenToWorld(e.clientX, e.clientY);
      ctrl.setPosition(d.id, { x: world.x - d.offset.x, y: world.y - d.offset.y });
    } else {
      const r = containerRef.current?.getBoundingClientRect();
      const rw = r?.width ?? size.w;
      const rh = r?.height ?? size.h;
      const dx = ((e.clientX - d.startX) / rw) * d.vb.w;
      const dy = ((e.clientY - d.startY) / rh) * (d.vb.w / aspect);
      setVb({ x: d.vb.x - dx, y: d.vb.y - dy, w: d.vb.w });
    }
  };

  const endDrag = () => {
    drag.current = null;
  };

  // wheel zoom-to-cursor (native listener so we can preventDefault)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;
      const factor = Math.exp(e.deltaY * 0.0012);
      setVb((cur) => {
        const newW = Math.min(Math.max(cur.w * factor, 80), 20000);
        const curH = cur.w / aspect;
        const newH = newW / aspect;
        const wx = cur.x + px * cur.w;
        const wy = cur.y + py * curH;
        return { x: wx - px * newW, y: wy - py * newH, w: newW };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [aspect]);

  const zoomBy = (factor: number) =>
    setVb((cur) => {
      const newW = Math.min(Math.max(cur.w * factor, 80), 20000);
      const curH = cur.w / aspect;
      const newH = newW / aspect;
      const cx = cur.x + cur.w / 2;
      const cy = cur.y + curH / 2;
      return { x: cx - newW / 2, y: cy - newH / 2, w: newW };
    });

  return (
    <div className="schematic" ref={containerRef} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerLeave={endDrag}>
      <svg
        className="schematic-svg"
        width="100%"
        height="100%"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vbHeight}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onBgPointerDown}
      >
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <circle cx={1} cy={1} r={0.8} className="grid-dot" />
          </pattern>
        </defs>
        <rect
          className="grid-bg"
          x={vb.x - vb.w}
          y={vb.y - vbHeight}
          width={vb.w * 3}
          height={vbHeight * 3}
          fill="url(#grid)"
        />
        {model.routes.map((route) => (
          <NetWires key={route.net.id} route={route} />
        ))}
        {model.placed.map((placed) => (
          <ComponentNode
            key={placed.component.id}
            placed={placed}
            selected={snap.selectedId === placed.component.id}
            onPointerDown={onNodePointerDown}
          />
        ))}
      </svg>

      {model.placed.length === 0 && (
        <div className="schematic-empty">
          <h2>Empty schematic</h2>
          <p>
            Use the <strong>Procedures</strong> panel to synthesize a circuit, load a demo from the
            toolbar, or ask the <strong>Agent</strong> (e.g. “low-pass filter at 1&nbsp;kHz”).
          </p>
        </div>
      )}

      <div className="canvas-controls">
        <button onClick={() => zoomBy(0.83)} title="Zoom in">＋</button>
        <button onClick={() => zoomBy(1.2)} title="Zoom out">－</button>
        <button onClick={() => setVb(fitToBounds(model, aspect))} title="Fit to view">⤢</button>
      </div>
    </div>
  );
}
