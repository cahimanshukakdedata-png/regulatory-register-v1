// Rule-based note taking and classification. No AI involved: everything here is
// deterministic pattern matching, so the same page always gives the same notes.
import crypto from "node:crypto";
import * as cheerio from "cheerio";

export const AREA_IDS = ["gst", "it", "tds", "mca", "acc", "sebi", "fema", "labour", "mh", "loan"];

const MONTHS = { jan:0, feb:1, mar:2, apr:3, may:4, jun:5, jul:6, aug:7, sep:8, sept:8, oct:9, nov:10, dec:11,
  january:0, february:1, march:2, april:3, june:5, july:6, august:7, september:8, october:9, november:10, december:11 };

export function hashId(s) {
  return crypto.createHash("sha1").update(String(s)).digest("hex").slice(0, 12);
}

export function decodeEntities(s) {
  return String(s || "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#039;|&apos;/g, "'").replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"').replace(/&#8211;|&#8212;/g, "-").replace(/&#8377;/g, "₹")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}

export function stripHtml(html) {
  if (!html) return "";
  const s = String(html);
  if (!/[<>]/.test(s)) return clean(decodeEntities(s));
  const $ = cheerio.load(s);
  $("script,style,noscript,iframe,svg").remove();
  $("br").replaceWith("\n");
  $("p,div,li,tr,h1,h2,h3,h4").each((_, el) => { $(el).append("\n"); });
  return clean($.root().text());
}

export function clean(s) {
  return String(s || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
}

export function normTitle(t) {
  return String(t || "").toLowerCase()
    .replace(/\s+-\s+[^-]{2,60}$/, "")       // " - Publisher" suffix used by news aggregators
    .replace(/[^a-z0-9]+/g, " ").trim().slice(0, 90);
}

/* ---------- Relevance ---------- */
// Words that signal an actual change in law or procedure, as opposed to explainers.
const CHANGE_RE = /\b(notif(y|ied|ication)s?|circular|instruction|advisory|clarif(y|ies|ied|ication)|amend(s|ed|ment)?|extend(s|ed)?|extension|due date|last date|deadline|rules?,? 20\d\d|regulations?,? 20\d\d|directions?,? 20\d\d|order under section|press release|scheme|faqs?|omit(s|ted)?|insert(s|ed)?|substitut|w\.?e\.?f|with effect|comes? into force|effective from|draft|consultation|bill,? 20\d\d|act,? 20\d\d|gazette|G\.?S\.?R\.?|S\.?O\.? ?\d|standard|guidance note|utility|functionality|enabled|launch(es|ed)?|rolls? out|mandatory|penalty waiver|amnesty|council meeting|recommendations?)\b/i;
const JUDGMENT_RE = /\b(ITAT|CESTAT|High Court|HC|Supreme Court|SC|NCLT|NCLAT|GSTAT|AAAR|AAR|Tribunal|bench|writ|quashe[sd]|upholds?|sets? aside|remand(s|ed)?|dismiss(es|ed)?|allows? appeal|deletes? addition)\b/i;

export function classifyType(title, text = "") {
  const t = `${title}`;
  const both = `${title} ${text.slice(0, 400)}`;
  if (JUDGMENT_RE.test(t)) return "Judgment";
  if (/\b(extend(s|ed)?|extension)\b/i.test(t) && /\b(due date|last date|deadline|time ?line|date|till|upto|up to|period)\b/i.test(t)) return "Due date";
  if (/\bdraft\b|consultation paper|comments? (invited|sought)|public comments/i.test(t)) return "Draft";
  if (/\bbill\b/i.test(t) && !/e-?way bills?|bills? of (entry|supply|lading)/i.test(t)) return "Bill";
  if (/press release/i.test(t)) return "Press release";
  if (/\bcircular\b|\binstruction\b|clarif/i.test(t)) return "Circular";
  if (/\badvisory\b|\bGSTN\b|\bportal\b|\butility\b|functionality|enabled|\bFAQs?\b/i.test(t)) return "Advisory";
  if (/\bnotif(ied|ication)\b|G\.?S\.?R\.?|\bS\.?O\.? ?\d/i.test(t)) return "Notification";
  if (/\b(amend(ment|ed|s)?|rules?,? 20\d\d|regulations?,? 20\d\d|directions?,? 20\d\d)\b/i.test(t)) return "Amendment";
  if (/\bscheme\b/i.test(t)) return "Scheme";
  if (/\bcouncil\b/i.test(t)) return "Council";
  if (/\bdue dates?\b|\bcompliance calendar\b/i.test(t)) return "Due date";
  if (CHANGE_RE.test(both)) return "Update";
  return "Article";
}

// Area override rules, checked in order. First match wins.
const AREA_RULES = [
  ["tds", /\b(TDS|TCS|TRACES|Form (138|140|141|143|144|130|131|133)|24Q|26Q|27Q|27EQ|194[A-Z]{0,2}|206C|tax deducted at source|tax collected at source|lower deduction)\b/i],
  ["loan", /\b(subsid(y|ies|ised)|subvention|PMEGP|MUDRA|Stand[- ]?Up India|CGTMSE|collateral[- ]free|credit guarantee|SIDBI|NABARD|margin money|industrial policy|incentive scheme|capital investment incentive|MSME loan|PMFME|PLI scheme|seed fund|startup policy|viability gap)\b/i],
  ["labour", /\b(EPFO?|provident fund|ESIC?|employees'? state insurance|labour codes?|code on wages|social security code|gratuity|minimum wages?|bonus act|shops and establishment)\b/i],
  ["mh", /\b(Maharashtra|MahaGST|profession(al)? tax|Mumbai stamp|MVAT)\b/i],
  ["fema", /\b(FEMA|foreign exchange management|RBI|Reserve Bank|ECB|external commercial borrowing|overseas investment|ODI|LRS|liberalised remittance|FDI|NDI rules|FIRMS|export proceeds)\b/i],
  ["sebi", /\b(SEBI|LODR|listing obligations|stock exchange|NSE|BSE|mutual funds?|AIF|portfolio managers?|insider trading|ICDR|takeover regulations)\b/i],
  ["acc", /\b(ICAI|UDIN|NFRA|Ind ?AS|accounting standards?|auditing standards?|standards on auditing|SA \d{3}|CARO|peer review|AQMM|guidance note|chartered accountants? act|ICSI|ICMAI)\b/i],
  ["mca", /\b(MCA|Companies Act|Companies \(|ROC|Registrar of Companies|LLP|limited liability partnership|AOC-4|MGT-7|DIR-3|DPT-3|CSR|IBC|insolvency|NCLT|corporate laws?|CCFS|MSME|MSMED)\b/i],
  ["gst", /\b(GST|CGST|IGST|SGST|UTGST|GSTN|GSTR-?\w*|e-?way bill|e-?invoic\w*|input tax credit|ITC|GSTAT|CBIC|GST Council|compensation cess)\b/i],
  ["it", /\b(income[- ]tax|CBDT|ITR|assessment year|AY 20\d\d|tax year|section 1[0-9]{2}[A-Z]{0,3}|ITAT|advance tax|44AB|tax audit|black money|FAST-DS|Schedule FA|AIS|26AS|PAN)\b/i],
];

export function classifyArea(text, fallback, reclassify) {
  if (!reclassify) return fallback;
  for (const [area, re] of AREA_RULES) if (re.test(text)) return area;
  return fallback;
}

/* ---------- References and dates ---------- */
const REF_RES = [
  /\bNotification No\.?\s*\d{1,4}\/\d{2,4}(?:\s*[-–]\s*(?:Central|Integrated|Union Territory|Compensation|State|Customs|Income)\s+(?:Tax|Cess)(?:\s*\(Rate\))?|\s*[-–]\s*[A-Za-z]{2,12})?/gi,
  /\bGeneral Circular No\.?\s*[\w./-]{1,20}/gi,
  /\bCircular No\.?\s*[\w./-]{1,30}(?:-GST)?/gi,
  /\bInstruction No\.?\s*[\w./-]{1,30}/gi,
  /\bAdvisory No\.?\s*\d{1,4}/gi,
  /\bOrder No\.?\s*[\w./-]{1,30}/gi,
  /\bG\.?\s?S\.?\s?R\.?\s*\d{1,5}\s*\(E\)/gi,
  /\bS\.?\s?O\.?\s*\d{1,5}\s*\(E\)/gi,
  /\bF\.?\s?No\.?\s*[\w./()-]{4,40}/gi,
];
export function findRefs(text) {
  const out = new Set();
  for (const re of REF_RES) {
    for (const m of String(text).matchAll(re)) {
      let v = m[0].replace(/\s+/g, " ").replace(/[.,;:\]-]+$/, "").trim();
      while (v.endsWith(")") && (v.match(/\(/g) || []).length < (v.match(/\)/g) || []).length) v = v.slice(0, -1);
      if (v.length >= 8 && /\d/.test(v)) out.add(v);
      if (out.size >= 4) break;
    }
  }
  return [...out].slice(0, 4);
}

function isoDate(y, m, d) {
  const dt = new Date(Date.UTC(y, m, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

// Returns [{date:"YYYY-MM-DD", index}] for dates written the usual Indian ways.
export function findDates(text) {
  const s = String(text);
  const out = [];
  const reWord = /\b(\d{1,2})(?:st|nd|rd|th)?\s+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[,.]?\s+(20\d\d)\b/gi;
  const reWordUS = /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d\d)\b/gi;
  const reNum = /\b(\d{1,2})[./-](\d{1,2})[./-](20\d\d)\b/g;
  for (const m of s.matchAll(reWord)) { const d = isoDate(+m[3], MONTHS[m[2].toLowerCase()], +m[1]); if (d) out.push({ date: d, index: m.index }); }
  for (const m of s.matchAll(reWordUS)) { const d = isoDate(+m[3], MONTHS[m[1].toLowerCase()], +m[2]); if (d) out.push({ date: d, index: m.index }); }
  for (const m of s.matchAll(reNum)) { const d = isoDate(+m[3], +m[2] - 1, +m[1]); if (d) out.push({ date: d, index: m.index }); }
  return out.sort((a, b) => a.index - b.index);
}

const DEADLINE_CUE = /\b(due date|last date|deadline|extended (?:till|to|up ?to|until)|extend(?:s|ed)? .{0,40}(?:till|to|up ?to|until)|on or before|not later than|till|until|up ?to|window (?:closes|open)|valid (?:till|up ?to)|comes? into force (?:on|from)|with effect from|w\.?e\.?f\.?|effective from|applicable from)\b/i;

// Future dates that appear next to a deadline or effective-date cue.
export function findDeadlines(text, todayISO) {
  const s = String(text);
  const found = new Map();
  for (const { date, index } of findDates(s)) {
    if (date < todayISO) continue;
    const windowText = s.slice(Math.max(0, index - 90), index + 20);
    const cue = windowText.match(DEADLINE_CUE);
    if (!cue) continue;
    const kind = /force|effect|w\.?e\.?f|effective|applicable/i.test(cue[0]) ? "effective" : "deadline";
    const start = Math.max(0, s.lastIndexOf(".", index - 1) + 1, s.lastIndexOf("\n", index - 1) + 1);
    let end = s.indexOf(".", index + 12); if (end < 0) end = Math.min(s.length, index + 160);
    const context = clean(s.slice(start, Math.min(end + 1, start + 260)));
    if (!found.has(date)) found.set(date, { date, kind, context });
  }
  return [...found.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
}

/* ---------- Notes ---------- */
const NOTE_SIGNALS = [
  [/\b(notif(ied|ication)|circular|instruction|advisory|order)\b/i, 2],
  [/\b(extend(ed|s)?|extension|due date|last date|deadline|on or before)\b/i, 3],
  [/\b(w\.?e\.?f|with effect from|effective from|comes? into force|applicable from)\b/i, 3],
  [/\b(amend(ed|ment)?|omit(ted)?|insert(ed)?|substitut(ed|ion)|replac(ed|es))\b/i, 2],
  [/\b(section|rule|regulation|clause|form)\s+[\dA-Z(]/i, 1],
  [/(₹|Rs\.?\s?\d|\bcrore\b|\blakh\b|\d+\s?(%|per ?cent))/i, 1],
  [/\b(mandatory|required|must|shall|penalty|late fee|interest)\b/i, 1],
  [/\b(taxpayers?|assessees?|companies|deductors?|registered persons?|employers?|auditors?|members)\b/i, 1],
];
const NOTE_NOISE = /\b(click here|subscribe|whatsapp|telegram|download (our|the) app|advertisement|sign in|comment|share this|follow us|disclaimer|all rights reserved|read more|related posts?|join our|©)\b/i;

export function splitSentences(text) {
  return clean(text).split(/\n+/).flatMap(line =>
    line.split(/(?<=[.;!?])\s+(?=[A-Z(₹"'])/)
  ).map(s => s.trim()).filter(s => s.length >= 40 && s.length <= 420);
}

export function pickNotes(text, max = 3) {
  const sents = splitSentences(text);
  const scored = sents.map((s, i) => {
    if (NOTE_NOISE.test(s)) return { s, i, score: -1 };
    let score = 0;
    for (const [re, w] of NOTE_SIGNALS) if (re.test(s)) score += w;
    if (findDates(s).length) score += 2;
    if (i < 6) score += 1;               // lead sentences usually carry the point
    return { s, i, score };
  }).filter(x => x.score >= 3);
  const seen = new Set();
  const top = scored.sort((a, b) => b.score - a.score || a.i - b.i).filter(x => {
    const k = x.s.slice(0, 60).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true;
  }).slice(0, max).sort((a, b) => a.i - b.i);
  return top.map(x => x.s.length > 260 ? x.s.slice(0, 257).replace(/\s+\S*$/, "") + "…" : x.s);
}

export function summarise(text, max = 280) {
  const t = clean(text).replace(/\n+/g, " ");
  if (t.length <= max) return t;
  return t.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

// Main body text of an HTML article page, without menus, ads and comments.
export function articleText(html) {
  const $ = cheerio.load(html);
  $("script,style,noscript,iframe,svg,nav,header,footer,aside,form,button,.comments,#comments,.sidebar,.widget,.share,.social,.advertisement,.ads,[class*='related'],[id*='related'],[class*='menu'],[id*='menu']").remove();
  const candidates = ["article .entry-content", ".entry-content", "article", "main", ".post-content", ".content", "#content", "body"];
  let node = null;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length && clean(el.text()).length > 200) { node = el; break; }
  }
  const metaDesc = $('meta[name="description"]').attr("content") || $('meta[property="og:description"]').attr("content") || "";
  const parts = [];
  (node || $("body")).find("h1,h2,h3,p,li,td").each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 30) parts.push(t);
  });
  return { metaDesc: clean(metaDesc), text: parts.join("\n") };
}

// Links on a listing page that look like documents or announcements.
const LINK_NOISE = /^(home|about( us)?|contact( us)?|login|log ?in|sign ?in|register|sitemap|site map|faqs?|help|feedback|privacy( policy)?|terms.*|disclaimer|copyright.*|screen reader.*|skip to.*|accessibility.*|search|more|read more|view all|click here|download|english|हिन्दी|hindi|marathi|मराठी|archives?|back|next|previous|go|submit|rti|tenders?|careers?|recruitment|photo gallery|videos?|a-|a\+|a)$/i;
export function extractMarkdownLinks(text, baseUrl, linkInclude, linkExclude) {
  const inc = linkInclude ? new RegExp(linkInclude, "i") : null;
  const exc = linkExclude ? new RegExp(linkExclude, "i") : null;
  const out = new Map();
  for (const m of String(text).matchAll(/\[([^\]\n]{12,300})\]\(([^)\s]+)\)/g)) {
    const title = clean(decodeEntities(m[1])).replace(/\n+/g, " ");
    let abs; try { abs = new URL(m[2], baseUrl).toString(); } catch { continue; }
    if (!/^https?:/i.test(abs) || LINK_NOISE.test(title)) continue;
    const hay = `${title} ${abs}`;
    if (inc && !inc.test(hay)) continue;
    if (exc && exc.test(hay)) continue;
    const key = abs.replace(/#.*$/, "");
    if (!out.has(key)) out.set(key, { title, link: key, isPdf: /\.pdf(\?|$)/i.test(key) });
  }
  return [...out.values()];
}

export function extractLinks(html, baseUrl, linkInclude, linkExclude) {
  // Some text proxies return markdown instead of HTML.
  if (!/<a[\s>]/i.test(html) && /\]\(\S+\)/.test(html)) return extractMarkdownLinks(html, baseUrl, linkInclude, linkExclude);
  const $ = cheerio.load(html);
  $("script,style,noscript,header nav,footer").remove();
  const inc = linkInclude ? new RegExp(linkInclude, "i") : null;
  const exc = linkExclude ? new RegExp(linkExclude, "i") : null;
  const out = new Map();
  $("a[href]").each((_, a) => {
    const href = String($(a).attr("href") || "").trim();
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;
    let abs; try { abs = new URL(href, baseUrl).toString(); } catch { return; }
    if (!/^https?:/i.test(abs)) return;
    const text = clean($(a).text() || $(a).attr("title") || "").replace(/\n+/g, " ");
    if (text.length < 12 || text.length > 300 || LINK_NOISE.test(text)) return;
    const hay = `${text} ${abs}`;
    if (inc && !inc.test(hay)) return;
    if (exc && exc.test(hay)) return;
    const key = abs.replace(/#.*$/, "");
    if (!out.has(key)) out.set(key, { title: text, link: key, isPdf: /\.pdf(\?|$)/i.test(key) });
  });
  return [...out.values()];
}

export { CHANGE_RE, JUDGMENT_RE };
