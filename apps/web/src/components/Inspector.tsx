import { useMemo, useState } from "react";
import { STANDARD_INTERFACES } from "@condenser/core-model";
import type { Component } from "@condenser/core-model";
import { useController, useSnapshot } from "../state/engineContext";
import { fmtQ, levelName } from "../lib/format";

function LevelLadder({ level }: { level: 0 | 1 | 2 | 3 }) {
  return (
    <div className="ladder">
      {[0, 1, 2, 3].map((l) => (
        <div key={l} className={`rung ${l <= level ? "on" : ""} ${l === level ? "cur" : ""}`}>
          <span className="rung-id">L{l}</span>
          <span className="rung-name">{levelName(l as 0 | 1 | 2 | 3)}</span>
        </div>
      ))}
    </div>
  );
}

function ComponentDetails({ component }: { component: Component }) {
  const ctrl = useController();
  const [iface, setIface] = useState<string>(Object.keys(STANDARD_INTERFACES)[0] ?? "i2c");
  const [mpn, setMpn] = useState("");
  const [footprint, setFootprint] = useState("");

  const params = component.params ?? {};
  return (
    <div className="inspector-body">
      <div className="kv">
        <span className="k">id</span>
        <span className="v mono">{component.id}</span>
      </div>
      <div className="kv">
        <span className="k">symbol</span>
        <span className="v mono">{component.symbolId}</span>
      </div>

      <h4>Fidelity</h4>
      <LevelLadder level={component.level} />

      <h4>Ports</h4>
      <ul className="plain-list">
        {component.semanticPorts.map((p) => (
          <li key={p.id}>
            <span className="mono">{p.id}</span> <span className="muted">· {p.role}</span>
            {p.pinBinding && <span className="muted"> → pin {p.pinBinding}</span>}
          </li>
        ))}
        {component.semanticPorts.length === 0 && <li className="muted">none (L0 formless)</li>}
      </ul>

      {Object.keys(params).length > 0 && (
        <>
          <h4>Parameters</h4>
          <ul className="plain-list">
            {Object.entries(params).map(([k, v]) => (
              <li key={k}>
                <span className="mono">{k}</span> = {fmtQ(v)}
              </li>
            ))}
          </ul>
        </>
      )}

      {component.part && (
        <>
          <h4>Real part</h4>
          <div className="kv">
            <span className="k">MPN</span>
            <span className="v mono">{component.part.mpn}</span>
          </div>
          <div className="kv">
            <span className="k">footprint</span>
            <span className="v mono">{component.part.footprintId}</span>
          </div>
        </>
      )}

      {component.obligations && component.obligations.length > 0 && (
        <>
          <h4>Obligations</h4>
          <ul className="plain-list">
            {component.obligations.map((ob) => (
              <li key={ob.id} className={ob.satisfied ? "ob done" : "ob"}>
                <label>
                  <input
                    type="checkbox"
                    checked={ob.satisfied}
                    disabled={ob.satisfied}
                    onChange={() => ctrl.apply({ t: "satisfyObligation", obligationId: ob.id }, "satisfy obligation")}
                  />
                  <span>{ob.description}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>Actions</h4>
      <div className="action-row">
        <select value={iface} onChange={(e) => setIface(e.target.value)}>
          {Object.keys(STANDARD_INTERFACES).map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
        <button
          onClick={() => ctrl.apply({ t: "attachInterface", componentId: component.id, interfaceId: iface }, `attach ${iface}`)}
        >
          Attach interface → L1
        </button>
      </div>
      <div className="action-row">
        <input placeholder="MPN" value={mpn} onChange={(e) => setMpn(e.target.value)} />
        <input placeholder="footprint" value={footprint} onChange={(e) => setFootprint(e.target.value)} />
        <button
          disabled={!mpn || !footprint}
          onClick={() => {
            ctrl.apply({ t: "bindRealPart", componentId: component.id, mpn, footprintId: footprint }, "bind real part");
            setMpn("");
            setFootprint("");
          }}
        >
          Bind real part → L3
        </button>
      </div>
    </div>
  );
}

export function Inspector() {
  const snap = useSnapshot();
  const selected = useMemo(
    () => snap.circuit.components.find((c) => c.id === snap.selectedId) ?? null,
    [snap.circuit.components, snap.selectedId]
  );

  if (selected) {
    return (
      <div className="panel">
        <div className="panel-head">Inspector</div>
        <ComponentDetails component={selected} />
      </div>
    );
  }

  const levelCounts = snap.circuit.components.reduce<Record<number, number>>((acc, c) => {
    acc[c.level] = (acc[c.level] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="panel">
      <div className="panel-head">Inspector</div>
      <div className="inspector-body">
        <p className="muted">Select a component to inspect it.</p>
        <h4>Circuit</h4>
        <div className="kv">
          <span className="k">components</span>
          <span className="v">{snap.circuit.components.length}</span>
        </div>
        <div className="kv">
          <span className="k">nets</span>
          <span className="v">{snap.circuit.nets.length}</span>
        </div>
        <div className="kv">
          <span className="k">by level</span>
          <span className="v mono">
            {[0, 1, 2, 3].map((l) => `L${l}:${levelCounts[l] ?? 0}`).join("  ")}
          </span>
        </div>
        {snap.lastViolations.length > 0 && (
          <>
            <h4>Last violations</h4>
            <ul className="plain-list">
              {snap.lastViolations.map((v, i) => (
                <li key={i} className={`viol ${v.severity}`}>
                  <span className="mono">{v.code}</span> {v.message}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
