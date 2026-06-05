import { nanoid } from "nanoid";
import type {
  CircuitState,
  Component,
  Net,
  Violation,
} from "@condenser/core-model";
import { STANDARD_INTERFACES, validateCircuitState } from "@condenser/core-model";
import type {
  Command,
  CommandResult,
  LoggedCommand,
  ProjectFile,
  PortRef,
} from "./types.js";

// ── Helper: deep clone via JSON ───────────────────────────────────────────────

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// ── Helper: find component or produce violation ───────────────────────────────

function findComponent(
  state: CircuitState,
  id: string
): { comp: Component; idx: number } | { violation: Violation } {
  const idx = state.components.findIndex((c) => c.id === id);
  if (idx === -1) {
    return {
      violation: {
        code: "CMD001",
        severity: "error",
        message: `Component '${id}' not found`,
        componentIds: [id],
      },
    };
  }
  return { comp: state.components[idx]!, idx };
}

// ── Helper: ensure a port exists on a component ───────────────────────────────

function portExists(comp: Component, portId: string): boolean {
  return comp.semanticPorts.some((p) => p.id === portId);
}

// ── Initial empty state ───────────────────────────────────────────────────────

function emptyState(): CircuitState {
  return {
    components: [],
    nets: [],
    interfaces: [],
    schemaVersion: "0.0.1",
  };
}

// ── Command handlers ──────────────────────────────────────────────────────────

/**
 * Options for replay: allows the caller to supply pre-assigned IDs so
 * that addComponent and connect produce byte-identical results on replay.
 * Values are string | undefined to satisfy exactOptionalPropertyTypes.
 */
interface ReplayHints {
  componentId?: string | undefined; // used by addComponent
  netId?: string | undefined;       // used by connect (new net creation)
}

function handleAddComponent(
  state: CircuitState,
  cmd: Extract<Command, { t: "addComponent" }>,
  hints?: ReplayHints
): CommandResult {
  const newId = hints?.componentId ?? nanoid();
  const component: Component = { id: newId, ...cmd.component };
  const next = clone(state);
  next.components.push(component);
  return {
    ok: true,
    newId,
    delta: { added: { components: [component] } },
  };
}

function handleAttachInterface(
  state: CircuitState,
  cmd: Extract<Command, { t: "attachInterface" }>
): CommandResult {
  const found = findComponent(state, cmd.componentId);
  if ("violation" in found) return { ok: false, violations: [found.violation] };

  const { comp, idx } = found;

  // Look up the interface — first in circuit state, then in standard interfaces
  const iface =
    state.interfaces.find((i) => i.id === cmd.interfaceId) ??
    STANDARD_INTERFACES[cmd.interfaceId];

  if (!iface) {
    return {
      ok: false,
      violations: [
        {
          code: "CMD002",
          severity: "error",
          message: `Interface '${cmd.interfaceId}' not found`,
        },
      ],
    };
  }

  const next = clone(state);
  const nextComp = next.components[idx]!;

  // Promote to at least L1
  if (nextComp.level < 1) {
    nextComp.level = 1;
  }

  // Add interface to list (deduplicated)
  if (!nextComp.interfaces) nextComp.interfaces = [];
  if (!nextComp.interfaces.includes(cmd.interfaceId)) {
    nextComp.interfaces.push(cmd.interfaceId);
  }

  // Add semantic ports from the interface (only if not already present)
  const existingPortIds = new Set(nextComp.semanticPorts.map((p) => p.id));
  for (const ifacePort of iface.ports) {
    if (!existingPortIds.has(ifacePort.id)) {
      nextComp.semanticPorts.push({
        id: ifacePort.id,
        role: ifacePort.role,
        fromInterface: cmd.interfaceId,
      });
    }
  }

  return {
    ok: true,
    delta: { modified: { components: [nextComp] } },
  };
}

function handleSetParams(
  state: CircuitState,
  cmd: Extract<Command, { t: "setParams" }>
): CommandResult {
  const found = findComponent(state, cmd.componentId);
  if ("violation" in found) return { ok: false, violations: [found.violation] };

  const { comp, idx } = found;
  const next = clone(state);
  const nextComp = next.components[idx]!;

  // Merge params (never remove existing)
  nextComp.params = { ...(comp.params ?? {}), ...cmd.params };

  // Promote to at least L2
  if (nextComp.level < 2) {
    nextComp.level = 2;
  }

  return {
    ok: true,
    delta: { modified: { components: [nextComp] } },
  };
}

