// Master caution annunciator, shared by the War Room and the Tracker.
// Behaves like the cockpit light: dark when nothing is pending, flashes and
// stays lit when a new hold arrives, goes dark when pressed (acknowledged)
// while the individual rows stay amber, and relights on the next new hold.

export class MasterCaution {
  /** Hold ids the operator has acknowledged by pressing the light. */
  private acked = new Set<string>();
  private seen: Set<string> | null = null;
  private current: string[] = [];

  constructor(
    readonly el: HTMLButtonElement,
    /** Called after an acknowledge, e.g. to jump to the oldest hold. */
    private readonly onPress: () => void = () => undefined,
  ) {
    el.dataset.lit = "false";
    el.addEventListener("click", () => this.press());
  }

  get lit(): boolean {
    return this.el.dataset.lit === "true";
  }

  /**
   * Feed the ids of everything currently waiting on the operator (oldest
   * first). Returns true when a new one arrived since the last call (callers
   * play the chime). The first call only establishes the baseline: holds that
   * were already there when the page opened light the lamp but don't flash.
   */
  update(ids: string[]): boolean {
    this.current = ids;
    const live = new Set(ids);
    for (const id of this.acked) if (!live.has(id)) this.acked.delete(id);
    const fresh = this.seen ? ids.filter((id) => !this.seen!.has(id)) : [];
    this.seen = live;
    const lit = ids.some((id) => !this.acked.has(id));
    this.el.dataset.lit = String(lit);
    this.el.setAttribute("aria-pressed", String(!lit && ids.length > 0));
    if (fresh.length) {
      this.el.classList.remove("flash");
      void this.el.offsetWidth; // restart the animation
      this.el.classList.add("flash");
    }
    return fresh.length > 0;
  }

  /** Acknowledge: the lamp goes dark until the next new hold. */
  press(): void {
    for (const id of this.current) this.acked.add(id);
    this.el.dataset.lit = "false";
    this.el.classList.remove("flash");
    this.el.setAttribute("aria-pressed", String(this.current.length > 0));
    this.onPress();
  }
}
