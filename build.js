#!/usr/bin/env node
/**
 * Builds the Raid Board.
 *
 *   node build.js            assemble from data/tarkov-data.json
 *   node build.js --refresh  re-download from tarkov.dev first (do this after a wipe)
 *
 * Outputs:
 *   tarkov-raid-board.html        page body only — what the Artifact tool publishes
 *   tarkov-raid-board.local.html  standalone file you can open from disk
 */
const fs = require("fs");
const path = require("path");
const { fetchStory } = require("./lib/story");

const ROOT = __dirname;
const SRC = path.join(ROOT, "src");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "tarkov-data.json");
const BASE = "https://json.tarkov.dev/regular/";
// tarkov.dev's quest-chain links are currently incomplete; this older community
// dump still carries the chains for quests that existed in 2024, keyed by BSG id.
const LEGACY_CHAINS = "https://raw.githubusercontent.com/TarkovTracker/tarkovdata/master/quests.json";
// Vector maps + the bounds that tie game coordinates to them. Verified empirically:
// bounds are [[x0,z0],[x1,z1]] in raw game units and map linearly onto the SVG viewBox,
// with bounds[0] at (0,0). Checked against every extract, spawn and quest zone on each
// map — 97-100% of known points land on drawn geometry with this projection.
const MAP_META = "https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json";

// tarkov.dev serves several ids for what is one physical map
const MERGE = {
  "night-factory": "factory",
  "ground-zero-21": "ground-zero",
  "ground-zero-tutorial": "ground-zero",
  "the-lab-dark": "the-lab"
};
const CARRY_IN = new Set(["plantItem", "plantQuestItem", "mark"]);

/**
 * Map variants collapse (Ground Zero and Ground Zero 21+ are one map here), so the same
 * zone arrives twice under different ids. Keep one copy per map + geometry.
 */
