#!/usr/bin/env node
// Regulatory Register collector.
// Reads scraper/sources.json, visits each source, takes rule-based notes and writes
// data/updates.json (full store), data/updates.js (last 30 days) and data/archive.js
// (older items up to the retention period) for index.html. Run: npm run update
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { fetch as undiciFetch, Agent } from "undici";
import {
  AREA_IDS, CHANGE_RE, JUDGMENT_RE, hashId, stripHtml, clean, normTitle, classifyType, classifyArea,
  findRefs, findDeadlines, findDates, pickNotes, summarise, articleText, extractLinks, decodeEntities
} from "./extract.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/* ---------------- Fetching ---------------- */
// Government sites break in three ways: broken certificate chains, very old TLS,
// and blocking anything that is not a browser. The fetcher climbs a ladder:
// normal request -> relaxed certificate -> legacy TLS -> public text proxy.
const insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
const legacyAgent = new Agent({ connect: {
  rejectUnauthorized: false, minVersion: "TLSv1", ciphers: "DEFAULT@SECLEVEL=0",
  secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT | crypto.constants.SSL_OP_ALLOW_UNSAFE_LEGACY_RENEGOTIATION
} });
const CERT_ERR = /CERT|certificate|UNABLE_TO_VERIFY|SELF_SIGNED|unable to get local issuer/i;
const NET_ERR = /timeout|ECONNRESET|ECONNREFUSED|EPROTO|socket|fetch failed|handshake|SSL|TLS/i;
const BLOCKED = new Set([401, 403, 405, 406, 409, 418, 429, 451, 503]);

export function makeFetcher(settings, rawFetch = undiciFetch) {
  const proxies = settings.proxies || [];
  const baseHeaders = (url) => {
    let origin = ""; try { origin = new URL(url).origin + "/"; } catch {}
    return {
      "user-agent": settings.userAgent,
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml,image/avif,image/webp,*/*;q=0.8",
      "accept-language": "en-IN,en-GB;q=0.9,en;q=0.8",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "upgrade-insecure-requests": "1",
      "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "none", "sec-fetch-user": "?1",
      ...(origin ? { referer: origin } : {})
    };
  };
  return async function fetchText(url, opts = {}) {
    const timeoutMs = opts.timeoutMs || settings.timeoutMs;
    const attempt = async (target, dispatcher) => {
      const res = await rawFetch(target, { headers: baseHeaders(target), redirect: "follow", dispatcher, signal: AbortSignal.timeout(timeoutMs) });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text, finalUrl: res.url || target, contentType: res.headers.get("content-type") || "" };
    };
    const viaProxy = async (reason) => {
      if (opts.proxy === false || !proxies.length) return null;
      for (const tpl of proxies) {
        const target = tpl.replace("{enc}", encodeURIComponent(url)).replace("{url}", url);
        try {
          const r = await attempt(target, undefined);
          if (r.ok && r.text && r.text.length > 200) {
            r.via = new URL(target).hostname; r.viaReason = reason; r.finalUrl = url;
            return r;
          }
        } catch { /* try the next proxy */ }
      }
      return null;
    };

    // Sites that always block or stall are read through the proxy straight away,
    // so a run is not spent waiting for three timeouts.
    if (opts.proxyFirst && opts.proxy !== false) {
      const early = await viaProxy("known to refuse direct requests");
      if (early) return early;
    }

    let firstError = null, blockedStatus = 0;
    try {
      const r = await attempt(url, undefined);
      if (!BLOCKED.has(r.status)) return r;
      blockedStatus = r.status;
    } catch (e) {
      firstError = e;
      const msg = `${e?.message || e} ${e?.cause?.code || ""} ${e?.cause?.message || ""}`;
      if (CERT_ERR.test(msg)) {
        try { const r = await attempt(url, insecureAgent); r.certWarning = true; if (!BLOCKED.has(r.status)) return r; blockedStatus = r.status; }
        catch (e2) { firstError = e2; }
      }
      if (!blockedStatus && NET_ERR.test(msg)) {
        await sleep(1200);
        for (const agent of [undefined, insecureAgent, legacyAgent]) {
          try { const r = await attempt(url, agent); r.certWarning = agent !== undefined; if (!BLOCKED.has(r.status)) return r; blockedStatus = r.status; break; }
          catch (e3) { firstError = e3; }
        }
      }
    }
    const proxied = await viaProxy(blockedStatus ? `HTTP ${blockedStatus}` : "could not connect");
    if (proxied) return proxied;
    if (blockedStatus) return { ok: false, status: blockedStatus, text: "", finalUrl: url, contentType: "" };
    throw firstError || new Error("could not connect");
  };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- Parsing feeds ---------------- */
