import { CommandEngine } from "@condenser/commands";
import type {
  Command,
  CommandResult,
  LoggedCommand,
  Point,
  ProjectFile,
} from "@condenser/commands";
import type { CircuitState, Violation } from "@condenser/core-model";
import { ensurePositions } from "../lib/layout";

export interface AppSnapshot {
  circuit: CircuitState;
  log: LoggedCommand[];
  cursor: number;
  positions: Record<string, Point>;
  selectedId: string | null;
  lastViolations: Violation[];
  version: number;
}

type Listener = () => void;

/**
 * Stateful controller bridging the deterministic CommandEngine to React.
 *
 * It owns the engine, view-only component positions, the current selection,
 * and an immutable snapshot exposed through `getSnapshot` so components can
 * subscribe via `useSyncExternalStore`. Every mutation produces a fresh
 * snapshot reference.
 */
export class EngineController {
  private engine: CommandEngine;
  private positions: Record<string, Point> = {};
  private selectedId: string | null = null;
  private lastViolations: Violation[] = [];
  private cursor = 0;
  private logLen = 0;
  private version = 0;
  private snap!: AppSnapshot;
  private listeners = new Set<Listener>();

  constructor(initial?: CircuitState) {
    this.engine = new CommandEngine(initial);
    this.relayout();
    this.rebuild();
  }

  // ── external-store plumbing ────────────────────────────────────────────────
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AppSnapshot => this.snap;

  private relayout(): void {
    this.positions = ensurePositions(this.engine.getState(), this.positions);
  }

  private rebuild(): void {
    this.snap = {
      circuit: this.engine.getState(),
      log: this.engine.getLog(),
      cursor: this.cursor,
      positions: { ...this.positions },
      selectedId: this.selectedId,
      lastViolations: this.lastViolations,
      version: this.version,
    };
  }

  private commit(): void {
    this.version++;
    this.rebuild();
    for (const l of this.listeners) l();
  }

  // ── commands ───────────────────────────────────────────────────────────────
  apply(cmd: Command, label?: string): CommandResult {
    const result = this.engine.apply(cmd, label);
    if (result.ok) {
      this.cursor++;
      this.logLen = this.cursor;
    }
    this.lastViolations = result.violations ?? [];
    this.relayout();
    this.commit();
    return result;
  }

  /** Apply several commands; stops at the first failure and returns results. */
  applyMany(cmds: { cmd: Command; label?: string }[]): CommandResult[] {
    const results: CommandResult[] = [];
    for (const { cmd, label } of cmds) {
      const r = this.apply(cmd, label);
      results.push(r);
      if (!r.ok) break;
    }
    return results;
  }

  undo(): void {
    if (this.engine.undo()) {
      this.cursor = Math.max(0, this.cursor - 1);
      this.commit();
    }
  }

  redo(): void {
    if (this.engine.redo()) {
      this.cursor = Math.min(this.logLen, this.cursor + 1);
      this.commit();
    }
  }

  get canUndo(): boolean {
    return this.cursor > 0;
  }

  get canRedo(): boolean {
    return this.cursor < this.logLen;
  }

  // ── selection & view state ───────────────────────────────────────────────
  select(id: string | null): void {
    this.selectedId = id;
    this.commit();
  }

  setPosition(id: string, pt: Point): void {
    this.positions[id] = pt;
    this.commit();
  }

  // ── lifecycle ──────────────────────────────────────────────────────────────
  newCircuit(): void {
    this.engine = new CommandEngine();
    this.positions = {};
    this.selectedId = null;
    this.lastViolations = [];
    this.cursor = 0;
    this.logLen = 0;
    this.relayout();
    this.commit();
  }

  loadCircuit(state: CircuitState): void {
    this.engine = new CommandEngine(state);
    this.positions = {};
    this.selectedId = null;
    this.lastViolations = [];
    this.cursor = 0;
    this.logLen = 0;
    this.relayout();
    this.commit();
  }

  loadProject(pf: ProjectFile): void {
    this.engine = CommandEngine.deserialize(pf);
    this.positions = {};
    this.selectedId = null;
    this.lastViolations = [];
    this.cursor = pf.cursor;
    this.logLen = pf.log.length;
    this.relayout();
    this.commit();
  }

  serialize(): ProjectFile {
    return this.engine.serialize();
  }

  getState(): CircuitState {
    return this.engine.getState();
  }
}
