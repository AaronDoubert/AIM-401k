import { describe, expect, it } from "vitest";
import { parseLocation } from "../src/core/geo";
import { CITIES, MAP_VIEWBOX, NATION_PATH, STATE_BORDERS_PATH, STATES } from "../src/core/usmap.data";

const k = (s: string) => parseLocation(s).key;

describe("parseLocation", () => {
  it("resolves City, ST and City, State", () => {
    expect(parseLocation("Austin, TX")).toMatchObject({ kind: "city", key: "city:austin-tx", state: "TX" });
    expect(k("Austin, Texas")).toBe("city:austin-tx");
    expect(k("austin,tx")).toBe("city:austin-tx");
    expect(k("Austin TX")).toBe("city:austin-tx");
    expect(k("Austin, TX, USA")).toBe("city:austin-tx");
    expect(k("St. Louis, MO")).toBe("city:st-louis-mo");
    expect(k("Saint Louis, Missouri")).toBe("city:st-louis-mo");
  });
  it("ignores zip codes", () => {
    expect(k("New York, NY 10001")).toBe("city:new-york-ny");
    expect(k("Seattle WA 98101")).toBe("city:seattle-wa");
  });
  it("handles aliases and areas", () => {
    expect(k("NYC")).toBe("city:new-york-ny");
    expect(k("San Francisco Bay Area")).toBe("city:san-francisco-ca");
    expect(k("Greater Seattle Area")).toBe("city:seattle-wa");
    expect(k("Washington, D.C.")).toBe("city:washington-dc");
    expect(k("Washington, DC")).toBe("city:washington-dc");
  });
  it("detects remote", () => {
    expect(parseLocation("Remote").kind).toBe("remote");
    expect(k("Remote - US")).toBe("remote");
    expect(k("Remote (United States)")).toBe("remote");
    expect(k("Remote, USA")).toBe("remote");
    expect(k("remote - Canada")).toBe("remote");
  });
  it("picks the physical place from hybrid and alternatives", () => {
    expect(k("Hybrid - Seattle, WA")).toBe("city:seattle-wa");
    expect(k("Seattle or Remote")).toBe("city:seattle-wa");
    expect(k("Remote or Austin, TX")).toBe("city:austin-tx");
    expect(k("Boston, MA (Hybrid)")).toBe("city:boston-ma");
    expect(k("Denver, CO / Boulder, CO")).toBe("city:denver-co");
  });
  it("treats country-only as unknown", () => {
    expect(parseLocation("United States").kind).toBe("unknown");
    expect(parseLocation("USA").kind).toBe("unknown");
    expect(parseLocation("").key).toBe("unknown");
    expect(parseLocation("   ").kind).toBe("unknown");
    expect(parseLocation("Headquarters").kind).toBe("unknown");
  });
  it("falls back to state centroid", () => {
    expect(parseLocation("Texas")).toMatchObject({ kind: "state", key: "state:TX", label: "Texas" });
    expect(k("TX")).toBe("state:TX");
    expect(parseLocation("Smallville, TX")).toMatchObject({ kind: "state", key: "state:TX" });
    expect(parseLocation("Texas").x).toBe(STATES.TX?.x);
  });
  it("only treats ambiguous 2-letter tokens as states after a comma or alone", () => {
    expect(k("Indianapolis, IN")).toBe("city:indianapolis-in");
    expect(k("Portland, OR")).toBe("city:portland-or");
    expect(k("Portland, ME")).toBe("city:portland-me");
    expect(k("IN")).toBe("state:IN");
    expect(k("OR")).toBe("state:OR");
    expect(k("Austin IN")).toBe("unknown"); // bare "IN" after a space is not read as Indiana
    expect(k("Springfield OR")).toBe("unknown");
  });
  it("detects foreign", () => {
    expect(k("London, UK")).toBe("foreign");
    expect(k("Toronto, ON, Canada")).toBe("foreign");
    expect(k("Berlin, Germany")).toBe("foreign");
    expect(k("Bengaluru")).toBe("foreign");
    expect(k("Remote - Germany")).toBe("remote");
  });
  it("distinguishes same-named cities by state", () => {
    expect(k("Columbia, SC")).toBe("city:columbia-sc");
    expect(k("Columbia, MD")).toBe("city:columbia-md");
    expect(k("Columbia")).toBe("unknown");
  });
  it("has coordinates for cities and states, none for buckets", () => {
    const p = parseLocation("Austin, TX");
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
    expect(parseLocation("Remote").x).toBeUndefined();
  });
});

describe("usmap data", () => {
  const [, , W, H] = MAP_VIEWBOX.split(" ").map(Number) as [number, number, number, number];
  it("keeps every city and state inside the viewBox", () => {
    for (const [name, , x, y] of CITIES) {
      expect(x, name).toBeGreaterThanOrEqual(0);
      expect(x, name).toBeLessThanOrEqual(W);
      expect(y, name).toBeGreaterThanOrEqual(0);
      expect(y, name).toBeLessThanOrEqual(H);
    }
    for (const [code, s] of Object.entries(STATES)) {
      expect(s.x, code).toBeGreaterThanOrEqual(0);
      expect(s.x, code).toBeLessThanOrEqual(W);
      expect(s.y, code).toBeGreaterThanOrEqual(0);
      expect(s.y, code).toBeLessThanOrEqual(H);
    }
  });
  it("has all 50 states plus DC, and a sane city list", () => {
    const fifty =
      "AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
    for (const c of fifty) expect(STATES[c], c).toBeDefined();
    expect(STATES.DC).toBeDefined();
    expect(CITIES.length).toBeGreaterThanOrEqual(150);
    for (const [, st] of CITIES) expect(STATES[st]).toBeDefined();
  });
  it("ships non-empty paths", () => {
    expect(NATION_PATH.startsWith("M")).toBe(true);
    expect(STATE_BORDERS_PATH.startsWith("M")).toBe(true);
  });
});
