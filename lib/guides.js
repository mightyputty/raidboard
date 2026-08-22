"use strict";
/**
 * Guides for the trader quests.
 *
 * The story chapters put one "===heading===" per objective under ==Guide==, so those attach
 * per step. Trader quest pages do not: their ==Guide== is a flat run of prose with the location
 * screenshots in a gallery underneath, and a quest-item reference table that is not directions.
 * So those attach to the quest instead of to one of its objectives, which is the honest place
 * for them — the wiki never said which step they belong to.
 */

const S = require("./story");

const HOST = "escapefromtarkov.fandom.com";
const BATCH = 45;                 // the API takes 50 titles a call

// interwiki and category links are page plumbing, not instructions
const PLUMBING = /\[\[(?:Category|[a-z]{2}(?:-[a-z]{2})?):[^\]]*\]\]/g;

function pageTitle(wikiLink) {
  const m = /\/wiki\/([^#?]+)/.exec(wikiLink || "");
  return m ? decodeURIComponent(m[1]).replace(/_/g, " ") : null;
}

/** The whole ==Guide== section as one lump: what to do, and the pictures that go with it. */
function flatGuide(wikitext) {
  let sec = wikitext.split("==Guide==")[1];
  if (sec === undefined) return null;
  const next = sec.search(/\n==[^=]/);
  if (next >= 0) sec = sec.slice(0, next);

  const images = [];
  for (const g of sec.match(/<gallery[^>]*>[\s\S]*?<\/gallery>/g) || []) {
    for (const line of g.split("\n")) {
      const m = /^File:([^|\]]+?)(?:\|(.*))?$/.exec(line.trim());
      if (m) images.push({ f: m[1].trim(), c: S.plain(m[2] || "") });
    }
  }
  for (const m of sec.matchAll(/\[\[File:([^|\]]+?)(?:\|[^\]]*?)?\]\]/g)) {
    const f = m[1].trim();
    if (S.DECORATION.test(f)) continue;          // item icons are not directions
    if (!images.some((x) => x.f === f)) images.push({ f: f, c: "" });
  }

  const prose = S.plain(
    sec.replace(/<gallery[\s\S]*?<\/gallery>/g, "")
       .replace(/\{\|[\s\S]*?\|\}/g, "")         // the quest-item table is reference, not directions
       .replace(/\[\[File:[^\]]*\]\]/g, "")
       .replace(PLUMBING, "")
       .replace(/<ref[\s\S]*?<\/ref>/g, "")
  ).replace(/^[*#:;\s]+/, "").trim();

  if (!prose && !images.length) return null;
  return { g: prose.slice(0, 900), sh: images };
}

/**
 * Read every trader quest's wiki page and hang its guide on the quest. Pages that do use
 * per-objective headings get the story treatment as well, so nothing is lost either way.
 */
async function fetchQuestGuides(tasks, log) {
  const byTitle = {};
  for (const t of tasks) {
    if (t.story || !t.w) continue;
    const title = pageTitle(t.w);
    if (title) (byTitle[title] = byTitle[title] || []).push(t);
  }
  const titles = Object.keys(byTitle);
  let quests = 0, objectives = 0, missing = 0;

  for (let i = 0; i < titles.length; i += BATCH) {
    let j;
    try {
      j = await S.apiJson({
        action: "query", format: "json", prop: "revisions", rvprop: "content",
        rvslots: "main", titles: titles.slice(i, i + BATCH).join("|")
      });
    } catch (e) { continue; }

    // the API normalises titles, so map what came back to what we asked for
    const asked = {};
    for (const n of (j.query && j.query.normalized) || []) asked[n.to] = n.from;
    for (const p of Object.values((j.query && j.query.pages) || {})) {
      if (p.missing !== undefined) { missing++; continue; }
      const w = p.revisions && p.revisions[0] && p.revisions[0].slots && p.revisions[0].slots.main["*"];
      if (!w) continue;
      const mine = byTitle[asked[p.title] || p.title] || byTitle[p.title] || [];
      const blocks = S.guideBlocks(w);
      const flat = flatGuide(w);
      for (const t of mine) {
        // a page with per-objective headings is worth more than one lump of prose
        if (blocks.length) {
          const before = t.obj.filter((o) => o.g || o.sh).length;
          S.attachGuides(t.obj, blocks);
          objectives += t.obj.filter((o) => o.g || o.sh).length - before;
        }
        if (flat && !blocks.length) { t.qg = flat; quests++; }
      }
    }
    if (log) log(Math.min(i + BATCH, titles.length), titles.length);
  }
  return { pages: titles.length, quests: quests, objectives: objectives, missing: missing };
}


/**
 * Turn wiki filenames into URLs the page can put straight in an <img>.
 *
 * Resolved once at build time rather than proxied at view time, so the hosted site can show
 * screenshots at all — there is no server there to ask. Thumbnails, not originals: the full
 * files are 2-3 MB each and nobody needs that to find a cabin.
 */
async function resolveImages(tasks, log) {
  const wanted = new Set();
  const lists = [];
  const collect = (holder) => {
    if (!holder || !holder.sh || !holder.sh.length) return;
    lists.push(holder.sh);
    for (const s of holder.sh) if (s.f) wanted.add(s.f);
  };
  for (const t of tasks) {
    collect(t.qg);
    for (const o of t.obj || []) { collect(o); for (const g of o.ig || []) collect(g); }
    for (const x of t.gx || []) collect(x);
    for (const x of t.ix || []) collect(x);
  }

  const names = [...wanted];
  const url = {};
  for (let i = 0; i < names.length; i += 45) {
    const slice = names.slice(i, i + 45);
    try {
      const j = await S.apiJson({
        action: "query", format: "json", prop: "imageinfo", iiprop: "url",
        iiurlwidth: "1000", titles: slice.map((n) => "File:" + n).join("|")
      });
      for (const p of Object.values((j.query && j.query.pages) || {})) {
        const im = (p.imageinfo || [])[0];
        if (im && im.thumburl) url[String(p.title).replace(/^File:/, "")] = im.thumburl;
      }
    } catch (e) { /* a failed batch just leaves those pictures out */ }
    if (log) log(Math.min(i + 45, names.length), names.length);
  }

  let resolved = 0;
  for (const list of lists) {
    for (let i = list.length - 1; i >= 0; i--) {
      const hit = url[list[i].f] || url[String(list[i].f).replace(/_/g, " ")];
      if (!hit) { list.splice(i, 1); continue; }   // no URL, no picture — do not ship a broken img
      list[i] = { u: hit, c: list[i].c || "" };
      resolved++;
    }
  }
  return { asked: names.length, resolved: resolved };
}

module.exports = { fetchQuestGuides, flatGuide, pageTitle, resolveImages };