function handleBindRealPart(
  state: CircuitState,
  cmd: Extract<Command, { t: "bindRealPart" }>
): CommandResult {
  const found = findComponent(state, cmd.componentId);
  if ("violation" in found) return { ok: false, violations: [found.violation] };

  const { idx } = found;
  const next = clone(state);
  const nextComp = next.components[idx]!;

  // Bind part info
  nextComp.part = { mpn: cmd.mpn, footprintId: cmd.footprintId };

  // Promote to L3
  nextComp.level = 3;

  // Surface a decoupling obligation for L3 ICs
  if (!nextComp.obligations) nextComp.obligations = [];
  const alreadyHasDecouple = nextComp.obligations.some(
    (ob) => ob.kind === "decouple"
  );
  if (!alreadyHasDecouple) {
    nextComp.obligations.push({
      id: nanoid(),
      kind: "decouple",
      description: `Add 100nF bypass capacitor on VDD of ${cmd.mpn}`,
      satisfied: false,
    });
  }

  return {
    ok: true,
    delta: { modified: { components: [nextComp] } },
  };
}

function handleConnect(
  state: CircuitState,
  cmd: Extract<Command, { t: "connect" }>,
  hints?: ReplayHints
): CommandResult {
  const violations: Violation[] = [];

  // Validate both port refs
  for (const ref of [cmd.a, cmd.b]) {
    const found = findComponent(state, ref.componentId);
    if ("violation" in found) {
      violations.push(found.violation);
      continue;
    }
    if (!portExists(found.comp, ref.portId)) {
      violations.push({
        code: "CMD003",
        severity: "error",
        message: `Port '${ref.portId}' not found on component '${ref.componentId}'`,
        componentIds: [ref.componentId],
      });
    }
  }

  if (violations.length > 0) return { ok: false, violations };

  const next = clone(state);

  // Find if either port is already in a net
  function findNetForPort(ref: PortRef): number {
    return next.nets.findIndex((n) =>
      n.members.some(
        (m) => m.componentId === ref.componentId && m.portId === ref.portId
      )
    );
  }

  const netIdxA = findNetForPort(cmd.a);
  const netIdxB = findNetForPort(cmd.b);

  if (netIdxA === -1 && netIdxB === -1) {
    // Create a new net — use hint if available (for replay determinism)
    const newNet: Net = {
      id: hints?.netId ?? nanoid(),
      members: [
        { componentId: cmd.a.componentId, portId: cmd.a.portId },
        { componentId: cmd.b.componentId, portId: cmd.b.portId },
      ],
    };
    next.nets.push(newNet);
    return {
      ok: true,
      delta: { added: { nets: [newNet] } },
    };
  } else if (netIdxA !== -1 && netIdxB === -1) {
    // Add b to A's net
    const net = next.nets[netIdxA]!;
    net.members.push({ componentId: cmd.b.componentId, portId: cmd.b.portId });
    return {
      ok: true,
      delta: { modified: { nets: [net] } },
    };
  } else if (netIdxA === -1 && netIdxB !== -1) {
    // Add a to B's net
    const net = next.nets[netIdxB]!;
    net.members.push({ componentId: cmd.a.componentId, portId: cmd.a.portId });
    return {
      ok: true,
      delta: { modified: { nets: [net] } },
    };
  } else {
    // Merge the two nets if they're different
    if (netIdxA === netIdxB) {
      // Already connected — idempotent
      return { ok: true };
    }
    const netA = next.nets[netIdxA]!;
    const netB = next.nets[netIdxB]!;
    // Merge B into A
    for (const m of netB.members) {
      if (
        !netA.members.some(
          (existing) =>
            existing.componentId === m.componentId &&
            existing.portId === m.portId
        )
      ) {
        netA.members.push(m);
      }
    }
    // Remove net B
    next.nets.splice(netIdxB, 1);
    return {
      ok: true,
      delta: { modified: { nets: [netA] } },
    };
  }
}

function handleDisconnect(
  state: CircuitState,
  cmd: Extract<Command, { t: "disconnect" }>
): CommandResult {
  const next = clone(state);
  const netIdx = next.nets.findIndex((n) => n.id === cmd.netId);
  if (netIdx === -1) {
    return {
      ok: false,
      violations: [
        {
          code: "CMD004",
          severity: "error",
          message: `Net '${cmd.netId}' not found`,
          netIds: [cmd.netId],
        },
      ],
    };
  }
  const net = next.nets[netIdx]!;
  net.members = net.members.filter(
    (m) =>
      !(
        m.componentId === cmd.member.componentId &&
        m.portId === cmd.member.portId
      )
  );
  return { ok: true, delta: { modified: { nets: [net] } } };
}

