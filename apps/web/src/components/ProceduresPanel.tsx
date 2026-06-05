import { useState } from "react";
import { rcLpfProcedure } from "@condenser/procedures";
import type { RCLpfValues } from "@condenser/procedures";
import { useController } from "../state/engineContext";
import { insertFragment } from "../agent/procedures";
import { fmtQ } from "../lib/format";

type ESeries = "E12" | "E24" | "E96";

export function ProceduresPanel() {
  const ctrl = useController();
  const [fcValue, setFcValue] = useState("1");
  const [fcUnit, setFcUnit] = useState("kHz");
  const [impValue, setImpValue] = useState("1");
  const [impUnit, setImpUnit] = useState("kΩ");
  const [eseries, setEseries] = useState<ESeries>("E24");
  const [result, setResult] = useState<RCLpfValues | null>(null);
  const [error, setError] = useState<string | null>(null);

  const buildParams = () => {
    const params: { fc: { value: number; unit: string }; impedance?: { value: number; unit: string } } = {
      fc: { value: parseFloat(fcValue), unit: fcUnit },
    };
    if (impValue.trim()) params.impedance = { value: parseFloat(impValue), unit: impUnit };
    return params;
  };

  const preview = () => {
    setError(null);
    try {
      const { values } = rcLpfProcedure.solve(buildParams(), { eseries });
      setResult(values);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const insert = () => {
    setError(null);
    try {
      const { values } = rcLpfProcedure.solve(buildParams(), { eseries });
      setResult(values);
      if (rcLpfProcedure.emit) {
        insertFragment(ctrl, rcLpfProcedure.emit(values), rcLpfProcedure.title);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="panel">
      <div className="panel-head">Procedures</div>
      <div className="proc-body">
        <div className="proc-card">
          <div className="proc-title">{rcLpfProcedure.title}</div>
          <p className="proc-desc">{rcLpfProcedure.description}</p>

          <label className="field">
            <span>Cutoff frequency</span>
            <div className="qty">
              <input value={fcValue} onChange={(e) => setFcValue(e.target.value)} inputMode="decimal" />
              <select value={fcUnit} onChange={(e) => setFcUnit(e.target.value)}>
                <option>Hz</option>
                <option>kHz</option>
                <option>MHz</option>
              </select>
            </div>
          </label>

          <label className="field">
            <span>Source impedance (optional)</span>
            <div className="qty">
              <input value={impValue} onChange={(e) => setImpValue(e.target.value)} inputMode="decimal" />
              <select value={impUnit} onChange={(e) => setImpUnit(e.target.value)}>
                <option>Ω</option>
                <option>kΩ</option>
                <option>MΩ</option>
              </select>
            </div>
          </label>

          <label className="field">
            <span>E-series</span>
            <select value={eseries} onChange={(e) => setEseries(e.target.value as ESeries)}>
              <option>E12</option>
              <option>E24</option>
              <option>E96</option>
            </select>
          </label>

          <div className="action-row">
            <button onClick={preview}>Compute</button>
            <button className="primary" onClick={insert}>
              Insert into circuit
            </button>
          </div>

          {error && <p className="error-text">{error}</p>}

          {result && (
            <div className="proc-result">
              <div className="kv">
                <span className="k">R</span>
                <span className="v mono">{fmtQ(result.R)}</span>
              </div>
              <div className="kv">
                <span className="k">C</span>
                <span className="v mono">{fmtQ(result.C)}</span>
              </div>
              <div className="kv">
                <span className="k">fc achieved</span>
                <span className="v mono">{fmtQ(result.fcAchieved)}</span>
              </div>
              <p className="muted small">
                Values snapped to {eseries}. The AI never computes these — the procedure does.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
