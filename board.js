#!/usr/bin/env node
"use strict";
/**
 * Runs the Raid Board locally.
 *
 *   node board.js                 read the default EFT log folder, serve on 127.0.0.1:8778
 *   node board.js --port 9000     use another port
 *   node board.js --logs "D:/..." point at a different EFT Logs folder
 *   node board.js --no-open       do not launch a browser
 *
 * Reads the game's logs only — it never writes to them and never talks to BSG.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { exec } = require("child_process");
const { LogWatcher, defaultLogRoot } = require("./lib/logs");
const { WikiShots, pagesFromData, shotsFromData } = require("./lib/wiki");


const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const PORT = parseInt(opt("port", "8778"), 10);
const LOGS = opt("logs", defaultLogRoot());
const OPEN = !argv.includes("--no-open");

const PAGE = path.join(__dirname, "dist", "index.html");
if (!fs.existsSync(PAGE)) {
  console.error("Missing dist/index.html — run `node build.js` first.");
  process.exit(1);
}

const watcher = new LogWatcher(LOGS);
if (!fs.existsSync(LOGS)) {
  console.error(`\n  Log folder not found: ${LOGS}`);
  console.error(`  Pass the right one with:  node board.js --logs "C:/path/to/Escape from Tarkov/Logs"\n`);
}

console.log(`Reading logs from ${LOGS}`);
const applied = watcher.scanAll();
const snap = watcher.snapshot();
console.log(
  `  ${snap.sessions} sessions, ${applied} quest events -> ` +
  `${snap.counts.active} active, ${snap.counts.done} completed` +
  (snap.range.from ? `, back to ${new Date(snap.range.from).toISOString().slice(0, 10)}` : "")
);
watcher.start(2000);

// ---- live clients ----
const clients = new Set();
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) { try { res.write(frame); } catch (e) { clients.delete(res); } }
}
watcher.on("quest", (q) => { if (q.fresh) broadcast("quest", q); });
watcher.on("raid", (r) => broadcast("raid", r));

const DATA_FILE = path.join(__dirname, "data", "tarkov-data.json");
const wiki = new WikiShots(
  path.join(__dirname, "data", "wiki"),
  pagesFromData(DATA_FILE),
  shotsFromData(DATA_FILE)
);

const server = http.createServer((req, res) => {

  const url = req.url.split("?")[0];

  if (url === "/api/state") {
    // ?rescan=1 re-reads every session folder, not just the one the game is writing to
    if (/[?&]rescan=1/.test(req.url)) watcher.scanAll();
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    return res.end(JSON.stringify(watcher.snapshot()));
  }

  if (url === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive"
    });
    res.write("retry: 3000\n\n");
    clients.add(res);
    const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25000);
    req.on("close", () => { clearInterval(ping); clients.delete(res); });
    return;
  }

  // Wiki location screenshots. The browser only ever asks us for a quest id; we hold the
  // list of pages, so a page it made up cannot send us anywhere.
  if (url === "/api/wiki") {
    const q = /[?&]task=([A-Za-z0-9]+)/.exec(req.url);
    const send = (body) => {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      res.end(JSON.stringify(body));
    };
    if (!q) return send({ shots: [] });
    wiki.get(q[1]).then(send, () => send({ shots: [], error: "lookup failed" }));
    return;
  }

  const shot = url.match(/^\/wiki\/([a-f0-9]{16}\.(?:png|jpe?g|gif|webp))$/);
  if (shot) {
    const file = path.join(__dirname, "data", "wiki", shot[1]);
    if (fs.existsSync(file)) {
      const ext = shot[1].split(".").pop();
      res.writeHead(200, {
        "Content-Type": ext === "png" ? "image/png" : ext === "gif" ? "image/gif" : ext === "webp" ? "image/webp" : "image/jpeg",
        "Cache-Control": "max-age=604800"
      });
      return res.end(fs.readFileSync(file));
    }
  }

  // one guide file per quest, fetched when you open a Guide button
  const guide = url.match(/^\/guides\/([A-Za-z0-9]+\.json)$/);
  if (guide) {
    const file = path.join(__dirname, "dist", "guides", guide[1]);
    if (fs.existsSync(file)) {
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      return res.end(fs.readFileSync(file));
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end('{"o":{},"x":{}}');
  }

  const map = url.match(/^\/maps\/([A-Za-z0-9_.-]+\.svg)$/);
  if (map) {
    const file = path.join(__dirname, "dist", "maps", map[1]);
    if (fs.existsSync(file)) {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "max-age=86400" });
      return res.end(fs.readFileSync(file));
    }
  }

  if (url === "/" || url === "/index.html") {
    const body = fs.readFileSync(PAGE);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    return res.end(body);
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("Not found");
});

server.listen(PORT, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${PORT}/`;
  console.log(`\n  Raid Board running at ${url}`);
  console.log(`  Watching for quest and raid events. Ctrl+C to stop.\n`);
  if (OPEN) exec(`start "" "${url}"`, { shell: "cmd.exe" }, () => {});
});

server.on("error", (e) => {
  if (e.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use — try: node board.js --port ${PORT + 1}`);
    process.exit(1);
  }
  throw e;
});
