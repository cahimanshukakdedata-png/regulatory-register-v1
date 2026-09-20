// Offline tests: every network call is replaced by fixture text.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { collect, makeFetcher, friendlyError } from "../run.mjs";
import { findDeadlines, findRefs, classifyType, classifyArea, pickNotes, extractLinks, extractMarkdownLinks } from "../extract.mjs";

let passed = 0;
const t = (name, fn) => Promise.resolve().then(fn).then(() => { passed++; console.log("ok  " + name); }, e => { console.error("FAIL " + name + "\n", e); process.exitCode = 1; });

/* ---- unit checks ---- */
await t("finds refs", () => {
  const r = findRefs("Vide Notification No. 12/2026-Central Tax dated 10.09.2026 and G.S.R. 725(E), read with Circular No. 250/07/2026-GST.");
  assert.ok(r.some(x => x.startsWith("Notification No. 12/2026-Central Tax")), JSON.stringify(r));
  assert.ok(r.includes("G.S.R. 725(E)"), JSON.stringify(r));
  assert.ok(r.some(x => x.startsWith("Circular No. 250/07/2026")), JSON.stringify(r));
});
await t("finds future deadlines next to cues only", () => {
  const d = findDeadlines("The order dated 1st August 2026 was issued. The due date has been extended till 31st October 2026 for all assessees. Meeting held on 12.09.2026.", "2026-09-15");
  assert.equal(d.length, 1); assert.equal(d[0].date, "2026-10-31"); assert.equal(d[0].kind, "deadline");
  const e = findDeadlines("These rules shall come into force on 1 October 2026.", "2026-09-15");
  assert.equal(e[0].date, "2026-10-01"); assert.equal(e[0].kind, "effective");
});
await t("classifies type", () => {
  assert.equal(classifyType("ITAT Mumbai deletes addition under section 68"), "Judgment");
  assert.equal(classifyType("CBDT extends due date for filing tax audit report"), "Due date");
  assert.equal(classifyType("GSTN Advisory on Ship-to GSTIN"), "Advisory");
  assert.equal(classifyType("How to choose a mutual fund for your child"), "Article");
});
await t("reclassifies area", () => {
  assert.equal(classifyArea("New Form 140 for TDS on non-salary payments", "it", true), "tds");
  assert.equal(classifyArea("EPFO revises interest rate", "mca", true), "labour");
  assert.equal(classifyArea("EPFO revises interest rate", "mca", false), "mca");
  assert.equal(classifyArea("Maharashtra announces capital subsidy under new industrial policy", "mh", true), "loan");
  assert.equal(classifyArea("CGTMSE revises guarantee fee for collateral-free MSME loans", "it", true), "loan");
  assert.equal(classifyArea("Maharashtra profession tax return date advanced", "gst", true), "mh");
});
await t("picks notes from substance", () => {
  const n = pickNotes("Click here to join our WhatsApp group for updates on every topic we cover.\nThe Board has extended the due date for furnishing the audit report from 30 September 2026 to 31 October 2026.\nThis is a nice day and the weather in the city was pleasant for most of the week.\nThe extension applies to assessees referred to in section 139(1) and no interest under section 234A shall be charged.");
  assert.equal(n.length, 2, JSON.stringify(n));
  assert.ok(n[0].includes("extended the due date"));
});
await t("extracts document links and skips navigation", () => {
  const l = extractLinks(`<a href="/">Home</a><a href="/c/notif-12.pdf">Notification No. 12/2026-Central Tax dated 10.09.2026</a><a href="javascript:void(0)">Screen Reader Access</a>`, "https://cbic-gst.gov.in/", "notification|\\.pdf");
  assert.equal(l.length, 1); assert.ok(l[0].isPdf); assert.equal(l[0].link, "https://cbic-gst.gov.in/c/notif-12.pdf");
});

await t("reads markdown from a text proxy when there is no HTML", () => {
  const md = "Header\n\n[Notification No. 12/2026 dated 10.09.2026](/files/n12.pdf)\n[Home](/)\n";
  const l = extractMarkdownLinks(md, "https://incometaxindia.gov.in/", "notification|\\.pdf");
  assert.equal(l.length, 1); assert.equal(l[0].link, "https://incometaxindia.gov.in/files/n12.pdf"); assert.ok(l[0].isPdf);
  const viaExtract = extractLinks(md, "https://incometaxindia.gov.in/", "notification|\\.pdf");
  assert.equal(viaExtract.length, 1);
});