const xml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_", textNodeName: "#text", trimValues: true, processEntities: true, htmlEntities: true });
const txt = v => (v == null ? "" : typeof v === "object" ? (v["#text"] ?? v["__cdata"] ?? "") : String(v));
const arr = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

export function parseFeed(body) {
  const doc = xml.parse(body);
  let entries = [];
  if (doc?.rss?.channel) {
    entries = arr(doc.rss.channel.item).map(it => ({
      title: decodeEntities(txt(it.title)),
      link: txt(it.link) || txt(it.guid),
      published: txt(it.pubDate) || txt(it["dc:date"]),
      description: txt(it.description),
      content: txt(it["content:encoded"]),
      publisher: txt(it.source)
    }));
  } else if (doc?.feed) {
    entries = arr(doc.feed.entry).map(it => {
      const links = arr(it.link);
      const alt = links.find(l => !l["@_rel"] || l["@_rel"] === "alternate") || links[0] || {};
      return { title: decodeEntities(txt(it.title)), link: alt["@_href"] || txt(alt), published: txt(it.published) || txt(it.updated), description: txt(it.summary), content: txt(it.content), publisher: "" };
    });
  } else if (doc?.["rdf:RDF"]) {
    entries = arr(doc["rdf:RDF"].item).map(it => ({ title: decodeEntities(txt(it.title)), link: txt(it.link), published: txt(it["dc:date"]), description: txt(it.description), content: "", publisher: "" }));
  } else {
    throw new Error("Response is not an RSS or Atom feed");
  }
  return entries.filter(e => e.title && e.link);
}

