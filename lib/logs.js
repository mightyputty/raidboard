"use strict";
/**
 * Reads Escape from Tarkov's own log files to work out which quests you have
 * accepted and finished, and which map you are currently loading into.
 *
 * Two things in the logs carry quest state. When a trader sends you a quest
 * briefing the client logs a chat message of type 10 whose templateId is
 * "<questId> description"; when you hand a quest in it logs type 12 with
 * "<questId> successMessageText". Neither is documented, but both are stable,
 * and together they reconstruct your journal without touching the game.
 *
 * Raids come from application_*.log: "RaidMode: Online, ... Location: bigmap, ..."
 * on the way in, and a line containing RaidEnd on the way out.
 */

const fs = require("fs");
const path = require("path");
const { EventEmitter } = require("events");

const MSG_QUEST_STARTED = 10;
const MSG_QUEST_FINISHED = 12;

// the game's internal location ids -> the map ids the board uses
const LOCATIONS = {
  bigmap: "customs",
  factory4_day: "factory",
  factory4_night: "factory",
  woods: "woods",
  lighthouse: "lighthouse",
  shoreline: "shoreline",
  rezervbase: "reserve",
  interchange: "interchange",
  tarkovstreets: "streets-of-tarkov",
  laboratory: "the-lab",
  sandbox: "ground-zero",
  sandbox_high: "ground-zero",
  labyrinth: "the-labyrinth",
  terminal: "terminal",
  icebreaker: "icebreaker"
};

const NOTIFICATION_BLOCK = /Got notification \| (\w+)\s*\n(\{[\s\S]*?\n\})\s*(?=\n\d{4}-|\s*$)/g;
const RAID_START = /RaidMode:\s*\w+,.*?Location:\s*([A-Za-z0-9_]+)/;
const LINE_TIME = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;

function defaultLogRoot() {
  const candidates = [
    "C:/Battlestate Games/Escape from Tarkov/Logs",
    "C:/Battlestate Games/EFT/Logs",
    "C:/Program Files/Battlestate Games/Escape from Tarkov/Logs"
  ];
  return candidates.find((p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }) || candidates[0];
}

class LogWatcher extends EventEmitter {
  constructor(root) {
    super();
    this.root = root || defaultLogRoot();
    this.quests = new Map();   // questId -> {status, at}
    this.raid = null;          // {map, state, at}
    this.range = { from: null, to: null };
    this.seen = new Set();     // dedupe key per quest event
    this.timer = null;
    this.sessions = 0;
  }

  sessionDirs() {
    let entries;
    try { entries = fs.readdirSync(this.root); } catch (e) { return []; }
    return entries
      .filter((d) => /^log_/.test(d))
      .map((d) => path.join(this.root, d))
      .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } })
      .sort();
  }

  filesIn(dir, kind) {
    try {
      return fs.readdirSync(dir)
        .filter((f) => f.includes(kind) && f.endsWith(".log"))
        .map((f) => path.join(dir, f));
    } catch (e) { return []; }
  }

  /** Read every session once. Returns the number of quest events applied. */
  scanAll() {
    const dirs = this.sessionDirs();
    this.sessions = dirs.length;
    let applied = 0;
    for (const dir of dirs) {
      for (const f of this.filesIn(dir, "push-notifications")) applied += this.readNotifications(f);
      for (const f of this.filesIn(dir, "application")) this.readApplication(f);
    }
    return applied;
  }

  readNotifications(file) {
    let txt;
    try { txt = fs.readFileSync(file, "utf8"); } catch (e) { return 0; }
    let applied = 0;
    let m;
    NOTIFICATION_BLOCK.lastIndex = 0;
    while ((m = NOTIFICATION_BLOCK.exec(txt))) {
      let payload;
      try { payload = JSON.parse(m[2]); } catch (e) { continue; }   // a half-written block; next poll gets it
      const msg = payload && payload.message;
      if (!msg || !msg.templateId) continue;
      if (msg.type !== MSG_QUEST_STARTED && msg.type !== MSG_QUEST_FINISHED) continue;

      const questId = String(msg.templateId).split(" ")[0];
      const at = (msg.dt || 0) * 1000;
      const key = msg.type + ":" + questId + ":" + msg.dt;
      if (this.seen.has(key)) continue;
      this.seen.add(key);

      const status = msg.type === MSG_QUEST_FINISHED ? "d" : "a";
      const prev = this.quests.get(questId);
      if (!prev || at >= prev.at) {
        this.quests.set(questId, { status, at });
        this.emit("quest", { id: questId, status, at, fresh: !prev || prev.status !== status });
      }
      if (at) {
        if (!this.range.from || at < this.range.from) this.range.from = at;
        if (!this.range.to || at > this.range.to) this.range.to = at;
      }
      applied++;
    }
    return applied;
  }

  readApplication(file) {
    let txt;
    try { txt = fs.readFileSync(file, "utf8"); } catch (e) { return; }
    for (const line of txt.split("\n")) {
      const start = line.match(RAID_START);
      const isEnd = line.includes("RaidEnd");
      if (!start && !isEnd) continue;
      const ts = line.match(LINE_TIME);
      const at = ts ? Date.parse(ts[1].replace(" ", "T")) : Date.now();
      if (this.raid && at < this.raid.at) continue;
      const next = start
        ? { map: LOCATIONS[start[1].toLowerCase()] || null, raw: start[1], state: "in-raid", at }
        : { map: this.raid ? this.raid.map : null, raw: this.raid ? this.raid.raw : null, state: "ended", at };
      const changed = !this.raid || this.raid.state !== next.state || this.raid.map !== next.map;
      this.raid = next;
      if (changed) this.emit("raid", next);
    }
  }

  /** Re-read the newest session's files every `ms` and emit anything new. */
  start(ms) {
    const poll = () => {
      const dirs = this.sessionDirs();
      this.sessions = dirs.length;          // the game opens a new folder every launch
      const newest = dirs[dirs.length - 1];
      if (!newest) return;
      for (const f of this.filesIn(newest, "push-notifications")) this.readNotifications(f);
      for (const f of this.filesIn(newest, "application")) this.readApplication(f);
    };
    poll();
    this.timer = setInterval(poll, ms || 2000);
    this.timer.unref && this.timer.unref();
    return this;
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  snapshot() {
    const status = {};
    for (const [id, v] of this.quests) status[id] = v.status;
    let active = 0, done = 0;
    for (const v of this.quests.values()) (v.status === "d" ? done++ : active++);
    return {
      status,
      raid: this.raid,
      counts: { active, done, tracked: this.quests.size },
      range: this.range,
      sessions: this.sessions,
      root: this.root
    };
  }
}

module.exports = { LogWatcher, LOCATIONS, defaultLogRoot };
