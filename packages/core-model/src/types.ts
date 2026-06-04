// Core model types for Condenser EDA tool

export type Level = 0 | 1 | 2 | 3;

export interface Quantity {
  value: number;
  unit: string;
}

export interface Interface {
  id: string;
  ports: { id: string; role: string }[];
  composes?: string[];
}

export interface SemanticPort {
  id: string;
  role: string;
  fromInterface?: string;
  pinBinding?: string; // physical pad id — set only at L3
}

export interface Obligation {
  id: string;
  kind:
    | "tie_unused"
    | "decouple"
    | "ground_ep"
    | "pullup"
    | "set_enable"
    | "terminate";
  description: string;
  satisfied: boolean;
  suggestedFix?: unknown[]; // Command[] — forward ref, typed as unknown here
}

export interface Component {
  id: string;
  level: Level;
  symbolId: string;
  semanticPorts: SemanticPort[];
  interfaces?: string[];
  params?: Record<string, Quantity>;
  part?: {
    mpn: string;
    footprintId: string;
    sourcing?: SourcingInfo;
  };
  physicalPins?: PhysicalPin[];
  obligations?: Obligation[];
  moduleProvenance?: ModuleProvenance;
}

export interface PhysicalPin {
  padId: string;
  name: string;
  semanticPortId?: string;
}

export interface SourcingInfo {
  lcscPartNumber?: string;
  manufacturer?: string;
  stock?: number;
  priceUsd?: number;
}

export interface ModuleProvenance {
  procedureId: string;
  params: Record<string, Quantity>;
  version: number;
}

export interface Net {
  id: string;
  name?: string;
  members: Array<{ componentId: string; portId: string }>;
}

export interface Violation {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  componentIds?: string[];
  netIds?: string[];
}

export interface CircuitState {
  components: Component[];
  nets: Net[];
  interfaces: Interface[];
  schemaVersion: string;
}
