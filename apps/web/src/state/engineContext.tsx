import {
  createContext,
  useContext,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { EngineController, type AppSnapshot } from "./EngineController";

const EngineContext = createContext<EngineController | null>(null);

export function EngineProvider({ children }: { children: ReactNode }) {
  const [controller] = useState(() => new EngineController());
  return (
    <EngineContext.Provider value={controller}>
      {children}
    </EngineContext.Provider>
  );
}

export function useController(): EngineController {
  const ctrl = useContext(EngineContext);
  if (!ctrl) throw new Error("useController must be used within EngineProvider");
  return ctrl;
}

export function useSnapshot(): AppSnapshot {
  const ctrl = useController();
  return useSyncExternalStore(ctrl.subscribe, ctrl.getSnapshot);
}
