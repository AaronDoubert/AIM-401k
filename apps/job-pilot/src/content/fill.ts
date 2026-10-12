import { chooseOption } from "../core/choose";
import type { ResumeFile } from "../shared/types";
import { sleep } from "../shared/util";
import { isVisible, optionLabel, queryAll, textOf } from "./dom";
import type { ScannedField } from "./scan";

function fire(el: Element, type: string): void {
  const ev =
    type === "focus" || type === "blur" || type === "focusin" || type === "focusout"
      ? new FocusEvent(type, { bubbles: type === "focusin" || type === "focusout" })
      : new Event(type, { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
}

/**
 * Set a value the way a user would, so React/Vue/Angular controlled inputs
 * notice it: use the native prototype setter (bypassing framework-installed
 * instance setters), then dispatch input + change + blur.
 */
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  fire(el, "focusin");
  if (setter) setter.call(el, value);
  else el.value = value;
  fire(el, "input");
  fire(el, "change");
  fire(el, "focusout");
  fire(el, "blur");
}

function clickLike(el: HTMLElement): void {
  const opts = { bubbles: true, cancelable: true, view: window };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.click();
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const opts = Array.from(el.options);
  const i = chooseOption(
    value,
    opts.map((o) => o.text),
  );
  const opt = i >= 0 ? opts[i] : undefined;
  if (!opt) return false;
  setNativeValue(el, opt.value);
  return el.value === opt.value;
}

function fillRadio(els: HTMLElement[], value: string): boolean {
  const radios = els as HTMLInputElement[];
  const i = chooseOption(value, radios.map(optionLabel));
  const r = i >= 0 ? radios[i] : undefined;
  if (!r) return false;
  if (!r.checked) (r.labels?.[0] && !isVisible(r) ? r.labels[0] : r).click();
  return r.checked;
}

function setChecked(el: HTMLInputElement, checked: boolean): void {
  if (el.checked === checked) return;
  // Styled checkboxes hide the input; clicking the label toggles it the same way.
  const target = !isVisible(el) && el.labels?.[0] ? el.labels[0] : el;
  target.click();
  if (el.checked !== checked) {
    el.checked = checked;
    fire(el, "input");
    fire(el, "change");
  }
}

function fillCheckboxGroup(els: HTMLElement[], value: string): boolean {
  const boxes = els as HTMLInputElement[];
  const labels = boxes.map(optionLabel);
  const picks = new Set(
    value
      .split(/\s*;\s*/)
      .map((v) => chooseOption(v, labels))
      .filter((i) => i >= 0),
  );
  if (!picks.size) return false;
  boxes.forEach((b, i) => setChecked(b, picks.has(i)));
  return true;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function fillFile(el: HTMLInputElement, file: ResumeFile): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(new File([base64ToBytes(file.data) as BlobPart], file.name, { type: file.type || "application/pdf" }));
    el.files = dt.files;
    fire(el, "input");
    fire(el, "change");
    el.dataset.jobpilotUploaded = "1";
    return (el.files?.length ?? 0) > 0;
  } catch {
    return false;
  }
}

/** Visible listbox options anywhere on the page (portaled dropdown menus). */
function visibleOptions(): HTMLElement[] {
  return queryAll<HTMLElement>("[role=option], [data-automation-id=promptOption], li[role=menuitem]").filter(isVisible);
}

async function waitForOptions(timeoutMs: number): Promise<HTMLElement[]> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const opts = visibleOptions();
    if (opts.length) return opts;
    await sleep(100);
  }
  return [];
}

/** Custom dropdowns (React-Select, Workday, Ashby): open, optionally type, click the best option. */
async function fillCombobox(el: HTMLElement, value: string): Promise<boolean> {
  if (el instanceof HTMLInputElement) {
    clickLike(el);
    setNativeValue(el, "");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, value);
    fire(el, "input");
    el.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }));
  } else {
    clickLike(el);
  }
  const opts = await waitForOptions(2000);
  if (!opts.length) {
    if (el instanceof HTMLInputElement) {
      // Free-text combobox (e.g. a location autocomplete with no matches): keep typed value.
      el.dataset.jobpilotFilled = "1";
      fire(el, "change");
      return !!el.value;
    }
    return false;
  }
  const i = chooseOption(value, opts.map(textOf));
  const pick = i >= 0 ? opts[i] : undefined;
  if (!pick) {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    return false;
  }
  clickLike(pick);
  el.dataset.jobpilotFilled = "1";
  await sleep(150);
  return true;
}

/** Fill one scanned field. Returns true when the value took. */
export async function fillField(f: ScannedField, value: string, resume: ResumeFile | null): Promise<boolean> {
  const el = f.els[0];
  if (!el) return false;
  let ok = false;
  switch (f.info.kind) {
    case "file":
      ok = !!resume && fillFile(el as HTMLInputElement, resume);
      break;
    case "select":
      ok = fillSelect(el as HTMLSelectElement, value);
      break;
    case "radio":
      ok = fillRadio(f.els, value);
      break;
    case "checkbox":
      setChecked(el as HTMLInputElement, value === "checked");
      ok = true;
      break;
    case "checkboxGroup":
      ok = fillCheckboxGroup(f.els, value);
      break;
    case "combobox":
      ok = await fillCombobox(el, value);
      break;
    default: {
      const input = el as HTMLInputElement | HTMLTextAreaElement;
      const max = input.maxLength > 0 ? input.maxLength : Infinity;
      setNativeValue(input, value.slice(0, max));
      ok = input.value.length > 0;
    }
  }
  if (ok) for (const e of f.els) e.dataset.jobpilot = "filled";
  return ok;
}

/** Click a button/link like a person would. */
export function press(el: HTMLElement): void {
  el.scrollIntoView?.({ block: "center" });
  clickLike(el);
}
