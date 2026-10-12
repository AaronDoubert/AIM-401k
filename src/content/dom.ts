// Low-level DOM helpers: visibility, text, labels, and walking open shadow roots.

export function textOf(el: Element | null | undefined): string {
  if (!el) return "";
  return (el.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function isVisible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  if (el.hidden) return false;
  const rects = el.getClientRects();
  if (rects.length === 0 && !isTestEnv()) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

// happy-dom (unit tests) has no layout; treat everything as laid out.
function isTestEnv(): boolean {
  return typeof navigator !== "undefined" && /HappyDOM/i.test(navigator.userAgent);
}

/** All open shadow roots under (and including) a root, so web-component forms are reachable. */
export function allRoots(root: Document | ShadowRoot = document): (Document | ShadowRoot)[] {
  const out: (Document | ShadowRoot)[] = [root];
  // nodeType rather than instanceof: robust across realms (Firefox Xrays, test DOMs).
  const isDoc = root.nodeType === 9;
  const doc = isDoc ? (root as Document) : root.ownerDocument;
  const start = isDoc ? (root as Document).documentElement : root;
  if (!start || !doc) return out;
  const walker = doc.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
  let n = walker.nextNode();
  while (n) {
    const sr = (n as Element).shadowRoot;
    if (sr) out.push(...allRoots(sr));
    n = walker.nextNode();
  }
  return out;
}

export function queryAll<T extends Element = Element>(selector: string, root: Document | ShadowRoot = document): T[] {
  return allRoots(root).flatMap((r) => Array.from(r.querySelectorAll<T>(selector)));
}

const FIELD_SEL = "input, select, textarea, button, [role=combobox], [role=listbox]";

/** Text of a label element without the text of controls nested inside it. */
function labelText(label: Element): string {
  if (!label.querySelector(FIELD_SEL)) return textOf(label);
  const clone = label.cloneNode(true) as Element;
  clone.querySelectorAll(`${FIELD_SEL}, option`).forEach((n) => n.remove());
  return textOf(clone);
}

function byIds(el: Element, attr: string): string {
  const ids = el.getAttribute(attr);
  if (!ids) return "";
  const doc = el.getRootNode() as Document | ShadowRoot;
  return ids
    .split(/\s+/)
    .map((id) => textOf(doc.getElementById?.(id) ?? el.ownerDocument.getElementById(id)))
    .filter(Boolean)
    .join(" ");
}

/** Nearby descriptive text: previous siblings of the element or its ancestors. */
function nearbyText(el: Element, maxDepth = 4): string {
  let node: Element | null = el;
  for (let depth = 0; node && depth < maxDepth; depth++) {
    let sib = node.previousElementSibling;
    for (let hops = 0; sib && hops < 3; hops++) {
      if (!sib.matches(FIELD_SEL) && !sib.querySelector("input, select, textarea")) {
        const t = labelText(sib);
        if (t && t.length <= 400) return t;
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
    if (node && /^(form|body)$/i.test(node.tagName)) break;
  }
  return "";
}

/** Best-effort human question text for a single control. */
export function controlLabel(el: HTMLElement): string {
  const viaIds = byIds(el, "aria-labelledby");
  if (viaIds) return viaIds;
  const labels = (el as HTMLInputElement).labels;
  if (labels && labels.length) {
    const t = Array.from(labels).map(labelText).filter(Boolean).join(" ");
    if (t) return t;
  }
  const wrap = el.closest("label");
  if (wrap) {
    const t = labelText(wrap);
    if (t) return t;
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  return nearbyText(el) || el.getAttribute("placeholder") || el.getAttribute("title") || "";
}

/** Question text for a group of radios/checkboxes. */
export function groupLabel(members: HTMLElement[]): string {
  const first = members[0];
  if (!first) return "";
  const group = first.closest("fieldset, [role=radiogroup], [role=group]");
  if (group) {
    const legend = group.querySelector("legend");
    if (legend) return labelText(legend);
    const viaIds = byIds(group, "aria-labelledby");
    if (viaIds) return viaIds;
    const aria = group.getAttribute("aria-label");
    if (aria) return aria;
  }
  // Climb to the smallest ancestor holding every member, then look just above it.
  let common: HTMLElement | null = first.parentElement;
  while (common && !members.every((m) => common!.contains(m))) common = common.parentElement;
  if (!common) return "";
  return nearbyText(common, 3) || (group ? nearbyText(group, 2) : "");
}

/** Text describing one option (a radio or checkbox) inside a group. */
export function optionLabel(el: HTMLInputElement): string {
  if (el.labels && el.labels.length) {
    const t = labelText(el.labels[0]!);
    if (t) return t;
  }
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  const next = el.nextSibling;
  if (next && next.textContent?.trim()) return next.textContent.trim();
  return el.value;
}

export function humanizeAttr(s: string | null): string {
  if (!s) return "";
  return s
    .replace(/\[\]$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_\-.[\]]+/g, " ")
    .trim();
}