function handleSetNetName(
  state: CircuitState,
  cmd: Extract<Command, { t: "setNetName" }>
): CommandResult {
  const next = clone(state);
  const netIdx = next.nets.findIndex((n) => n.id === cmd.netId);
  if (netIdx === -1) {
    return {
      ok: false,
      violations: [
        {
          code: "CMD005",
          severity: "error",
          message: `Net '${cmd.netId}' not found`,
          netIds: [cmd.netId],
        },
      ],
    };
  }
  next.nets[netIdx]!.name = cmd.name;
  return { ok: true, delta: { modified: { nets: [next.nets[netIdx]!] } } };
}

function handleInsertModule(
  state: CircuitState,
  _cmd: Extract<Command, { t: "insertModule" }>
): CommandResult {
  // Stub — procedures package handles the actual subcircuit generation
  void state;
  return { ok: true };
}

function handleReparametrize(
  state: CircuitState,
  cmd: Extract<Command, { t: "reparametrize" }>
): CommandResult {
  return handleSetParams(state, {
    t: "setParams",
    componentId: cmd.targetId,
    params: cmd.params,
  });
}

function handleSatisfyObligation(
  state: CircuitState,
  cmd: Extract<Command, { t: "satisfyObligation" }>
): CommandResult {
  const next = clone(state);
  let found = false;
  for (const comp of next.components) {
    if (comp.obligations) {
      for (const ob of comp.obligations) {
        if (ob.id === cmd.obligationId) {
          ob.satisfied = true;
          found = true;
        }
      }
    }
  }
  if (!found) {
    return {
      ok: false,
      violations: [
        {
          code: "CMD006",
          severity: "error",
          message: `Obligation '${cmd.obligationId}' not found`,
        },
      ],
    };
  }
  return { ok: true, delta: { modified: { components: next.components } } };
}

function handlePlace(
  state: CircuitState,
  _cmd: Extract<Command, { t: "place" }>
): CommandResult {
  void state;
  return { ok: true };
}

function handleRoute(
  state: CircuitState,
  _cmd: Extract<Command, { t: "route" }>
): CommandResult {
  void state;
  return { ok: true };
}

// ── applyCommandToState ───────────────────────────────────────────────────────
// Pure function: given a state and command, returns a CommandResult.
// hints: optional replay hints to make ID generation deterministic.

export function applyCommandToState(
  state: CircuitState,
  cmd: Command,
  hints?: ReplayHints
): { result: CommandResult; nextState: CircuitState } {
  let result: CommandResult;

  switch (cmd.t) {
    case "addComponent":
      result = handleAddComponent(state, cmd, hints);
      break;
    case "attachInterface":
      result = handleAttachInterface(state, cmd);
      break;
    case "setParams":
      result = handleSetParams(state, cmd);
      break;
    case "bindRealPart":
      result = handleBindRealPart(state, cmd);
      break;
    case "connect":
      result = handleConnect(state, cmd, hints);
      break;
    case "disconnect":
      result = handleDisconnect(state, cmd);
      break;
    case "setNetName":
      result = handleSetNetName(state, cmd);
      break;
    case "insertModule":
      result = handleInsertModule(state, cmd);
      break;
    case "reparametrize":
      result = handleReparametrize(state, cmd);
      break;
    case "satisfyObligation":
      result = handleSatisfyObligation(state, cmd);
      break;
    case "place":
      result = handlePlace(state, cmd);
      break;
    case "route":
      result = handleRoute(state, cmd);
      break;
  }

  if (!result.ok) {
    return { result, nextState: state };
  }

  // Build next state by applying the delta
  const nextState = applyDelta(state, result);
  return { result, nextState };
}

// ── applyDelta ────────────────────────────────────────────────────────────────

