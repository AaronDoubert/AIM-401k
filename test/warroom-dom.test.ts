// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { copy } from "../src/shared/copy";
import type { ToBackground } from "../src/shared/messages";
import type { Need } from "../src/shared/types";
import type { TileModel } from "../src/ui/warroom/model";
import { TrackView } from "../src/ui/warroom/tracks";

// ui/common.ts imports the WebExtension API alias; tiles never call it (sends go through deps).
vi.hoisted(() => {
  (globalThis as { chrome?: unknown }).chrome ??= {};
});



function model(needs: Need[], over: Partial<TileModel> = {}): TileModel {
  return {
    jobId: "job_1",
    company: "Acme <b>Robotics</b>",
    title: "Engineer",
    url: "https://acme.example/jobs/1",
    location: "Austin, TX",
    status: needs.length ? "needs_you" : "running",
    phase: needs.length ? "holding" : "filling",
    ready: needs.length > 0 && needs.every((n) => n.kind === "review_submit"),
    step: 2,
    fieldsDone: 3,
    fieldsTotal: 6,
    currentField: "Email",
    fields: [
      { label: "First name", state: "ok" },
      { label: "Cover letter", state: "ai" },
      { label: "Work authorization", state: "need" },
    ],
    needs,
    holdingSince: needs.length ? Date.now() - 65_000 : null,
    createdAt: 1,
    ...over,
  };
}

const need = (over: Partial<Need>): Need => ({ id: "need_1", jobId: "job_1", kind: "question", prompt: "Why?", frameId: 0, createdAt: Date.now(), ...over });

let sent: ToBackground[];
let view: TrackView;
let selected: string[];

beforeEach(() => {
  document.body.replaceChildren();
  sent = [];
  selected = [];
  view = new TrackView("job_1", { t: () => (k, v) => copy(true, k, v), send: async (m) => void sent.push(m), drafts: new Map(), select: (id) => void selected.push(id) });
  document.body.append(view.el);
});

describe("War Room track row", () => {
  it("renders page-derived text as text, never markup", () => {
    view.update(model([need({ prompt: '<img src=x onerror="alert(1)">Describe chaos', inputType: "textarea" })]), 1, "TGT-0042", Date.now(), true, false);
    expect(view.el.querySelector("img")).toBeNull();
    expect(view.el.querySelector("b:not(.fill)")).toBeNull();
    expect(view.el.textContent).toContain('<img src=x onerror="alert(1)">Describe chaos');
    expect(view.el.textContent).toContain("Acme <b>Robotics</b>");
    expect(view.el.textContent).toContain("ALPHA");
    expect(view.el.textContent).toContain("TGT-0042");
    // Status and timer live on the row only; the panel carries just the message and actions.
    expect(view.el.querySelector(".c-status")!.textContent).toBe("HOLD");
    expect(view.el.querySelector(".c-hold")!.textContent).toMatch(/^01:0\d$/);
    expect(view.el.querySelector(".operator")!.textContent).not.toMatch(/HOLD|OPERATOR|QUERY|01:0/);
    expect(view.el.dataset.phase).toBe("holding");
  });

  it("answers a textarea question with answerNeed and remember", () => {
    view.update(model([need({ inputType: "textarea" })]), 1, "TGT-0042", Date.now(), true, false);
    const ta = view.el.querySelector("textarea")!;
    ta.value = "Because robots.";
    ta.dispatchEvent(new Event("input"));
    view.el.querySelector<HTMLButtonElement>(".need button.primary")!.click();
    expect(sent).toEqual([{ type: "answerNeed", needId: "need_1", value: "Because robots.", remember: true }]);
  });

  it("keeps typed text across live updates while the needs are unchanged", () => {
    const m = model([need({ inputType: "text" })]);
    view.update(m, 1, "TGT-0042", Date.now(), true, false);
    const input = view.el.querySelector<HTMLInputElement>(".need input.wr-input")!;
    input.value = "half typed";
    view.update({ ...m, fieldsDone: 4 }, 1, "TGT-0042", Date.now(), true, false);
    expect(view.el.querySelector<HTMLInputElement>(".need input.wr-input")).toBe(input);
    expect(input.value).toBe("half typed");
  });

  it("consent sends 'checked'; login offers Done (dismissNeed)", () => {
    view.update(model([need({ kind: "consent", prompt: "I certify" })]), 1, "TGT-0042", Date.now(), true, false);
    view.el.querySelector<HTMLButtonElement>(".need[data-kind=consent] button.primary")!.click();
    expect(sent[0]).toEqual({ type: "answerNeed", needId: "need_1", value: "checked", remember: true });

    view.update(model([need({ id: "need_2", kind: "login", prompt: "Sign in" })]), 1, "TGT-0042", Date.now(), true, false);
    const done = [...view.el.querySelectorAll<HTMLButtonElement>(".need button")].find((b) => b.textContent === "DONE")!;
    done.click();
    expect(sent[1]).toEqual({ type: "dismissNeed", needId: "need_2" });
  });

  it("puts a guarded release switch on review_submit", () => {
    view.update(model([need({ kind: "review_submit", prompt: "Everything is filled" })]), 3, "TGT-0042", Date.now(), true, false);
    expect(view.el.dataset.ready).toBe("true");
    expect(view.el.querySelector(".c-status")!.textContent).toBe("READY");
    expect(view.el.querySelector(".operator")!.textContent).not.toMatch(/READY|OPEN/); // one OPEN TAB, on the row
    const g = view.el.querySelector<HTMLElement>(".guarded")!;
    expect(g.dataset.state).toBe("closed");
    expect(g.querySelector(".guard-cover")!.textContent).toBe("LIFT GUARD");
  });

  it("shows the field checklist and locks with brackets only when selected", () => {
    view.update(model([]), 2, "TGT-0042", Date.now(), true, false);
    const items = [...view.el.querySelectorAll<HTMLElement>(".checklist li")].map((li) => [li.dataset.state, li.querySelector("span")!.textContent]);
    expect(items).toEqual([["ok", "First name"], ["ai", "Cover letter"], ["need", "Work authorization"]]);
    expect(view.el.querySelector(".checklist li[data-state=ai] em")!.textContent).toBe("AI-drafted");
    expect(view.el.classList.contains("locked")).toBe(false);
    view.update(model([]), 2, "TGT-0042", Date.now(), true, true);
    expect(view.el.classList.contains("locked")).toBe(true);
    expect(view.el.textContent).toContain("BRAVO");
  });

  it("selects on click and opens the tab from its button", () => {
    view.update(model([]), 1, "TGT-0042", Date.now(), true, false);
    view.el.querySelector<HTMLElement>(".track-row")!.click();
    expect(selected).toEqual(["job_1"]);
    view.el.querySelector<HTMLButtonElement>(".c-open")!.click();
    expect(sent).toEqual([{ type: "focusJob", jobId: "job_1" }]);
  });

  it("never shows an IP address as the company", () => {
    view.update(model([], { company: "127.0.0.1", url: "http://127.0.0.1:4000/apply" }), 1, "TGT-0042", Date.now(), true, false);
    expect(view.el.querySelector(".c-co")!.textContent).toBe("Localhost");
  });
});
