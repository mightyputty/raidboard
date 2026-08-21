"use strict";
/**
 * Location screenshots for a quest, taken from the Escape from Tarkov wiki.
 *
 * The page itself never talks to the wiki. This fetches a quest's images once, writes them
 * to data/wiki/, and serves everything from disk after that — so the board keeps working
 * with no connection, and what you look at stays on your machine.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const HOST = "escapefromtarkov.fandom.com";
const UA = "tarkov-raid-board (local, personal use)";
// icons and page banners are decoration; the map and location shots are the point
const DECORATION = /(icon|banner|logo|_button|\.svg$)/i;
const MAX_SHOTS = 12;
const MAX_BYTES = 6 * 1024 * 1024;

function caption(file) {
  return file.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim();
}

/** quest id -> wiki page title, read out of the built dataset. */
function pagesFromData(file) {
  const out = {};
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const t of d.tasks || []) {
      const m = t.w && /\/wiki\/([^#?]+)/.exec(t.w);
      if (m) out[t.i] = decodeURIComponent(m[1]);
    }
  } catch (e) {}
  return out;
}

/** objective id -> the wiki files its guide showed, so the browser only ever sends us an id. */
function shotsFromData(file) {
  const out = {};
  const add = (o) => { if (o && o.oi && o.sh && o.sh.length) out[o.oi] = o.sh; };
  try {
    const d = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const t of d.tasks || []) {
      for (const o of t.obj || []) { add(o); for (const g of o.ig || []) add(g); }
      for (const x of t.gx || []) add(x);
      for (const x of t.ix || []) add(x);
    }
  } catch (e) {}
  return out;
}

class WikiShots {
  constructor(dir, pages, sets) {
    this.dir = dir;
    this.pages = pages || {};     // quest id -> wiki page, for whole-page image lists
    this.sets = sets || {};       // objective id -> the exact files its guide used
    this.inflight = new Map();    // one fetch per id, however many times it is asked for
    try { fs.mkdirSync(this.dir, { recursive: true }); } catch (e) {}
  }

  manifest(id) { return path.join(this.dir, "q-" + id + ".json"); }

  /** Cached result if there is one, otherwise fetch it once and keep it. */
  get(id) {
    if (!/^[A-Za-z0-9]+$/.test(id)) return Promise.resolve({ shots: [] });
    const file = this.manifest(id);
    if (fs.existsSync(file)) {
      try { return Promise.resolve(JSON.parse(fs.readFileSync(file, "utf8"))); } catch (e) {}
    }
    if (this.inflight.has(id)) return this.inflight.get(id);
    // an objective knows exactly which files it wants; a quest has to be read off its page
    const work = this.sets[id] ? this.fetchNamed(this.sets[id]) : this.fetchShots(id);
    const job = work
      .then((out) => {
        try { fs.writeFileSync(file, JSON.stringify(out)); } catch (e) {}
        return out;
      })
      .catch((e) => ({ shots: [], error: String((e && e.message) || e) }))   // a failure is not cached
      .then((out) => { this.inflight.delete(id); return out; });
    this.inflight.set(id, job);
    return job;
  }

  async api(params) {
    const url = "https://" + HOST + "/api.php?" + new URLSearchParams(params).toString();
    const r = await fetch(url, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error("the wiki returned " + r.status);
    return r.json();
  }

  /** File names -> scaled-down URLs, in one request. */
  async resolveTitles(names) {
    const byName = {};
    for (let i = 0; i < names.length; i += 40) {                 // the API caps titles per call
      const slice = names.slice(i, i + 40);
      const info = await this.api({
        action: "query", format: "json", prop: "imageinfo",
        iiprop: "url|size", iiurlwidth: "1000",
        titles: slice.map((n) => "File:" + n).join("|")
      });
      for (const p of Object.values((info.query && info.query.pages) || {})) {
        const im = (p.imageinfo || [])[0];
        if (im && im.thumburl) byName[String(p.title).replace(/^File:/, "").replace(/ /g, "_")] = im.thumburl;
      }
    }
    return byName;
  }

  /** The exact files one objective's guide showed, captions and order kept. */
  async fetchNamed(list) {
    const names = list.map((x) => String(x.f).replace(/ /g, "_"));
    const byName = await this.resolveTitles(names);
    const shots = [];
    for (const item of list) {
      const src = byName[String(item.f).replace(/ /g, "_")];
      if (!src) continue;
      const f = await this.cache(src);
      if (f) shots.push({ f: f, n: item.c || caption(item.f) });
    }
    return { shots: shots };
  }

  async fetchShots(id) {
    const page = this.pages[id];
    if (!page) return { shots: [] };
    const parsed = await this.api({ action: "parse", page: page, prop: "images", format: "json" });
    const names = ((parsed.parse && parsed.parse.images) || [])
      .filter((f) => !DECORATION.test(f))
      .slice(0, MAX_SHOTS);
    if (!names.length) return { shots: [], page: page };
    const byName = await this.resolveTitles(names);
    const shots = [];
    for (const n of names) {          // keep the wiki's own order, it reads top to bottom
      const src = byName[n];
      if (!src) continue;
      const f = await this.cache(src);
      if (f) shots.push({ f: f, n: caption(n) });
    }
    return { shots: shots, page: page };
  }

  async cache(src) {
    const ext = ((/\.(png|jpe?g|gif|webp)/i.exec(src) || [])[1] || "png").toLowerCase();
    const name = crypto.createHash("sha1").update(src).digest("hex").slice(0, 16) + "." + ext;
    const dest = path.join(this.dir, name);
    if (fs.existsSync(dest)) return name;
    const r = await fetch(src, { headers: { "User-Agent": UA } });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    if (!buf.length || buf.length > MAX_BYTES) return null;
    fs.writeFileSync(dest, buf);
    return name;
  }
}

module.exports = { WikiShots, pagesFromData, shotsFromData };
