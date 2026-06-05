import { EngineProvider } from "./state/engineContext";
import { Toolbar } from "./components/Toolbar";
import { SchematicView } from "./components/SchematicView";
import { Inspector } from "./components/Inspector";
import { CommandLogView } from "./components/CommandLogView";
import { ProceduresPanel } from "./components/ProceduresPanel";
import { AgentPanel } from "./components/AgentPanel";

export function App() {
  return (
    <EngineProvider>
      <div className="app">
        <Toolbar />
        <div className="main">
          <aside className="sidebar left">
            <ProceduresPanel />
            <Inspector />
            <CommandLogView />
          </aside>
          <main className="canvas-area">
            <SchematicView />
          </main>
          <aside className="sidebar right">
            <AgentPanel />
          </aside>
        </div>
      </div>
    </EngineProvider>
  );
}
