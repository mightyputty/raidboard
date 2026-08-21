"use strict";
/**
 * The ten story chapters — Tour, Boreas, The Ticket and the rest.
 *
 * These are not trader quests: the game hands them to you and they sit in your journal for the
 * whole wipe. tarkov.dev does not carry them at all, and nothing in the game logs reports their
 * progress, so they are read from the wiki and ticked off by hand.
 *
 * Only objectives that are actually raid work on a named map get a map, so talking to a trader
 * and handing things in score nothing — the same rule the trader quests already follow.
 */

const crypto = require("crypto");

const HOST = "escapefromtarkov.fandom.com";
const UA = "tarkov-raid-board (local, personal use)";
const DECORATION = /(icon|banner|logo|_button|[.]svg$)/i;

const CHAPTERS = [
  ["Accidental_Witness", "Accidental Witness"],
  ["Batya", "Batya"],
  ["Blue_Fire", "Blue Fire"],
  ["Boreas", "Boreas"],
  ["Falling_Skies", "Falling Skies"],
  ["The_Labyrinth_(story_chapter)", "The Labyrinth"],
  ["The_Ticket", "The Ticket"],
  ["The_Unheard", "The Unheard"],
  ["They_Are_Already_Here", "They Are Already Here"],
  ["Tour", "Tour"]
];

const MAP_NAMES = {
  "Customs": "customs", "Factory": "factory", "Woods": "woods", "Shoreline": "shoreline",
  "Interchange": "interchange", "Reserve": "reserve", "Lighthouse": "lighthouse",
  "Streets of Tarkov": "streets-of-tarkov", "Ground Zero": "ground-zero", "The Lab": "the-lab",
  "The Labyrinth": "the-labyrinth", "Terminal": "terminal", "Icebreaker": "icebreaker"
};

// longest first, so "The Labyrinth" is never mistaken for "The Lab"
const BY_LENGTH = Object.keys(MAP_NAMES).sort((a, b) => b.length - a.length);
const LEADS = [" on ", " in ", " at ", " from ", " on the ", " in the ", " at the ", " from the ", " to ", " to the "];

const id16 = (s) => crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);

