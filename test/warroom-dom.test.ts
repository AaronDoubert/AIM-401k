// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../src/shared/copy";
import type { ToBackground } from "../src/shared/messages";
import type { Need } from "../src/shared/types";
import { holdToFire } from "../src/ui/warroom/holdfire";
import type { TileModel } from "../src/ui/warroom/model";
import { TileView } from "../src/ui/warroom/tiles";

// ui/common.ts imports the WebExtension API alias; tiles never call it (sends go through deps).
vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome ??= {};
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function model(needs: Need[], over: Partial<TileModel> = {}): TileModel {
  return {
    jobId: "job_1",
    tgt: "0042",
    company: "Acme <b>Robotics</b>",
    title: "Engineer",
    url: "https://acme.example/jobs/1",
    status: needs.length ? "needs_you" : "running",
    phase: needs.length ? "holding" : "filling",
    ready: needs.length > 0 && needs.every((n) => n.kind === "review_submit"),
    step: 2,
    fieldsDone: 3,
    fieldsTotal: 6,
    currentField: "Email",
    needs,
    holdingSince: needs.length ? Date.now() - 65_000 : null,
    createdAt: 1,
    ...over,
  };
}

const need = (over: Partial<Need>): Need => ({ id: "need_1", jobId: "job_1", kind: "question", prompt: "Why?", frameId: 0, createdAt: Date.now(), ...over });

let sent: ToBackground[];
let view: TileView;

beforeEach(() => {
  document.body.replaceChildren();
  sent = [];
  view = new TileView("job_1", { t: () => (k, v) => copy(true, k, v), send: async (m) => void sent.push(m), drafts: new Map() });
  document.body.append(view.el);
});

describe("War Room tile", () => {
  it("renders page-derived text as text, never markup", () => {
    view.update(model([need({ prompt: '<img src=x onerror="alert(1)">Describe chaos', inputType: "textarea" })]), 1, Date.now(), true);
    expect(view.el.querySelector("img")).toBeNull();
    expect(view.el.querySelector("b:not(.fill)")).toBeNull();
    expect(view.el.textContent).toContain('<img src=x onerror="alert(1)">Describe chaos');
    expect(view.el.textContent).toContain("Acme <b>Robotics</b>");
    expect(view.el.textContent).toContain("UNIT-01");
    expect(view.el.textContent).toContain("TGT-0042");
    expect(view.el.textContent).toContain("OPERATOR INPUT REQUIRED");
    expect(view.el.textContent).toMatch(/HOLDING 01:0\d/);
    expect(view.el.dataset.phase).toBe("holding");
  });

  it("answers a textarea question with answerNeed and remember", () => {
    view.update(model([need({ inputType: "textarea" })]), 1, Date.now(), true);
    const ta = view.el.querySelector("textarea")!;
    ta.value = "Because robots.";
    ta.dispatchEvent(new Event("input"));
    view.el.querySelector<HTMLButtonElement>(".need button.primary")!.click();
    expect(sent).toEqual([{ type: "answerNeed", needId: "need_1", value: "Because robots.", remember: true }]);
  });

  it("keeps typed text across live updates while the needs are unchanged", () => {
    const m = model([need({ inputType: "text" })]);
    view.update(m, 1, Date.now(), true);
    const input = view.el.querySelector<HTMLInputElement>(".need input.wr-input")!;
    input.value = "half typed";
    view.update({ ...m, fieldsDone: 4 }, 1, Date.now(), true);
    expect(view.el.querySelector<HTMLInputElement>(".need input.wr-input")).toBe(input);
    expect(input.value).toBe("half typed");
  });

  it("consent sends 'checked'; login offers Done (dismissNeed)", () => {
    view.update(model([need({ kind: "consent", prompt: "I certify" })]), 1, Date.now(), true);
    view.el.querySelector<HTMLButtonElement>(".need[data-kind=consent] button.primary")!.click();
    expect(sent[0]).toEqual({ type: "answerNeed", needId: "need_1", value: "checked", remember: true });

    view.update(model([need({ id: "need_2", kind: "login", prompt: "Sign in" })]), 1, Date.now(), true);
    const done = [...view.el.querySelectorAll<HTMLButtonElement>(".need button")].find((b) => b.textContent === "DONE")!;
    done.click();
    expect(sent[1]).toEqual({ type: "dismissNeed", needId: "need_2" });
  });

  it("shows a hold-to-fire RELEASE for review_submit", () => {
    view.update(model([need({ kind: "review_submit", prompt: "Everything is filled" })]), 3, Date.now(), true);
    expect(view.el.dataset.ready).toBe("true");
    expect(view.el.textContent).toContain("RELEASE AUTH REQUIRED");
    expect(view.el.querySelector(".fire-btn")).not.toBeNull();
  });
});

describe("hold to fire", () => {
  it("ignores a click, cancels on early release, fires after the hold", async () => {
    const onFire = vi.fn();
    const wrap = holdToFire({ label: "HOLD", arming: "ARMING", done: "RELEASED", hint: "hold it", onFire, ms: 60 });
    document.body.append(wrap);
    const btn = wrap.querySelector("button")!;

    btn.click();
    await sleep(100);
    expect(onFire).not.toHaveBeenCalled();

    btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    await sleep(15);
    btn.dispatchEvent(new KeyboardEvent("keyup", { key: " ", bubbles: true }));
    await sleep(100);
    expect(onFire).not.toHaveBeenCalled();
    expect(btn.dataset.state).toBe("idle");

    btn.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(150);
    expect(onFire).toHaveBeenCalledTimes(1);
    expect(btn.dataset.state).toBe("fired");
    expect(btn.textContent).toContain("RELEASED");
    expect(btn.disabled).toBe(true);
  });
});
