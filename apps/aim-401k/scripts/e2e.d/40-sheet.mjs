// Spreadsheet import: CSV file, multi-sheet XLSX, published-sheet link,
// pasted cells, re-import idempotency and .xlsx export, all through the
// tracker's "Import spreadsheet" modal.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const localIso = (t) => {
  if (t == null) return null;
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default async function (t) {
  const { ext, base, store, waitFor, check, msg, shots, fixtures, userDir } = t;
  const sheets = join(fixtures, "sheets");
  const byCompany = (s, c) => s.jobs.filter((j) => j.company === c);
  const byName = (s, c, title) => s.jobs.filter((j) => j.company === c && j.title === title);
  const ACME = ["Acme Robotics", "Senior Platform Engineer"];

  const open = async () => {
    await ext.click("#import-sheet");
    await ext.waitForSelector("#sheet-import-file", { state: "attached" });
  };
  const summary = () => ext.locator("#sheet-import-summary").innerText();
  const importAndWait = async (label, pred) => {
    await ext.click("#sheet-import-go");
    await ext.waitForSelector("#sheet-import", { state: "detached", timeout: 10000 });
    return waitFor(label, pred, 10000);
  };

  try {
    // Core-flow jobs this suite touches: the submitted posting.html job (matched by
    // URL) and the Acme jobs (the core flow applies to "Acme Robotics / Senior
    // Platform Engineer" twice; a name-only sheet row matches the most recent one).
    let s = await store();
    console.log("   core-flow jobs:", s.jobs.map((j) => `${j.company} / ${j.title} [${j.status}]`).join(" · "));
    const posted = s.jobs.find((j) => j.url === `${base}/posting.html`);
    check(posted?.status === "submitted", `core-flow submitted job present (${posted?.status})`);
    const acmeBefore = byName(s, ...ACME);
    check(acmeBefore.length >= 1, `tracked "${ACME.join(" / ")}" jobs before import (${acmeBefore.length})`);
    const acme = [...acmeBefore].sort((a, b) => b.createdAt - a.createdAt)[0];
    const before = s.jobs.length;

    // --- 1. Google Sheets CSV export: junk rows above the header, quotes, an existing job --
    await open();
    await ext.waitForSelector("#sheet-import-drop");
    await ext.screenshot({ path: join(shots, "sheet-import-source.png") }).catch(() => {});
    await ext.setInputFiles("#sheet-import-file", join(sheets, "google-tracker.csv"));
    await ext.waitForSelector("#sheet-import-preview");
    check((await ext.inputValue("#sheet-import-header")) === "2", "CSV: header row detected below the junk rows");
    check(
      (await ext.inputValue("#sheet-import-map-company")) === "0" && (await ext.inputValue("#sheet-import-map-appliedAt")) === "4",
      "CSV: columns auto-mapped",
    );
    check((await ext.locator("#sheet-import-preview tbody tr").count()) === 6, "CSV: preview shows the data rows");
    let sum = await summary();
    check(/4 new/i.test(sum) && /1 updat/i.test(sum) && /1 skipped/i.test(sum), `CSV: summary (${sum})`);
    await ext.screenshot({ path: join(shots, "sheet-import.png") }).catch(() => {});
    s = await importAndWait("CSV import", (s) => s.jobs.some((j) => j.company === "Stark Industries"));
    check(s.jobs.length === before + 4, `CSV: 4 jobs created (${s.jobs.length - before})`);
    const acme2 = byName(s, ...ACME);
    const acmeAfter = acme2.find((j) => j.id === acme?.id);
    check(acme2.length === acmeBefore.length && !!acmeAfter, "CSV: existing Acme job matched by company + title, not duplicated");
    const inFlight = ["running", "needs_you", "ready_to_submit"].includes(acme?.status);
    check(
      /expect a call, next week/.test(acmeAfter?.notes ?? "") && acmeAfter?.status === (inFlight ? acme.status : "interviewing"),
      `CSV: Acme notes added; status ${inFlight ? "left alone mid-application" : "moved to interviewing"} (${acme?.status} -> ${acmeAfter?.status})`,
    );
    const stark = byCompany(s, "Stark Industries");
    check(stark.length === 1 && stark[0].status === "submitted" && localIso(stark[0].appliedAt) === "2026-09-28", `CSV: Stark applied 2026-09-28, once (${stark.length}, ${localIso(stark[0]?.appliedAt)})`);
    const wayne = byCompany(s, "Wayne Enterprises")[0];
    check(wayne?.status === "rejected" && wayne.url === "https://boards.greenhouse.io/wayne/jobs/555", `CSV: Wayne rejected, bare link completed (${wayne?.url})`);
    const cyber = byCompany(s, "Cyberdyne Systems")[0];
    check(cyber?.url === "" && cyber.status === "submitted" && /Ghosted/.test(cyber.notes) && cyber.ats === "sheet", "CSV: link-less ghosted row kept (applied, note)");
    check(byCompany(s, "Soylent")[0]?.status === "saved", "CSV: wishlist row saved");
    check(/Imported from google-tracker\.csv/.test(stark[0]?.log?.[0]?.msg ?? ""), "CSV: job log notes the source file");

    // --- 2. Re-importing the same file changes nothing --------------------------------
    await open();
    await ext.setInputFiles("#sheet-import-file", join(sheets, "google-tracker.csv"));
    await ext.waitForSelector("#sheet-import-preview");
    sum = await summary();
    check(/0 new/i.test(sum) && /0 updat/i.test(sum) && (await ext.isDisabled("#sheet-import-go")), `re-import: nothing to do (${sum})`);
    await ext.keyboard.press("Escape");
    await ext.waitForSelector("#sheet-import", { state: "detached" });

    // --- 3. Excel workbook: sheet picker, dates, hyperlinks, never-downgrade ------------
    await open();
    await ext.setInputFiles("#sheet-import-file", join(sheets, "job-tracker.xlsx"));
    await ext.waitForSelector("#sheet-import-sheet");
    const sheetNames = await ext.locator("#sheet-import-sheet option").allInnerTexts();
    check(sheetNames.length === 3 && sheetNames[1] === "Archive 2025" && /Lists/.test(sheetNames[2]), `XLSX: sheets listed (${sheetNames.join(" | ")})`);
    await ext.selectOption("#sheet-import-sheet", "1");
    await ext.waitForFunction(() => /2 new/i.test(document.querySelector("#sheet-import-summary")?.textContent ?? ""));
    check(true, "XLSX: picking another sheet re-maps it");
    await ext.selectOption("#sheet-import-sheet", "0");
    await ext.waitForFunction(() => document.querySelector("#sheet-import-header")?.value === "2");
    sum = await summary();
    check(/5 new/i.test(sum) && /0 updat/i.test(sum) && /1 skipped/i.test(sum), `XLSX: summary (${sum})`);
    s = await importAndWait("XLSX import", (s) => s.jobs.some((j) => j.company === "Globex Corporation"));
    const globex = byCompany(s, "Globex Corporation")[0];
    check(
      globex?.status === "interviewing" && localIso(globex.appliedAt) === "2026-09-14" && globex.location === "Remote" && /Salary: 185000/.test(globex.notes),
      `XLSX: Globex phone screen -> interviewing, date, remote, salary (${globex?.status}, ${localIso(globex?.appliedAt)}, ${globex?.location})`,
    );
    check(byName(s, "Initech", "Backend Developer")[0]?.url === "https://jobs.lever.co/initech/abc-123", "XLSX: cell hyperlink used as the job link");
    check(byCompany(s, "Umbrella Health")[0]?.url === "https://umbrella.example/careers/77", "XLSX: HYPERLINK() formula used as the job link");
    check(byCompany(s, "Hooli")[0]?.status === "offer", "XLSX: offer");
    const mesa = byCompany(s, "Black Mesa")[0];
    check(mesa?.status === "interviewing" && localIso(mesa.appliedAt) === "2026-09-01", `XLSX: Excel serial date read by header (${localIso(mesa?.appliedAt)})`);
    check(byName(s, ...ACME).length === acmeBefore.length, "XLSX: Acme row matched the tracked job (no duplicate)");

    // --- 4. Published-sheet link (served by the fixture server) -------------------------
    await open();
    await ext.fill("#sheet-import-url", `${base}/posting.html`);
    await ext.click("#sheet-import-fetch");
    await ext.waitForFunction(() => !!document.querySelector("#sheet-import-error")?.textContent);
    check(/web page/i.test(await ext.locator("#sheet-import-error").innerText()), "link: an HTML page is rejected with a hint");
    await ext.fill("#sheet-import-url", `${base}/sheets/notion-export.csv`);
    await ext.click("#sheet-import-fetch");
    await ext.waitForSelector("#sheet-import-preview");
    sum = await summary();
    check(/4 new/i.test(sum) && /1 updat/i.test(sum), `link: Notion CSV summary (${sum})`);
    s = await importAndWait("link import", (s) => s.jobs.some((j) => j.company === "Initrode"));
    const initrode = byCompany(s, "Initrode")[0];
    check(initrode?.status === "submitted" && localIso(initrode.appliedAt) === "2026-10-03" && initrode.location === "Austin, TX", "link: Notion row imported with date + location");
    const hooli = byCompany(s, "Hooli");
    check(hooli.length === 1 && hooli[0].status === "offer" && hooli[0].location === "Remote" && /\$210k/.test(hooli[0].notes), "link: Hooli enriched, not duplicated");

    // --- 5. Pasted cells: URL match + upgrade, status override, queue option (paused) -----
    const wasPaused = (await store()).settings?.paused ?? false;
    await msg({ type: "setPaused", paused: true });
    await open();
    await ext.fill(
      "#sheet-import-paste",
      [
        "Company\tRole\tLink\tStatus",
        `Acme Robotics\tSenior Platform Engineer\t${base}/posting.html\tInterviewing`,
        "Blue Sun\tPilot\t\tYolo",
        `Serenity Valley\tMechanic\t${base}/posting.html?from=sheet\tWishlist`,
      ].join("\n"),
    );
    await ext.click("#sheet-import-paste-go");
    await ext.waitForSelector("#sheet-import-preview");
    await ext.selectOption('select[data-status-key="yolo"]', "interviewing");
    await ext.check("#sheet-import-queue");
    sum = await summary();
    check(/2 new/i.test(sum) && /1 updat/i.test(sum), `paste: summary (${sum})`);
    s = await importAndWait("paste import", (s) => s.jobs.some((j) => j.company === "Serenity Valley"));
    const postedNow = s.jobs.filter((j) => j.url === `${base}/posting.html`);
    check(postedNow.length === 1 && postedNow[0].id === posted?.id && postedNow[0].status === "interviewing", `paste: submitted job matched by URL moved to interviewing (${postedNow[0]?.status})`);
    check(byCompany(s, "Blue Sun")[0]?.status === "interviewing", "paste: status override applied");
    const serenity = byCompany(s, "Serenity Valley")[0];
    check(serenity?.status === "queued" && serenity.url === `${base}/posting.html?from=sheet`, `paste: saved row with a link queued for auto-apply (${serenity?.status})`);
    if (serenity) await msg({ type: "deleteJobs", jobIds: [serenity.id] });
    await msg({ type: "setPaused", paused: wasPaused });

    // An older sheet saying "Applied" never moves an interviewing job back.
    await open();
    await ext.fill("#sheet-import-paste", `Link\tStatus\n${base}/posting.html\tApplied`);
    await ext.click("#sheet-import-paste-go");
    await ext.waitForSelector("#sheet-import-preview");
    sum = await summary();
    check(/0 new/i.test(sum) && /0 updat/i.test(sum) && (await ext.isDisabled("#sheet-import-go")), `paste: "Applied" doesn't downgrade an interviewing job (${sum})`);
    await ext.keyboard.press("Escape");
    await ext.waitForSelector("#sheet-import", { state: "detached" });

    // --- 6. Export the tracker as .xlsx -------------------------------------------------
    await open();
    const [download] = await Promise.all([ext.waitForEvent("download", { timeout: 10000 }), ext.click("#sheet-import-export")]);
    const out = join(userDir, "export.xlsx");
    await download.saveAs(out);
    const bytes = readFileSync(out);
    const text = bytes.toString("latin1");
    check(
      bytes[0] === 0x50 && bytes[1] === 0x4b && /xl\/worksheets\/sheet1\.xml/.test(text) && /Acme Robotics/.test(text) && /Globex Corporation/.test(text),
      `export: .xlsx downloaded (${download.suggestedFilename()}, ${bytes.length} bytes)`,
    );
    await ext.keyboard.press("Escape");
  } finally {
    // Never leave the modal over the shared tracker page for later suites.
    if (await ext.locator("#sheet-import").count()) await ext.keyboard.press("Escape").catch(() => {});
  }
}