function toISO(s) {
  if (!s) return null;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString();
  const found = findDates(s)[0];
  return found ? found.date + "T00:00:00.000Z" : null;
}
// Calendar day in India for an item: its published date, or the day it was first seen.
export function dayKey(item) {
  const v = item.published || item.firstSeen || "";
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(v)) return v;
  const t = Date.parse(v);
  return isNaN(t) ? "" : new Date(t + 330 * 60000).toISOString().slice(0, 10);
}
function istToday(now) {
  return new Date(now.getTime() + 330 * 60000).toISOString().slice(0, 10);
}
export function gnewsUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-IN&gl=IN&ceid=IN:en`;
}

/* ---------------- Source handlers ---------------- */
async function readSource(src, ctx) {
  const { fetchText, snapshots, settings } = ctx;
  const url = src.kind === "gnews" ? gnewsUrl(src.query) : src.url;
  const r = await fetchText(url, { proxy: src.proxy !== false, proxyFirst: !!src.proxyFirst, timeoutMs: src.timeoutMs });
  if (!r.ok) throw new Error(r.status === 403 || r.status === 406 ? `the site refused the request (HTTP ${r.status}); a reader proxy did not help either`
    : r.status === 429 ? "the site asked us to slow down (HTTP 429)" : `HTTP ${r.status}`);
  const notes = [];
  if (r.certWarning) notes.push("site certificate is broken; read anyway");
  if (r.via) notes.push(`site refused a direct request (${r.viaReason}); read through ${r.via}`);
  const inc = src.include ? new RegExp(src.include, "i") : null;
  const exc = src.exclude ? new RegExp(src.exclude, "i") : null;

  if (src.kind === "rss" || src.kind === "gnews") {
    let entries = parseFeed(r.text);
    const total = entries.length;
    entries = entries.filter(e => {
      const hay = `${e.title} ${stripHtml(e.description).slice(0, 400)}`;
      if (inc && !inc.test(hay)) return false;
      if (exc && exc.test(hay)) return false;
      if (src.requireSignal && !CHANGE_RE.test(hay) && !JUDGMENT_RE.test(e.title)) return false;
      return true;
    }).slice(0, src.maxItems || settings.maxPerSource);
    return {
      notes, fetched: total,
      candidates: entries.map(e => {
        let title = clean(e.title), publisher = clean(e.publisher);
        if (src.kind === "gnews") {
          const m = title.match(/^(.*)\s+-\s+([^-]{2,60})$/);
          if (m) { title = m[1].trim(); publisher = publisher || m[2].trim(); }
        }
        const descText = src.kind === "gnews" ? "" : stripHtml(e.description);
        return { title, link: e.link.trim(), published: toISO(e.published), summaryText: descText, contentText: stripHtml(e.content), publisher };
      })
    };
  }

  if (src.kind === "page") {
    const links = extractLinks(r.text, r.finalUrl || url, src.linkInclude, src.linkExclude);
    const prev = snapshots[src.id];
    const keys = links.map(l => hashId(l.link));
    if (!links.length) {
      notes.push("page returned no usable links (it may need a real browser); this section relies on its other sources");
      return { notes, fetched: 0, candidates: [] };
    }
    if (!prev) {
      snapshots[src.id] = keys;
      notes.push(`first visit: saved ${links.length} existing links; only links added after today will be reported`);
      return { notes, fetched: links.length, candidates: [] };
    }
    const prevSet = new Set(prev);
    const fresh = links.filter(l => !prevSet.has(hashId(l.link)));
    if (fresh.length > settings.redesignThreshold) {
      snapshots[src.id] = keys;
      notes.push(`${fresh.length} unfamiliar links at once, so the page layout probably changed; saved the new layout without reporting`);
      return { notes, fetched: links.length, candidates: [] };
    }
    snapshots[src.id] = [...new Set([...keys, ...prev])].slice(0, 5000);
    return {
      notes, fetched: links.length,
      candidates: fresh.filter(l => {
        if (inc && !inc.test(l.title)) return false;
        if (exc && exc.test(l.title)) return false;
        return true;
      }).map(l => ({ title: l.title, link: l.link, isPdf: l.isPdf, published: findDates(l.title)[0] ? findDates(l.title)[0].date + "T00:00:00.000Z" : null, summaryText: "", contentText: "" }))
    };
  }
  throw new Error(`Unknown source kind "${src.kind}"`);
}

export function friendlyError(e) {
  const msg = `${e?.message || e} ${e?.cause?.code || ""} ${e?.cause?.message || ""}`.trim();
  if (/ENOTFOUND|EAI_AGAIN/i.test(msg)) return "website address could not be found (DNS)";
  if (/ECONNREFUSED/i.test(msg)) return "the website refused the connection";
  if (/timeout|TimeoutError/i.test(msg)) return "the website did not answer in time";
  if (CERT_ERR.test(msg)) return "the website's security certificate could not be read";
  if (/EPROTO|SSL|TLS|handshake/i.test(msg)) return "the website's security settings are too old to connect to";
  if (/fetch failed/i.test(msg)) return "could not connect to the website (network or TLS problem)";
  if (/not an RSS or Atom feed/i.test(msg)) return "the address did not return a feed; check the URL";
  return String(e?.message || e).slice(0, 200);
}

/* ---------------- Enrichment (note taking) ---------------- */
async function enrich(item, cand, ctx) {
  const today = istToday(ctx.now);
  if (item.type === "Judgment" && !item.official) {
    // Case law from commentary sites: keep it light. No page visit, no notes.
    item.summary = summarise(cand.summaryText || "", 220);
    item.refs = []; item.deadlines = [];
    return;
  }
  let body = cand.contentText || "";
  let meta = "";
  const canVisit = !cand.isPdf && !/news\.google\.com/i.test(item.link) && !/\.pdf(\?|$)/i.test(item.link);
  if (body.length < 400 && canVisit && ctx.visits < ctx.settings.enrichPerRun) {
    ctx.visits++;
    try {
      if (ctx.settings.politeDelayMs) await sleep(ctx.settings.politeDelayMs);
      const r = await ctx.fetchText(item.link, { proxy: true });
      if (r.ok && /html/i.test(r.contentType || "text/html")) {
        const a = articleText(r.text);
        body = a.text || body; meta = a.metaDesc;
      }
    } catch { /* keep what the feed gave us */ }
  }
  const full = [item.title, cand.summaryText, body].filter(Boolean).join("\n");
  item.summary = summarise(cand.summaryText || meta || "", 300);
  item.notes = pickNotes(body || cand.summaryText || "", 3);
  item.refs = findRefs(full);
  item.deadlines = findDeadlines(full, today);
  if (cand.isPdf || /\.pdf(\?|$)/i.test(item.link)) item.pdf = true;
  if (item.type === "Article" || item.type === "Update") item.type = classifyType(item.title, full);
}

/* ---------------- Main ---------------- */
export async function collect(opts = {}) {
  const root = opts.root || ROOT;
  const now = opts.now || new Date();
  const cfg = JSON.parse(await fs.readFile(path.join(root, "scraper/sources.json"), "utf8"));
  const settings = Object.assign({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    timeoutMs: 30000, concurrency: 4, maxPerSource: 25, enrichPerRun: 40, politeDelayMs: 700,
    keepDays: 100, keepMax: 9000, recentDays: 30, redesignThreshold: 60
  }, cfg.settings || {}, opts.settings || {});
  const fetchText = opts.fetchText || makeFetcher(settings);
  const dataDir = path.join(root, "data");
  await fs.mkdir(dataDir, { recursive: true });

  const readJSON = async (f, d) => { try { return JSON.parse(await fs.readFile(path.join(dataDir, f), "utf8")); } catch { return d; } };
  const prev = await readJSON("updates.json", { items: [], sources: [] });
  const snapshots = await readJSON("snapshots.json", {});
  const prevSourceMap = Object.fromEntries((prev.sources || []).map(s => [s.id, s]));

  let sources = cfg.sources.filter(s => s.enabled !== false);
  if (opts.only) sources = sources.filter(s => s.id === opts.only);
  const ctx = { fetchText, snapshots, settings, now, visits: 0 };

  const statuses = [];
  const results = [];
  const queue = [...sources];
  async function worker() {
    while (queue.length) {
      const src = queue.shift();
      const started = Date.now();
      try {
        const out = await readSource(src, ctx);
        results.push({ src, out });
        statuses.push({ id: src.id, name: src.name, area: src.area, kind: src.kind, official: !!src.official, url: src.kind === "gnews" ? gnewsUrl(src.query) : src.url,
          ok: true, fetched: out.fetched, kept: out.candidates.length, note: out.notes.join("; "), lastOk: now.toISOString(), ms: Date.now() - started });
      } catch (e) {
        const p = prevSourceMap[src.id];
        statuses.push({ id: src.id, name: src.name, area: src.area, kind: src.kind, official: !!src.official, url: src.kind === "gnews" ? gnewsUrl(src.query) : src.url,
          ok: false, fetched: 0, kept: 0, error: friendlyError(e), lastOk: p?.lastOk || null, ms: Date.now() - started });
      }
    }
  }
  await Promise.all(Array.from({ length: settings.concurrency }, worker));

  if (opts.check) {
    return { statuses: statuses.sort((a, b) => a.id.localeCompare(b.id)), results };
  }

  /* Merge */
  const today = istToday(now);
  const dayMinus = n => new Date(Date.parse(today + "T00:00:00Z") - n * 86400000).toISOString().slice(0, 10);
  const keepFrom = dayMinus(settings.keepDays), recentFrom = dayMinus(settings.recentDays);
  const byId = new Map((prev.items || []).map(i => [i.id, i]));
  const byTitle = new Map([...byId.values()].map(i => [normTitle(i.title), i]));
  const fresh = [];
  for (const { src, out } of results) {
    for (const c of out.candidates) {
      const id = hashId(c.link);
      if (byId.has(id)) continue;
      if (dayKey({ published: c.published, firstSeen: now.toISOString() }) < keepFrom) continue;   // older than the retention period
      const tkey = normTitle(c.title);
      const dup = tkey.length > 25 ? byTitle.get(tkey) : null;
      if (dup) {
        dup.alsoIn = [...new Set([...(dup.alsoIn || []), src.name])].slice(0, 5);
        if (src.official && !dup.official) { dup.officialLink = c.link; }
        continue;
      }
      const hay = `${c.title} ${c.summaryText.slice(0, 500)}`;
      const item = {
        id, area: classifyArea(hay, src.area, !!src.reclassify), sourceId: src.id, source: src.name,
        official: !!src.official, publisher: c.publisher || "", type: classifyType(c.title, hay),
        title: c.title.slice(0, 300), link: c.link, published: c.published, firstSeen: now.toISOString(),
        summary: "", notes: [], refs: [], deadlines: []
      };
      if (!AREA_IDS.includes(item.area)) item.area = src.area;
      // General explainers from news and commentary sites are not regulatory changes: skip them.
      if (!src.official && item.type === "Article") continue;
      byId.set(id, item); byTitle.set(tkey, item);
      fresh.push([item, c]);
    }
  }
  // Official items get their notes first, then newest.
  fresh.sort((a, b) => (b[0].official - a[0].official) || String(b[0].published || "").localeCompare(String(a[0].published || "")));
  for (const [item, cand] of fresh) await enrich(item, cand, ctx);

  /* Prune */
  let items = [...byId.values()].filter(i => dayKey(i) >= keepFrom);
  items.sort((a, b) => dayKey(b).localeCompare(dayKey(a)) || String(b.firstSeen).localeCompare(String(a.firstSeen)));
  items = items.slice(0, settings.keepMax);
  const recent = items.filter(i => dayKey(i) >= recentFrom);
  const older = items.filter(i => dayKey(i) < recentFrom);

  const data = {
    generatedAt: now.toISOString(),
    repo: process.env.GITHUB_REPOSITORY || null,
    newThisRun: fresh.length,
    sources: statuses.sort((a, b) => (a.area + a.id).localeCompare(b.area + b.id)),
    items
  };
  if (!opts.only) {
    await fs.writeFile(path.join(dataDir, "updates.json"), JSON.stringify(data, null, 1));
    // The page loads the last 30 days straight away and the older part only when asked.
    await fs.writeFile(path.join(dataDir, "updates.js"), "window.REGISTER_DATA = " + JSON.stringify({ ...data, items: recent, archiveCount: older.length, recentDays: settings.recentDays, keepDays: settings.keepDays }) + ";\n");
    await fs.writeFile(path.join(dataDir, "archive.js"), "window.REGISTER_ARCHIVE = " + JSON.stringify({ generatedAt: data.generatedAt, items: older }) + ";\n");
    await fs.writeFile(path.join(dataDir, "snapshots.json"), JSON.stringify(snapshots));
  }
  return data;
}

/* ---------------- CLI ---------------- */
const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? true]; }));
  const t0 = Date.now();
  collect({ check: !!args.check, only: typeof args.only === "string" ? args.only : undefined }).then(res => {
    const statuses = res.statuses || res.sources;
    const pad = (s, n) => String(s).padEnd(n).slice(0, n);
    console.log("\n" + pad("SOURCE", 24) + pad("STATUS", 8) + pad("READ", 6) + pad("KEPT", 6) + "NOTE");
    for (const s of statuses) console.log(pad(s.id, 24) + pad(s.ok ? "ok" : "FAILED", 8) + pad(s.fetched, 6) + pad(s.kept, 6) + (s.ok ? (s.note || "") : s.error));
    const failed = statuses.filter(s => !s.ok).length;
    if (!args.check) console.log(`\n${res.newThisRun} new items, ${res.items.length} in register, ${failed} of ${statuses.length} sources failed, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    if (failed === statuses.length && statuses.length) process.exitCode = 1;
  }).catch(e => { console.error(e); process.exitCode = 1; });
}
