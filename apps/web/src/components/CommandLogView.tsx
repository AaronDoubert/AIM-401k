import { useSnapshot } from "../state/engineContext";
import type { LoggedCommand } from "@condenser/commands";

function describe(cmd: LoggedCommand["command"]): string {
  switch (cmd.t) {
    case "addComponent":
      return `addComponent ${cmd.component.symbolId}`;
    case "attachInterface":
      return `attachInterface ${cmd.interfaceId} → ${cmd.componentId}`;
    case "setParams":
      return `setParams ${cmd.componentId}`;
    case "bindRealPart":
      return `bindRealPart ${cmd.mpn}`;
    case "connect":
      return `connect ${cmd.a.componentId}.${cmd.a.portId} ↔ ${cmd.b.componentId}.${cmd.b.portId}`;
    case "disconnect":
      return `disconnect ${cmd.netId}`;
    case "setNetName":
      return `setNetName ${cmd.name}`;
    case "insertModule":
      return `insertModule ${cmd.procedureId}`;
    case "reparametrize":
      return `reparametrize ${cmd.targetId}`;
    case "satisfyObligation":
      return `satisfyObligation`;
    case "place":
      return `place ${cmd.componentId}`;
    case "route":
      return `route ${cmd.netId}`;
    default:
      return (cmd as { t: string }).t;
  }
}

export function CommandLogView() {
  const snap = useSnapshot();
  return (
    <div className="panel">
      <div className="panel-head">
        Command log <span className="muted">({snap.cursor}/{snap.log.length})</span>
      </div>
      <div className="log-body">
        {snap.log.length === 0 && <p className="muted pad">No commands yet.</p>}
        <ol className="log-list">
          {snap.log.map((entry, i) => (
            <li key={entry.id} className={`log-item ${i < snap.cursor ? "applied" : "undone"}`}>
              <span className="log-idx">{i + 1}</span>
              <span className="log-desc mono">{entry.label ?? describe(entry.command)}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