await t("fetcher: blocked site is retried through a proxy", async () => {
  const calls = [];
  const raw = async (url) => {
    calls.push(url);
    if (url.startsWith("https://www.mca.gov.in")) return { ok: false, status: 403, text: "", url, headers: { get: () => "text/html" } };
    return { ok: true, status: 200, text: async () => "<html><body>" + "x".repeat(300) + "</body></html>", url, headers: { get: () => "text/html" } };
  };
  const wrap = async (url, o) => { const r = await raw(url, o); return { ...r, text: typeof r.text === "function" ? r.text : async () => "" }; };
  const fetchText = makeFetcher({ userAgent: "test", timeoutMs: 5000, proxies: ["https://proxy.example/raw?url={enc}"] },
    async (url, opts) => { const r = await raw(url, opts); return { ok: r.ok, status: r.status, url, headers: r.headers, text: r.text || (async () => "") }; });
  const r = await fetchText("https://www.mca.gov.in/x");
  assert.ok(r.ok, "proxy result returned");
  assert.equal(r.via, "proxy.example");
  assert.match(r.viaReason, /403/);
  assert.equal(r.finalUrl, "https://www.mca.gov.in/x");
  assert.equal(calls.length, 2);
});

await t("fetcher: old TLS is retried, and proxy is skipped when told to", async () => {
  let n = 0;
  const raw = async (url) => {
    n++;
    if (n < 3) { const e = new Error("fetch failed"); e.cause = { code: "EPROTO", message: "handshake failure" }; throw e; }
    return { ok: true, status: 200, url, headers: { get: () => "text/html" }, text: async () => "ok" };
  };
  const fetchText = makeFetcher({ userAgent: "test", timeoutMs: 5000, proxies: ["https://proxy.example/raw?url={enc}"] }, raw);
  const r = await fetchText("https://www.esic.gov.in/", { proxy: false });
  assert.ok(r.ok); assert.equal(r.text, "ok"); assert.ok(n >= 3, "retried with other TLS settings");
});

await t("friendly errors", () => {
  const mk = (m, code) => Object.assign(new Error(m), { cause: { code } });
  assert.match(friendlyError(mk("fetch failed", "ENOTFOUND")), /could not be found/);
  assert.match(friendlyError(mk("fetch failed", "EPROTO")), /too old/);
  assert.match(friendlyError(new Error("Response is not an RSS or Atom feed")), /did not return a feed/);
});

/* ---- end-to-end with fixtures ---- */
const root = await fs.mkdtemp(path.join(os.tmpdir(), "regreg-"));
await fs.mkdir(path.join(root, "scraper"), { recursive: true });
await fs.writeFile(path.join(root, "scraper/sources.json"), JSON.stringify({
  settings: { politeDelayMs: 0, concurrency: 2 },
  sources: [
    { id: "tg", name: "TaxGuru GST", area: "gst", kind: "rss", url: "https://t/feed", reclassify: true },
    { id: "sebi", name: "SEBI", area: "sebi", kind: "rss", official: true, url: "https://s/rss", exclude: "recovery certificate|notice of demand" },
    { id: "cbic", name: "CBIC GST", area: "gst", kind: "page", official: true, url: "https://cbic/", linkInclude: "notification|circular|\\.pdf|advisory" },
    { id: "gn", name: "News search: GST", area: "gst", kind: "gnews", requireSignal: true, query: "GST notification" },
    { id: "dead", name: "Broken site", area: "mca", kind: "page", official: true, url: "https://dead/" }
  ]
}));