/** wikitext -> the sentence a person reads */
function plain(s) {
  return s
    .replace(/\[\[[^\]|]*\|([^\]]*)\]\]/g, "$1")
    .replace(/\[\[([^\]]*)\]\]/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\{\{[^}]*\}\}/g, "")
    .replace(/'''?/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The map the sentence actually names — "the entrance on Factory" is Factory, not the Lab. */
function mapSpokenIn(text) {
  const t = " " + String(text).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ") + " ";
  for (const name of BY_LENGTH) {
    const n = name.toLowerCase();
    if (LEADS.some((p) => t.indexOf(p + n + " ") >= 0)) return MAP_NAMES[name];
  }
  return null;
}

/** Every map the line links to, as a fallback when it names none outright. */
function mapsLinked(raw) {
  const out = [];
  for (const name of BY_LENGTH) {
    if (raw.indexOf("[[" + name + "]]") >= 0 || raw.indexOf("[[" + name + "|") >= 0) out.push(MAP_NAMES[name]);
  }
  return [...new Set(out)];
}

// a step you take standing at a trader is not raid work, wherever it mentions a map
const TRADER_STEP = /^(talk to|hand over|tell |ask |return to|give |collect the required)/i;

function classify(text) {
  const t = text.toLowerCase();
  if (/^(survive and extract|extract from|escape )/.test(t)) return "extract";
  if (/ \d+ times?\b/.test(t)) return "visit";
  if (/^eliminate/.test(t)) return "kill";
  if (TRADER_STEP.test(t)) return "trader";
  if (/^(find|obtain|collect)/.test(t)) return "findItem";
  if (/^(locate|search|reach|access|get to|use |plant|stash|mark|ensure)/.test(t)) return "visitPlace";
  return "other";
}

/** Counts worth showing: "3 times", "any 5", "hand over 5" — never the 20 out of 20,000. */
function countIn(text) {
  const m = /\b(\d{1,3})\s+times\b/i.exec(text)
    || /\bany\s+(\d{1,3})\b(?![\d,])/i.exec(text)
    || /\bhand over\s+(\d{1,3})\b(?![\d,])/i.exec(text);
  return m ? Number(m[1]) : 0;
}

// ---------- the wiki's Guide section, split up per objective ----------
// Each chapter's guide has one "===heading===" per objective, with the location shots in a
// <gallery> underneath. Headings usually repeat the objective word for word, but some pages
// use shorthand ("Ragman - Interchange"), so exact matches are claimed first and the rest are
// scored. Anything that still matches nothing is kept at chapter level rather than guessed at.

const STOP = new Set("the a an and or to of on in at from for with any all your you it is be get".split(" "));
const keyOf = (s) => plain(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ").trim();
const wordsOf = (k) => k.split(" ").filter((w) => w && !STOP.has(w));

function similarity(headingKey, objKey) {
  if (!headingKey || !objKey) return 0;
  if (headingKey === objKey) return 1;
  if (headingKey.length >= 15 && objKey.startsWith(headingKey)) return 0.95;
  if (objKey.length >= 15 && headingKey.startsWith(objKey)) return 0.95;
  const h = wordsOf(headingKey), o = wordsOf(objKey);
  if (!h.length || !o.length) return 0;
  const inObj = new Set(o);
  const hit = h.filter((w) => inObj.has(w)).length;
  const cover = hit / h.length;
  if (cover === 1 && h.length >= 2) return 0.9;
  return cover * 0.6 + (hit / o.length) * 0.3;
}

function guideBlocks(wikitext) {
  const at = wikitext.indexOf("==Guide==");
  if (at < 0) return [];
  let section = wikitext.slice(at + 9);
  const nextTop = section.search(/\n==[^=]/);
  if (nextTop >= 0) section = section.slice(0, nextTop);

  const blocks = [];
  let cur = null;
  for (const line of section.split("\n")) {
    const h = /^(=+)([^=].*?)\1\s*$/.exec(line.trim());
    if (h && h[1].length >= 3) { cur = { heading: plain(h[2]), lines: [] }; blocks.push(cur); continue; }
    if (cur) cur.lines.push(line);
  }

  const out = [];
  for (const b of blocks) {
    if (/^rewards?$/i.test(b.heading.trim())) continue;      // reward tables are not directions
    // the quest-item tables are reference material and read as noise in a set of directions
    const raw = b.lines.join("\n").replace(/\{\|[\s\S]*?\|\}/g, "");
    const images = [];
    for (const g of raw.match(/<gallery[^>]*>[\s\S]*?<\/gallery>/g) || []) {
      for (const line of g.split("\n")) {
        const m = /^File:([^|\]]+?)(?:\|(.*))?$/.exec(line.trim());
        if (m) images.push({ f: m[1].trim(), c: plain(m[2] || "") });
      }
    }
    // a gallery is curated location art; a bare inline File: is usually just an item icon
    for (const m of raw.matchAll(/\[\[File:([^|\]]+?)(?:\|[^\]]*?)?\]\]/g)) {
      const f = m[1].trim();
      if (DECORATION.test(f)) continue;
      if (!images.some((x) => x.f === f)) images.push({ f: f, c: "" });
    }
    const prose = plain(
      raw.replace(/<gallery[\s\S]*?<\/gallery>/g, "")
         .replace(/\[\[File:[^\]]*\]\]/g, "")
         .replace(/<ref[\s\S]*?<\/ref>/g, "")
    ).replace(/^[*#:;\s]+/, "").trim();
    if (!prose && !images.length) continue;
    out.push({ heading: b.heading, prose: prose.slice(0, 900), images: images });
  }
  return out;
}

/** Hang each guide block on the objective it describes; hand back whatever will not fit. */
function attachGuides(objs, blocks) {
  const objKeys = objs.map((o) => keyOf(o.d));
  const claimed = new Set();
  const bucket = new Map();
  const take = (i, b) => {
    if (!bucket.has(i)) bucket.set(i, { prose: [], images: [] });
    const g = bucket.get(i);
    if (b.prose) g.prose.push(b.prose);
    for (const im of b.images) if (!g.images.some((x) => x.f === im.f)) g.images.push(im);
  };

  const left = [];
  for (const b of blocks) {                       // exact wording wins, and claims its objective
    const i = objKeys.indexOf(keyOf(b.heading));
    if (i >= 0) { take(i, b); claimed.add(i); } else left.push(b);
  }

  const extras = [];
  for (const b of left) {
    const hk = keyOf(b.heading);
    let best = -1, bestScore = 0;
    objKeys.forEach((ok, i) => {
      const s = similarity(hk, ok) - (claimed.has(i) ? 0.1 : 0);   // prefer an objective nobody has
      if (s > bestScore) { bestScore = s; best = i; }
    });
    if (bestScore >= 0.75) { take(best, b); claimed.add(best); }
    else extras.push({ oi: id16("x|" + b.heading + "|" + b.prose.slice(0, 40)), h: b.heading, g: b.prose, sh: b.images });
  }

  for (const [i, g] of bucket) {
    if (g.prose.length) objs[i].g = g.prose.join(" ").slice(0, 900);
    if (g.images.length) objs[i].sh = g.images;
  }
  return extras;
}

function parseObjectives(wikitext) {
  const section = (wikitext.split("==Objectives==")[1] || "").split(/\n==[^=]/)[0];
  const rows = [];
  for (const line of section.split("\n")) {
    const m = /^(\*+)\s*(.+)$/.exec(line.trim());
    if (!m) continue;
    let body = m[2];
    const optional = /\(''Optional''\)/i.test(body);
    body = body.replace(/\(''Optional''\)\s*/i, "");
    const text = plain(body);
    if (!text) continue;
    rows.push({ depth: m[1].length, raw: body, text: text, optional: optional });
  }
  return rows;
}


// ---------- where to find the items a chapter asks for ----------
// A lot of the real directions are not on the chapter page at all: the Sailor's diary has its own
// page with a ==Location== section and a captioned gallery, and the chapter never links it — the
// item declares itself instead ("one of the minor evidence used in The Ticket"). So candidates
// come from both directions: pages the chapter links, and pages that link the chapter. A page
// only counts if it has a Location section with a gallery; without pictures it is invariably a
// generic loot list ("Sport bag, Toolbox, Dead Scav") and no use to anybody.

const NOT_AN_ITEM = /^(File|Category|Image|Template|Help):|^Hideout|^Found in raid$|^Quests$|^Escape from Tarkov$|^Scavs?$|^Loot$|^Crafts$|^Barter trades$|^Changelog$|^Events$|^Achievements$|^Prestige$|^Endings$|^Story chapters$|^Skills$|^Quest items$|^Dogtag/i;
const MAP_TITLES = new Set(Object.keys(MAP_NAMES));
const TRADER_TITLES = new Set(["Prapor", "Therapist", "Fence", "Skier", "Peacekeeper", "Mechanic",
  "Ragman", "Jaeger", "Lightkeeper", "BTR Driver", "Ref"]);

function looksLikeItem(title, chapterTitles) {
  return !!title && !NOT_AN_ITEM.test(title) && !MAP_TITLES.has(title) &&
    !TRADER_TITLES.has(title) && !chapterTitles.has(title);
}

function locationSection(wikitext) {
  const m = /\n==\s*Locations?\s*==\n([\s\S]*?)(?=\n==[^=]|$)/.exec(wikitext);
  if (!m) return null;
  const raw = m[1];
  const images = [];
  for (const g of raw.match(/<gallery[^>]*>[\s\S]*?<\/gallery>/g) || []) {
    for (const line of g.split("\n")) {
      const f = /^File:([^|\]]+?)(?:\|(.*))?$/.exec(line.trim());
      if (f) images.push({ f: f[1].trim(), c: plain(f[2] || "") });
    }
  }
  if (!images.length) return null;
  const prose = plain(
    raw.replace(/<gallery[\s\S]*?<\/gallery>/g, "").replace(/\{\|[\s\S]*?\|\}/g, "")
  ).replace(/^[*#:;\s]+/, "").trim();
  return { g: prose.slice(0, 700), sh: images };
}

async function apiJson(params) {
  const url = "https://" + HOST + "/api.php?" + new URLSearchParams(params).toString();
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error("the wiki returned " + r.status);
  return r.json();
}

async function backlinks(page) {
  try {
    const j = await apiJson({
      action: "query", format: "json", list: "backlinks", blnamespace: "0",
      bllimit: "500", bltitle: page.replace(/_/g, " ")
    });
    return ((j.query && j.query.backlinks) || []).map((b) => b.title);
  } catch (e) { return []; }
}

/** Hang each item's location on the objectives that ask for it, or on the chapter if none do. */
async function attachItemGuides(chapters) {
  const chapterTitles = new Set(CHAPTERS.map((c) => c[1]).concat(["The Labyrinth (story chapter)"]));
  const wanted = new Map();                       // page title -> Set of chapter names
  const note = (t, name) => {
    if (!looksLikeItem(t, chapterTitles)) return;
    if (!wanted.has(t)) wanted.set(t, new Set());
    wanted.get(t).add(name);
  };

  for (const c of chapters) {
    for (const m of (c.__wt || "").matchAll(/\[\[([^\]|#]+)(?:\|[^\]]*)?\]\]/g)) note(m[1].trim(), c.n);
    for (const t of await backlinks(c.__page)) note(t, c.n);
  }

  const titles = [...wanted.keys()];
  const guides = {};
  for (let i = 0; i < titles.length; i += 45) {              // the API takes 50 titles a call
    let j;
    try {
      j = await apiJson({
        action: "query", format: "json", prop: "revisions", rvprop: "content",
        rvslots: "main", titles: titles.slice(i, i + 45).join("|")
      });
    } catch (e) { continue; }
    for (const p of Object.values((j.query && j.query.pages) || {})) {
      if (p.missing !== undefined) continue;
      const w = p.revisions && p.revisions[0] && p.revisions[0].slots && p.revisions[0].slots.main["*"];
      if (!w) continue;
      const loc = locationSection(w);
      if (loc) guides[p.title] = loc;
    }
  }

  for (const c of chapters) {
    const mine = Object.keys(guides).filter((t) => wanted.get(t).has(c.n));
    const loose = [];
    for (const title of mine) {
      const entry = {
        oi: id16("item|" + c.n + "|" + title),
        n: title,
        g: guides[title].g,
        sh: guides[title].sh
      };
      // an objective that links the item outright owns it; otherwise it belongs to the chapter
      const owner = c.obj.find((o) => o.raw && o.raw.indexOf("[[" + title) >= 0);
      if (owner) (owner.ig = owner.ig || []).push(entry);
      else loose.push(entry);
    }
    if (loose.length) c.ix = loose.sort((a, b) => a.n.localeCompare(b.n));
  }
  return Object.keys(guides).length;
}

async function fetchChapter(page, name) {
  const url = "https://" + HOST + "/api.php?action=parse&page=" + encodeURIComponent(page) +
    "&prop=wikitext&format=json";
  const r = await fetch(url, { headers: { "User-Agent": UA } });
  if (!r.ok) throw new Error(name + ": wiki returned " + r.status);
  const j = await r.json();
  if (j.error) throw new Error(name + ": " + j.error.code);
  const wikitext = j.parse.wikitext["*"];
  const rows = parseObjectives(wikitext);

  const objs = rows.map((row, i) => {
    // a line with deeper lines under it is a heading; the work is in its children
    const isHeader = !!rows[i + 1] && rows[i + 1].depth > row.depth;
    const o = {
      oi: id16(name + "|" + i + "|" + row.text),
      d: row.text,
      ty: isHeader ? "group" : classify(row.text),
      dp: row.depth
    };
    o.raw = row.raw;
    if (isHeader) o.hd = 1;
    if (row.optional) o.o = 1;
    const c = countIn(row.text);
    if (c > 1) o.c = c;
    if (!isHeader && o.ty !== "trader") {
      const spoken = mapSpokenIn(row.text);
      const mp = spoken ? [spoken] : mapsLinked(row.raw);
      if (mp.length) o.mp = mp;
    }
    return o;
  });

  // directions and location shots, hung on the objective each one describes
  const extras = attachGuides(objs, guideBlocks(wikitext));

  return {
    i: id16("story:" + name),
    n: name,
    tr: "Story",
    story: 1,
    w: "https://" + HOST + "/wiki/" + page,
    lvl: 0, xp: 0, lk: 0, f: null, m: null,
    maps: [...new Set(objs.flatMap((o) => o.mp || []))],
    req: [], keys: [],
    obj: objs,
    __wt: wikitext,
    __page: page,
    gx: extras          // guide sections that match no single objective
  };
}

/** All ten chapters. Throws only if every one fails; a single bad page is skipped. */
async function fetchStory() {
  const out = [];
  const failed = [];
  for (const [page, name] of CHAPTERS) {
    try { out.push(await fetchChapter(page, name)); }
    catch (e) { failed.push(name + " (" + ((e && e.message) || e) + ")"); }
  }
  let items = 0;
  try { items = await attachItemGuides(out); }
  catch (e) { failed.push("item locations (" + ((e && e.message) || e) + ")"); }
  for (const c of out) {                       // working fields, not part of the dataset
    delete c.__wt; delete c.__page;
    for (const o of c.obj) delete o.raw;
  }
  return { chapters: out, failed: failed, items: items };
}

module.exports = { fetchStory, CHAPTERS };
