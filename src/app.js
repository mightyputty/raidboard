(function () {
  "use strict";

  var DATA = JSON.parse(document.getElementById("tarkov-data").textContent);
  var TASKS = DATA.tasks;
  var MAPS = DATA.maps;
  var HEALTH = DATA.health || {};
  var MAP_BY_ID = {};
  MAPS.forEach(function (m) { MAP_BY_ID[m.id] = m; });
  var BY_ID = {};
  TASKS.forEach(function (t) { BY_ID[t.i] = t; });

  // quests that depend on a given quest — used to undo a chain cleanly
  var DEPENDENTS = {};
  TASKS.forEach(function (t) {
    t.req.forEach(function (r) { (DEPENDENTS[r.t] = DEPENDENTS[r.t] || []).push(t.i); });
  });


  // ---------- state ----------
  var KEY = "tarkov-raid-board/v1";
  var storageOK = true;
  var S = {
    level: 15,
    faction: "Any",
    gameMode: "pvp",
    sort: "total",
    theme: "system",
    map: null,
    autoFollow: true,    // jump to a map's plan when you load into it
    marks: {},           // taskId -> "a" | "d" | "" — what YOU set, wins over the logs
    ignored: {},         // taskId -> 1 — parked: still yours, just not counted right now
    objDone: {}          // objectiveId -> 1
  };

  // Filled in from the game's own logs when the board runs behind `node board.js`.
  var LOG = {};          // taskId -> "a" | "d"
  var LIVE = null;       // {counts, range, sessions, root} once the local server answers

  function loadState() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { storageOK = false; }
    if (!raw) return;
    try {
      var o = JSON.parse(raw);
      ["level", "faction", "gameMode", "sort", "theme", "map", "autoFollow", "showExits"].forEach(function (k) {
        if (o[k] !== undefined && o[k] !== null) S[k] = o[k];
      });
      if (o.marks) S.marks = o.marks;
      else if (o.status) S.marks = o.status;   // saves from before the log watcher existed
      if (o.ignored) S.ignored = o.ignored;
      if (o.objDone) S.objDone = o.objDone;
    } catch (e) { /* unreadable backup — start clean rather than crash */ }
  }

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); storageOK = true; }
    catch (e) { storageOK = false; }
  }

  /** What you set by hand beats what the logs say; otherwise the logs speak. */
  function statusOf(id) {
    var mark = S.marks[id];
    if (mark !== undefined) return mark;
    if (LOG[id]) return LOG[id];
    // story chapters are handed to you at the start and never leave your journal, so they
    // count as active until you say otherwise — nothing in the logs will ever tell us
    return BY_ID[id] && BY_ID[id].story ? "a" : "";
  }
  function isDone(id) { return statusOf(id) === "d"; }
  function isActive(id) { return statusOf(id) === "a"; }
  // a quest you failed is neither active nor done — out of the running until BSG resets it
  function isFailed(id) { return statusOf(id) === "f"; }
  function isIgnored(id) { return !!S.ignored[id]; }
  function isOverridden(id) {
    return S.marks[id] !== undefined && S.marks[id] !== (LOG[id] || "");
  }

  // ---------- what counts right now ----------
  var unlockMemo = null;
  function resetMemo() { unlockMemo = {}; }

  function factionOk(t) { return !t.f || S.faction === "Any" || t.f === S.faction; }

  /** Could you pick this up? Uses the quest chain where the data has one. */
  function isUnlocked(t, seen) {
    if (isDone(t.i)) return false;
    var memo = unlockMemo[t.i];
    if (memo !== undefined) return memo;
    seen = seen || {};
    if (seen[t.i]) return false;
    seen[t.i] = 1;
    var ok = t.lvl <= S.level && factionOk(t);
    if (ok) {
      for (var i = 0; i < t.req.length; i++) {
        var r = t.req[i];
        if (!BY_ID[r.t]) continue;
        if (r.s.indexOf("complete") >= 0) { if (!isDone(r.t)) { ok = false; break; } }
        else if (!isDone(r.t) && !isActive(r.t)) { ok = false; break; }
      }
    }
    unlockMemo[t.i] = ok;
    return ok;
  }

  // about 25 quests each way exist in only one mode; everything else runs in both
  function inMode(t) {
    return !t.md || t.md === (S.gameMode === "pve" ? "e" : "v");
  }

  function inScope(t) {
    return inMode(t) && !isIgnored(t.i) && isActive(t.i);
  }

  function openObjectives(t) {
    return t.obj.filter(function (o) { return !S.objDone[o.oi]; });
  }

  function scopedTasks() { return TASKS.filter(inScope); }

  // ---------- scoring ----------
  function scoreMaps() {
    var rows = {};
    MAPS.forEach(function (m) {
      rows[m.id] = { map: m, locked: 0, flex: 0, finishes: 0, tasks: {}, keys: {}, objs: [] };
    });
    scopedTasks().forEach(function (t) {
      var mapped = openObjectives(t).filter(function (o) { return o.mp && o.mp.length; });
      if (!mapped.length) return;
      var finishers = {};
      MAPS.forEach(function (m) {
        if (mapped.every(function (o) { return o.mp.indexOf(m.id) >= 0; })) finishers[m.id] = 1;
      });
      mapped.forEach(function (o) {
        var w = o.o ? 0.5 : 1;
        o.mp.forEach(function (mid) {
          var row = rows[mid];
          if (!row) return;
          if (o.mp.length === 1) row.locked += w; else row.flex += w * 0.4;
          row.tasks[t.i] = 1;
          row.objs.push({ task: t, obj: o });
          (o.rk || []).forEach(function (k) { row.keys[k] = 1; });
        });
      });
      (t.keys || []).forEach(function (k) {
        if (rows[k.m]) k.k.forEach(function (name) { rows[k.m].keys[name] = 1; });
      });
      Object.keys(finishers).forEach(function (mid) { if (rows[mid]) rows[mid].finishes += 1; });
    });
    var out = Object.keys(rows).map(function (id) {
      var r = rows[id];
      r.score = r.finishes * 3 + r.locked + r.flex;
      r.rate = r.map.duration ? (r.score / r.map.duration) * 10 : 0;
      r.questCount = Object.keys(r.tasks).length;
      r.keyList = Object.keys(r.keys).sort();
      return r;
    }).filter(function (r) { return r.score > 0; });
    out.sort(function (a, b) {
      return S.sort === "rate" ? b.rate - a.rate || b.score - a.score : b.score - a.score;
    });
    return out;
  }

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function n1(x) { return Math.round(x * 10) / 10; }
  var toastTimer;
  function toast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2800);
  }

  function taskChips(t) {
    var c = ['<span class="chip' + (t.story ? " story" : "") + '">' + esc(t.tr || "—") + "</span>"];
    if (t.lvl > 0) c.push('<span class="chip">Lv ' + t.lvl + "</span>");
    if (t.f) c.push('<span class="chip crit">' + esc(t.f) + " only</span>");
    return c.join("");
  }

  function objExtras(o, currentMap) {
    var c = [];
    if (o.c) c.push('<span class="chip">x' + o.c + "</span>");
    if (o.o) c.push('<span class="chip">Optional</span>');
    if (o.fir) c.push('<span class="chip good">Found in raid</span>');
    if (o.any) c.push('<span class="chip">any of ' + o.any + " items</span>");
    (o.rk || []).forEach(function (k) { c.push('<span class="chip key">' + esc(k) + "</span>"); });
    if (o.mp && o.mp.length > 1) {
      var others = o.mp.filter(function (m) { return m !== currentMap; })
        .map(function (m) { return MAP_BY_ID[m] ? MAP_BY_ID[m].name : m; });
      if (others.length) c.push('<span class="chip">Also: ' + esc(others.join(", ")) + "</span>");
    }
    if (o.was) {
      var old = o.was.split(", ").map(function (m) { return MAP_BY_ID[m] ? MAP_BY_ID[m].name : m; }).join(", ");
      c.push('<span class="chip moved" title="tarkov.dev still files this objective under ' + esc(old) +
        ', along with the keys and coordinates from back then. The quest text in the game says otherwise, ' +
        'so the text wins.">moved from ' + esc(old) + "</span>");
    }
    if (o.ex) c.push('<span class="chip">Exit: ' + esc(o.ex) + "</span>");
    return c.join("");
  }

  // ---------- progress mutations ----------
  /** Returns how many quests the change touched, so the caller knows whether one row can be patched. */
  function setStatus(id, val) {
    var touched = 1;
    if (val === "d") {
      // finishing a quest means everything it required is finished too
      var stack = [id], guard = 0;
      touched = 0;
      while (stack.length && guard++ < 4000) {
        var cur = stack.pop();
        if (isDone(cur)) continue;
        S.marks[cur] = "d";
        touched++;
        var t = BY_ID[cur];
        if (t) t.req.forEach(function (r) { if (r.s.indexOf("complete") >= 0) stack.push(r.t); });
      }
    } else if (val === "a") {
      S.marks[id] = "a";
    } else {
      // un-finishing a quest un-finishes everything that needed it
      var wasDone = isDone(id);
      S.marks[id] = "";
      if (wasDone) {
        var stack2 = (DEPENDENTS[id] || []).slice(), guard2 = 0;
        while (stack2.length && guard2++ < 4000) {
          var c2 = stack2.pop();
          if (!isDone(c2)) continue;
          S.marks[c2] = "";
          touched++;
          (DEPENDENTS[c2] || []).forEach(function (d) { stack2.push(d); });
        }
      }
    }
    persist();
    resetMemo();
    return touched;
  }

  function updateDoneCount() {
    document.getElementById("done-count").textContent =
      TASKS.filter(function (t) { return isDone(t.i); }).length + " of " + TASKS.length + " quests marked complete.";
  }

  /** Repaint one quest row's controls without rebuilding the list. */
  function patchRow(id) {
    var seg = document.querySelector('#q-list .seg[data-id="' + id + '"]');
    if (!seg) return;
    var st = statusOf(id);
    [].forEach.call(seg.querySelectorAll("button"), function (b) {
      b.setAttribute("aria-pressed", String(b.getAttribute("data-set") === st));
    });
    var row = seg.closest(".qrow");
    if (row) row.classList.toggle("dim", !st && !isUnlocked(BY_ID[id]));
  }

  function setObjDone(oid, done) {
    if (done) S.objDone[oid] = 1; else delete S.objDone[oid];
    persist();
    // deliberately do not rebuild the map list — nothing should move under your cursor mid-raid
    dirty.board = dirty.map = dirty.setup = true;
  }

  // ---------- render: board ----------
  function renderBoard() {
    var ranked = scoreMaps();
    var scoped = scopedTasks();
    var openObjs = 0;
    scoped.forEach(function (t) {
      openObjs += openObjectives(t).filter(function (o) { return o.mp && o.mp.length; }).length;
    });
    var best = ranked[0];
    var journalCount = TASKS.filter(function (t) { return isActive(t.i) && !isIgnored(t.i); }).length;
    var ignoredCount = TASKS.filter(function (t) { return isIgnored(t.i); }).length;

    document.getElementById("tiles").innerHTML = [
      tile(journalCount,
        "quests marked active" + (ignoredCount ? " · " + ignoredCount + " ignored" : ""),
        "In your journal", true),
      tile(openObjs, "objectives still to do in raid", "Raid work left"),
      tile(best ? best.map.name : "—",
        best ? n1(best.score) + " points across " + best.questCount + " quest" + (best.questCount === 1 ? "" : "s") : "nothing to run",
        "Go here next", true),
      tile(best ? best.keyList.length : 0, best ? "to open everything on " + best.map.name : "no map selected", "Keys to bring")
    ].join("");

    // Story chapters are permanently in your journal, so on their own they tell us nothing about
    // your progress — and a board ranked off them alone recommends The Lab to a level 1 player.
    var traderActive = TASKS.filter(function (t) {
      return !t.story && isActive(t.i) && !isIgnored(t.i);
    }).length;
    var banner = document.getElementById("empty-banner");
    if (traderActive === 0) {
      banner.hidden = false;
      banner.innerHTML = (journalCount
        ? "This is ranking your story chapters and nothing else, so it leans late-game. "
        : "Nothing is in your journal yet. ") +
        'Point the board at your game logs in <button class="linkish" data-goto="setup">Setup</button> ' +
        'and it fills itself in, or tick quests by hand in ' +
        '<button class="linkish" data-goto="quests">Quests</button>.';
    } else {
      banner.hidden = true;
    }

    var max = ranked.length ? Math.max.apply(null, ranked.map(function (r) { return S.sort === "rate" ? r.rate : r.score; })) : 1;
    document.getElementById("rank").innerHTML = ranked.length ? ranked.map(function (r, i) {
      var val = S.sort === "rate" ? r.rate : r.score;
      var span = r.locked + r.flex || 1;
      var lockedW = (r.locked / span) * (val / max) * 100;
      var flexW = (r.flex / span) * (val / max) * 100;
      return '<button class="rank-row" data-map="' + esc(r.map.id) + '"' + (S.map === r.map.id ? ' aria-current="true"' : "") + ">" +
        '<span class="rank-n">' + (i + 1) + "</span>" +
        '<span><span class="rank-name">' + esc(r.map.name) + "</span>" +
        '<span class="rank-sub">' + r.questCount + " quest" + (r.questCount === 1 ? "" : "s") +
        (r.finishes ? " · " + r.finishes + " would finish" : "") +
        (r.keyList.length ? " · " + r.keyList.length + " key" + (r.keyList.length === 1 ? "" : "s") : "") +
        " · " + r.map.duration + " min</span></span>" +
        '<span class="bar-cell"><span class="bar" role="img" aria-label="' + n1(r.locked) + " points only here, " + n1(r.flex) + ' points shared">' +
        '<i class="a" style="width:' + Math.max(lockedW, r.locked ? 1.5 : 0) + '%"></i>' +
        '<i class="b" style="width:' + Math.max(flexW, r.flex ? 1.5 : 0) + '%"></i></span></span>' +
        '<span class="rank-score">' + n1(val) + "<em>" + (S.sort === "rate" ? "per 10 min" : "points") + "</em></span>" +
        "</button>";
    }).join("") : '<p class="empty">No raid objectives to score yet.</p>';

    document.getElementById("rank-note").textContent = ranked.length ? "Click a map to open its plan." : "";

    document.getElementById("score-tbl").innerHTML =
      "<thead><tr><th>Map</th><th>Quests</th><th>Would finish</th><th>Only here</th><th>Shared</th><th>Keys</th><th>Raid</th><th>Score</th><th>Per 10 min</th></tr></thead><tbody>" +
      ranked.map(function (r) {
        return "<tr><td>" + esc(r.map.name) + '</td><td class="n">' + r.questCount + '</td><td class="n">' + r.finishes +
          '</td><td class="n">' + n1(r.locked) + '</td><td class="n">' + n1(r.flex) + '</td><td class="n">' + r.keyList.length +
          '</td><td class="n">' + r.map.duration + 'm</td><td class="n">' + n1(r.score) + '</td><td class="n">' + n1(r.rate) + "</td></tr>";
      }).join("") + "</tbody>";

    renderFirList(scoped);

    if ((!S.map || !ranked.some(function (r) { return r.map.id === S.map; })) && ranked.length) S.map = ranked[0].map.id;
    return ranked;
  }

  /** Found-in-raid turn-ins across the quests in scope — map-independent loot to hoard. */
  function renderFirList(scoped) {
    var want = {};
    scoped.forEach(function (t) {
      openObjectives(t).forEach(function (o) {
        if (o.ty !== "giveItem" || !o.fir || !o.it) return;
        // several quests wanting the same item add up to one line with the total
        var name = o.it.length === 1 ? o.it[0] : "any of: " + o.it.join(" / ");
        var w = want[name] || (want[name] = { c: 0, tasks: [] });
        w.c += o.c || 1;
        if (w.tasks.indexOf(t.n) < 0) w.tasks.push(t.n);
      });
    });
    var rows = Object.keys(want)
      .map(function (n) { return { n: n, c: want[n].c, tasks: want[n].tasks }; })
      .sort(function (a, b) { return b.c - a.c || a.n.localeCompare(b.n); });

    document.getElementById("fir-n").textContent = rows.length ? rows.length + " items" : "";
    document.getElementById("fir-list").innerHTML = rows.length
      ? rows.map(function (r) {
        return '<span class="chip good" title="' + esc(r.tasks.join(", ")) + '">' +
          (r.c > 1 ? '<b class="qty">' + r.c + "&times;</b> " : "") + esc(r.n) + "</span>";
      }).join("")
      : '<span class="note">Nothing to hoard for the quests in scope.</span>';
  }

  function tile(v, sub, label, hi) {
    return '<div class="tile' + (hi ? " hi" : "") + '"><div class="lbl">' + esc(label) +
      '</div><div class="v">' + (typeof v === "string" ? esc(v) : v) + '</div><div class="s">' + esc(sub) + "</div></div>";
  }

  // ---------- render: map plan ----------
  function renderMap(ranked) {
    document.getElementById("mapsel").innerHTML = ranked.map(function (r) {
      return '<button class="chip" data-map="' + esc(r.map.id) + '" aria-pressed="' + (S.map === r.map.id) + '">' +
        esc(r.map.name) + " · " + n1(r.score) + "</button>";
    }).join("") || '<span class="note">Nothing to run right now.</span>';

    var row = ranked.filter(function (r) { return r.map.id === S.map; })[0];
    var lo = document.getElementById("loadout");
    var objsEl = document.getElementById("map-objs");

    if (!row) {
      lo.innerHTML = "";
      document.getElementById("map-card").hidden = true;
      objsEl.innerHTML = '<p class="empty">Mark some quests active first, then pick a map.</p>';
      document.getElementById("map-obj-h").textContent = "Objectives";
      document.getElementById("map-obj-n").textContent = "";
      return;
    }

    var groups = {};
    row.objs.forEach(function (x) {
      (groups[x.task.i] = groups[x.task.i] || { task: x.task, objs: [] }).objs.push(x.obj);
    });
    var list = Object.keys(groups).map(function (k) { return groups[k]; });
    list.sort(function (a, b) { return a.task.lvl - b.task.lvl || a.task.n.localeCompare(b.task.n); });

    // One shopping list per column: the same item wanted by three quests is one line of three.
    var bring = {}, loot = {}, questItems = {};
    function add(bucket, name, count) { bucket[name] = (bucket[name] || 0) + count; }

    list.forEach(function (g) {
      g.objs.forEach(function (o) {
        var c = o.c || 1;
        if (o.ty === "mark" && o.mk) add(bring, o.mk, c);
        if (o.ty === "plantItem" || o.ty === "plantQuestItem") {
          var its = o.it || [];
          if (its.length === 1) add(bring, its[0], c);
          else if (its.length > 1) add(bring, "any of: " + its.join(" / "), c);
        }
        if (o.ty === "findItem") {
          var f = o.it || [];
          var fir = o.fir ? " (found in raid)" : "";
          if (f.length === 1) add(loot, f[0] + fir, c);
          else if (f.length > 1) add(loot, "any of: " + f.join(" / ") + fir, c);
        }
        if (o.ty === "findQuestItem") questItems[o.d] = 1;
      });
    });

    lo.innerHTML =
      loCol("Keys to bring", row.keyList.map(function (k) { return { n: k, c: 1 }; })) +
      loCol("Gear to bring in", tally(bring)) +
      loCol("Loot to find", tally(loot)) +
      loCol("Quest items to grab", Object.keys(questItems).map(function (q) { return { n: q, c: 1 }; }));

    var numbers = numberObjectives(list, row.map);
    renderMapImage(row.map, list, numbers);

    document.getElementById("map-obj-h").textContent = row.map.name + " objectives";
    document.getElementById("map-obj-n").textContent =
      list.length + (list.length === 1 ? " quest · " : " quests · ") +
      row.objs.length + (row.objs.length === 1 ? " objective · " : " objectives · ") +
      row.map.duration + " min raid";

    var parked = ignoredForMap(row.map.id);
    objsEl.innerHTML =
      list.map(function (g) { return questGroup(g, row.map.id, numbers, false); }).join("") +
      (parked.length
        ? '<div class="parked-h">' + parked.length + (parked.length === 1 ? " ignored quest" : " ignored quests") +
          " on " + esc(row.map.name) + " — not counted anywhere</div>" +
          parked.map(function (g) { return questGroup(g, row.map.id, {}, true); }).join("")
        : "");
  }

  function questGroup(g, mapId, numbers, parked) {
    var t = g.task;
    return '<div class="grp' + (parked ? " grp-parked" : "") + '"><div class="grp-h"><span class="qn">' +
      (t.w ? '<a href="' + esc(t.w) + '" target="_blank" rel="noopener">' + esc(t.n) + "</a>" : esc(t.n)) +
      '</span><span class="chips">' + taskChips(t) +
      (parked
        ? '<button class="chip act unign" data-ignore="' + esc(t.i) + '" ' +
          'title="Count this quest again">Un-ignore</button>'
        : '<button class="chip act" data-finish="' + esc(t.i) + '">Mark done</button>' +
          '<button class="chip act ign" data-ignore="' + esc(t.i) + '" ' +
          'title="Park it — drops off the board and out of every map plan">Ignore</button>') +
      // a story chapter has its shots split up per objective, so the whole-page dump is only
      // worth offering on trader quests, where that is all the wiki gives us
      (t.story
        ? ""
        : '<button class="chip shotsb" data-shots="' + esc(t.i) + '" aria-pressed="false" ' +
          'title="Location screenshots from the wiki">Screenshots</button>') +
      "</span></div>" +
      g.objs.map(function (o) {
        var done = !!S.objDone[o.oi];
        var n = numbers[o.oi];
        var gd = guideBits(o, t.i);
        return '<div class="obj' + (done ? " done" : "") + (o.dp > 1 ? " sub" : "") +
          (o.hd ? " hd" : "") + '" data-row="' + esc(o.oi) + '">' +
          '<input class="tick" type="checkbox" data-obj="' + esc(o.oi) + '" id="o-' + esc(o.oi) + '"' +
          (done ? " checked" : "") + (parked ? " disabled" : "") + ">" +
          '<label for="o-' + esc(o.oi) + '"><span class="od">' +
          (n ? '<button class="pinno" data-pin="' + esc(o.oi) + '" title="Show on the map">' + n + "</button> " : "") +
          esc(o.d) + '</span><span class="oe">' + objExtras(o, mapId) + "</span></label>" +
          (gd.btn || "<span></span>") + "</div>" + gd.panel;
      }).join("") +
      (t.story ? "" : '<div class="shots" data-shots-for="' + esc(t.i) + '" hidden></div>') + "</div>";
  }

  /** Ignored quests that would otherwise be on this map — shown, but counted nowhere. */
  function ignoredForMap(mapId) {
    return TASKS.filter(function (t) {
      if (!isIgnored(t.i) || !inMode(t)) return false;
      return isActive(t.i);
    }).map(function (t) {
      var objs = openObjectives(t).filter(function (o) {
        return o.mp && o.mp.indexOf(mapId) >= 0;
      });
      return objs.length ? { task: t, objs: objs } : null;
    }).filter(Boolean).sort(function (a, b) {
      return a.task.lvl - b.task.lvl || a.task.n.localeCompare(b.task.n);
    });
  }

  // ---------- the map itself ----------
  // Game coordinates land on the vector map linearly: bounds[0] sits at the top-left of
  // the viewBox and bounds[1] at the bottom-right. Verified against every extract, spawn
  // and quest zone per map before this was built.
  function projector(map) {
    var b = map.bounds, W = map.vb[0], H = map.vb[1];
    var x0 = b[0][0], z0 = b[0][1], x1 = b[1][0], z1 = b[1][1];
    return function (x, z) {
      return [(x - x0) / (x1 - x0) * W, (z - z0) / (z1 - z0) * H];
    };
  }

  function geometryFor(o, mapId) {
    var zn = (o.zn || []).filter(function (g) { return g.m === mapId; });
    var sp = (o.sp || []).filter(function (g) { return g.m === mapId; });
    return zn.length || sp.length ? { zn: zn, sp: sp } : null;
  }

  /** Give every objective with geometry on this map a number, in list order. */
  function numberObjectives(list, map) {
    var numbers = {}, n = 0;
    if (!map.svg) return numbers;
    list.forEach(function (g) {
      g.objs.forEach(function (o) {
        if (geometryFor(o, map.id)) numbers[o.oi] = ++n;
      });
    });
    return numbers;
  }

  var svgCache = {};
  var mapToken = 0;
  var EXIT_LABEL_PX = 16;   // on-screen size of extract names, held constant through zoom

  function renderMapImage(map, list, numbers) {
    var card = document.getElementById("map-card");
    var wrap = document.getElementById("mapwrap");
    var hint = document.getElementById("map-hint");
    var count = Object.keys(numbers).length;

    if (!map.svg) {
      card.hidden = false;
      wrap.innerHTML = '<p class="empty">No map drawing exists for ' + esc(map.name) + " yet.</p>";
      hint.textContent = "";
      return;
    }
    card.hidden = false;
    hint.textContent = count
      ? count + (count === 1 ? " objective pinned" : " objectives pinned") + " · scroll to zoom, drag to pan"
      : "None of these objectives have a known location";

    var token = ++mapToken;
    var draw = function (svgText) {
      if (token !== mapToken) return;         // the user moved on to another map
      wrap.innerHTML = svgText;
      var svg = wrap.querySelector("svg");
      if (!svg) return;
      svg.removeAttribute("width");
      svg.removeAttribute("height");
      var W = map.vb[0], H = map.vb[1];
      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      svg.dataset.home = "0 0 " + W + " " + H;

      var unit = Math.max(W, H) / 110;        // keep pins the same visual size on every map
      var proj = projector(map);

      if (S.showExits !== false) drawExits(svg, map, proj, unit);

      var g = document.createElementNS("http://www.w3.org/2000/svg", "g");
      g.setAttribute("id", "pins");

      list.forEach(function (grp) {
        grp.objs.forEach(function (o) {
          var geo = geometryFor(o, map.id);
          if (!geo) return;
          var n = numbers[o.oi];
          var done = !!S.objDone[o.oi];
          // every piece of this pin answers "what am I pointing at?" on hover
          var tag = function (el) {
            el.dataset.pin = o.oi;
            el.dataset.tipq = grp.task.n;
            el.dataset.tipo = o.d;
          };
          var cx = 0, cy = 0, pts = 0;

          geo.zn.forEach(function (z) {
            var poly = z.pl.map(function (p) { return proj(p[0], p[1]); });
            var el = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
            el.setAttribute("points", poly.map(function (p) { return p[0].toFixed(1) + "," + p[1].toFixed(1); }).join(" "));
            el.setAttribute("class", "pin-zone" + (done ? " pin-done" : ""));
            el.setAttribute("stroke-width", (unit * 0.28).toFixed(2));
            tag(el);
            g.appendChild(el);
            poly.forEach(function (p) { cx += p[0]; cy += p[1]; pts++; });
          });
          geo.sp.forEach(function (sgroup) {
            sgroup.pt.forEach(function (p) {
              var q = proj(p[0], p[1]);
              var el = document.createElementNS("http://www.w3.org/2000/svg", "circle");
              el.setAttribute("cx", q[0].toFixed(1));
              el.setAttribute("cy", q[1].toFixed(1));
              el.setAttribute("r", (unit * 0.5).toFixed(2));
              el.setAttribute("class", "pin-spot" + (done ? " pin-done" : ""));
              el.setAttribute("stroke-width", (unit * 0.2).toFixed(2));
              tag(el);
              g.appendChild(el);
              cx += q[0]; cy += q[1]; pts++;
            });
          });

          if (!pts) return;
          cx /= pts; cy /= pts;
          var badge = document.createElementNS("http://www.w3.org/2000/svg", "g");
          badge.setAttribute("class", "pin-badge" + (done ? " pin-done" : ""));
          tag(badge);
          var disc = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          disc.setAttribute("cx", cx.toFixed(1));
          disc.setAttribute("cy", cy.toFixed(1));
          disc.setAttribute("r", (unit * 1.05).toFixed(2));
          disc.setAttribute("stroke-width", (unit * 0.18).toFixed(2));
          var label = document.createElementNS("http://www.w3.org/2000/svg", "text");
          label.setAttribute("x", cx.toFixed(1));
          label.setAttribute("y", cy.toFixed(1));
          label.setAttribute("font-size", (unit * 1.35).toFixed(2));
          label.textContent = n;
          badge.appendChild(disc);
          badge.appendChild(label);
          g.appendChild(badge);
        });
      });
      svg.appendChild(g);
    };

    if (svgCache[map.svg]) { draw(svgCache[map.svg]); return; }
    wrap.innerHTML = '<p class="empty">Loading ' + esc(map.name) + " …</p>";
    fetch("maps/" + map.svg)
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.text(); })
      .then(function (txt) { svgCache[map.svg] = txt; draw(txt); })
      .catch(function () {
        if (token !== mapToken) return;
        wrap.innerHTML = '<p class="empty">Could not load the ' + esc(map.name) +
          " drawing. Run the board with <code>node board.js</code> so it can serve the maps.</p>";
      });
  }

  /**
   * Extract names, so the quest pins have landmarks to sit between. Drawn under the pins
   * and deliberately quiet: this is context, not the thing you came to read.
   */
  function drawExits(svg, map, proj, unit) {
    var list = map.ex || [];
    if (!list.length && !(map.tr || []).length) return;
    var NS = "http://www.w3.org/2000/svg";
    var g = document.createElementNS(NS, "g");
    g.setAttribute("id", "exits");

    // Sort so that when two labels collide the PMC one is drawn last and stays readable.
    list.slice().sort(function (a, b) {
      return (a.f === "scav" ? 0 : 1) - (b.f === "scav" ? 0 : 1);
    }).forEach(function (e) {
      var q = proj(e.x, e.z);
      var scav = e.f === "scav";
      var item = document.createElementNS(NS, "g");
      item.setAttribute("class", "exit" + (scav ? " exit-scav" : ""));

      var mark = document.createElementNS(NS, "circle");
      mark.setAttribute("cx", q[0].toFixed(1));
      mark.setAttribute("cy", q[1].toFixed(1));
      mark.setAttribute("class", "exit-mark");

      var label = document.createElementNS(NS, "text");
      label.setAttribute("x", q[0].toFixed(1));   // nudged off the marker by scaleExitLabels
      label.setAttribute("y", q[1].toFixed(1));
      label.setAttribute("class", "exit-label");
      label.dataset.x = q[0].toFixed(1);
      // near the right edge the name would run off the drawing, so hang it to the left instead
      if (q[0] > map.vb[0] * 0.74) {
        label.dataset.flip = "1";
        label.setAttribute("text-anchor", "end");
      }
      label.textContent = e.n;

      item.appendChild(mark);
      item.appendChild(label);
      var title = document.createElementNS(NS, "title");
      title.textContent = e.n + " — " + (scav ? "scav exit" : e.f === "pmc" ? "PMC exit" : "either side");
      item.appendChild(title);
      g.appendChild(item);
    });

    (map.tr || []).forEach(function (t) {
      var q = proj(t.x, t.z);
      var item = document.createElementNS(NS, "g");
      item.setAttribute("class", "exit exit-transit");

      var mark = document.createElementNS(NS, "circle");
      mark.setAttribute("cx", q[0].toFixed(1));
      mark.setAttribute("cy", q[1].toFixed(1));
      mark.setAttribute("class", "exit-mark");

      var label = document.createElementNS(NS, "text");
      label.setAttribute("x", q[0].toFixed(1));
      label.setAttribute("y", q[1].toFixed(1));
      label.setAttribute("class", "exit-label");
      label.dataset.x = q[0].toFixed(1);
      if (q[0] > map.vb[0] * 0.74) {
        label.dataset.flip = "1";
        label.setAttribute("text-anchor", "end");
      }
      label.textContent = "→ " + t.n;

      var tip = document.createElementNS(NS, "title");
      tip.textContent = "Transit to " + t.n;
      item.appendChild(mark);
      item.appendChild(label);
      item.appendChild(tip);
      g.appendChild(item);
    });

    svg.appendChild(g);
    // Everything here is drawn in map units, which means it would shrink and grow with the
    // zoom. Size it against the rendered width instead so it stays put on screen.
    var shown = svg.getBoundingClientRect().width || 700;
    g.dataset.base = (EXIT_LABEL_PX * (map.vb[0] / shown)).toFixed(4);
    scaleExitLabels(svg);
  }

  /** Hold the extract names, their halos and their markers at a fixed on-screen size. */
  function scaleExitLabels(svg) {
    var g = svg && svg.querySelector("#exits");
    if (!g || !g.dataset.base) return;
    var vb = svg.getAttribute("viewBox").trim().split(/[\s,]+/).map(Number);
    var home = svg.dataset.home.trim().split(/[\s,]+/).map(Number);
    if (!vb[2] || !home[2]) return;

    var size = parseFloat(g.dataset.base) * (vb[2] / home[2]);
    g.style.fontSize = size.toFixed(3) + "px";

    [].forEach.call(g.querySelectorAll(".exit-mark"), function (m) {
      m.setAttribute("r", (size * 0.3).toFixed(2));
      m.setAttribute("stroke-width", (size * 0.09).toFixed(2));
    });
    [].forEach.call(g.querySelectorAll(".exit-label"), function (t) {
      t.setAttribute("stroke-width", (size * 0.22).toFixed(2));
      var off = t.dataset.flip ? -size * 0.5 : size * 0.5;
      t.setAttribute("x", (parseFloat(t.dataset.x) + off).toFixed(1));
    });
  }

  /** Tick an objective off and its pin leaves the map; untick and it comes back. */
  function setPinVisible(oid, visible) {
    var wrap = document.getElementById("mapwrap");
    var pins = wrap.querySelectorAll('[data-pin="' + oid + '"]');
    if (!pins.length) return;
    [].forEach.call(pins, function (el) {
      el.classList.toggle("pin-off", !visible);
      if (!visible) el.classList.remove("hot");
    });
    var left = wrap.querySelectorAll(".pin-badge:not(.pin-off)").length;
    var hint = document.getElementById("map-hint");
    if (hint && hint.textContent) {
      hint.textContent = left
        ? left + (left === 1 ? " objective pinned" : " objectives pinned") + " · scroll to zoom, drag to pan"
        : "Everything here is ticked off";
    }
  }

  function highlightPin(oid, scrollIntoView) {
    var wrap = document.getElementById("mapwrap");
    [].forEach.call(wrap.querySelectorAll(".hot"), function (el) { el.classList.remove("hot"); });
    [].forEach.call(wrap.querySelectorAll('[data-pin="' + oid + '"]'), function (el) {
      el.classList.add("hot");
      el.parentNode.appendChild(el);            // bring the highlighted pin to the front
    });
    if (scrollIntoView) {
      var card = document.getElementById("map-card");
      if (card) card.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }

  /** Biggest quantities first — that is the part you have to go and stock up on. */
  function tally(bucket) {
    return Object.keys(bucket)
      .map(function (n) { return { n: n, c: bucket[n] }; })
      .sort(function (a, b) { return b.c - a.c || a.n.localeCompare(b.n); });
  }

  function loCol(title, items) {
    return '<div class="lo"><h3>' + esc(title) + "</h3>" + (items.length
      ? "<ul>" + items.map(function (i) {
        return "<li>" + (i.c > 1 ? '<b class="qty">' + i.c + "&times;</b> " : "") + esc(i.n) + "</li>";
      }).join("") + "</ul>"
      : '<p class="none">Nothing needed</p>') + "</div>";
  }

  // ---------- render: quests ----------
  function renderQuests() {
    var q = document.getElementById("q-search").value.trim().toLowerCase();
    var trader = document.getElementById("q-trader").value;
    var map = document.getElementById("q-map").value;
    var status = document.getElementById("q-status").value;

    var rows = TASKS.filter(function (t) {
      if (!inMode(t)) return false;
      if (trader && t.tr !== trader) return false;
      if (map && t.maps.indexOf(map) < 0) return false;
      if (status === "done" && !isDone(t.i)) return false;
      if (status === "failed" && !isFailed(t.i)) return false;
      if (status === "active" && !isActive(t.i)) return false;
      if (status === "unlocked" && !isUnlocked(t)) return false;
      if (status === "locked" && (isDone(t.i) || isUnlocked(t))) return false;
      if (status === "ignored" && !isIgnored(t.i)) return false;
      // ignored quests are parked, so keep them out of the everyday lists unless asked for
      if (status !== "ignored" && status !== "all" && isIgnored(t.i)) return false;
      if (q) {
        var hay = (t.n + " " + (t.tr || "") + " " + t.obj.map(function (o) { return o.d; }).join(" ")).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    rows.sort(function (a, b) { return (a.tr || "").localeCompare(b.tr || "") || a.lvl - b.lvl || a.n.localeCompare(b.n); });

    document.getElementById("q-count").textContent = rows.length + " quests";
    updateDoneCount();
    var shown = rows.slice(0, 300);
    document.getElementById("q-list").innerHTML = rows.length ? shown.map(function (t) {
      var st = statusOf(t.i);
      var allMaps = t.maps.map(function (m) { return MAP_BY_ID[m] ? MAP_BY_ID[m].name : m; });
      // a quest doable on eight maps would otherwise stretch the row off the screen
      var maps = allMaps.length > 3 ? allMaps.slice(0, 3).concat("+" + (allMaps.length - 3)) : allMaps;
      var locked = !st && !isUnlocked(t);
      var ign = isIgnored(t.i);
      return '<div class="qrow' + (locked || ign ? " dim" : "") + '">' +
        '<div><div class="qn">' + esc(t.n) + "</div>" +
        '<div class="qmeta">' + taskChips(t) +
        (maps.length ? '<span class="chip" title="' + esc(allMaps.join(", ")) + '">' + esc(maps.join(" / ")) + "</span>" : "") +
        (locked ? '<span class="chip">Locked</span>' : "") +
        (ign ? '<span class="chip warnc">Ignored</span>' : "") +
        (isFailed(t.i) ? '<span class="chip crit" title="the game logged this as failed">Failed</span>' : "") +
        (isOverridden(t.i) ? '<span class="chip crit" title="you set this by hand; the game logs say otherwise">manual</span>' : "") +
        (t.w ? '<a class="chip" href="' + esc(t.w) + '" target="_blank" rel="noopener">Wiki</a>' : "") +
        "</div></div>" +
        '<div class="seg" role="group" data-id="' + esc(t.i) + '" aria-label="' + esc(t.n) + ' status">' +
        segBtn(t.i, "", "Not started", st === "") +
        segBtn(t.i, "a", "Active", st === "a") +
        segBtn(t.i, "d", "Done", st === "d") +
        "</div>" +
        '<button class="chip act ign" data-ignore="' + esc(t.i) + '" aria-pressed="' + ign + '" ' +
        'title="' + (ign ? "Count this quest again" : "Park it — keeps the quest but drops it from the board and map plans") + '">' +
        (ign ? "Un-ignore" : "Ignore") + "</button></div>";
    }).join("") + (rows.length > shown.length ? '<p class="empty">Showing the first ' + shown.length + ". Narrow the search to see the rest.</p>" : "")
      : '<p class="empty">No quests match those filters.</p>';
  }

  function toggleIgnore(id) {
    if (S.ignored[id]) delete S.ignored[id]; else S.ignored[id] = 1;
    persist(); resetMemo();
    dirty.board = dirty.map = dirty.setup = true;
    return !!S.ignored[id];
  }

  function segBtn(id, val, label, on) {
    return '<button data-task="' + esc(id) + '" data-set="' + val + '" aria-pressed="' + on + '">' + label + "</button>";
  }

  // ---------- render: setup ----------
  function renderSetup() {
    document.getElementById("s-lvl").value = S.level;
    document.getElementById("s-faction").value = S.faction;
    var done = TASKS.filter(function (t) { return isDone(t.i); }).length;
    var active = TASKS.filter(function (t) { return isActive(t.i); }).length;
    document.getElementById("storage-note").textContent = storageOK
      ? active + " quests active, " + done + " completed. Progress saves in this browser as you click."
      : "This page cannot save to browser storage here — copy a backup before closing the tab.";

    var marks = Object.keys(S.marks).length;
    var c = logCounts();
    var canPick = !!(window.RaidLogs && RaidLogs.supported);
    var connect = document.getElementById("s-connect");
    var forget = document.getElementById("s-forget");
    if (connect) connect.hidden = SOURCE === "server" || !canPick;
    if (forget) forget.hidden = SOURCE !== "folder";

    document.getElementById("log-state").textContent =
      SOURCE === "folder" ? "Reading your Logs folder" : SOURCE === "server" ? "Connected" : "Not connected";

    var journal = SOURCE
      ? "<strong>" + c.active + " active</strong>, <strong>" + c.done + " completed</strong>" +
        (c.failed ? " and <strong>" + c.failed + " failed</strong>" : "") + " quests" +
        (LIVE && LIVE.sessions ? " across " + LIVE.sessions + " game sessions" : "") +
        (c.unknown ? " (plus " + c.unknown + " retired or event quests this board does not list)" : "") + ".<br><br>" +
        "The logs only reach as far back as the folders the game has kept, so anything you finished " +
        "before then shows as not started. Fix those by hand in Quests — your changes always win over " +
        "the logs" + (marks ? " (" + marks + " set so far)" : "") + "."
      : "";

    document.getElementById("log-note").innerHTML =
      SOURCE === "server"
        ? "Read straight from Escape from Tarkov's own log files by the local watcher, which keeps " +
          "reading in the background whether or not this tab is open. " + journal
      : SOURCE === "folder"
        ? "This tab is reading your Logs folder directly. Nothing is uploaded — there is no server to " +
          "upload to. It reads while the tab is open, so leave it open during a session. " + journal
      : canPick
        ? "Point the board at your Escape from Tarkov <code>Logs</code> folder and it fills in your " +
          "journal from the game's own files. You pick the folder once; the browser remembers it. " +
          "It is opened read-only and nothing leaves your machine."
        : "This browser cannot open a folder, so your journal has to be ticked by hand in Quests. " +
          "Chrome and Edge can do it, and the downloadable version works in any browser.";
    document.getElementById("s-follow").setAttribute("aria-pressed", String(!!S.autoFollow));
    document.getElementById("prov").innerHTML =
      "Quests, maps, keys and objectives come from <a href=\"https://tarkov.dev\" target=\"_blank\" rel=\"noopener\">tarkov.dev</a>, pulled " +
      esc(new Date(DATA.generated).toLocaleDateString()) + ": <strong>" + TASKS.length + " quests</strong>, " +
      TASKS.reduce(function (s, t) { return s + t.obj.length; }, 0) + " objectives, " + MAPS.length + " maps. " +
      "Both PVP and PVE are included — about 25 quests each way are exclusive to one mode, " +
      "and the Mode control in the header switches between them." +
      "<br><br>Story chapters and the guides behind every Guide button come from the " +
      "<a href=\"https://escapefromtarkov.fandom.com\" target=\"_blank\" rel=\"noopener\">Escape from Tarkov Wiki</a>, " +
      "used under CC BY-SA." +
      "<br><br><strong>One gap worth knowing.</strong> " +
      (HEALTH.chainsMissing || 0) + " quests are missing their unlock chain upstream, mostly ones added recently. " +
      "That only weakens the <em>Still gated</em> filter and the cascade when you mark a quest done — " +
      "what is in your journal comes from your own logs and is unaffected.";
  }

  // ---------- guides, fetched only when opened ----------
  // Core ships two numbers per objective — is there text, how many pictures — which is all the
  // button needs. The words and the screenshot list live in one file per quest, so the 500-odd
  // quests nobody opens on a given visit cost nothing.
  var guideCache = {};

  function loadGuides(taskId) {
    if (guideCache[taskId]) return Promise.resolve(guideCache[taskId]);
    return fetch("guides/" + encodeURIComponent(taskId) + ".json", { cache: "force-cache" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("no guide file")); })
      .then(function (d) { guideCache[taskId] = d; return d; });
  }

  /** The button, plus the empty shell its content drops into once fetched. */
  function guideBits(o, taskId) {
    if (!o.gt && !o.gn) return { btn: "", panel: "" };
    return {
      btn: '<button class="guideb" data-guide="' + esc(o.oi) + '" data-task="' + esc(taskId) + '" ' +
        'aria-pressed="false" title="What to do and where">Guide' + (o.gn ? " · " + o.gn : "") + "</button>",
      panel: '<div class="guide" data-guide-for="' + esc(o.oi) + '" hidden></div>'
    };
  }

  /** Where one item this objective wants actually spawns, off the item's own wiki page. */
  function itemGuide(x) {
    return '<div class="ig"><p class="ig-n">' + esc(x.n) + "</p>" +
      (x.g ? '<p class="guide-text">' + esc(x.g) + "</p>" : "") +
      (x.sh && x.sh.length ? '<div class="shots" data-shots-for="' + esc(x.oi) + '"></div>' : "") +
      "</div>";
  }

  function drawGuide(box, oid, g) {
    var items = g.ig || [];
    var html =
      (g.g ? '<p class="guide-text">' + esc(g.g) + "</p>" : "") +
      (g.sh && g.sh.length ? '<div class="shots" data-shots-for="' + esc(oid) + '"></div>' : "") +
      items.map(itemGuide).join("");
    box.innerHTML = html || '<p class="shots-note">Nothing written for this one.</p>';
    // pictures come from the local server, which caches them; hosted there is none yet
    [].forEach.call(box.querySelectorAll("[data-shots-for]"), function (grid) {
      grid.innerHTML = '<p class="shots-note">Fetching the screenshots …</p>';
      fetch("api/wiki?task=" + encodeURIComponent(grid.getAttribute("data-shots-for")))
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("no server")); })
        .then(function (d) { drawShots(grid, d); })
        .catch(function () {
          grid.innerHTML = '<p class="shots-note">Screenshots need the downloadable version for now.</p>';
        });
    });
  }

  function toggleGuide(oid, taskId, btn) {
    var box = document.querySelector('[data-guide-for="' + oid + '"]');
    if (!box) return;
    var opening = box.hidden;
    box.hidden = !opening;
    btn.setAttribute("aria-pressed", opening ? "true" : "false");
    if (!opening || box.dataset.loaded) return;
    box.dataset.loaded = "1";
    box.innerHTML = '<p class="shots-note">Loading …</p>';
    loadGuides(taskId)
      .then(function (d) { drawGuide(box, oid, (d.o && d.o[oid]) || (d.x && d.x[oid]) || {}); })
      .catch(function () {
        box.dataset.loaded = "";
        box.innerHTML = '<p class="shots-note">Could not load this guide.</p>';
      });
  }

  // ---------- story chapters ----------
  // Ticked entirely by hand: the wiki knows what the objectives are, the logs never say how far
  // through them you are. Scoring is the ordinary rule — only objectives that name a map count.
  function storyChapters() {
    return TASKS.filter(function (t) { return t.story; });
  }

  function storyProgress(t) {
    var real = t.obj.filter(function (o) { return !o.hd; });
    var done = real.filter(function (o) { return !!S.objDone[o.oi]; }).length;
    return { done: done, total: real.length, pct: real.length ? Math.round((done / real.length) * 100) : 0 };
  }

  function storyExtras(o) {
    var c = [];
    if (o.c) c.push('<span class="chip">x' + o.c + "</span>");
    if (o.o) c.push('<span class="chip">Optional</span>');
    (o.mp || []).forEach(function (m) {
      c.push('<span class="chip">' + esc(MAP_BY_ID[m] ? MAP_BY_ID[m].name : m) + "</span>");
    });
    return c.join("");
  }

  function storyCard(t) {
    var p = storyProgress(t);
    var ign = isIgnored(t.i);
    var fin = isDone(t.i);
    var extras = t.gx || [];
    var items = t.ix || [];
    return '<div class="card story-card' + (ign ? " grp-parked" : "") + '" data-chapter="' + esc(t.i) + '">' +
      '<div class="card-h"><h2>' + esc(t.n) + "</h2>" +
      '<span class="sp lbl story-count">' + p.done + " / " + p.total + "</span>" +
      '<button class="chip act" data-chapdone="' + esc(t.i) + '">' +
        (fin ? "Mark unfinished" : "Mark finished") + "</button>" +
      '<button class="chip act ' + (ign ? "unign" : "ign") + '" data-ignore="' + esc(t.i) + '">' +
        (ign ? "Un-ignore" : "Ignore") + "</button>" +
      (t.w ? '<a class="chip" href="' + esc(t.w) + '" target="_blank" rel="noopener">Wiki</a>' : "") +
      "</div>" +
      '<div class="story-bar"><i style="width:' + p.pct + '%"></i></div>' +
      '<div class="story-objs">' + t.obj.map(function (o) {
        var d = !!S.objDone[o.oi];
        var gd = guideBits(o, t.i);
        return '<div class="obj' + (d ? " done" : "") + (o.dp > 1 ? " sub" : "") + (o.hd ? " hd" : "") +
          '" data-srow="' + esc(o.oi) + '">' +
          (o.hd
            ? "<span></span>"
            : '<input class="tick" type="checkbox" data-obj="' + esc(o.oi) + '" id="s-' + esc(o.oi) + '"' +
              (d ? " checked" : "") + (ign ? " disabled" : "") + ">") +
          (o.hd ? "<label>" : '<label for="s-' + esc(o.oi) + '">') +
          '<span class="od">' + esc(o.d) + '</span><span class="oe">' + storyExtras(o) + "</span></label>" +
          (gd.btn || "<span></span>") + "</div>" + gd.panel;
      }).join("") + "</div>" +
      // guide sections the wiki writes against no single objective — kept rather than guessed at
      (extras.length
        ? '<div class="story-extra"><p class="lbl">Also in the guide</p>' + extras.map(function (x) {
            var gd = guideBits({ oi: x.oi, gt: x.gt, gn: x.gn }, t.i);
            return '<div class="obj"><span></span><label><span class="od">' + esc(x.h) +
              '</span><span class="oe"></span></label>' + (gd.btn || "<span></span>") + "</div>" + gd.panel;
          }).join("") + "</div>"
        : "") +
      // items the chapter needs whose directions live on the item's own page
      (items.length
        ? '<div class="story-extra"><p class="lbl">Where to find the items</p>' + items.map(function (x) {
            var gd = guideBits({ oi: x.oi, gt: x.gt, gn: x.gn }, t.i);
            return '<div class="obj"><span></span><label><span class="od">' + esc(x.n) +
              '</span><span class="oe"></span></label>' + (gd.btn || "<span></span>") + "</div>" + gd.panel;
          }).join("") + "</div>"
        : "") +
      "</div>";
  }

  function renderStory() {
    var list = storyChapters();
    var el = document.getElementById("story-list");
    var note = document.getElementById("story-note");
    if (!list.length) {
      el.innerHTML = '<div class="card"><p class="empty">No story chapters in this dataset — ' +
        "run <code>node build.js --refresh</code> to pull them from the wiki.</p></div>";
      note.textContent = "";
      return;
    }
    var done = 0, total = 0;
    list.forEach(function (t) { var p = storyProgress(t); done += p.done; total += p.total; });
    note.textContent = done + " of " + total + " ticked · " + list.length + " chapters";
    el.innerHTML = list.map(storyCard).join("");
  }

  /** Just the bar and the count — re-rendering 461 rows because one box was ticked is silly. */
  function patchStoryCard(card) {
    var t = BY_ID[card.getAttribute("data-chapter")];
    if (!t) return;
    var p = storyProgress(t);
    card.querySelector(".story-count").textContent = p.done + " / " + p.total;
    card.querySelector(".story-bar i").style.width = p.pct + "%";
    var list = storyChapters(), done = 0, total = 0;
    list.forEach(function (x) { var q = storyProgress(x); done += q.done; total += q.total; });
    document.getElementById("story-note").textContent =
      done + " of " + total + " ticked · " + list.length + " chapters";
  }

  document.getElementById("story-list").addEventListener("change", function (e) {
    var c = e.target.closest("[data-obj]");
    if (!c) return;
    setObjDone(c.getAttribute("data-obj"), c.checked);
    var row = c.closest(".obj");
    if (row) row.classList.toggle("done", c.checked);
    var card = c.closest(".story-card");
    if (card) patchStoryCard(card);
  });

  document.getElementById("story-list").addEventListener("click", function (e) {
    var gb = e.target.closest("[data-guide]");
    if (gb) { e.preventDefault(); toggleGuide(gb.getAttribute("data-guide"), gb.getAttribute("data-task"), gb); return; }
    var sb = e.target.closest("[data-shots]");
    if (sb) { e.preventDefault(); toggleShots(sb.getAttribute("data-shots"), sb); return; }
    var ig = e.target.closest("[data-ignore]");
    if (ig) {
      var iid = ig.getAttribute("data-ignore");
      var nowIgnored = toggleIgnore(iid);
      dirty.quests = true;
      renderStory();
      var it = BY_ID[iid];
      toast(nowIgnored
        ? "Ignoring " + (it ? it.n : "chapter") + " — it will not count until you un-ignore it"
        : "Counting " + (it ? it.n : "chapter") + " again");
      return;
    }
    var fb = e.target.closest("[data-chapdone]");
    if (!fb) return;
    var fid = fb.getAttribute("data-chapdone");
    setStatus(fid, isDone(fid) ? "a" : "d");
    dirty.board = dirty.map = dirty.quests = dirty.setup = true;
    renderStory();
    toast(isDone(fid) ? "Chapter marked finished" : "Chapter back in your journal");
  });

  // ---------- render scheduling ----------
  // 517 quests is too many to repaint on every click, so each view repaints when it is shown
  var dirty = { board: true, map: true, quests: true, story: true, setup: true };
  var currentTab = "board";

  function renderCurrent() {
    resetMemo();
    if (currentTab === "board" || currentTab === "map") {
      if (dirty.board || dirty.map) {
        var ranked = renderBoard();
        renderMap(ranked);
        dirty.board = dirty.map = false;
      }
    }
    if (currentTab === "quests" && dirty.quests) { renderQuests(); dirty.quests = false; }
    if (currentTab === "story" && dirty.story) { renderStory(); dirty.story = false; }
    if (currentTab === "setup" && dirty.setup) { renderSetup(); dirty.setup = false; }
  }

  function renderAll() {
    dirty.board = dirty.map = dirty.quests = dirty.story = dirty.setup = true;
    renderCurrent();
  }

  // ---------- events ----------
  function tab(name) {
    currentTab = name;
    ["board", "map", "quests", "story", "setup"].forEach(function (n) {
      document.getElementById("tab-" + n).setAttribute("aria-selected", String(n === name));
      document.getElementById("v-" + n).hidden = n !== name;
    });
    renderCurrent();
  }
  ["board", "map", "quests", "story", "setup"].forEach(function (n) {
    document.getElementById("tab-" + n).addEventListener("click", function () { tab(n); });
  });

  function setLevel(v) {
    S.level = Math.max(1, Math.min(79, parseInt(v, 10) || 1));
    document.getElementById("lvl").value = S.level;
    document.getElementById("s-lvl").value = S.level;
    persist(); renderAll();
  }
  document.getElementById("lvl").addEventListener("input", function () { setLevel(this.value); });
  document.getElementById("s-lvl").addEventListener("input", function () { setLevel(this.value); });

  function setGameMode(v) {
    S.gameMode = v === "pve" ? "pve" : "pvp";
    document.getElementById("gamemode").value = S.gameMode;
    persist(); resetMemo(); renderAll();
  }
  document.getElementById("gamemode").addEventListener("change", function () { setGameMode(this.value); });

  function setFaction(v) {
    S.faction = v;
    document.getElementById("faction").value = v;
    document.getElementById("s-faction").value = v;
    persist(); renderAll();
  }
  document.getElementById("faction").addEventListener("change", function () { setFaction(this.value); });
  document.getElementById("s-faction").addEventListener("change", function () { setFaction(this.value); });

  document.getElementById("theme").addEventListener("change", function () {
    S.theme = this.value;
    if (S.theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", S.theme);
    persist();
  });

  function setSort(v) {
    S.sort = v;
    document.getElementById("sort-total").setAttribute("aria-pressed", String(v === "total"));
    document.getElementById("sort-rate").setAttribute("aria-pressed", String(v === "rate"));
    persist(); renderAll();
  }
  document.getElementById("sort-total").addEventListener("click", function () { setSort("total"); });
  document.getElementById("sort-rate").addEventListener("click", function () { setSort("rate"); });

  document.getElementById("empty-banner").addEventListener("click", function (e) {
    var b = e.target.closest("[data-goto]");
    if (b) tab(b.dataset.goto);
  });

  document.getElementById("rank").addEventListener("click", function (e) {
    var b = e.target.closest("[data-map]");
    if (!b) return;
    S.map = b.getAttribute("data-map"); persist(); renderAll(); tab("map");
  });
  document.getElementById("mapsel").addEventListener("click", function (e) {
    var b = e.target.closest("[data-map]");
    if (!b) return;
    S.map = b.getAttribute("data-map"); persist(); renderAll();
  });
  // ---------- map pan / zoom ----------
  (function () {
    var wrap = document.getElementById("mapwrap");

    function vb(svg) { return svg.getAttribute("viewBox").split(/[\s,]+/).map(Number); }
    function setVb(svg, v) { svg.setAttribute("viewBox", v.join(" ")); }

    wrap.addEventListener("wheel", function (e) {
      var svg = wrap.querySelector("svg");
      if (!svg) return;
      e.preventDefault();
      var v = vb(svg);
      var rect = svg.getBoundingClientRect();
      var fx = (e.clientX - rect.left) / rect.width;
      var fy = (e.clientY - rect.top) / rect.height;
      var k = e.deltaY < 0 ? 0.82 : 1 / 0.82;
      var home = svg.dataset.home.split(" ").map(Number);
      var nw = Math.min(home[2], Math.max(home[2] / 40, v[2] * k));
      var nh = nw * (home[3] / home[2]);
      setVb(svg, [v[0] + (v[2] - nw) * fx, v[1] + (v[3] - nh) * fy, nw, nh]);
      scaleExitLabels(svg);
    }, { passive: false });

    var drag = null;
    wrap.addEventListener("pointerdown", function (e) {
      var svg = wrap.querySelector("svg");
      if (!svg || e.target.closest("[data-pin]")) return;
      drag = { x: e.clientX, y: e.clientY, v: vb(svg), rect: svg.getBoundingClientRect() };
      wrap.classList.add("dragging");
      wrap.setPointerCapture(e.pointerId);
    });
    wrap.addEventListener("pointermove", function (e) {
      if (!drag) return;
      var svg = wrap.querySelector("svg");
      if (!svg) return;
      var dx = (e.clientX - drag.x) / drag.rect.width * drag.v[2];
      var dy = (e.clientY - drag.y) / drag.rect.height * drag.v[3];
      setVb(svg, [drag.v[0] - dx, drag.v[1] - dy, drag.v[2], drag.v[3]]);
    });
    function endDrag() { drag = null; wrap.classList.remove("dragging"); }
    wrap.addEventListener("pointerup", endDrag);
    wrap.addEventListener("pointercancel", endDrag);

    wrap.addEventListener("click", function (e) {
      var el = e.target.closest("[data-pin]");
      if (!el) return;
      var oid = el.dataset.pin;
      highlightPin(oid, false);
      var row = document.querySelector('#map-objs [data-row="' + oid + '"]');
      if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    });

    document.getElementById("map-exits").addEventListener("click", function () {
      S.showExits = S.showExits === false;
      this.setAttribute("aria-pressed", String(S.showExits));
      persist();
      dirty.map = true;
      renderCurrent();
    });

    document.getElementById("map-fit").addEventListener("click", function () {
      var svg = wrap.querySelector("svg");
      if (svg) { svg.setAttribute("viewBox", svg.dataset.home); scaleExitLabels(svg); }
    });
  })();

  document.getElementById("map-objs").addEventListener("click", function (e) {
    var gb = e.target.closest("[data-guide]");
    if (gb) { e.preventDefault(); toggleGuide(gb.getAttribute("data-guide"), gb.getAttribute("data-task"), gb); return; }
    var sb = e.target.closest("[data-shots]");
    if (sb) { e.preventDefault(); toggleShots(sb.getAttribute("data-shots"), sb); return; }
    var p = e.target.closest("[data-pin]");
    if (p) { e.preventDefault(); highlightPin(p.dataset.pin, true); }
  });

  // ---------- wiki location screenshots ----------
  // The server fetches these once and keeps them on disk, so the page never talks to the
  // wiki itself and they still work the next time with no connection.
  function toggleShots(id, btn) {
    var box = document.querySelector('[data-shots-for="' + id + '"]');
    if (!box) return;
    var opening = box.hidden;
    box.hidden = !opening;
    btn.setAttribute("aria-pressed", opening ? "true" : "false");
    if (!opening || box.dataset.loaded) return;
    box.dataset.loaded = "1";
    box.innerHTML = '<p class="shots-note">Fetching from the wiki …</p>';
    fetch("api/wiki?task=" + encodeURIComponent(id))
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("no server")); })
      .then(function (d) { drawShots(box, d); })
      .catch(function () {
        box.dataset.loaded = "";
        box.innerHTML = '<p class="shots-note">Could not reach the wiki. Try again when you are online.</p>';
      });
  }

  function drawShots(box, d) {
    if (!d.shots || !d.shots.length) {
      box.innerHTML = '<p class="shots-note">The wiki has no location shots for this one.</p>';
      return;
    }
    box.innerHTML = '<div class="shots-grid">' + d.shots.map(function (s) {
      return '<a href="wiki/' + esc(s.f) + '" target="_blank" rel="noopener" title="Open full size">' +
        '<img src="wiki/' + esc(s.f) + '" alt="' + esc(s.n) + '">' +
        '<span class="shots-cap">' + esc(s.n) + "</span></a>";
    }).join("") + "</div>";
  }

  // ---------- what you are pointing at on the map ----------
  (function () {
    var wrap = document.getElementById("mapwrap");
    var card = document.getElementById("map-card");
    var tip = document.getElementById("pintip");
    if (!wrap || !card || !tip) return;

    wrap.addEventListener("mousemove", function (e) {
      var p = wrap.classList.contains("dragging") ? null : e.target.closest("[data-pin]");
      if (!p || !p.dataset.tipo) { tip.hidden = true; return; }
      if (tip.dataset.forpin !== p.dataset.pin) {
        tip.dataset.forpin = p.dataset.pin;
        tip.innerHTML = "<b>" + esc(p.dataset.tipq) + "</b>" + esc(p.dataset.tipo);
      }
      tip.hidden = false;                       // unhide before measuring, or it has no size
      var r = card.getBoundingClientRect();
      var x = e.clientX - r.left + 16;
      var y = e.clientY - r.top + 16;
      if (x + tip.offsetWidth > r.width - 8) x = e.clientX - r.left - tip.offsetWidth - 16;
      if (y + tip.offsetHeight > r.height - 8) y = e.clientY - r.top - tip.offsetHeight - 16;
      tip.style.left = Math.max(8, x) + "px";
      tip.style.top = Math.max(8, y) + "px";
    });
    wrap.addEventListener("mouseleave", function () { tip.hidden = true; });
    wrap.addEventListener("mousedown", function () { tip.hidden = true; });
  })();

  document.getElementById("map-objs").addEventListener("change", function (e) {
    var c = e.target.closest("[data-obj]");
    if (!c) return;
    var oid = c.getAttribute("data-obj");
    setObjDone(oid, c.checked);
    var row = c.closest(".obj");
    if (row) row.classList.toggle("done", c.checked);
    setPinVisible(oid, !c.checked);
  });
  document.getElementById("map-objs").addEventListener("click", function (e) {
    var ig = e.target.closest("[data-ignore]");
    if (ig) {
      var iid = ig.getAttribute("data-ignore");
      var nowIgnored = toggleIgnore(iid);
      dirty.quests = true;
      renderCurrent();
      var it = BY_ID[iid];
      toast(nowIgnored
        ? "Ignoring " + (it ? it.n : "quest") + " — moved to the bottom, not counted"
        : "Counting " + (it ? it.n : "quest") + " again");
      return;
    }
    var b = e.target.closest("[data-finish]");
    if (!b) return;
    var n = setStatus(b.getAttribute("data-finish"), "d");
    dirty.board = dirty.map = dirty.quests = dirty.setup = true;
    renderCurrent();
    toast(n > 1 ? "Marked as handed in, plus " + (n - 1) + " earlier quests in the chain" : "Marked as handed in");
  });
  document.getElementById("q-list").addEventListener("click", function (e) {
    var ig = e.target.closest("[data-ignore]");
    if (ig) {
      var iid = ig.getAttribute("data-ignore");
      var nowIgnored = toggleIgnore(iid);
      renderQuests();
      var it = BY_ID[iid];
      toast(nowIgnored
        ? "Ignoring " + (it ? it.n : "quest") + " — it will not count until you un-ignore it"
        : "Counting " + (it ? it.n : "quest") + " again");
      return;
    }
    var b = e.target.closest("[data-set]");
    if (!b) return;
    var id = b.getAttribute("data-task");
    var n = setStatus(id, b.getAttribute("data-set"));
    dirty.board = dirty.map = dirty.setup = true;
    if (n > 1) {
      // a chain got marked off, so other rows changed too
      renderQuests();
      toast("Also marked " + (n - 1) + " earlier quests in the chain as done");
    } else {
      patchRow(id);
      updateDoneCount();
    }
  });
  ["q-search", "q-trader", "q-map", "q-status"].forEach(function (id) {
    var el = document.getElementById(id);
    el.addEventListener("input", renderQuests);
    el.addEventListener("change", renderQuests);
  });

  // ---------- backup / restore ----------
  function backupText() {
    return JSON.stringify({
      app: "tarkov-raid-board", version: 1, saved: new Date().toISOString(),
      level: S.level, faction: S.faction, marks: S.marks, ignored: S.ignored,
      objDone: Object.keys(S.objDone)
    }, null, 1);
  }
  document.getElementById("s-copy").addEventListener("click", function () {
    var ta = document.getElementById("s-json");
    ta.value = backupText(); ta.select();
    try { document.execCommand("copy"); toast("Backup copied to the clipboard"); }
    catch (e) { toast("Backup written below — copy it by hand"); }
  });
  document.getElementById("s-save").addEventListener("click", function () {
    var text = backupText();
    var name = "tarkov-progress-" + new Date().toISOString().slice(0, 10) + ".json";
    Promise.resolve()
      .then(function () { return (window.claude && window.claude.use) ? window.claude.use("downloads") : null; })
      .catch(function () { return null; })
      .then(function (dl) {
        if (dl) return dl.save({ filename: name, data: text }).then(function () { toast("Saved " + name); });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([text], { type: "application/json" }));
        a.download = name; document.body.appendChild(a); a.click(); a.remove();
        toast("Saved " + name);
      })
      .catch(function () {
        document.getElementById("s-json").value = text;
        toast("Could not save a file here — copy the text below instead");
      });
  });
  document.getElementById("s-restore").addEventListener("click", function () {
    var raw = document.getElementById("s-json").value.trim();
    if (!raw) { toast("Paste a backup first"); return; }
    try {
      var o = JSON.parse(raw);
      S.marks = o.marks || o.status || {};
      // older backups stored a flat list of completed quests
      if (!o.marks && !o.status && o.done) o.done.forEach(function (i) { S.marks[i] = "d"; });
      S.ignored = o.ignored || {};
      S.objDone = {};
      (o.objDone || []).forEach(function (i) { S.objDone[i] = 1; });
      if (o.level) S.level = o.level;
      if (o.faction) S.faction = o.faction;
      document.getElementById("lvl").value = S.level;
      document.getElementById("faction").value = S.faction;
      persist(); renderAll();
      toast("Restored " + Object.keys(S.marks).length + " tracked quests");
    } catch (e) { toast("That does not look like a backup file"); }
  });
  document.getElementById("s-reset").addEventListener("click", function () {
    S.marks = {}; S.ignored = {}; S.objDone = {};
    persist(); renderAll();
    toast(LIVE ? "Your manual changes are cleared — the game logs still stand" : "Progress cleared");
  });

  // ---------- live: the game's own logs ----------
  // Only works when the page is served by `node board.js`; opened as a plain
  // file it just stays in manual mode and nothing below runs.
  function applySnapshot(snap) {
    LIVE = snap;
    LOG = snap.status || {};
    applyDetectedMode(snap.mode);
    setLivePill(true);
    renderRaid(snap.raid);
    if (snap.raid && snap.raid.state === "in-raid" && snap.raid.map && S.autoFollow) S.map = snap.raid.map;
  }

  /** Count only quests this board knows about — the logs also mention retired event quests. */
  function logCounts() {
    var active = 0, done = 0, failed = 0, unknown = 0;
    Object.keys(LOG).forEach(function (id) {
      if (!BY_ID[id]) { unknown++; return; }
      if (LOG[id] === "d") done++;
      else if (LOG[id] === "f") failed++;
      else active++;
    });
    return { active: active, done: done, failed: failed, unknown: unknown };
  }

  function setLivePill(ok) {
    var pill = document.getElementById("live-pill");
    pill.hidden = false;
    var top = document.getElementById("s-sync-top");
    if (top) top.hidden = false;
    pill.classList.toggle("stale", !ok);
    var c = logCounts();
    document.getElementById("live-text").textContent = ok
      ? c.active + " active · " + c.done + " done"
      : "Log watcher offline";
  }

  function renderRaid(raid) {
    var el = document.getElementById("raid-banner");
    if (!raid || raid.state !== "in-raid") { el.hidden = true; return; }
    var name = raid.map && MAP_BY_ID[raid.map] ? MAP_BY_ID[raid.map].name : (raid.raw || "an unknown map");
    el.hidden = false;
    el.innerHTML = "You are in a raid on <strong>" + esc(name) + "</strong>. " +
      (raid.map
        ? '<button class="linkish" data-goto="map">Open the ' + esc(name) + " plan</button>."
        : "No plan for this location.");
  }

  document.getElementById("raid-banner").addEventListener("click", function (e) {
    var b = e.target.closest("[data-goto]");
    if (b) tab(b.dataset.goto);
  });

  // ---------- where log lines come from ----------
  // Three possibilities, same snapshot shape out of all of them: the local watcher (background
  // polling, any browser), a folder handle the browser holds (hosted, Chromium only), or nothing
  // at all, which is manual ticking like every other tracker.
  var SOURCE = null;
  var FOLDER = null;
  var folderTimer = null;

  function sourceLabel() {
    return SOURCE === "folder" ? "your Logs folder" : SOURCE === "server" ? "the log watcher" : "nothing";
  }

  /** The game decides which mode you are in; the header control is only for people with no logs. */
  function applyDetectedMode(mode) {
    if (!mode || mode === S.gameMode) return;
    S.gameMode = mode;
    var sel = document.getElementById("gamemode");
    if (sel) sel.value = mode;
    persist();
    resetMemo();
    toast("Switched to " + mode.toUpperCase() + " — that is what your logs say");
  }

  var syncing = false;
  /** Re-read everything the current source knows. */
  function syncFromLogs(deep, quiet) {
    if (syncing || !SOURCE) {
      if (!SOURCE && !quiet) toast("Not reading any logs yet — connect them in Setup");
      return Promise.resolve();
    }
    syncing = true;
    var btns = [document.getElementById("live-pill"), document.getElementById("s-sync-top")]
      .filter(Boolean);
    btns.forEach(function (b) { b.classList.add("busy"); });
    var job = SOURCE === "folder"
      ? RaidLogs.scan(FOLDER, false)
      : fetch("api/state" + (deep ? "?rescan=1" : ""), { cache: "no-store" })
          .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("no watcher")); });
    return job
      .then(function (snap) {
        var was = JSON.stringify(LOG);
        applySnapshot(snap);
        renderAll();
        if (!quiet) {
          var c = logCounts();
          toast(was === JSON.stringify(LOG)
            ? "Already up to date — " + c.active + " active, " + c.done + " done"
            : "Synced — " + c.active + " active, " + c.done + " done");
        }
      })
      .catch(function () { if (!quiet) toast("Could not read " + sourceLabel()); setLivePill(false); })
      .then(function () {
        syncing = false;
        btns.forEach(function (b) { b.classList.remove("busy"); });
      });
  }

  /** Poll the session the game is writing to and fold anything new into what we already have. */
  function startFolderPolling() {
    if (folderTimer) clearInterval(folderTimer);
    folderTimer = setInterval(function () {
      if (document.hidden || !FOLDER) return;
      RaidLogs.scan(FOLDER, true).then(function (snap) {
        var changed = false;
        Object.keys(snap.status || {}).forEach(function (id) {
          if (LOG[id] === snap.status[id]) return;
          LOG[id] = snap.status[id];
          changed = true;
          // the game just told us what happened, so drop any stale hand-set value
          if (S.marks[id] !== undefined && S.marks[id] !== snap.status[id]) { delete S.marks[id]; persist(); }
          var t = BY_ID[id];
          if (t) toast((snap.status[id] === "d" ? "Completed: " : snap.status[id] === "f" ? "Failed: " : "Accepted: ") + t.n);
        });
        applyDetectedMode(snap.mode);
        if (snap.raid && (!LIVE || !LIVE.raid || snap.raid.at >= LIVE.raid.at)) {
          if (LIVE) LIVE.raid = snap.raid;
          renderRaid(snap.raid);
          if (snap.raid.state === "in-raid" && snap.raid.map && S.autoFollow && S.map !== snap.raid.map) {
            S.map = snap.raid.map; persist(); changed = true; tab("map");
          }
        }
        if (changed) { setLivePill(true); renderAll(); }
      }).catch(function () { /* folder went away or permission lapsed; the pill will say so */ });
    }, 8000);
  }

  function useFolder(dir, announce) {
    FOLDER = dir;
    SOURCE = "folder";
    return RaidLogs.scan(dir, false).then(function (snap) {
      applySnapshot(snap);
      renderAll();
      startFolderPolling();
      dirty.setup = true;
      renderCurrent();
      if (announce) {
        var c = logCounts();
        toast("Reading your logs — " + c.active + " active, " + c.done + " done");
      }
    });
  }

  /** Only ever called from a click, because the picker requires a gesture. */
  function connectFolder() {
    if (!window.RaidLogs || !RaidLogs.supported) {
      toast("This browser cannot open a folder — use Chrome or Edge, or the downloadable version");
      return;
    }
    RaidLogs.pick()
      .then(function (dir) { return useFolder(dir, true); })
      .catch(function () { toast("No folder chosen"); });
  }

  function forgetFolder() {
    if (folderTimer) { clearInterval(folderTimer); folderTimer = null; }
    FOLDER = null;
    if (SOURCE === "folder") { SOURCE = null; LIVE = null; LOG = {}; }
    RaidLogs.forget().then(function () {
      setLivePill(false);
      dirty.setup = true;
      renderAll();
      toast("Forgotten. Your ticks are untouched.");
    });
  }

  function connectLive() {
    if (!window.fetch || !/^https?:/.test(location.protocol)) return;
    // the local watcher wins when it is there: it polls in the background and needs no permission
    fetch("api/state", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error("no watcher")); })
      .then(function (snap) {
        SOURCE = "server";
        applySnapshot(snap);
        renderAll();
        watchServerEvents();
      })
      .catch(function () {
        if (!window.RaidLogs || !RaidLogs.supported) { dirty.setup = true; renderCurrent(); return; }
        RaidLogs.restore().then(function (dir) {
          if (dir) return useFolder(dir, false);
          dirty.setup = true;
          renderCurrent();
        }).catch(function () {});
      });
  }

  function watchServerEvents() {
    var src = new EventSource("api/events");
    var firstOpen = true;
    src.onopen = function () {
      // a reconnect means the page missed whatever happened while it was down
      if (firstOpen) { firstOpen = false; return; }
      syncFromLogs(true, true);
    };
    src.addEventListener("quest", function (ev) {
      var q = JSON.parse(ev.data);
      LOG[q.id] = q.status;
      // the game just told us what happened, so drop any stale hand-set value
      if (S.marks[q.id] !== undefined && S.marks[q.id] !== q.status) {
        delete S.marks[q.id];
        persist();
      }
      setLivePill(true);
      var t = BY_ID[q.id];
      if (t) toast((q.status === "d" ? "Completed: " : q.status === "f" ? "Failed: " : "Accepted: ") + t.n);
      renderAll();
    });
    src.addEventListener("raid", function (ev) {
      var raid = JSON.parse(ev.data);
      if (LIVE) LIVE.raid = raid;
      renderRaid(raid);
      if (raid.state === "in-raid" && raid.map && S.autoFollow) {
        S.map = raid.map;
        persist();
        renderAll();
        tab("map");
        var m = MAP_BY_ID[raid.map];
        toast("Heading into " + (m ? m.name : raid.map) + " — plan open");
      }
    });
    src.onerror = function () { setLivePill(false); };
  }

  document.getElementById("live-pill").addEventListener("click", function () {
    if (LIVE) syncFromLogs(true, false);
  });
  // the same sync lives in the top bar and in Setup — you want it the moment a raid ends
  document.getElementById("s-connect").addEventListener("click", connectFolder);
  document.getElementById("s-forget").addEventListener("click", forgetFolder);

  ["s-sync", "s-sync-top"].forEach(function (id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("click", function () {
      if (LIVE) syncFromLogs(true, false); else toast("Not connected to the log watcher");
    });
  });

  document.getElementById("s-follow").addEventListener("click", function () {
    S.autoFollow = !S.autoFollow;
    this.setAttribute("aria-pressed", String(S.autoFollow));
    persist();
  });
  document.getElementById("s-clear-marks").addEventListener("click", function () {
    var n = Object.keys(S.marks).length;
    S.marks = {};
    persist(); renderAll();
    toast(n ? "Cleared " + n + " manual changes" : "Nothing was set by hand");
  });

  // ---------- boot ----------
  loadState();
  document.getElementById("lvl").value = S.level;
  document.getElementById("faction").value = S.faction;
  document.getElementById("gamemode").value = S.gameMode;
  document.getElementById("theme").value = S.theme;
  if (S.theme !== "system") document.documentElement.setAttribute("data-theme", S.theme);
  document.getElementById("sort-total").setAttribute("aria-pressed", String(S.sort === "total"));
  document.getElementById("sort-rate").setAttribute("aria-pressed", String(S.sort === "rate"));
  document.getElementById("map-exits").setAttribute("aria-pressed", String(S.showExits !== false));

  var tsel = document.getElementById("q-trader");
  DATA.traders.forEach(function (t) {
    var o = document.createElement("option"); o.value = t; o.textContent = t; tsel.appendChild(o);
  });
  var msel = document.getElementById("q-map");
  MAPS.forEach(function (m) {
    var o = document.createElement("option"); o.value = m.id; o.textContent = m.name; msel.appendChild(o);
  });

  renderAll();
  connectLive();
})();
