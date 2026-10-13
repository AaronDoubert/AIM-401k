// Pure rules behind the ops log (feed.ts), kept separate so they can be unit-tested.
import type { Job, OpsKind, ProviderId } from "../shared/types";

/** Red means a true failure: only a deliberate stand-down stays a quiet "lost". */
export function lostKind(why: string): OpsKind {
  return why === "stood down" ? "lost" : "error";
}

/** The queue has drained: armed by a launch, nothing queued, nothing running. */
export function shouldWinchester(armed: boolean, jobs: Pick<Job, "status">[]): boolean {
  return armed && !jobs.some((j) => j.status === "queued" || j.status === "running");
}

/** At most one BINGO line per provider per local day. */
export function createBingoGate(): (provider: ProviderId, day: string) => boolean {
  const seen = new Map<ProviderId, string>();
  return (provider, day) => {
    if (seen.get(provider) === day) return false;
    seen.set(provider, day);
    return true;
  };
}
