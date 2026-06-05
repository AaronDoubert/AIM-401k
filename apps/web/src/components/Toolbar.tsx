import { useRef } from "react";
import type { ProjectFile } from "@condenser/commands";
import { useController, useSnapshot } from "../state/engineContext";
import { FIXTURES } from "../lib/fixtures";

export function Toolbar() {
  const ctrl = useController();
  const snap = useSnapshot();
  const fileInput = useRef<HTMLInputElement>(null);

  const canUndo = snap.cursor > 0;
  const canRedo = snap.cursor < snap.log.length;

  const saveProject = () => {
    const pf = ctrl.serialize();
    const blob = new Blob([JSON.stringify(pf, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "condenser-project.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const pf = JSON.parse(await file.text()) as ProjectFile;
      ctrl.loadProject(pf);
    } catch (err) {
      alert(`Failed to load project: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.target.value = "";
    }
  };

  return (
    <header className="toolbar">
      <div className="brand">
        <span className="brand-mark">⊏⊐</span>
        <span className="brand-name">Condenser</span>
        <span className="brand-tag">AI-assisted schematic · prototype</span>
      </div>

      <div className="toolbar-actions">
        <button onClick={() => ctrl.newCircuit()}>New</button>

        <div className="dropdown">
          <button>Demos ▾</button>
          <div className="dropdown-menu">
            {Object.entries(FIXTURES).map(([id, fx]) => (
              <button key={id} onClick={() => ctrl.loadCircuit(fx.circuit)}>
                {fx.label}
              </button>
            ))}
          </div>
        </div>

        <span className="divider" />

        <button disabled={!canUndo} onClick={() => ctrl.undo()} title="Undo">
          ↶ Undo
        </button>
        <button disabled={!canRedo} onClick={() => ctrl.redo()} title="Redo">
          ↷ Redo
        </button>

        <span className="divider" />

        <button onClick={saveProject}>Save</button>
        <button onClick={() => fileInput.current?.click()}>Open</button>
        <input ref={fileInput} type="file" accept="application/json" hidden onChange={onFile} />
      </div>
    </header>
  );
}
