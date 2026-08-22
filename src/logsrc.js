/**
 * Reading Escape from Tarkov's logs from inside the page.
 *
 * Same two facts lib/logs.js pulls out of the files, same regexes — only the file access
 * differs. The browser gets a handle to the Logs folder through the directory picker, keeps
 * it in IndexedDB so the folder is chosen once, and reads it directly. Nothing is uploaded;
 * on the hosted build there is no server to upload to.
 */
(function (global) {
  "use strict";

  var MSG_STARTED = 10, MSG_FAILED = 11, MSG_FINISHED = 12;
  var BLOCK = /Got notification \| (\w+)\s*\n(\{[\s\S]*?\n\})\s*(?=\n\d{4}-|\s*$)/g;
  var RAID_START = /RaidMode:\s*\w+,.*?Location:\s*([A-Za-z0-9_]+)/;
  var LINE_TIME = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/;
  var SESSION_MODE = /Session mode:\s*(\w+)/g;

  var LOCATIONS = {
    bigmap: "customs", factory4_day: "factory", factory4_night: "factory", woods: "woods",
    lighthouse: "lighthouse", shoreline: "shoreline", rezervbase: "reserve",
    interchange: "interchange", tarkovstreets: "streets-of-tarkov", laboratory: "the-lab",
    sandbox: "ground-zero", sandbox_high: "ground-zero", labyrinth: "the-labyrinth",
    terminal: "terminal", icebreaker: "icebreaker"
  };

  /** Quest status out of one push-notifications file. Type 11 is a failure. */
  function readNotifications(text, quests) {
    var m, applied = 0;
    BLOCK.lastIndex = 0;
    while ((m = BLOCK.exec(text))) {
      var payload;
      try { payload = JSON.parse(m[2]); } catch (e) { continue; }
      var msg = payload && payload.message;
      if (!msg || !msg.templateId) continue;
      if (msg.type !== MSG_STARTED && msg.type !== MSG_FAILED && msg.type !== MSG_FINISHED) continue;
      var id = String(msg.templateId).split(" ")[0];
      var at = (msg.dt || 0) * 1000;
      var status = msg.type === MSG_FINISHED ? "d" : msg.type === MSG_FAILED ? "f" : "a";
      var prev = quests[id];
      if (!prev || at >= prev.at) quests[id] = { status: status, at: at };
      applied++;
    }
    return applied;
  }

  /** Which map you last loaded into, and which mode you are playing. */
  function readApplication(text, state) {
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var start = line.match(RAID_START);
      var isEnd = line.indexOf("RaidEnd") >= 0;
      if (start || isEnd) {
        var ts = line.match(LINE_TIME);
        var at = ts ? Date.parse(ts[1].replace(" ", "T")) : Date.now();
        if (!state.raid || at >= state.raid.at) {
          state.raid = start
            ? { map: LOCATIONS[start[1].toLowerCase()] || null, raw: start[1], state: "in-raid", at: at }
            : { map: state.raid ? state.raid.map : null, state: "ended", at: at };
        }
      }
    }
    SESSION_MODE.lastIndex = 0;
    var mm;
    while ((mm = SESSION_MODE.exec(text))) {
      var mode = mm[1].toLowerCase();
      if (mode.indexOf("pve") === 0) state.mode = "pve";
      else if (mode.indexOf("pvp") === 0) state.mode = "pvp";
    }
  }

  // ---- the folder handle, kept so you only pick it once ----
  var DB = "raidboard", STORE = "kv", KEY = "logdir";

  function idb(mode, run) {
    return new Promise(function (res, rej) {
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(STORE); };
      r.onerror = function () { rej(r.error); };
      r.onsuccess = function () {
        var tx = r.result.transaction(STORE, mode);
        var rq = run(tx.objectStore(STORE));
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      };
    });
  }
  function saveDir(h) { return idb("readwrite", function (s) { return s.put(h, KEY); }); }
  function loadDir() { return idb("readonly", function (s) { return s.get(KEY); }); }
  function forgetDir() { return idb("readwrite", function (s) { return s.delete(KEY); }); }

  var supported = typeof global.showDirectoryPicker === "function";

  function pick() {
    return global.showDirectoryPicker({ id: "eft-logs", mode: "read" })
      .then(function (dir) { return saveDir(dir).then(function () { return dir; }); });
  }

  /** A stored handle, if we still have permission — never prompts. */
  function restore() {
    if (!supported) return Promise.resolve(null);
    return loadDir().then(function (dir) {
      if (!dir) return null;
      return dir.queryPermission({ mode: "read" }).then(function (p) {
        return p === "granted" ? dir : null;
      });
    }).catch(function () { return null; });
  }

  /** Ask again for a handle we already have. Needs a click. */
  function regrant() {
    return loadDir().then(function (dir) {
      if (!dir) return null;
      return dir.requestPermission({ mode: "read" }).then(function (p) {
        return p === "granted" ? dir : null;
      });
    });
  }

  async function sessionFolders(dir) {
    var out = [];
    for await (var e of dir.values()) {
      if (e.kind === "directory" && e.name.indexOf("log_") === 0) out.push(e);
    }
    out.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    return out;
  }

  /**
   * Read the folder and reconstruct the journal. `newestOnly` re-reads just the session the
   * game is writing to, which is all a poll needs and keeps it to a couple of small files.
   */
  async function scan(dir, newestOnly) {
    var folders = await sessionFolders(dir);
    if (newestOnly && folders.length) folders = folders.slice(-1);
    var quests = {};
    var state = { raid: null, mode: null };
    var files = 0;
    for (var i = 0; i < folders.length; i++) {
      for await (var f of folders[i].values()) {
        if (f.kind !== "file") continue;
        var isNotif = f.name.indexOf("push-notifications") >= 0;
        var isApp = f.name.indexOf("application") >= 0;
        if (!isNotif && !isApp) continue;
        var text = await (await f.getFile()).text();
        files++;
        if (isNotif) readNotifications(text, quests);
        else readApplication(text, state);
      }
    }
    var status = {};
    var active = 0, done = 0, failed = 0;
    for (var id in quests) {
      status[id] = quests[id].status;
      if (quests[id].status === "d") done++;
      else if (quests[id].status === "f") failed++;
      else active++;
    }
    return {
      status: status,
      raid: state.raid,
      mode: state.mode,
      counts: { active: active, done: done, failed: failed, tracked: Object.keys(status).length },
      sessions: folders.length,
      files: files
    };
  }

  global.RaidLogs = {
    supported: supported,
    pick: pick,
    restore: restore,
    regrant: regrant,
    forget: forgetDir,
    scan: scan,
    LOCATIONS: LOCATIONS
  };
})(window);