function dedupeLoc(list, key) {
  const seen = new Set();
  return list.filter((entry) => {
    const sig = entry.m + "|" + JSON.stringify(entry[key]);
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

async function grab(name) {
  const res = await fetch(BASE + name, { headers: { "accept-encoding": "gzip" } });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const json = await res.json();
  return json.data || json;
}

async function refresh() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  process.stdout.write("Downloading from tarkov.dev ...\n");
  const [tasksRaw, tasksLoc, mapsRaw, mapsLoc, tradersRaw, tradersLoc, itemsRaw, itemsLoc] =
    await Promise.all(["tasks", "tasks_en", "maps", "maps_en", "traders", "traders_en", "items", "items_en"].map(grab));

  const tasks = tasksRaw.tasks || tasksRaw;
  const mapsIn = mapsRaw.maps || mapsRaw;
  const traders = tradersRaw.traders || tradersRaw;
  const items = itemsRaw.items || itemsRaw;
  const L = (k) => (k && (tasksLoc[k] || mapsLoc[k] || tradersLoc[k] || itemsLoc[k])) || k || null;

  const mapById = {};
  const canon = {};
  for (const id of Object.keys(mapsIn)) {
    const m = mapsIn[id];
    const cn = MERGE[m.normalizedName] || m.normalizedName;
    mapById[id] = cn;
    if (!canon[cn]) {
      canon[cn] = {
        id: cn,
        name: mapsLoc[m.name] || m.name,
        duration: m.raidDuration || 0,
        players: m.players || "",
        ex: [],
        tr: []
      };
    }
    // transits to other maps, labelled by where they take you
    for (const t of m.transits || []) {
      if (!t.position) continue;
      const label = String(mapsLoc[t.description] || t.description || "").replace(/^Transit to\s*/i, "");
      if (!label) continue;
      const x = Math.round(t.position.x * 10) / 10;
      const z = Math.round(t.position.z * 10) / 10;
      if (canon[cn].tr.some((o) => o.n === label && o.x === x && o.z === z)) continue;
      canon[cn].tr.push({ n: label, x: x, z: z });
    }
    // extracts, for labelling the map — variants repeat them, so dedupe on name + spot
    for (const e of m.extracts || []) {
      if (!e.position) continue;
      const name = mapsLoc[e.name] || e.name;
      const x = Math.round(e.position.x * 10) / 10;
      const z = Math.round(e.position.z * 10) / 10;
      if (canon[cn].ex.some((o) => o.n === name && o.x === x && o.z === z)) continue;
      canon[cn].ex.push({ n: name, f: e.faction || "shared", x: x, z: z });
    }
  }
  // the merged ids must not inherit a variant's display name
  if (canon.factory) canon.factory.name = "Factory";
  if (canon["ground-zero"]) canon["ground-zero"].name = "Ground Zero";
  if (canon["the-lab"]) canon["the-lab"].name = "The Lab";

  // tarkov.dev's structured fields sometimes lag the in-game text. Vitamins, Supplements and
  // Offensive Reconnaissance all still carry the map, key and coordinates from where the item
  // used to spawn, while the description names where BSG actually moved it. The description is
  // what the player reads in their quest log, so it wins — and the keys and coordinates that
  // belonged to the old map go with it, because they describe a place the objective is not.
  const MAP_WORDS = Object.values(canon)
    .map((m) => ({ id: m.id, n: String(m.name).toLowerCase() }))
    .sort((a, b) => b.n.length - a.n.length);
  const LEADS = [" on ", " at ", " in ", " from ", " on the ", " at the ", " in the ", " from the "];
  const mapNamedIn = (text) => {
    const t = " " + String(text || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/ +/g, " ") + " ";
    const hit = MAP_WORDS.find((m) => LEADS.some((p) => t.indexOf(p + m.n + " ") >= 0));
    return hit ? hit.id : null;
  };

  const itemName = (id) => { const it = items[id]; return it ? (itemsLoc[it.name] || it.name) : null; };
  const traderName = (id) => { const t = traders[id]; return t ? (tradersLoc[t.name] || t.name) : null; };

  const out = [];
  for (const id of Object.keys(tasks)) {
    const t = tasks[id];
    const objs = (t.objectives || []).map((o) => {
      const mp = [...new Set((o.maps || []).map((m) => mapById[m]).filter(Boolean))];
      const r = { oi: o.id, d: L(o.description), ty: o.type };
      if (o.count && o.count > 1) r.c = o.count;
      if (o.optional) r.o = 1;
      if (mp.length) r.mp = mp;
      const its = (o.items || []).map(itemName).filter(Boolean);
      // long "any of these" lists are noise in a checklist — keep the count, drop the names
      if (its.length && its.length <= 6) r.it = its;
      else if (its.length) r.any = its.length;
      if (o.foundInRaid) r.fir = 1;
      if (o.markerItem) r.mk = itemName(o.markerItem);
      if (o.exitName) r.ex = o.exitName;
      const rk = [...new Set((o.requiredKeys || []).flat().map(itemName).filter(Boolean))];
      if (rk.length) r.rk = rk;

      // where to physically go: zone polygons, plus discrete spots for quest items
      const round = (n) => Math.round(n * 10) / 10;
      const zones = [];
      for (const z of o.zones || []) {
        const mid = mapById[z.map];
        if (!mid || !z.outline || !z.outline.length) continue;
        zones.push({ m: mid, pl: z.outline.map((p) => [round(p.x), round(p.z)]) });
      }
      if (zones.length) r.zn = dedupeLoc(zones, "pl");

      const spots = [];
      for (const p of o.possibleLocations || []) {
        const mid = mapById[p.map];
        if (!mid || !p.positions || !p.positions.length) continue;
        spots.push({ m: mid, pt: p.positions.map((q) => [round(q.x), round(q.z)]) });
      }
      if (spots.length) r.sp = dedupeLoc(spots, "pt");

      const spoken = mapNamedIn(r.d);
      if (spoken && r.mp && r.mp.indexOf(spoken) < 0) {
        r.was = r.mp.join(", ");     // what the data claimed, so the card can own up to the change
        r.mp = [spoken];
        delete r.rk; delete r.sp; delete r.zn;
      }
      return r;
    });
    const taskMaps = [...new Set(objs.flatMap((o) => o.mp || []))];

    out.push({
      i: t.id,
      n: L(t.name),
      tr: traderName(t.trader),
      w: t.wikiLink || null,
      lvl: t.minPlayerLevel || 0,
      xp: t.experience || 0,
      k: t.kappaRequired ? 1 : 0,
      lk: t.lightkeeperRequired ? 1 : 0,
      f: t.factionName && t.factionName !== "Any" ? t.factionName : null,
      m: t.map && (!taskMaps.length || taskMaps.indexOf(mapById[t.map]) >= 0) ? mapById[t.map] : null,
      maps: taskMaps,
      req: (t.taskRequirements || [])
        .filter((r) => !r.status || r.status.includes("complete") || r.status.includes("active"))
        .map((r) => ({ t: r.task, s: (r.status || ["complete"]).join("/") })),
      // a key filed against a map the quest no longer visits is left over from the old version
      keys: (t.neededKeys || [])
        .map((k) => ({ m: mapById[k.map] || null, k: k.keys.map(itemName).filter(Boolean) }))
        .filter((x) => x.k.length && (!x.m || !taskMaps.length || taskMaps.indexOf(x.m) >= 0)),
      obj: objs
    });
  }
  const legacyFilled = await fillChainGaps(out);
  const mapImages = await fetchMaps(canon);
  for (const [id, info] of Object.entries(mapImages)) Object.assign(canon[id], info);

  // The story chapters are not tarkov.dev's to give — they come from the wiki, they have no
  // trader, and nothing in the game logs reports them, so they are ticked off by hand.
  const story = await fetchStory();
  if (story.failed.length) process.stdout.write("  story chapters skipped: " + story.failed.join("; ") + "\n");
  if (story.chapters.length) {
    out.push(...story.chapters);
    process.stdout.write("  " + story.chapters.length + " story chapters, " +
      story.chapters.reduce((n, c) => n + c.obj.length, 0) + " objectives (hand-ticked)\n");
  }

  out.sort((a, b) => (a.tr || "").localeCompare(b.tr || "") || a.lvl - b.lvl || a.n.localeCompare(b.n));

  const payload = {
    generated: new Date().toISOString(),
    maps: Object.values(canon).sort((a, b) => a.name.localeCompare(b.name)),
    traders: [...new Set(out.map((t) => t.tr).filter(Boolean))],
    health: {
      chainsFromSource: out.filter((t) => t.req.length && !t.rs).length,
      chainsFromLegacy: legacyFilled,
      chainsMissing: out.filter((t) => !t.req.length && !t.story).length,
      kappaFlagged: out.filter((t) => t.k).length
    },
    tasks: out
  };
  fs.writeFileSync(DATA_FILE, JSON.stringify(payload));
  console.log(`  ${out.length} quests, ${out.reduce((s, t) => s + t.obj.length, 0)} objectives, ${payload.maps.length} maps`);
  return payload;
}

/** Download the vector maps and return {canonMapId: {svg, bounds, vb}}. */
async function fetchMaps(canon) {
  const dir = path.join(DATA_DIR, "maps");
  fs.mkdirSync(dir, { recursive: true });
  let meta;
  try {
    const res = await fetch(MAP_META);
    if (!res.ok) throw new Error("HTTP " + res.status);
    meta = await res.json();
  } catch (e) {
    console.warn("  (skipped map images: " + e.message + ")");
    return {};
  }

  const out = {};
  for (const entry of Object.values(meta)) {
    const id = MERGE[entry.normalizedName] || entry.normalizedName;
    if (!canon[id] || out[id]) continue;
    const cfg = (entry.maps || []).find((m) => m.svgPath && m.bounds);
    if (!cfg) continue;

    const file = cfg.svgPath.split("/").pop();
    const dest = path.join(dir, file);
    let svg;
    if (fs.existsSync(dest)) {
      svg = fs.readFileSync(dest, "utf8");
    } else {
      const r = await fetch(cfg.svgPath);
      if (!r.ok) { console.warn(`  (map ${file}: HTTP ${r.status})`); continue; }
      svg = await r.text();
      fs.writeFileSync(dest, svg);
    }
    const vb = (svg.match(/viewBox="([^"]+)"/) || [])[1];
    if (!vb) continue;
    const nums = vb.trim().split(/[\s,]+/).map(Number);
    out[id] = { svg: file, bounds: cfg.bounds, vb: [nums[2], nums[3]] };
  }
  console.log(`  ${Object.keys(out).length} vector maps in data/maps/`);
  return out;
}

/** Fill in missing quest chains from the older community dump. Returns how many were filled. */
async function fillChainGaps(tasks) {
  let legacy;
  try {
    const res = await fetch(LEGACY_CHAINS);
    if (!res.ok) throw new Error("HTTP " + res.status);
    legacy = await res.json();
  } catch (e) {
    console.warn("  (skipped chain backfill: " + e.message + ")");
    return 0;
  }
  const byLocalId = {};
  legacy.forEach((q) => { byLocalId[q.id] = q; });
  const byGameId = {};
  legacy.forEach((q) => { if (q.gameId) byGameId[q.gameId] = q; });

  let filled = 0;
  for (const t of tasks) {
    if (t.req.length) continue;
    const q = byGameId[t.i];
    if (!q || !q.require || !q.require.quests) continue;
    const ids = [...new Set(
      q.require.quests.flat()
        .map((id) => byLocalId[id] && byLocalId[id].gameId)
        .filter((gid) => gid && gid !== t.i)
    )];
    if (!ids.length) continue;
    t.req = ids.map((gid) => ({ t: gid, s: "complete" }));
    t.rs = 1; // chain recovered from the older dump, not the live source
    filled++;
  }
  console.log(`  chain backfill: ${filled} quests recovered from the 2024 community dump`);
  return filled;
}

function assemble() {
  const shell = fs.readFileSync(path.join(SRC, "shell.html"), "utf8");
  const app = fs.readFileSync(path.join(SRC, "app.js"), "utf8");
  const data = fs.readFileSync(DATA_FILE, "utf8").replace(/</g, "\\u003c");

  const body = shell +
    '\n<script id="tarkov-data" type="application/json">' + data + "</script>\n" +
    "<script>\n" + app + "</script>\n";

  fs.writeFileSync(path.join(ROOT, "tarkov-raid-board.html"), body);

  // the standalone copy is the same content, split so the title/fonts/CSS sit in <head>
  const cut = body.indexOf("</style>") + "</style>".length;
  fs.writeFileSync(
    path.join(ROOT, "tarkov-raid-board.local.html"),
    '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    body.slice(0, cut) + "\n</head>\n<body>\n" + body.slice(cut) + "\n</body>\n</html>\n"
  );

  const kb = (f) => Math.round(fs.statSync(path.join(ROOT, f)).size / 1024);
  console.log(`Built tarkov-raid-board.html (${kb("tarkov-raid-board.html")} KB) and tarkov-raid-board.local.html (${kb("tarkov-raid-board.local.html")} KB)`);
}

(async function main() {
  if (process.argv.includes("--refresh") || !fs.existsSync(DATA_FILE)) await refresh();
  assemble();
})().catch((e) => { console.error("Build failed:", e.message); process.exit(1); });