const WP = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>TG</title>
<item><title>CBIC extends GSTR-9 due date to 31 December 2026</title><link>https://t/gstr9</link><pubDate>Mon, 14 Sep 2026 10:00:00 +0530</pubDate>
<description><![CDATA[CBIC has extended the annual return due date.]]></description>
<content:encoded><![CDATA[<p>The Central Board of Indirect Taxes and Customs has issued Notification No. 14/2026-Central Tax dated 14.09.2026.</p><p>By this notification, the due date for furnishing FORM GSTR-9 for FY 2025-26 has been extended till 31st December 2026 for registered persons with turnover above ₹2 crore.</p><p>Join our WhatsApp group for more updates on GST and income tax matters.</p>]]></content:encoded></item>
<item><title>New Form 140 validation errors for TDS deductors under CBDT utility</title><link>https://t/form140</link><pubDate>Sun, 13 Sep 2026 09:00:00 +0530</pubDate><description>Deductors report errors in the utility.</description></item>
<item><title>CBDT notifies Income-tax (Second Amendment) Rules, 2026</title><link>https://t/old-rules</link><pubDate>Wed, 01 Jul 2026 10:00:00 +0530</pubDate><description>Rules notified.</description></item>
<item><title>Ten smart ways to plan your family budget</title><link>https://t/budget-tips</link><pubDate>Mon, 14 Sep 2026 08:00:00 +0530</pubDate><description>Personal finance ideas.</description></item>
<item><title>ITAT Mumbai deletes addition under section 68 for share capital</title><link>https://t/itat</link><pubDate>Mon, 14 Sep 2026 07:00:00 +0530</pubDate><description>The Tribunal held the assessee proved identity and creditworthiness.</description></item>
<item><title>Very old circular on GST refunds</title><link>https://t/very-old</link><pubDate>Mon, 01 Jan 2026 10:00:00 +0530</pubDate><description>Circular.</description></item>
</channel></rss>`;
const SEBI = `<?xml version="1.0"?><rss version="2.0"><channel><title>SEBI</title>
<item><title>Recovery Certificate No. RC9001 of 2026_ Notice of Demand in respect of XYZ</title><link>https://s/rc</link><pubDate>Mon, 14 Sep 2026 10:00:00 +0530</pubDate></item>
<item><title>Amendment to SEBI (LODR) Regulations, 2015 - circular on related party transactions</title><link>https://s/lodr</link><pubDate>Mon, 14 Sep 2026 11:00:00 +0530</pubDate></item>
</channel></rss>`;
const GN = `<?xml version="1.0"?><rss version="2.0"><channel><title>GN</title>
<item><title>CBIC extends GSTR-9 due date to 31 December 2026 - Business Daily</title><link>https://news.google.com/rss/articles/abc</link><pubDate>Mon, 14 Sep 2026 12:00:00 GMT</pubDate><source url="https://bd">Business Daily</source></item>
<item><title>Five tips to save money this festive season - Lifestyle Mag</title><link>https://news.google.com/rss/articles/xyz</link><pubDate>Mon, 14 Sep 2026 12:00:00 GMT</pubDate></item>
<item><title>GSTN issues advisory on IMS changes for October returns - Tax Wire</title><link>https://news.google.com/rss/articles/ims</link><pubDate>Mon, 14 Sep 2026 13:00:00 GMT</pubDate></item>
</channel></rss>`;
const PAGE1 = `<html><body><nav><a href="/">Home</a></nav><a href="/n/10.pdf">Notification No. 10/2026-Central Tax dated 01.08.2026</a><a href="/c/249.html">Circular No. 249/06/2026-GST on refunds</a></body></html>`;
const PAGE2 = PAGE1.replace("</body>", `<a href="/n/15.pdf">Notification No. 15/2026-Central Tax dated 15.09.2026 seeks to extend due date</a><a href="/a/adv.html">Advisory on e-way bill closure facility</a></body>`);
const ADV = `<html><head><meta name="description" content="Advisory on voluntary closure of e-way bills."></head><body><header>menu</header><article><h1>Advisory</h1><p>Taxpayers are informed that the voluntary e-way bill closure facility shall come into force from 1st October 2026 on the portal.</p><p>Generators must close unused bills within 24 hours as per Rule 138 of the CGST Rules.</p></article><footer>©</footer></body></html>`;

let run = 1;
const fetchText = async (url) => {
  const map = {
    "https://t/feed": WP, "https://s/rss": SEBI,
    "https://cbic/": run === 1 ? PAGE1 : PAGE2,
    "https://cbic/a/adv.html": ADV
  };
  if (url.startsWith("https://news.google.com/rss/search")) return { ok: true, status: 200, text: GN, contentType: "application/rss+xml" };
  if (url === "https://dead/") throw new Error("getaddrinfo ENOTFOUND dead");
  if (url in map) return { ok: true, status: 200, text: map[url], finalUrl: url, contentType: url.endsWith(".html") ? "text/html" : "application/xml" };
  return { ok: false, status: 404, text: "", contentType: "text/html" };
};

const now1 = new Date("2026-09-15T03:00:00Z");
const d1 = await collect({ root, fetchText, now: now1 });
await t("run 1: feeds collected, page baselined, broken source reported", () => {
  const titles = d1.items.map(i => i.title);
  assert.ok(titles.includes("CBIC extends GSTR-9 due date to 31 December 2026"));
  assert.ok(!titles.some(x => /Recovery Certificate/.test(x)), "SEBI noise filtered");
  assert.ok(!titles.some(x => /festive season/.test(x)), "news explainer filtered");
  assert.ok(titles.some(x => /IMS changes/.test(x)));
  const cbic = d1.sources.find(s => s.id === "cbic");
  assert.ok(cbic.ok && cbic.kept === 0 && /first visit/.test(cbic.note), JSON.stringify(cbic));
  const dead = d1.sources.find(s => s.id === "dead");
  assert.equal(dead.ok, false); assert.match(dead.error, /could not be found/);
});
await t("run 1: notes, refs, deadline, type and dedupe", () => {
  const g = d1.items.find(i => i.link === "https://t/gstr9");
  assert.equal(g.type, "Due date");
  assert.ok(g.refs.some(r => r.startsWith("Notification No. 14/2026-Central Tax")), JSON.stringify(g.refs));
  assert.equal(g.deadlines[0]?.date, "2026-12-31", JSON.stringify(g.deadlines));
  assert.ok(g.notes.length >= 1 && !g.notes.some(n => /WhatsApp/.test(n)), JSON.stringify(g.notes));
  assert.ok((g.alsoIn || []).includes("News search: GST"), "news duplicate merged into existing item");
  assert.equal(d1.items.filter(i => /GSTR-9 due date/.test(i.title)).length, 1);
  const tds = d1.items.find(i => i.link === "https://t/form140");
  assert.equal(tds.area, "tds");
  const lodr = d1.items.find(i => i.link === "https://s/lodr");
  assert.ok(lodr.official && lodr.area === "sebi");
});
await t("run 1: explainers dropped, case law kept light, retention and 30-day split", async () => {
  const links = d1.items.map(i => i.link);
  assert.ok(!links.includes("https://t/budget-tips"), "explainer article dropped");
  const itat = d1.items.find(i => i.link === "https://t/itat");
  assert.equal(itat.type, "Judgment"); assert.equal(itat.notes.length, 0); assert.ok(itat.summary.length > 10);
  assert.ok(!links.includes("https://t/very-old"), "older than retention period dropped");
  assert.ok(links.includes("https://t/old-rules"), "July item kept in the store");
  const recent = JSON.parse((await fs.readFile(path.join(root, "data/updates.js"), "utf8")).replace(/^window.REGISTER_DATA = /, "").replace(/;\s*$/, ""));
  const archive = JSON.parse((await fs.readFile(path.join(root, "data/archive.js"), "utf8")).replace(/^window.REGISTER_ARCHIVE = /, "").replace(/;\s*$/, ""));
  assert.ok(!recent.items.some(i => i.link === "https://t/old-rules"), "July item not in the 30-day file");
  assert.ok(archive.items.some(i => i.link === "https://t/old-rules"), "July item in the archive file");
  assert.equal(recent.archiveCount, archive.items.length);
});
await t("run 1: files written", async () => {
  const js = await fs.readFile(path.join(root, "data/updates.js"), "utf8");
  assert.ok(js.startsWith("window.REGISTER_DATA = {"));
  const snap = JSON.parse(await fs.readFile(path.join(root, "data/snapshots.json"), "utf8"));
  assert.equal(snap.cbic.length, 2);
});

run = 2;
const now2 = new Date("2026-09-15T09:00:00Z");
const d2 = await collect({ root, fetchText, now: now2 });
await t("run 2: only new page links reported, first-seen kept", () => {
  const cb = d2.items.filter(i => i.sourceId === "cbic");
  assert.equal(cb.length, 2, JSON.stringify(cb.map(i => i.title)));
  const pdf = cb.find(i => i.pdf);
  assert.ok(pdf && /15\/2026/.test(pdf.title));
  const adv = cb.find(i => /Advisory/.test(i.title));
  assert.equal(adv.type, "Advisory");
  assert.equal(adv.deadlines[0]?.date, "2026-10-01", JSON.stringify(adv));
  assert.equal(adv.deadlines[0]?.kind, "effective");
  assert.ok(adv.notes.some(n => /Rule 138/.test(n)), JSON.stringify(adv.notes));
  assert.equal(d2.newThisRun, 2);
  const g = d2.items.find(i => i.link === "https://t/gstr9");
  assert.equal(g.firstSeen, now1.toISOString());
});

console.log(`\n${passed} passed${process.exitCode ? ", some failed" : ""}`);