function applyDelta(state: CircuitState, result: CommandResult): CircuitState {
  if (!result.delta) return state;

  const next = clone(state);
  const delta = result.delta;

  if (delta.added?.components) {
    next.components.push(...delta.added.components);
  }
  if (delta.added?.nets) {
    next.nets.push(...delta.added.nets);
  }
  if (delta.modified?.components) {
    for (const modComp of delta.modified.components) {
      const idx = next.components.findIndex((c) => c.id === modComp.id);
      if (idx !== -1) next.components[idx] = modComp;
    }
  }
  if (delta.modified?.nets) {
    for (const modNet of delta.modified.nets) {
      const idx = next.nets.findIndex((n) => n.id === modNet.id);
      if (idx !== -1) next.nets[idx] = modNet;
    }
  }
  if (delta.removed?.componentIds) {
    next.components = next.components.filter(
      (c) => !delta.removed!.componentIds!.includes(c.id)
    );
  }
  if (delta.removed?.netIds) {
    next.nets = next.nets.filter(
      (n) => !delta.removed!.netIds!.includes(n.id)
    );
  }

  return next;
}

// ── CommandEngine class ───────────────────────────────────────────────────────

export class CommandEngine {
  private _states: CircuitState[];  // states[i] is state BEFORE log[i] was applied
  private _log: LoggedCommand[];
  private _cursor: number;

  constructor(initialState?: CircuitState) {
    this._states = [initialState ? clone(initialState) : emptyState()];
    this._log = [];
    this._cursor = 0;
  }

  apply(cmd: Command, label?: string): CommandResult {
    // Truncate any redo history when a new command is applied
    if (this._cursor < this._log.length) {
      this._log.splice(this._cursor);
      this._states.splice(this._cursor + 1);
    }

    const currentState = this._states[this._cursor]!;
    const { result, nextState } = applyCommandToState(currentState, cmd);

    if (result.ok) {
      // Build resultMeta for deterministic replay
      const resultMeta: LoggedCommand["resultMeta"] = {};
      if (result.newId) resultMeta.newComponentId = result.newId;
      // Capture newly created net IDs from delta
      if (result.delta?.added?.nets?.[0]) {
        resultMeta.newNetId = result.delta.added.nets[0].id;
      }

      const logged: LoggedCommand = {
        id: nanoid(),
        timestamp: Date.now(),
        command: cmd,
        ...(label ? { label } : {}),
        ...(Object.keys(resultMeta).length > 0 ? { resultMeta } : {}),
      };
      this._log.push(logged);
      this._states.push(nextState);
      this._cursor++;
    }

    return result;
  }

  undo(): boolean {
    if (this._cursor <= 0) return false;
    this._cursor--;
    return true;
  }

  redo(): boolean {
    if (this._cursor >= this._log.length) return false;
    this._cursor++;
    return true;
  }

  getState(): CircuitState {
    return clone(this._states[this._cursor]!);
  }

  getLog(): LoggedCommand[] {
    return clone(this._log);
  }

  serialize(): ProjectFile {
    return {
      schemaVersion: "0.0.1",
      snapshot: clone(this._states[0]!),
      log: clone(this._log),
      cursor: this._cursor,
    };
  }

  static deserialize(pf: ProjectFile): CommandEngine {
    const engine = new CommandEngine(pf.snapshot);
    for (const logged of pf.log) {
      const hints: ReplayHints = {};
      if (logged.resultMeta?.newComponentId !== undefined) {
        hints.componentId = logged.resultMeta.newComponentId;
      }
      if (logged.resultMeta?.newNetId !== undefined) {
        hints.netId = logged.resultMeta.newNetId;
      }
      const currentState = engine._states[engine._cursor]!;
      const { result, nextState } = applyCommandToState(
        currentState,
        logged.command,
        hints
      );
      if (result.ok) {
        engine._log.push(clone(logged));
        engine._states.push(nextState);
        engine._cursor++;
      }
    }
    engine._cursor = pf.cursor;
    return engine;
  }

  /**
   * Pure static replay — uses resultMeta from each LoggedCommand for
   * deterministic ID assignment.
   */
  static replay(
    log: LoggedCommand[],
    snapshot?: CircuitState
  ): CircuitState {
    let state: CircuitState = snapshot ? clone(snapshot) : emptyState();
    for (const logged of log) {
      const hints: ReplayHints = {};
      if (logged.resultMeta?.newComponentId !== undefined) {
        hints.componentId = logged.resultMeta.newComponentId;
      }
      if (logged.resultMeta?.newNetId !== undefined) {
        hints.netId = logged.resultMeta.newNetId;
      }
      const { result, nextState } = applyCommandToState(
        state,
        logged.command,
        hints
      );
      if (result.ok) {
        state = nextState;
      }
    }
    return state;
  }
}

export { validateCircuitState };
